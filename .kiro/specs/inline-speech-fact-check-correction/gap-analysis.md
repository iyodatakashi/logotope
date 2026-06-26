# Gap Analysis: inline-speech-fact-check-correction

## 概要

- 本機能は「発言ドラフト生成 → ファクトチェック → 指摘フィードバックで再生成 → 正式登録」をターン生成ループに組み込む。挿入点は唯一 [generatePersonaTurn](functions/src/pipeline/debate/turn.ts#L154)（`generateTurn` の直後・`addTurn` の直前）に集約され、検証本体は既存 [checkTurn](functions/src/pipeline/fact-check/fact-check-runner.ts#L110) をほぼそのまま再利用できる。新規配管は「ドラフト検証→フィードバック構築→再生成」の薄いオーケストレーション1本に収まる。
- **レイテンシ懸念は実態として小さい**。討論は `runStep`（[onTaskDispatched, timeoutSeconds 540](functions/src/api/debates.ts#L122)）が**1タスク=1ターン**で回す構造（[debate-orchestrator.ts](functions/src/pipeline/debate/debate-orchestrator.ts) が各ターン後に次ステップを enqueue）。1発言の予算は最大540秒で、現状のターン生成は数十秒。grounding 検証（〜10-30秒）＋再生成（〜10秒）を足しても1ターン予算に十分収まる。要件7はチャプター一括ではなくターン単位で素直に満たせる。
- 検証関数 `checkTurn` は引数が `DebateTurn`（`id`・`speakerType` 前提）。ドラフトはまだ `id` を持たないため、**`content` + `speechMode` を入力とするコア関数（例 `checkContent`）への小リファクタ**が要る。`FactCheckContext` には `topicTitle` が必要だが `generatePersonaTurn` は `chapter`（title/focusQuestion）しか持たないため、トピックタイトルの受け渡しが要る（軽微）。
- **再生成は新規実装ではなく既存 [generateTurn](functions/src/agents/persona-agent.ts#L208) の拡張**で実現する。指摘（claim/verdict/correction/reason）をプロンプトに注入する任意パラメータを足し、同じ関数を1回だけ再実行する。口調・立場・指名ロジックは既存プロンプト資産がそのまま効く。
- 主要な設計判断は3点：(1) **補正トレースの保存先**（ターン埋め込み or 既存 `factCheck/result` 流用）、(2) **後追い `runFactCheck` との役割整理**（補正済み発言の二重 grounding をどう避けるか）、(3) **`fact-check-validity-improvement` への依存**（「断定のみ検証」の判定はそのスペックのプロンプト改修が前提＝実装順序の依存）。Effort **M〜L**、Risk **Medium**（コスト増とプロンプト品質依存）。

## 1. 現状調査（Current State）

### 関連資産

| 資産 | 役割 | 本機能との関係 |
|------|------|----------------|
| [generatePersonaTurn](functions/src/pipeline/debate/turn.ts#L154) | ペルソナ発言を `generateTurn`→`addTurn` で生成・永続 | **挿入の中心**。`generateTurn`(L191) と `addTurn`(L225) の間にファクトチェック＋再生成を差し込む |
| [generateTurn](functions/src/agents/persona-agent.ts#L208) | LLM でドラフト生成（`PersonaReply`: content/speechMode/beliefChange/target/search） | **再生成の拡張点**。指摘フィードバック注入の任意引数を追加 |
| [checkTurn](functions/src/pipeline/fact-check/fact-check-runner.ts#L110) | 1発言を Phase1(grounding)→Phase2(構造化)で検証し `FactCheckFinding[]` を返す | **再利用の中心**。`DebateTurn` 依存をコア化してドラフトにも使う |
| `buildPhase1Prompt`/`buildPhase2Prompt`（同ファイル L50/77） | 検証・構造化プロンプト（断定のみ・反証起点） | そのまま流用。`fact-check-validity-improvement` 改修と同じ判定基準 |
| [FactCheckContext](functions/src/pipeline/fact-check/fact-check-runner.ts#L30) | topicTitle/chapterTitle/focusQuestion/currentDate を検証に渡す | ドラフト検証時にも構築が要る。`topicTitle` の受け渡しがギャップ |
| [addTurn](functions/src/pipeline/debate/turn.ts#L51) | 章ローカル index 照合＋runId 世代照合の冪等追記 | **不変**。補正後 content をここに渡す。冪等性の防壁として機能 |
| [FactCheckFinding / FactCheckResultForFirestore](functions/src/types/fact-check.types.ts) | 指摘・結果の永続契約（`turnId` 前提） | トレース保存をこの構造に整合させるか、ターン埋め込みにするかの判断点 |
| [fact-check-repository.ts](functions/src/pipeline/fact-check/fact-check-repository.ts) | `factCheck/result` への start/append/complete/delete | 後追い専用。トレース流用するなら append を再利用 |
| [DebateTurn / NewTurnFields](functions/src/types/turn.types.ts) | ターンの実行時型・追記入力型 | トレースをターン埋め込みにする場合の拡張点（`buildTurnRecord` L28 に追加） |
| [runStep](functions/src/api/debates.ts#L122)（onTaskDispatched 540s, GEMINI_API_KEY 等を secrets 保持） | 1ターン=1タスクの実行器 | **インラインの実行環境**。Gemini provider が既に利用可、レイテンシ予算もここで決まる |
| [currentDateString()](functions/src/utils/prompt-formatters.ts#L4) | 「本日は YYYY年M月D日」 | `FactCheckContext.currentDate` に流用 |
| [isDebateActive](functions/src/pipeline/debate/debate-lifecycle.ts) | 生成中の停止判定（generatePersonaTurn L212） | 検証・再生成の前後で停止ガードを尊重する |

### 規約・制約

- **置き場所**: AI 検証ロジックは `functions/src/pipeline/fact-check/`、発言生成は `pipeline/debate/` と `agents/`。インラインのオーケストレーションは debate 側（ターン生成の一部）に置くのが責務的に自然。
- **過度な共通化の禁止**（structure.md）: 中央ディスパッチャを作らず、ターンの処理はターン生成経路に素直に書く。
- **冪等・世代照合**: `addTurn` の index/runId 照合が唯一のコミット点。ファクトチェック・再生成はコミット前に閉じるため、タスク再試行時は検証が再走する（コスト増だが正しさは保たれる）。
- **検索プロバイダ**: 検証は Gemini `google_search` grounding（`getGoogleProvider` / `GEMINI_API_KEY`）。`runStep` の secrets に含まれ、インラインで利用可。未設定時は検証スキップ＝補正なしで登録（要件6と整合）。
- **型の二重管理**: functions（`types/`）と FE（`src/lib/models/factCheck/`）で同形型。トレースを型に足す場合は両側整合が要る。

## 2. 要件 → 資産マップ（Requirement-to-Asset Map）

| 要件 | 必要な技術要素 | 既存資産 | ギャップ |
|------|----------------|----------|----------|
| 1.1-1.3 ドラフトを検証経由で登録 | `generateTurn` 後・`addTurn` 前に検証を挟む | 両関数が同一スコープ（generatePersonaTurn） | **Missing**: 中間オーケストレーション |
| 1.4 最大1巡・再検証なし | 1回だけ検証→（必要なら）1回だけ再生成 | — | **Missing**: ループ制御（軽量） |
| 1.5 ファシリテーターは対象外 | persona 経路のみに適用 | `generateFacilitatorTurn` は別関数 | **対応済み**（経路分離で自然に除外） |
| 2.1-2.5 断定のみ検証・指摘なしは素通し | 断定/非断定判定 + finding 0 件の分岐 | `checkTurn` のプロンプト・post-processing | **Constraint**: 判定品質は `fact-check-validity-improvement` 依存 |
| 3.1-3.5 指摘フィードバックで再生成 | findings をプロンプト注入し再実行 | `generateTurn`（拡張） | **Missing**: フィードバック引数・プロンプト節 |
| 4.1-4.4 補正トレース記録 | 原ドラフト・指摘・補正後を保存 | `FactCheckFinding`/repository or ターン埋め込み | **Missing/要判断**: 保存先と契約 |
| 5.1-5.4 後追いとの関係整理 | 補正済み発言の二重検証回避 | `runFactCheck`/`checkChapter` | **Constraint**: 重複・矛盾防止の方針 |
| 6.1-6.4 失敗時フォールバック | 例外/タイムアウト時は原ドラフト登録 | Result 型・try/catch 規約 | **Missing**: 検証/再生成の失敗ハンドリング |
| 7.1 断定なしは検証起動せず素通し | 事前の軽量判定 or Phase 構成 | Phase1 で google_search 起動 | **要判断**: 起動前ゲートを置くか |
| 7.2-7.3 ターン/章タイムアウト内 | 1ターン予算で同期完了 | runStep 540s・1タスク=1ターン | **対応済み**（予算は十分） |

## 3. 実装アプローチ

### Option A: `generatePersonaTurn` に直接インライン（最小拡張）

- **対象**: [turn.ts](functions/src/pipeline/debate/turn.ts#L154) の `generatePersonaTurn` 内に、検証→フィードバック→再生成を直書き。`checkTurn` を呼び、findings があれば `generateTurn` を再実行して content を差し替えてから `addTurn`。
- **トレードオフ**:
  - ✅ 新規ファイルなし、最短。挿入点が1関数に閉じる
  - ✅ 既存の停止ガード・冪等追記をそのまま活かせる
  - ❌ `generatePersonaTurn` が肥大化（検証・再生成・トレースで責務過多）
  - ❌ `checkTurn` の `DebateTurn` 依存をどう満たすか（ダミーID付与）が場当たりになりやすい

### Option B: インライン補正モジュールを新設（推奨）

- **対象**: `pipeline/debate/`（または `pipeline/fact-check/`）に薄いオーケストレーション関数を新設（例 `verifyAndReviseDraft({ content, speechMode, context, persona, ... })`）。内部で「`checkContent` 呼び出し → findings 0 件なら素通し → あれば `generateTurn` をフィードバック付きで再実行」を担い、`generatePersonaTurn` はこれを1行で呼ぶ。あわせて `checkTurn` から `checkContent(content, speechMode, context)` コアを抽出（`checkTurn` は薄いラッパに）。
- **トレードオフ**:
  - ✅ `generatePersonaTurn` は薄いまま、補正の責務が分離されテスト容易
  - ✅ `checkContent` 抽出でドラフト検証・後追い検証の両方から再利用
  - ✅ 後追い `checkChapter` とコードを共有でき判定の一貫性が保てる
  - ❌ 新規ファイル＋小リファクタで初期コストがやや増（structure.md の「真に共通な処理のヘルパー化」には合致）

### Option C: ハイブリッド（段階導入＋フラグ）

- **Phase1（補正コア）**: Option B のモジュールで検証→再生成→`addTurn` を実装。トレースは最小（ターン埋め込みで原ドラフト＋findings を保持、要件4）。後追い `runFactCheck` は当面そのまま残す。
- **Phase2（重複整理）**: 後追い側を「補正済み発言はスキップ／再検証のみ」に調整し、要件5の二重 grounding を解消。必要なら設定で inline 補正の ON/OFF を切替。
- **トレードオフ**:
  - ✅ コア機能を早期投入し、後追いとの整合・コスト最適化を後続に隔離
  - ✅ ロールバック容易（フラグで旧挙動に戻せる）
  - ❌ 2段階のスコープ管理が必要

## 4. 主要な設計判断（要設計確定）

1. **補正トレースの保存先（要件4）**
   - 案1: 既存 `factCheck/result`（per-chapter）に `appendFactCheckFindings` で追記。✅契約再利用 / ❌このドキュメントは後追い前提・章再生成で delete され、「未解決の指摘」という意味論。補正済み（解決済み）指摘を同じ箱に入れると要件5.3/5.4（二重・矛盾の回避）と衝突しやすい。
   - 案2: **ターンに埋め込み**（`TurnEmbed.factCheck?: { originalContent, findings, revised: boolean }`）。✅発言と常に一緒に読む監査情報を co-locate（firebase.md の埋め込み原則に合致）、✅後追いの「未解決指摘」と意味論が分離。❌ターンサイズ増・FE 型追従。
   - → 案2 を軸に、補正の有無（要件4.2/4.3）と失敗時の未検証フラグ（要件6.2）を同じ埋め込みに表現するのが整合的。
2. **再生成プロンプトの制約（要件3.3）**: 「事実訂正で結論が変わるのは許容、ただし論旨の方向性・指名（target）整合は維持」をどう指示するか。指名先・直前文脈との齟齬を避けるためのプロンプト節を設計で具体化。
3. **後追い `runFactCheck` の役割（要件5）**: (a) 残して補正済みを再検証 / (b) 補正済みターンは grounding をスキップし inline トレースを表示に流用 / (c) 廃止。inline 全ターン検証で grounding が二重に走るコストを踏まえ、(b) を軸に検討。
4. **検証起動ゲート（要件7.1）**: 断定主張がない発言で google_search を起こさないために、Phase1 前に軽量判定を置くか、Phase1 のままで「対象なし＝即 finding 0」に委ねるか。コスト最小化と実装単純さのトレードオフ。

## 5. Effort & Risk

- **Effort: M〜L（5日〜2週間）** — コア（checkContent 抽出＋オーケストレーション＋generateTurn 拡張）は M。トレース埋め込み（型・FE 追従）、後追いとの重複整理（要件5）、フォールバック網羅、テスト更新まで含めると L。
- **Risk: Medium**
  - **コスト増（主因）**: ペルソナ発言ごとに grounding（Gemini pro）＋構造化（flash）＋場合により再生成（persona LLM）が加わり、発言あたり LLM 呼び出しが概ね2〜3倍。1章15発言規模で無視できない。起動ゲート（要件7.1）と後追い重複解消（要件5）で緩和。
  - **判定品質依存**: 「断定のみ補正」の精度は `fact-check-validity-improvement` のプロンプトに依存。**そのスペックは tasks 未着手**であり、本機能は実装順序としてその後段が望ましい（依存関係）。
  - **再生成の副作用**: 補正で結論が変わると指名先・後続文脈と齟齬しうる（要件3.3の制約で緩和、設計で要詰め）。
  - **Low 寄りの要素**: レイテンシは1タスク=1ターン・540秒予算で十分。Gemini provider は runStep に既存。冪等追記は不変で回帰範囲が限定。

## 6. design フェーズへの引き継ぎ

### 推奨アプローチ
- **Option B（補正モジュール新設＋`checkContent` 抽出）＋ Option C の段階導入**。コアを先に投入し、後追いとの重複整理・コスト最適化を後続フェーズに隔離する。

### 主要な設計判断（再掲・確定対象）
1. トレース保存先：**ターン埋め込み（案2）** か `factCheck/result` 流用か。要件4・5・6.2の表現に直結。
2. 後追い `runFactCheck` の扱い：補正済みターンの再検証スキップ／表示流用／廃止。
3. 再生成プロンプトの制約：論旨方向性・指名整合の維持指示。
4. 検証起動ゲート（要件7.1）の有無と実装位置。

### Research Needed（design で確認）
- `checkTurn` の `DebateTurn` 依存を `checkContent(content, speechMode, context)` に切り出す際の、後追い `checkChapter`・既存テスト（[fact-check-runner.test.ts](functions/src/tests/pipeline/fact-check/fact-check-runner.test.ts)）への影響範囲。
- `generateTurn` へのフィードバック注入が、検索ツール（web_search）使用や beliefChange 出力と干渉しないか（再生成時のツール再利用・スキーマ不変の確認）。
- トレースをターン埋め込みにした場合の FE 型（`src/lib/models/factCheck/`）・表示（`FactCheckFindings.svelte`）への波及と、後追い指摘表示との出し分け。
- `fact-check-validity-improvement`（断定判定）の実装完了を本機能の前提とするか、並行で進めて判定基準を共有するかの順序判断。
