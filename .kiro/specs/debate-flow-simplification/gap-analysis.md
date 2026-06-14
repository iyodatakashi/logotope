# Gap Analysis: debate-flow-simplification

要件（requirements.md）と現行コードの差分を整理し、設計フェーズの判断材料を提供する。本仕様は新機能の追加ではなく**現行討論フローの分岐整理・不整合解消（コード健全性）**であり、「不足している機能」ではなく「散在・重複・不一致の解消」がギャップの中心である。

## 1. 現状調査（Current State）

### 対象コードと規模
| ファイル | 行数 | 役割 |
|---|---|---|
| `functions/src/pipeline/debate-orchestrator.ts` | 654 | ライフサイクル・ターンループ本体（整理の中心） |
| `functions/src/pipeline/flow/speaker-selection.ts` | 101 | 指名解決・話者決定・発言パラメータ |
| `functions/src/pipeline/flow/chapter-progress.ts` | 32 | 活性シグナル・早期終了・章ターン上限 |
| `functions/src/pipeline/flow/intervention-policy.ts` | 9 | 介入クールダウン判定 |
| `functions/src/pipeline/flow/state-restore.ts` | 95 | 保存済みターン＋キューからの状態復元 |
| `functions/src/agents/facilitator-agent.ts` | 440 | 介入(A/B)・章立て・オープニング等の LLM 呼び出し |

### テスト資産（振る舞いの基準＝behavior oracle として重要）
| テスト | 行数 |
|---|---|
| `debate-orchestrator.test.ts` | 569 |
| `debate-orchestrator.integration.test.ts` | 293 |
| `flow/speaker-selection.test.ts` | 220 |
| `flow/state-restore.test.ts` | 210 |
| `flow/chapter-progress.test.ts` | 86 |
| `flow/intervention-policy.test.ts` | 32 |
| `agents/facilitator-agent.test.ts` | 537 |

flow 配下の4モジュールはすべて純関数として独立テスト済み。orchestrator はリポジトリ／エージェントをモックした Vitest で単体・結合テストを持つ。**この既存テスト群が要件8（振る舞い保全）の検証基盤になる。**

### 統合面（Integration Surfaces）
- **呼び出し元**: `functions/src/api/debates.ts` のみ。
  - `generateChaptersOnly(topicId)` ← `generateChapters`（onCall）
  - `executeChapterTask(topicId, chapterIndex)` ← `runChapter`（onTaskDispatched、Cloud Tasks）
  - 章ごとに `runChapter` タスクをチェーン投入（`hasNextChapter` が true なら次章を enqueue）。タイムアウト540秒・最大3リトライ・最終リトライ失敗で `markTopicStopped`。
- **状態モデル**: タスクはステートレス。`executeChapterTask` のたびに保存済みターン＋永続化キュー（`loadPendingIntents`）から `restoreDebateState` で `DebateState` を復元する。→ **要件8の振る舞い保全は「復元 + 話者決定が同一入力で決定的」であることに依存**し、`state-restore.test.ts` がこの性質を担保している。
- **公開インターフェース制約**: `generateChaptersOnly` / `executeChapterTask` のシグネチャは `api/debates.ts` が依存。整理は内部実装に限定し、この2メソッドの呼び出し契約を変えないこと。
- **型**: `SpeakerSource = 'nomination' | 'direct_address' | 'queue' | 'score'`（types/index.ts:88）。話者決定のソース種別はここに集約済み。

### アーキテクチャ制約（steering 由来）
- TypeScript strict・`any` 禁止（`unknown` でナローイング）。
- 変数名を省略しない（`def` 等の略名禁止）。
- **エミュレータ未使用＝本番 Functions 直結**。functions 変更は最終的にデプロイ検証が必要だが、本仕様は純粋ロジックの整理が中心のため**Vitest 単体/結合テストで大半を検証可能**。
- 過度な共通化禁止の原則は主に UI 画面が対象。flow の制御定数の単一定義化は「画面非依存の真に共通な処理」に該当し、原則に反しない。ただし「フェーズ番号で分岐する中央ディスパッチャ」のような重い抽象化の新設は避ける。

## 2. 要件→資産マップ（ギャップ種別: Missing=新規 / Constraint=既存制約 / Cleanup=整理）

| 要件 | 対応資産 | ギャップ | 種別 |
|---|---|---|---|
| **1** フロー正準仕様の文書化 | （ドキュメント無し） | フロー仕様書が未作成。コード内 docstring が唯一の記述 | Missing（軽微・新規 md） |
| **2** 話者決定の単一優先順位 | `speaker-selection.ts` decideNextSpeaker（採番 (1)(3)(5) 欠番）／orchestrator のドリフト・直接質問分岐 | 優先順位が orchestrator の if 連鎖と decideNextSpeaker に分散。A/B と (1)(3)(5) の二採番体系 | Cleanup |
| **3** 介入(A/B)の責務整理 | `facilitator-agent.ts` evaluateTopicDrift/evaluateStallIntervention・`intervention-policy.ts`・orchestrator tryTopicDriftIntervention/evaluateAndDecide | A は毎ターン先行評価、B は evaluateAndDecide 内。条件・保存・指名解決の責務が両所に分散 | Cleanup |
| **4** 評価・発言パラメータの重複排除 | orchestrator resolveSpeech・evaluateAndDecide・generateUnansweredReply | 全員評価経路と話者単独再評価経路の二系統。generateUnansweredReply がループ処理を別実装で重複 | Cleanup |
| **5** ターン状態更新の一元化 | orchestrator runChapterLoop（engagementSignals push が3分岐）・consecutiveDirectExchanges（4箇所更新）・saveFacilitatorTurn | 状態更新が分岐ごとに散在。更新漏れ・二重更新のリスク | Cleanup |
| **6** 閾値・定数の単一定義化 | `INTENT_EXPIRY_TURNS`（orchestrator:35 と state-restore:4 で二重定義）・score 境界（>=4 / <=3 / >=4・>=5）・`MAX_CONSECUTIVE_DIRECT`・各種 RATIO/WINDOW | 同一定数の二重定義、無名のスコア境界が複数ファイルに散在 | Cleanup（一部 Constraint: 比較の向きが逆の箇所あり、後述） |
| **7** docstring/コメントと実装の整合 | runChapterLoop docstring（「並列」と記すが実装は逐次）・speaker-selection 欠番コメント | 記述と実装の不一致 | Cleanup |
| **8** 振る舞い保全 | 既存テスト群（前掲） | 機能差分は無いことが要件。テストが基準。リファクタ後も全通過が条件 | Constraint |
| **9** メソッドの責務分界と命名 | orchestrator の各 private メソッド（evaluateAndDecide=god-method・tryTopicDriftIntervention・resolveSpeech・generateUnansweredReply 等） | 責務同居メソッドの分割と、役割に対応した改名。過度分割は回避（steering 準拠）。公開2メソッド名は不変 | Cleanup |

### 確認済みの具体的不整合（コード位置付き）
- **定数二重定義**: `INTENT_EXPIRY_TURNS = 8` が debate-orchestrator.ts:35 と flow/state-restore.ts:4 に独立定義。
- **スコア境界の散在**: `>= 4`（orchestrator:326 高意欲・:369 キュー追加）、`<= 3`（speaker-selection:66 キュー選択）、`>= 4`／`>= 5`（chapter-progress:11 活性シグナル）。
- **比較の向きの注意点（Constraint）**: キュー追加は `score >= 4`、キュー選択は `topScore <= 3`。両者は境界4を挟む補完関係だが**意味が逆**。単一定数に集約する際は比較演算子の向きを取り違えないこと（同名定数に丸めると逆転バグの温床）。
- **docstring 不一致**: runChapterLoop は「並列: 意欲評価＋介入評価」と記すが、evaluateAndDecide は「先に意欲評価を確定させてから介入評価」（:305）と逐次。
- **採番の欠番**: speaker-selection の (1)(3)(5) は (2)(4) 欠番。

## 3. 実装アプローチの選択肢

### Option A: 現コード内でのインプレース整理（リファクタリング）
既存ファイル構成を維持し、orchestrator の分岐抽出・状態更新の集約・定数の単一定義化をその場で行う。
- ✅ ファイル構成・公開 API 不変。既存テストがそのまま基準になる
- ✅ 振る舞い保全の検証が容易（差分が小さい）
- ❌ orchestrator(654行) の巨大メソッド（evaluateAndDecide 等）が大きいままになりやすい

### Option B: ターンステップの再構造化（新コンポーネント分割）
1ターンを「指名解決 / 介入判定 / 話者決定 / 発言パラメータ / 発言生成・状態更新」のステップ関数群に分割し、orchestrator は順序の調整役に徹する。
- ✅ 要件1の正準フローとコードが1対1対応し可読性が高い
- ✅ evaluateAndDecide の god-method を解体できる（要件4/5に直接効く）
- ❌ 分割設計を誤ると振る舞いが変わるリスク。テスト更新量が増える
- ❌ 過度な抽象化（中央ディスパッチャ化）に陥らない設計上の注意が必要

### Option C: ハイブリッド（推奨）
- **定数の単一定義化（要件6）**は小さな共有モジュール（例: `flow/constants.ts` または既存 OrchestratorOptions への寄せ）を新設し、二重定義・無名境界を解消。
- **状態更新の集約（要件5）**と**評価/発言パラメータの単一経路化（要件4）**は、ターンループ内の責務を関数抽出（Option B の軽量版）で整理。
- **docstring/採番の整合（要件7）・正準フロー文書化（要件1）**はドキュメント整備。
- **話者決定の優先順位（要件2）**は「指名/直接質問 ＞ A ＞ B ＞ キュー ＞ スコア」の順を単一の真実源として持ち、A を指名の先行評価から外す（指名が無いときに評価）。
- ✅ 振る舞い保全を最優先しつつ、最も効果の高い箇所（god-method・二重定数）に絞って構造改善
- ✅ 既存テストを基準に段階的に実施でき、各ステップでグリーンを確認できる
- ❌ 計画の粒度設計が必要

## 4. 確定した振る舞い変更（トリアージ結果・バグ修正＋整理）

設計・実装で意図的に変える挙動。要件8-1の振る舞い保全の例外として確定済み。

- **B介入のクールダウン誤適用を修正**（要件3-2/3-4）: クールダウン（`shouldEvaluateIntervention`）は **A 専用のレート制限**。現行は `interventionAllowed && !hasHighEngagement` で B もクールダウンに gate している（debate-orchestrator.ts:328）が、B の発火条件は「出尽くし（高意欲者なし）」のみとし、クールダウン依存を外す。
- **指名・直接質問を介入より優先（A の先行評価を廃止）**（要件2-1/3-5）: 現行は論点ずれ介入(A)を毎ターン先行評価し、発火時に保留中の指名・直接質問を破棄している（debate-orchestrator.ts:197-244）。これを「指名・直接質問を先に消化 → 指名が無いとき A/B を評価」の順に変更し、指名を破棄しない。逸脱は連続直接質問上限（`MAX_CONSECUTIVE_DIRECT=3`）により最大3ターン以内に拾える。
- **発言意欲評価を毎ターン全員に統一**（要件4-1・5-4）: 現行は指名・直接質問・論点ずれのターンで全員評価・`saveEngagements`・キュー保守をスキップ（→ 可視化の穴・再評価の第2経路）。毎ターン全員評価に統一し、評価結果を話者決定・発言パラメータ・可視化保存・キュー保守に共通利用する。トレードオフ: 従来スキップしていたターンでも評価 LLM 呼び出しが増える（許容済み）。副次効果として `resolveSpeech` の単独再評価経路が不要になり評価経路が1本化する。
- **キュー意図は drift で破棄せず保持**（要件5-5）: 論点ずれ介入をまたいでも意図キューを失わせず、本題に戻った際に蒸し返せるようにする。

### 据え置き（今回は変更しない）
- **③ 孤児ファシリテーター発言**: 再開は `restartDebate` が `discardChapterProgress` で章頭から破棄・再実行するため残存しない（タスクリトライ経路でも `pendingAddress` 復元で次ターンに解消）。対象外。
- **④ maxTurns(200)到達で空章**: エッジ挙動。今回は変更しない。
- **⑤ `saveEngagements` の turnIndex=lastTurnIndex**: 現状のまま（変更しない）。

## 5. Research Needed（設計フェーズへ持ち越し）
- **R2**: スコア境界（4 を挟む >=4 / <=3）を単一定数化する際の命名と、比較の向きを保つ表現方法（定数名で意味を取り違えない設計）。
- **R3**: `consecutiveDirectExchanges` をどこで一元更新するか（saveFacilitatorTurn と generatePersonaTurn の責務分界）。復元時は常に 0 リセットされる前提（state-restore.ts:90）との整合。
- **R4**: 正準フロー仕様書の置き場所と粒度（`.kiro/specs/.../` 内 design 付随か、コード近傍の doc か）。
- **R5**: 毎ターン全員評価へ統一した際、既存テスト（特に integration）の期待値・評価呼び出し回数の更新範囲。

## 6. 工数・リスク
- **Effort: M（3〜7日）** — 6ファイル＋テストにまたがる。確定した振る舞い変更（毎ターン評価への統一・優先順位変更・B クールダウン除去）に伴い、既存テストの期待値更新が一定量発生する。
- **Risk: Medium** — 確定した振る舞い変更があるため、整理（リファクタ）と挙動変更を混在させると差分の切り分けが難しくなる。緩和策: ①「純粋な整理（振る舞い不変）」と「確定した振る舞い変更」をコミット/ステップで分ける ②比較の向き（R2）・状態更新位置（R3）を設計で固定 ③既存テストを基準にしつつ、変更箇所のテストは意図に合わせて更新（R5）④エミュレータ非使用のため、ロジックは Vitest で、最終確認のみ本番デプロイで検証。

## 7. 設計フェーズへの推奨
- **推奨アプローチ: Option C（ハイブリッド）**。定数集約＋god-method の関数抽出に絞り、ファイル構成と公開 API は維持。統一フロー（停止ゲート → 全員評価 → 話者決定〔指名/直接質問 ＞ A ＞ B ＞ キュー ＞ スコア〕 → 発言パラメータ取得 → 生成・保存・状態更新）に沿って `evaluateAndDecide` を「評価ステップ」と「決定ステップ」へ分解する。
- **重要決定事項**: (a) スコア境界の単一定義表現（R2）、(b) 状態更新の一元化ポイント（R3）、(c) 正準フロー仕様書の置き場所（R4）。振る舞い変更の可否（旧 R1）はトレード済み（§4）。
- **持ち越し研究**: R2〜R5。
- **検証戦略**: 既存テストを behavior oracle とし、純粋な整理ステップではグリーン維持。§4の確定変更については、変更後の期待値へテストを更新し意図を明示する。
