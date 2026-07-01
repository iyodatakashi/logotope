# Research & Design Decisions

## Summary
- **Feature**: `post-debate-editorial-pass`
- **Discovery Scope**: Extension（既存の討論パイプライン・フェーズモデルへの拡張）
- **Key Findings**:
  - `Phase` は固定 union `1 | 2 | 3 | 4 | 5`。編集フェーズ（Phase 6）追加には型・定数・表示ロジックの改修が必要（`phase.types.ts` / `phase.constants.ts` の 4 つの label Record / `phase.ts` の `phase === 5` 終端判定）。
  - 討論は「1 ステップ＝1 Cloud Task」のチェーン駆動（`runStep` onTaskDispatched / `enqueueStep`）。状態は毎回 Firestore から再構築するため冪等・再入可能。編集パスもこの規範を踏襲する。
  - 討論データは `topics/{topicId}/chapters/{chapterId}` に `turns: DebateTurn[]` 埋め込み。事後コメントは `topics/{topicId}/postDebateComments/0`。これらを不変の原本とし、編集成果物を別コレクションへ完全分離する。
  - 公開閲覧ルート（`/debate/[id]`）は未実装。現状ディベートを表示するのは管理画面 `Phase5Debate.svelte` のみ。よって本スペックの表示統合先は管理画面の編集フェーズ画面とし、公開ページは将来スペックの消費者とする。
  - AI 呼び出しは Vercel AI SDK（`@ai-sdk/anthropic` + `ai`）の `generateObject` ＋ Zod schema。モデルは `AI_MODELS.SONNET = 'claude-sonnet-4-6'`。`formatTurns` / `formatPersonas`（`functions/src/utils/prompt-formatters.ts`）で討論をプロンプト整形できる。

## Research Log

### フェーズモデルと前進の仕組み
- **Context**: 「討論フェーズの後に編集フェーズを追加し、ボタンで編集開始」する要件。Phase 6 をどう足すか。
- **Sources Consulted**: `src/lib/models/phase/phase.types.ts`, `phase.ts`, `phase.constants.ts`; `src/lib/features/admin/topic-detail/debate/Phase5Debate.svelte`; `src/lib/sharedComponents/PhasePanel.svelte`; `src/lib/models/topic/createTopic.svelte.ts`。
- **Findings**:
  - `Phase = 1|2|3|4|5`、`PhaseStatus = 'not_started'|'running'|'generated'|'stopped'`、`PhaseLogicalState = PhaseStatus | 'approved'`。
  - `phaseLogicalState(current, target)`: `target < current.phase → 'approved'`、`> → 'not_started'`、`= → 現状の phaseStatus`。
  - フェーズ前進は approve 系で `topics/{topicId}.phase` を直接 `updateDoc`（例: `approveChapters` が `phase:5` をセット）。Phase 5（討論）は終端で approve ボタンを持たない。
  - `PhasePanel` は `logicalState` で表示を切替え、`generated` 状態で `approveLabel`+`onApprove` があれば承認ボタンを出す（既存対応済み）。
- **Implications**: 編集フェーズを Phase 6 として追加。討論（Phase 5, generated）に「承認して編集へ進む」アクションを足し `phase:6, phaseStatus:'not_started'` へ前進させる（既存の approve→前進パターンと一致）。Phase 6 画面の「編集を開始する」ボタンで編集パスを起動する。

### 討論完了とステップ駆動
- **Context**: 編集パスの起動・実行・完了確定をどの規範に載せるか。
- **Sources Consulted**: `functions/src/pipeline/debate/debate-orchestrator.ts`, `step.ts`, `post-debate-comments.ts`, `enqueue-step.ts`, `debate-lifecycle.ts`; `functions/src/api/debates.ts`; `functions/src/utils/topic-phase.ts`。
- **Findings**:
  - `runStep` は onTaskDispatched（`timeoutSeconds: 540`, `retryConfig.maxAttempts: 3`, `rateLimits.maxConcurrentDispatches: 5`, secrets に各 API キー）。`advanceDebate(payload)` を呼ぶ。
  - 完了確定（`phaseStatus: 'generated'`）は running/stopped 限定の冪等トランザクションでのみ行う（`persistPostDebateComments` 内、および汎用の `confirmPhaseGenerated`（`GeneratePhase = 1|2|3|4`））。
  - `startDebate`/`restartDebate`/`resetDebate` は `onCall({ timeoutSeconds: 60 })` で requireAuth → 状態書込 → 最初のステップ enqueue。FE は `httpsCallable` で呼ぶ。
- **Implications**: 編集パスも Cloud Tasks チェーンで実装。`startEditing` onCall（requireAuth → 既存編集成果物を即時破棄 → `phase:6, phaseStatus:'running'` → 最初の編集ステップ enqueue）、`runEditingStep` onTaskDispatched（章単位で 1 タスク）、最終ステップでコメント編集＋ `phaseStatus:'generated'` 確定。状態は Firestore から再構築し冪等にする。

### 討論データの形と表示
- **Context**: 編集対象の入力と、編集成果物が表示に提供すべきデータ。
- **Sources Consulted**: `functions/src/types/chapter.types.ts`, `turn.types.ts`; `src/lib/models/chapter/chapter.types.ts`, `src/lib/models/turn/turn.types.ts`, `src/lib/models/postDebateComment/postDebateComment.types.ts`; `src/lib/stores/chapters.svelte.ts`; `Phase5Debate.svelte`。
- **Findings**:
  - `ChapterForFirestore { chapterIndex, title, discussionPoints, turns: DebateTurn[], status, ... }`。`DebateTurn { id, speakerType, personaId?, content, createdAt, speechMode?, engagementScore?, fromQueue?, targetPersonaId?, targetedBy?, factCheck?, ... }`。
  - 表示は `turn.content` を平文 `<p>` で描画。加えて発話者名・役割・`speechMode` バッジ・engagements・`factCheckFindings`・信念変化（`beliefs.triggeredByTurnId === turn.id` で join）を出す。
  - 信念変化・ファクトチェックはターン id をキーに別ストア（personas / factCheck）から join して表示される。
- **Implications**: 編集成果物（編集後ターン）は「散文＋発話者＋ `sourceTurnIds`」を持てば十分。信念変化・ファクトチェック指摘は従来どおり原本側を `sourceTurnIds` で join して表示できる。編集ターンに注釈をコピーせず、原本を注釈の真実とする＝責務分離。

### AI 呼び出しと構造化出力
- **Context**: 編集者 LLM をどう実装するか。
- **Sources Consulted**: `functions/src/llm/models.ts`, `functions/src/constants/ai.constants.ts`; `functions/src/agents/persona-agent.ts`, `facilitator-agent.ts`, `chapter-agent.ts`; `functions/src/utils/prompt-formatters.ts`。
- **Findings**:
  - `AI_MODELS = { OPUS: 'claude-opus-4-8', SONNET: 'claude-sonnet-4-6' }`。`@ai-sdk/anthropic` の `anthropic(model)` を `generateObject({ model, system, schema, messages })` に渡す。
  - `chapter-agent.ts` は Zod schema で多段（生成→スコアリング→グルーピング→章構築）を `generateObject` で実装。
  - `formatTurns(turns, personas)` が `[名前(役割)(ID:..)]: content` 形式へ整形。
- **Implications**: 編集者エージェントは `generateObject` ＋ Zod schema（編集後ターン列＋ `sourceTurnIds`）で実装。モデルは既存 AI 呼び出しと揃え `AI_MODELS.SONNET` を既定とする（品質要求が高ければ Opus への切替を将来検討）。

### リセット・再開時の整合
- **Context**: 原本が再生成・破棄されたとき編集成果物をどう整合させるか。
- **Sources Consulted**: `functions/src/pipeline/debate/debate-lifecycle.ts`（`discardChaptersWithSideData`, `resetDebate`, `restartDebateFromChapter`）, `post-debate-comments.ts`（`clearPostDebateComments`）。
- **Findings**: `discardChaptersWithSideData` が章・事後コメント・信念・engagements・factCheck をまとめて削除する単一責務。reset と restart の双方が経由する。
- **Implications**: 編集成果物は原本の派生物なので、`discardChaptersWithSideData` に編集成果物（`editedChapters` / `editedPostDebateComments`）の削除を加え、討論の reset/restart で編集成果物も必ず破棄されるようにする（Req 5.6）。編集パス再実行時は `startEditing` 冒頭でも即時破棄する（Req 5.5）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 別コレクションへ完全分離（採用） | `editedChapters/{chapterId}` ＋ `editedPostDebateComments/0` を原本と並列に持つ | 原本不変・1MB 余裕・再実行/リセットが破棄のみ・責務分離 | コレクション増・表示時に原本と join | ユーザー意向（生ディベートと編集成果物の完全分離）と一致 |
| B. 章ドキュメントに `editedTurns` フィールド追加 | 既存 chapter doc に編集後配列を同居 | 読み取り 1 クエリ | 1MB 圧迫・型に永続されない混在・原本と密結合 | [[feedback-mirror-firestore-shape]] と相性悪 |
| C. ターン毎 `editedContent` 上書きフィールド | 各ターンに編集後本文を併記 | 単純 | 削除・連結で 1:1 が崩れ表現不能 | 要件（除外・連結）と不整合のため不採用 |

| Option（実行モデル） | Description | Strengths | Risks | Notes |
|--------|-------------|-----------|-------|-------|
| 章単位 Cloud Tasks チェーン（採用） | 1 章＝1 タスクで編集→次章 enqueue、最後にコメント編集＋完了確定 | 540s タイムアウト回避・既存規範踏襲・冪等 | タスク連鎖の実装コスト | `runStep` と同型の `runEditingStep` |
| 単一 onTaskDispatched で全章ループ | 1 関数で全章を順に編集 | 実装単純 | 章数×ターン数が多いとタイムアウト懸念 | 規模次第で破綻、不採用 |

## Design Decisions

### Decision: 編集成果物を原本と別コレクションへ完全分離する
- **Context**: Req 5（原本不変・別アーティファクト）、ユーザー意向。
- **Alternatives Considered**: A 別コレクション / B 章ドキュメント内フィールド / C ターン上書き。
- **Selected Approach**: `topics/{topicId}/editedChapters/{chapterId}`（`chapterId` を原本と同一にして 1:1・冪等上書き）と `topics/{topicId}/editedPostDebateComments/0`。
- **Rationale**: 原本を一切触らず、削除・連結で構造が変わっても破綻しない。再実行・リセットは編集成果物の破棄だけで済む。
- **Trade-offs**: 表示時に信念変化・ファクトチェックを原本から join する手間が増えるが、責務分離が明確になる。
- **Follow-up**: 章あたりの編集後ターン配列が 1MB を超えないこと（編集後はむしろ短くなる想定）を実装時に確認。

### Decision: 編集ターンは `sourceTurnIds` で原本に紐付け、注釈は原本側を真実とする
- **Context**: 除外・連結により編集ターンと原本ターンが 1:1 でなくなる。信念変化・ファクトチェック指摘の表示を保つ必要（Req 3.7, 4.3）。
- **Selected Approach**: 各編集ターンは `sourceTurnIds: string[]`（1 件以上、連結時は複数）を持つ。表示側は `sourceTurnIds` を使って原本の信念変化・ファクトチェックを join する。編集ターン自体は散文・発話者・`speechMode` のみを持つ。
- **Rationale**: 注釈を編集ターンへコピーすると二重管理になる。原本を注釈の単一の真実とし、編集成果物は散文・構造に責務を限定する。
- **Trade-offs**: 表示に join ロジックが必要。
- **Follow-up**: 保護対象ターン（信念変化・固有事実・ファクトチェック指摘あり）が必ずいずれかの編集ターンの `sourceTurnIds` に含まれることを編集後に検証する。

### Decision: 編集パスを章単位の Cloud Tasks チェーンで実行する
- **Context**: 討論は数章×多ターンになりうる。1 リクエストで全章を編集するとタイムアウトの懸念。
- **Selected Approach**: `startEditing` onCall → 1 章ずつ `runEditingStep` で編集し次章を enqueue → 最終章後にコメント編集ステップ → `phase:6, phaseStatus:'generated'` を冪等確定。状態は毎回 Firestore から再構築。
- **Rationale**: 既存の討論オーケストレーション規範を踏襲し、冪等・再入可能・タイムアウト耐性を得る。
- **Trade-offs**: 単一関数より実装が増えるが、信頼性を優先。
- **Follow-up**: `runId` で世代を識別し、古い世代のタスクは no-op にする。

### Decision: 表示統合先は管理画面の編集フェーズ画面。公開ページは boundary 外
- **Context**: 公開閲覧ルート（`/debate/[id]`）が未実装。
- **Selected Approach**: Phase 6 画面（`Phase6Editing.svelte`）で編集成果物を読み物として表示し、無い間は原本（討論）にフォールバック。公開ページは将来スペックが編集成果物を消費する前提で、本スペックでは実装しない。
- **Rationale**: 存在しない画面を本スペックに抱え込まない（過剰スコープ回避）。編集成果物の形は公開消費にも使えるよう設計する。
- **Trade-offs**: Req 6 の「公開画面表示」は将来スペックへ委譲。
- **Follow-up**: 公開ページ実装時に編集成果物ストアを再利用できるよう、ストアを features ではなく `src/lib/stores/` に置く。

## Risks & Mitigations
- **意味改変・矛盾混入のリスク** — システムプロンプトで不変条件を明示し、編集後に検証（保護対象ターンの残存・話者整合・`sourceTurnIds` 妥当性）。検証失敗章は原本にフォールバック（Req 4, 6.3）。
- **Phase 型拡張の波及** — `Phase` を参照する全箇所（label Record・終端判定・テスト）をコンパイルエラーで検出して網羅修正。
- **原本再生成との不整合** — `discardChaptersWithSideData` に編集成果物削除を追加し、reset/restart で必ず破棄。
- **1MB 上限** — 編集後は短くなる想定だが、章あたりの編集後ターン配列サイズを実装時に確認。

## References
- 既存実装: `functions/src/pipeline/debate/`（orchestrator/step/lifecycle）, `functions/src/agents/chapter-agent.ts`, `functions/src/api/debates.ts`
- ステアリング: `.kiro/steering/firebase.md`（Firestore 設計原則）, `tech.md`, `structure.md`
- 関連スペック: `.kiro/specs/session-document-restructure/`（章プライマリ構造）, `.kiro/specs/chapter-generation-scoring/`
