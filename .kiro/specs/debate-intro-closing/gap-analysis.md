# Implementation Gap Analysis: debate-intro-closing

要件（`requirements.md`）と既存コードベースのギャップを分析し、設計フェーズの意思決定材料とする。本フィーチャーは既存の**編集フェーズ（Phase 6 / `post-debate-editorial-pass`）に統合**するため、その実装との適合が分析の中心となる。

## 1. 現状調査（Current State）

### 編集フェーズ（Phase 6）は完全実装済み
討論完了後の編集パスは、以下の一貫したチェーン構造で実装されている。

| 層 | ファイル | 役割 |
|---|---|---|
| API | `functions/src/api/editing.ts` | `startEditing`/`resetEditing`（onCall）、`runEditingStep`（onTaskDispatched） |
| ライフサイクル | `functions/src/pipeline/editing/editing-lifecycle.ts` | `startEditingRun`（成果物破棄＋`phase='editing'`/`running`＋新 `runId`）、`resetEditingRun`、`stopEditingRun`、`finalizeEditingRun`、`isEditingActive` |
| オーケストレータ | `functions/src/pipeline/editing/editing-orchestrator.ts` | `advanceEditing`：`chapter(0..n)` → `comments` → `finalize` の1ステップ=1 Cloud Task チェーン |
| ステップ本体 | `functions/src/pipeline/editing/editing-step.ts` | `runChapterEditStep`（章リライト＋構造検証）、`runCommentsEditStep`（コメント編集＋確定） |
| enqueue | `functions/src/pipeline/editing/enqueue-editing-step.ts` | `EditingStepPayload { stepKind: 'chapter' \| 'comments' }`、deterministic task id |
| エージェント | `functions/src/agents/editor-agent.ts` | `editChapter` / `editComments`（`editorSystemPrompt` で意味・帰属・事実を保持しつつリライト） |
| 保存層 | `functions/src/pipeline/editing/edited-repository.ts` | `editedChapters/{chapterId}`（サブコレクション）、`editedPostDebateComments/0`（固定ID）。`clearEditedArtifact` で一括破棄 |
| 型 | `functions/src/types/editorial.types.ts` | `EditedChapterForFirestore`、`EditedTurnForFirestore`、`EditedPostDebateCommentsForFirestore` |
| 共有コンテキスト | `functions/src/pipeline/topics/topic-context.ts` | `getTopicContext(topicId)` → `{ description, sourceContents, factBase }`（BE 権威経路） |
| FE ストア | `src/lib/stores/editedChapters.svelte.ts` | `editedChapters` を `chapterIndex` 順に onSnapshot 購読 |
| FE 型 | `src/lib/models/editedChapter/`・`editedTurn/`・`editedPostDebateComment/` | Firestore 永続形と一致 |
| FE UI | `src/lib/features/admin/topic-detail/editing/Phase6Editing.svelte` | 開始／やり直し（reset→start）、原文との差分表示 |

### 確立された規約・パターン
- **ステップチェーン拡張**が既定パターン: `stepKind` 判定で dispatch し、次ステップを enqueue して自己継続。状態は毎回 Firestore（原本＋`runId`）から再構築 → 冪等・再入可能。旧世代タスクは世代ゲート（`isEditingActive`）で no-op。
- **編集成果物は生ディベートと別コレクション**、原本は不変（読み取りのみ）。再実行は `startEditingRun` が旧成果物を即時破棄（feedback: 再生成時の即時削除と整合）。
- **1:1・固定 ID パターン**: `editedPostDebateComments/0`・`factBase/0` のように、トピック単位で1件の成果物は `/0` 固定 ID ドキュメントに保存する（`firebase.md`）。
- **共有コンテキストは `getTopicContext` 経由**でのみ供給（フェーズ別分岐なし）。
- 型はフロント（`src/lib/models`）と Functions（`functions/src/types`）で分離し、いずれも Firestore 永続形と一致させる。

### 未実装・注意点
- **公開閲覧ルート `src/routes/debate/[id]` は存在しない**。討論コンテンツの描画は現状 admin（Phase6Editing / Phase5Debate）のみ。→ イントロ／クロージングの**公開表示は将来作業**。当面の表示先は Phase6 プレビュー。
- **編集後コメントはフロントで未描画**（`editedPostDebateComments` を読む FE コードなし）。Phase6Editing は編集後**章**のみ描画。→ クロージング（コメント直前に位置）の表示は、コメント描画の整備状況に依存する。
- `editor-agent` は**ターン単位**の編集（`sourceTurnIds` による由来追跡＋構造検証）であり、討論全体を俯瞰する自由生成（イントロ／クロージング）とは処理特性が異なる。

## 2. 要件→アセット対応（Requirement-to-Asset Map）

| 要件 | 対応する既存アセット | ギャップ |
|---|---|---|
| R1/R2 イントロ・クロージング生成 | `editor-agent.ts`（LLM 呼び出しパターン）、`getTopicContext`（テーマ・事実基盤）、`readRawChapters`／`readEditedChapters`（討論内容） | **Missing**: 討論全体を入力に自由生成する新エージェント関数（由来ID・構造検証なし）。既存 `editChapter` とは別物 |
| R3 中立性・非結論性 | `editorSystemPrompt`（保持系の不変条件） | **Missing**: 「結論・優劣・落としどころを出さない」イントロ・クロージング専用プロンプト（既存プロンプトはターン保持向け） |
| R4 表示位置・識別 | `Phase6Editing.svelte`、`editedChapters` ストア | **Missing**: 冒頭イントロ／コメント前クロージングの描画。（公開ルート・コメント描画自体が未整備 → Constraint） |
| R5 編集パスと同一操作での生成・再生成 | `advanceEditing` チェーン、`startEditingRun`（旧成果物破棄）、`EditingStepPayload` | **Missing**: チェーンへのイントロ／クロージング生成ステップ組み込み。**Unknown**: `finalizeEditingRun` の成功/失敗判定（現状は全 `editedChapters` completed が条件）にイントロ・クロージングをどう含めるか |
| R6 別成果物として保存・原本不変 | `edited-repository.ts`（別コレクション・`clearEditedArtifact`）、1:1固定IDパターン | **Missing**: イントロ・クロージング成果物ドキュメント（例 `editedIntroClosing/0` = `{ intro, closing }`）と、その read/write/clear。`clearEditedArtifact` への追加 |
| R7 エラー処理・片方成功時保持 | `runEditingStep` のリトライ／`stopEditingRun`、章の failed フォールバック | **Constraint/Unknown**: イントロ・クロージング失敗を「編集ラン停止」に波及させるか、best-effort（本編に影響させない）にするか。R7 は本編・既存成果物を妨げないことを要求 |
| 型（FE/BE） | `editorial.types.ts`、`src/lib/models/edited*` | **Missing**: `EditedIntroClosing(ForFirestore)` を両側に追加 |

複雑度シグナル: 主にワークフロー（既存チェーンへのステップ追加）＋ LLM 生成。外部連携・新規インフラは不要。

## 3. 実装アプローチ選択肢

### Option A: 既存編集チェーンにステップを追加（拡張中心）＋イントロ・クロージング専用エージェント新設
- チェーンを `chapter(0..n) → comments → intro-closing → finalize` に拡張。`intro-closing` ステップで討論全体（原本または編集後章＋テーマ／事実基盤）を入力にイントロ・クロージングを生成し、`editedIntroClosing/0` に保存。
- `EditingStepPayload.stepKind` に `'intro-closing'` を追加、`advanceEditing` に分岐追加、`enqueue`／task key はそのまま流用。
- エージェントは**新ファイル** `functions/src/agents/intro-closing-agent.ts`（`generateIntro`／`generateClosing`）。由来ID・構造検証を持たない点で `editor-agent` と責務が異なるため分離。
- 保存は `edited-repository.ts` に `writeEditedIntroClosing`／`readEditedIntroClosing` を追加し、`clearEditedArtifact` にイントロ・クロージング破棄を追加。
- **✅** 既存の「ステップ拡張」規約に最も忠実／冪等・世代ゲート・再実行破棄をそのまま享受。**✅** エージェント分離で単一責務維持。**❌** ステップ種別・型・FE を横断的に触る。

### Option B: 独立したイントロ・クロージング・サブパイプライン（新規中心）
- 編集ランとは別に、イントロ・クロージング専用の lifecycle/step を新設。同一操作起動は編集完了時に内部起動でつなぐ。
- **✅** 編集チェーンを汚さない。**❌** 「編集パスと同一操作」（R5）を別ライフサイクルの連結で表現することになり、状態管理が二重化。�established パターンから外れる。**❌** 過剰。

### Option C: `comments` ステップに畳み込む（ハイブリッド／最小差分）
- `runCommentsEditStep` の中でコメント編集後にイントロ・クロージングも生成し、`finalize` 前に保存。新ステップ種別を増やさない。
- **✅** 変更ファイル最小・チェーン形状不変。**❌** コメント編集とイントロ・クロージング生成が1ステップに同居し責務が肥大（1タスク=1責務の原則から外れる）。**❌** R7 の「片方失敗時に他方を保持」やリトライ粒度が粗くなる。

## 4. Research Needed（設計フェーズへ持ち越す論点）

1. **イントロ・クロージングの入力**: 原本章（`readRawChapters`）か編集後章（`readEditedChapters`）か。編集後を入力にすると読み物として一貫するが、編集ステップ完了への依存が生じる。
2. **`finalizeEditingRun` の判定拡張**: イントロ・クロージング失敗を `generated`/`stopped` 判定に含めるか、best-effort（本編確定を妨げない）とするか。R7 と `finalizeEditingRun` の現行セマンティクス（全章 completed で generated）の整合。
3. **ステップ粒度**: イントロとクロージングを1ステップ（1ドキュメント一括）か、別ステップ（R7 の独立保持を素直に満たす）か。
4. **保存形**: `editedIntroClosing/0 = { intro?: string, closing?: string, status? }` の形と、片方のみ生成済み状態の表現。
5. **クロージングの位置と描画**: 「本編後・コメント前」の確定（要件で設計送り）。編集後コメント描画が未整備な点との順序整合。
6. **中立・非結論プロンプト設計**: product.md の「結論を求めない」を担保する具体的プロンプト制約。

## 5. 複雑度・リスク

- **Effort: M（3〜7日）** — 既存の確立パターン（ステップ拡張・別成果物・世代ゲート）に沿うが、新エージェント2関数＋新ステップ＋新成果物＋`clearEditedArtifact`／`finalize` 調整＋FE ストア・Phase6 表示＋FE/BE 型＋既存編集群に倣ったテスト、と横断範囲が広い。
- **Risk: Low〜Medium** — インフラ・外部連携の新規性はなく低リスク。中リスク要因は (a) `finalizeEditingRun` の失敗判定への波及設計、(b) 非結論イントロ・クロージングのプロンプト品質、(c) コメント／公開描画が未整備なため表示要件（R4）の完全充足はそれらの整備に依存する点。

## 6. 設計フェーズへの推奨

- **推奨アプローチ: Option A**（編集チェーンへ `intro-closing` ステップ追加＋`intro-closing-agent.ts` 新設＋`editedIntroClosing/0` 成果物）。既存規約に最も忠実で、再実行・破棄・冪等をそのまま得られる。ステップ粒度（イントロ／クロージング分割）は R7 を根拠に設計で確定。
- **キー決定事項**: finalize への失敗波及の扱い（best-effort 推奨、R7 準拠）／イントロ・クロージング入力（原本 vs 編集後）／保存形と部分成功表現。
- **持ち越し**: 上記 Research Needed 1〜6。特に表示（R4）は公開ルート・編集後コメント描画の未整備を前提に、当面 admin プレビュー範囲で満たし、公開表示は後続とすることを明記して設計する。
