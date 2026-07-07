# Research & Design Decisions

## Summary
- **Feature**: `post-debate-comment-generation-decouple`
- **Discovery Scope**: Extension（既存の討論／編集 Cloud Tasks チェーンの再配線）
- **Key Findings**:
  - 討論の `running→generated` 遷移は **`persistPostDebateComments`（`post-debate-comments.ts`）の中でしか行われていない**。コメント生成を外すと遷移の担い手が消えるため、最終章の章完了ステップへ遷移を移設する必要がある。
  - `summary`/`closing` は発話生成を持たず `completeChapterStep`（章 completed 化＋論点クリーンアップ）を呼ぶだけ。実処理はあるので削除ではなく単一 `chapter-end` への統合・改名が妥当。
  - 編集チェーンは既に `chapter→intro-closing→comments(編集)` の同型 Cloud Tasks チェーン。前段 stepKind `generate-comments` を足すだけで「生成→編集」を順次化できる。原本コメントの FE 消費は Phase6Editing のみで Phase5Debate は非表示のため FE 影響は最小。

## Research Log

### 討論 generated 遷移の唯一の担い手
- **Context**: R2「コメント生成なしで generated 到達」を満たすには遷移の所在を特定する必要がある。
- **Sources Consulted**: `post-debate-comments.ts:36-51`（runTransaction で `phaseStatus running→generated`）、`utils/topic-phase.ts`（`confirmPhaseGenerated` は `GeneratePhase` 限定で `debate` を含まない）、`debate-lifecycle.ts`（`updateDebatePhaseStatus`/`isDebateActive`/`isDebateCompleted`）。
- **Findings**: debate の generated 遷移用ヘルパーは存在せず、コメント生成と癒着している。`confirmPhaseGenerated` の規範（running|stopped→generated・phase 前進なら巻き戻さない・冪等トランザクション）が流用可能。
- **Implications**: `debate-lifecycle.ts` に debate 専用 `confirmDebateGenerated` を新設し、最終章の `chapter-end` ハンドラから呼ぶ。

### 編集チェーンへの前段挿入点
- **Context**: R3「コメント生成を編集工程の先頭ステージに」。
- **Sources Consulted**: `api/editing.ts:44-45`（`startEditingRun`→`enqueueEditingStep(chapter,0)`）、`editing-orchestrator.ts:20-48`、`enqueue-editing-step.ts:9-18`（deterministic task id）、`editing-step.ts:234-262`（`runCommentsEditStep` は原本 `postDebateComments/0` を読み、空なら空成果物で確定）。
- **Findings**: `startEditing` が最初に投入する stepKind を `generate-comments` に変えれば前段化できる。`advanceEditing` の dispatch に 1 ケース追加。
- **Implications**: `EditingStepPayload.stepKind` に `generate-comments` を追加し、`generate-comments → chapter → intro-closing → comments` の順にする。

### 原本コメント生成の再利用形
- **Context**: `persistPostDebateComments` は「生成＋書込＋遷移」の3責務。編集側は生成＋書込のみ欲しい。
- **Findings**: 生成部（各ペルソナ `generatePostDebateComment` → `postDebateComments/0` に単一 `set()`）は原子的。遷移部だけ切り離せば残りをそのまま編集前段で再利用できる。`clearPostDebateComments` は `discardChaptersWithSideData`（reset/restart）で引き続き必要。
- **Implications**: `post-debate-comments.ts` を「`generatePostDebateComments`（書込のみ）＋ `clearPostDebateComments`」に整理し、遷移責務を除去。debate チェーンからは呼ばれなくなり、編集が import する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 前段 stepKind 追加 | 編集チェーンに `generate-comments` を前置 | 既存の冪等・リトライ・世代照合をそのまま享受、540s タスク枠で LLM 実行 | stepKind が1つ増える | **採用** |
| B: startEditing onCall 内同期生成 | onCall(60s) 内でコメント生成後に章 enqueue | チェーン変更最小 | 60s 制約でタイムアウト危険、リトライ弱い | 不採用 |
| C: ハイブリッド | 生成部を関数抽出し前段タスクから呼ぶ | — | 実質 A の内部設計 | A に内包 |

## Design Decisions

### Decision: `summary`/`closing` を単一 `chapter-end` stepKind に統合
- **Alternatives**: (1) 2 kind 維持のまま改名 (2) 単一 kind ＋ `isLastChapter` 分岐
- **Selected Approach**: `StepKind` を `open | turn | chapter-end` に。`chapter-end` ハンドラは `completeChapterStep` を実行後、`ctx.isLastChapter` で「非最終章→次章 open 投入／最終章→`confirmDebateGenerated`」を分岐。`chapterEndStepKind` と `summary`/`closing` 分岐、`decideNextStep` の `summary|closing` 返却を撤去。
- **Rationale**: 分岐の実体は「次に何を投入するか」だけで、章完了処理は共通。命名の名残を排し 1 kind に集約するのが最小かつ意味整合。
- **Trade-offs**: 型・分岐の一括改修が必要だが、末尾チェーンが単純化。

### Decision: 討論 generated 遷移を `chapter-end`(最終章) へ移設
- **Selected Approach**: `debate-lifecycle.ts` に `confirmDebateGenerated(topicId)` を新設（phase==='debate' かつ phaseStatus==='running' のとき generated へ、前進済みは巻き戻さない冪等トランザクション）。最終章 `chapter-end` で `completeChapterStep` 後に呼ぶ。
- **Rationale**: `confirmPhaseGenerated` と近い規範だが**討論は running 限定**にする。討論の稼働ゲート `isDebateActive` は running 限定で `chapter-end` は running 中しか実行されないため stopped からの遷移経路は到達不能。stopped を許容すると停止済み討論を誤って generated に復活させる余地が残るため running 限定で塞ぐ（validate-design Issue 2）。
- **Follow-up**: `comments` stepKind・`performCommentsStep`・frontier `'comments'` 特別扱い（`enqueue-step.ts` の `frontierIndex: number | 'comments'` を `number` に）を撤去。

### Decision: `generate-comments` 前段ステージは「未生成時のみ生成」（スキップ可）
- **Context**: 編集は失敗し得て何度も再実行される。毎回コメントを LLM 再生成するのは非効率（コスト・非決定性）。
- **Alternatives**: (1) 毎回 clear→再生成 (2) 原本が既に存在すればスキップ
- **Selected Approach**: `generate-comments` 実行時に原本 `postDebateComments/0` の存在チェック。未生成（不在または `comments.length===0`）なら `generatePostDebateComments`（単一 `set()` で原子的書込）、既存非空ならスキップして章編集へ連鎖。
- **Rationale**: 討論内容が変わる restart/reset では `discardChaptersWithSideData → clearPostDebateComments` で原本が消えるため、「内容が変わったときだけ再生成、変わらない編集再試行ではスキップ」が構造的に噛み合う。編集失敗の再試行で要約をやり直さない。
- **Trade-offs**: 「編集は据え置きでコメントだけ作り直す」明示操作は別途必要になった時に追加（現状は restart/reset 経由でのみ再生成）。
- **Follow-up**: スキップ判定は「不在 or 空配列」。全ペルソナ生成失敗で空になった場合は次回再生成される。

## Risks & Mitigations
- **generated 遷移移設の回帰**（承認導線・冪等・世代照合が壊れる） → 既存テスト（`debate-step-idempotency` / `decide-next-step` / `enqueue-step` / `debate-parity`）を新チェーンに合わせて更新し、最終章 `chapter-end` の冪等再適用テストを追加。
- **編集開始時に原本未生成**（旧経路の前提） → `generate-comments` 前段化で構造的に解消。加えて `runCommentsEditStep` の空入力耐性は保持（多層防御）。
- **本番直結（エミュレータ未使用）** → [[project-no-emulator]]。functions 変更はデプロイ必須。段階デプロイ不可のため、討論側撤去と編集側追加を同一デプロイに含める。

## References
- 既存 spec `post-debate-editorial-pass`（編集フェーズ Phase 6 の導入元）
- `.kiro/steering/firebase.md` / `tech.md`（Cloud Tasks チェーン・onTaskDispatched の規約）
