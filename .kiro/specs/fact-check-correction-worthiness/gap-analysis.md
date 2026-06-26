# Gap Analysis: fact-check-correction-worthiness

## 概要

- 本機能は検出済み finding に対する**最終フィルタ（修正適否ジャッジ）**を [checkTurn](functions/src/pipeline/fact-check/fact-check-runner.ts#L110) の内部・`return` 直前（[L153-174](functions/src/pipeline/fact-check/fact-check-runner.ts#L153)）に1段追加するだけで、要件1.4（共通フィルタ）が自動的に満たされる。`checkTurn` は後追い [checkChapter](functions/src/pipeline/fact-check/fact-check-runner.ts#L196) と将来の inline 補正の**唯一の合流点**であり、ここを通せば全消費者がフィルタ済み finding を受け取る。
- 必要な配管はほぼ揃っている。判定に要る討論文脈は既存の [FactCheckContext](functions/src/pipeline/fact-check/fact-check-runner.ts#L30)（topicTitle/chapterTitle/focusQuestion/currentDate）をそのまま再利用でき、`checkTurn` は既に `turn.content` と finding 群を手元に持つ。判定モデルは [PIPELINE_MODELS](functions/src/constants/ai.constants.ts#L6) に `factCheckJudge`（gemini-2.5-flash 相当）を足し、[getPipelineModel](functions/src/llm/models.ts#L35) に case を1つ追加すれば足りる。
- 判定は**発言単位で1回の LLM 呼び出し**にまとめ、その発言の全 finding をまとめて評価するのが自然（要件1.3: finding 0 件なら判定を起動しない＝大半のターンは追加コストなし）。
- 主要な設計判断は2点：(1) **対象外にした finding の記録方法**（破棄してログのみ＝型変更なし / フラグを残して永続＝functions・FE 両型と表示に波及）、(2) **判定失敗時のフェイルオープン**（要件6.1: フィルタせず全 finding を残す）を `checkTurn` の Result を壊さずに実装すること。
- 難所はコードではなく**プロンプトの汎化**（validity-improvement と同質）。要件2.6「特定事例を埋め込まない」と要件5.3「不確実なら残す保守的デフォルト」を軸にし、評価ケース（過検出5件＋回帰）で守る。Effort **S〜M**、Risk **Medium**（プロンプト品質依存のみ）。

## 1. 現状調査（Current State）

### 関連資産

| 資産 | 役割 | 本機能との関係 |
|------|------|----------------|
| [checkTurn](functions/src/pipeline/fact-check/fact-check-runner.ts#L110) | 1発言を Phase1(grounding)→Phase2(構造化)→post-processing し `FactCheckFinding[]` を返す | **追加の中心**。`return`（L174）直前に Phase3 ジャッジを挿入 |
| post-processing（[L153-172](functions/src/pipeline/fact-check/fact-check-runner.ts#L153)） | 引用照合・出典写像・unverifiable 格上げで findings を確定 | ジャッジはこの確定済み findings を入力にする |
| [checkChapter](functions/src/pipeline/fact-check/fact-check-runner.ts#L196) | 章の全発言を `checkTurn` で回し集約（後追い） | フィルタ済み finding を**自動で**受け取る消費者。変更不要 |
| [FactCheckContext](functions/src/pipeline/fact-check/fact-check-runner.ts#L30) | topicTitle/chapterTitle/focusQuestion/currentDate | ジャッジの討論文脈（要件2.1）に再利用 |
| [FactCheckFinding](functions/src/types/fact-check.types.ts#L8)（functions） | claim/verdict/correction/reason/sources/turnId | 記録方式により拡張 or 不変（判断点） |
| [factCheck.types.ts](src/lib/models/factCheck/factCheck.types.ts#L9)（FE 同形型） | FE 側 finding | 記録を型に足す場合のみ追従 |
| [FactCheckFindings.svelte](src/lib/features/admin/debate/FactCheckFindings.svelte) | 指摘表示 | フィルタ済みを表示するだけ＝原則不変（要件: 表示レイアウト変更は out of scope） |
| [PIPELINE_MODELS](functions/src/constants/ai.constants.ts#L6) / [getPipelineModel](functions/src/llm/models.ts#L35) | パイプライン用モデル選択 | `factCheckJudge` を追加 |
| [appendFactCheckFindings](functions/src/pipeline/fact-check/fact-check-repository.ts#L27) ほか repository | `factCheck/result` への逐次追記・status 遷移 | フィルタ済みを渡すだけ＝変更不要（記録を永続するなら拡張点） |
| [fact-check-runner.test.ts](functions/src/tests/pipeline/fact-check/fact-check-runner.test.ts) | runner の単体テスト（ai/grounding/モデルをモック） | **評価ケース（要件3/4/5）の回帰追加先**。`generateObject` モックにジャッジ分を足す |

### 規約・制約

- **置き場所**: AI 検証ロジックは `functions/src/pipeline/fact-check/`。ジャッジは runner にコロケート（既存 Phase1/Phase2 と同じ）か、同ディレクトリの別ファイルに切り出す。
- **過度な共通化の禁止**（structure.md）: 中央ディスパッチャを作らず、判定は検出経路（`checkTurn`）内に素直に置く。「共通フィルタ」は**ディスパッチャではなくパイプライン1段**として実現する点が重要。
- **既存ガードの踏襲**: post-processing は `turn.content.includes(f.claim)` の引用照合・出典写像・unverifiable 格上げを行う。ジャッジはその**後段**に積む（確定 finding を入力にする）。
- **型の二重管理**: functions（`types/`）と FE（`models/factCheck/`）で同形。記録を型に足す場合は両側整合が要る。
- **モデル選択**: `getPipelineModel('factCheckStructuring')` と同様、Gemini provider 経由（`GEMINI_API_KEY`）。後追い・inline いずれの実行環境（runStep / runFactCheckTask）も secrets を保持済み。

## 2. 要件 → 資産マップ（Requirement-to-Asset Map）

| 要件 | 必要な技術要素 | 既存資産 | ギャップ |
|------|----------------|----------|----------|
| 1.1-1.2 finding を表示前にフィルタ | Phase3 ジャッジ＋除外適用 | `checkTurn` の findings 配列 | **Missing**: ジャッジ呼び出しと filter 適用 |
| 1.3 finding 0 件なら起動しない | 早期 return | findings.length 判定 | **Missing**（軽微）: ガード |
| 1.4 検出内部に置き全経路が受領 | `checkTurn` 内に配置 | `checkTurn` が唯一の合流点 | **対応容易**（配置で自然に充足） |
| 2.1-2.2 討論文脈＋原則で判定 | 文脈付きプロンプト | `FactCheckContext` 再利用可 | **Missing**: 判定プロンプト |
| 2.3-2.5 修正適否の基準 | 断定の事実誤認のみ通す判定 | — | **Missing**: 判定基準（プロンプト） |
| 2.6 汎化・事例非埋め込み | 原則ベースのプロンプト | — | **Constraint**: プロンプト設計方針 |
| 3.x 問いの前提を抑制 | 判定基準＋回帰テスト | — / テスト基盤あり | **Missing**: 基準＋評価ケース |
| 4.x 当為・提案を抑制 | 同上 | — / テスト基盤あり | **Missing**: 基準＋評価ケース |
| 5.1-5.4 真の誤りは残す/保守的 | 判定の保守的デフォルト | post-processing の前例 | **Missing**: 「不確実なら残す」実装 |
| 6.1-6.3 失敗時フェイルオープン | try/catch で全 finding 温存 | runner の Result 規約 | **Missing**: ジャッジ失敗の独立ハンドリング |
| 7.1-7.3 判定根拠の記録 | per-finding 判定＋理由の出力 | finding 型 / repository | **要判断**: 構造化返却のみ(テスト用) か 永続まで |

## 3. 実装アプローチ

### Option A: `checkTurn` 内に直書き（最小）

- **対象**: [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) に private `judgeCorrectionWorthiness(content, findings, context)` を追加し、`checkTurn` の `return` 直前で呼んでフィルタ。`findingSchema` と並びに判定用 Zod スキーマ、`buildPhase3Prompt` を同居。`PIPELINE_MODELS.factCheckJudge` 追加。
- **トレードオフ**:
  - ✅ 新規ファイルなし・最短。Phase1/2 と同じ場所で流れが追える
  - ✅ `checkChapter`・inline は無変更で恩恵
  - ❌ runner が肥大（既に Phase1/2＋post-processing で長い）

### Option B: 判定モジュールを別ファイルに分離（推奨）

- **対象**: `pipeline/fact-check/fact-check-judge.ts`（仮）に `judgeCorrectionWorthiness` とプロンプト・スキーマを切り出し、`checkTurn` から1行で呼ぶ。
- **トレードオフ**:
  - ✅ 判定責務が独立しテスト容易（評価ケースを judge 単体で回せる）
  - ✅ runner は「検出」、judge は「修正適否」と責務が明快。プロンプト汎化の試行錯誤を隔離できる
  - ✅ 将来 inline がドラフト検証で judge を直接使う余地も残る
  - ❌ 新規ファイル＋配線が少し増える（structure.md の「真に共通な処理のヘルパー化」に合致）

### Option C: 各消費者側に判定を置く

- **対象**: `checkChapter` と inline にそれぞれ判定を実装。
- **トレードオフ**:
  - ❌ 要件1.4（共通フィルタ）に反し、判定が二重化・不整合化。**非推奨**

## 4. 主要な設計判断（要設計確定）

1. **対象外 finding の記録方式（要件6.2 / 7）**
   - 案1: **破棄＋ログのみ** — ジャッジは修正対象のみ返し、除外分は理由を `console`／構造化ログに出すだけ。型・FE・repository 不変。要件7.2（評価可能な単位での判定結果）は**ジャッジ関数の構造化返り値＋単体テスト**で満たす。最小スコープ。
   - 案2: **フラグを残して永続** — `FactCheckFinding` に `correctionWorthy?: boolean` / `judgeReason?: string` を足し、除外分も保持。functions・FE 両型と `FactCheckFindings.svelte` の出し分けに波及。透明性は高いが out-of-scope（表示変更）に触れる。
   - → **案1 を基本**にし、評価・監査はテストとログで担保。永続が要るなら後続スコープへ。
2. **判定失敗時のフェイルオープン（要件6.1/6.3）**: ジャッジは `checkTurn` の Result を壊さない。`try/catch` で失敗時は**入力 findings をそのまま返す**（フィルタしない）。検出（Phase1/2）の失敗とは別系統。要件6.2の「未判定」記録は案1ならログ、案2ならフラグ。
3. **判定の呼び出し単位**: 発言単位で findings をまとめて1回（コスト最小・要件1.3）。finding と判定結果の突合は claim 文字列 or インデックスで行う（Phase2 と同じ引用照合の前例あり）。
4. **保守的デフォルト（要件5.3）**: ジャッジ出力に「不確実」を表現させ、不確実は**残す**側に写像。プロンプトとスキーマ（例: `decision: 'correct' | 'skip' | 'uncertain'` → uncertain は correct 扱い）で実装。

## 5. Effort & Risk

- **Effort: S〜M（2〜5日）** — judge 関数＋プロンプト＋Zod スキーマ＋モデル定数追加＋`checkTurn` 1箇所の配線で S。評価ケース（過検出5件＋回帰4件）の単体テスト整備、保守的デフォルトとフェイルオープンの網羅で M。記録を永続（案2）まで広げると型・FE 追従で M+。
- **Risk: Medium**
  - **プロンプト汎化（主因・Low寄り運用可）**: validity-improvement と同質のファジーさ。要件2.6（事例非埋め込み）・5.3（不確実は残す）を保守的デフォルトにし、評価セットで回帰確認すれば限定可能。過検出を消しすぎると要件5（見逃し）に振れるため、評価セットに「修正すべき」ケースも含めて両側を固定する。
  - **コスト（小）**: finding を持つ発言のみ +1 LLM 呼び出し。大半のターンは finding 0 でジャッジ非起動。後追いは章末1回の重い処理内に収まり、inline でもターン予算内。
  - **非決定性（小）**: `checkChapter` 再試行でジャッジも再走し結果が揺れうる。既存 `resetFactCheckProgress` が部分追記をクリアするため整合は保たれる。
  - **Low 要素**: 配管は既存パターンの踏襲、消費者（checkChapter/FE）は無変更、回帰範囲が runner＋テストに限定。

## 6. design フェーズへの引き継ぎ

### 推奨アプローチ
- **Option B（judge を別ファイルに分離）＋記録は案1（破棄＋ログ／構造化返却）**。`checkTurn` の `return` 直前に共通フィルタとして差し込み、評価ケースは judge 単体テストで回す。

### 主要な設計判断（確定対象）
1. 記録方式：案1（ログ＋テスト）か案2（型・FE 拡張で永続）か。要件6.2/7 の充足水準を決める。
2. ジャッジの出力スキーマ：`decision`（correct/skip/uncertain）＋ reason、finding との突合キー（claim 部分文字列 or index）。
3. 保守的デフォルトの写像（uncertain → 残す）と、フェイルオープンの実装位置。
4. 判定モデル（`factCheckJudge` = flash 相当でよいか、pro が要るか）。

### Research Needed（design で確認）
- 原則ベース・事例非埋め込み（要件2.6）で過検出5カテゴリ例と回帰4例を両立するプロンプト設計と、評価方法（held-out で汎化を見る）。
- `checkTurn` の Result 型を壊さずジャッジ失敗をフェイルオープンする実装と、既存テスト（[fact-check-runner.test.ts](functions/src/tests/pipeline/fact-check/fact-check-runner.test.ts)）の `generateObject` モック追加の影響範囲。
- 案2を採る場合の `FactCheckFinding`（functions/FE）拡張と `FactCheckFindings.svelte` の出し分け、`inline-speech-fact-check-correction` の補正ゲートが参照する契約への影響。
- inline 補正（将来）が judge をドラフト（id 未確定）に対しても呼べるよう、judge の入力を `content + findings + context`（`DebateTurn` 非依存）にしておくべきか。
