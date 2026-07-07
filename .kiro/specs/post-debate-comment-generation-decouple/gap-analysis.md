# Gap Analysis: post-debate-comment-generation-decouple

作成日: 2026-07-06

## 1. 現状調査（Current State）

### 討論パイプライン末尾（削除・付替え対象）
- **stepKind チェーン**: `open → turn(×N) → summary|closing → comments`（`functions/src/pipeline/debate/`）
- **型**: `StepKind` union に `comments`/`summary`/`closing`/`open`/`turn`（`types/step.types.ts`）。`NextStep`/`TurnFollowupStep` にも `summary`/`closing`（`debate-orchestrator.ts:19-22,60`）
- **章末種別選択**: `chapterEndStepKind(isLastChapter) → 'summary'|'closing'`（`debate-orchestrator.ts:56-57`）。選択ロジックの単一源
- **dispatch**（`debate-orchestrator.ts:284-305`）:
  - `summary`: `completeChapterStep` → 次章 `open` を enqueue
  - `closing`: `completeChapterStep` → `comments` を enqueue
  - `comments`: `performCommentsStep`
- **`completeChapterStep`**（`step.ts:496-505`）: 章を `completed` 化 ＋ `deleteDiscussionPointStatuses`。**発話生成なし・実処理あり**（no-op ではない）
- **`performCommentsStep`**（`step.ts:509-517`）→ **`persistPostDebateComments`**（`post-debate-comments.ts:14-52`）: コメント生成＋`postDebateComments/0` 保存 ＋ **`running→generated` 遷移を所有**
- **frontier/taskKey**: 終端 `comments` だけ frontier を `'comments'` 固定（`enqueue-step.ts:11-15`, `debate-orchestrator.ts:178-179`）
- **重要**: 討論の `running→generated` 遷移は**現状 `persistPostDebateComments` の中でしか行われていない**。`utils/topic-phase.ts` の `confirmPhaseGenerated` は `GeneratePhase`（fact-research/stakeholders/personas/interviews/chapters）専用で `debate` を含まない

### 編集パイプライン（挿入対象）
- **チェーン**: `startEditing`（onCall）→ `chapter(0..N-1) → intro-closing → comments(編集)`（`editing-orchestrator.ts:20-48`, `api/editing.ts:44-45`）
- **stepKind**: `'chapter' | 'intro-closing' | 'comments'`（`enqueue-editing-step.ts:12`）。討論と同型の deterministic task id チェーン
- **`runCommentsEditStep`**（`editing-step.ts:234-262`）: **原本 `postDebateComments/0` を読み**、`editComments` でリライトして `editedPostDebateComments/0` 保存 → `finalizeEditingRun`。**原本が空/不在なら空成果物を書いて確定**（既に ungenerated 耐性あり）
- **ライフサイクル**: `startEditingRun`（成果物破棄＋`phase:editing/running`＋新 runId）、`finalizeEditingRun`、`stopEditingRun`、`isEditingActive`（`editing-lifecycle.ts`）。討論完了ゲート `isDebateCompleted`（`api/editing.ts:38`）

### フロントエンド
- 原本 `postDebateComments/0` を購読する store は `postDebateComments.svelte.ts`
- **消費は Phase6Editing.svelte:216 のみ**（`rawComments = ...postDebateCommentsStore.comments`）。**Phase5Debate は原本コメントを表示していない** → 生成を編集工程へ移しても Phase5 表示への影響なし

## 2. 要件↔資産マップ（Requirement-to-Asset Map）

| 要件 | 対象資産 | ギャップ種別 |
|---|---|---|
| R1 章末統合・命名是正 | `StepKind`/`NextStep` 型、`chapterEndStepKind`、orchestrator dispatch(summary/closing)、`completeChapterStep` | **Constraint**（型・分岐の一括改名／統合） |
| R2 generated をターン生成のみで確定 | `persistPostDebateComments` 内の遷移を last-chapter step へ移設。debate 用 generated 遷移ヘルパーが**存在しない** | **Missing**（debate 版 `confirmDebateGenerated` 相当が要新設） |
| R3 コメント生成を編集工程先頭へ | 編集チェーンに前段 stepKind 追加 or `startEditing` 内実行。`persistPostDebateComments` の生成部を再利用 | **Missing**（前段ステージ）＋ **Constraint**（生成部と遷移部の分離） |
| R4 生成→編集の順次実行 | `editing-orchestrator` のチェーン順序。`runCommentsEditStep` が原本を入力 | **Extend**（既存チェーンに1段前置） |
| R5 原本スキーマ・reset 保全 | `postDebateComments/0` スキーマ不変、`discardChaptersWithSideData → clearPostDebateComments` | **保全のみ**（変更不要、回帰確認） |

## 3. 実装アプローチ

### 討論側（末尾リストラ）— 単一案でよい低裁量域
- `summary`/`closing` を単一 stepKind（例 `chapter-end`）へ統合し、`StepKind`/`NextStep`/`chapterEndStepKind`/dispatch/`completeChapterStep` の doc を是正
- last-chapter の `chapter-end` で章完了後に **`running/stopped → generated` を確定**（新設ヘルパー。`confirmPhaseGenerated` の debate 拡張 or 専用関数）
- `comments` stepKind・`performCommentsStep`・frontier `'comments'` 特別扱いを撤去
- `persistPostDebateComments` を **生成部（`postDebateComments/0` 書込）と遷移部**に分離。遷移部は上記へ移す／生成部は編集側へ渡す

### 編集側（前段挿入）— Option 比較
**Option A: 編集チェーンに前段 stepKind を追加（推奨）**
- `EditingStepPayload.stepKind` に `'generate-comments'` を追加。`startEditing` は `generate-comments` を最初に enqueue → `advanceEditing` が `generate-comments` 実行後に `chapter(0)` を enqueue
- ✅ 討論と同型の「1ステップ=1タスク」チェーンに自然に乗る／冪等・リトライ・世代照合をそのまま享受／長時間 LLM 生成を独立タスク枠（540s）で実行
- ❌ stepKind が1つ増える

**Option B: `startEditing`（onCall, 60s）内で同期生成してから章 enqueue**
- ✅ チェーン変更が最小
- ❌ **onCall 60s 制約**にペルソナ数ぶんの LLM 生成が乗り、タイムアウト危険。リトライ/冪等が弱い → 非推奨

**Option C: ハイブリッド**（生成部は関数抽出し前段タスクから呼ぶ）＝実質 A の内部設計。A に内包

## 4. Effort / Risk

- **討論末尾リストラ**: Effort **M** / Risk **Medium** — 型・分岐の一括改名に加え、**generated 遷移の唯一の担い手を移設**するため回帰（承認導線・冪等・世代照合）に注意。既存テスト（`debate-step-idempotency` / `decide-next-step` / `enqueue-step` / `debate-parity`）の更新必須
- **編集前段挿入（Option A）**: Effort **S–M** / Risk **Low–Medium** — 既存編集チェーンと同型パターンの踏襲。生成部の関数抽出と onCall→タスクの順序繋ぎが主
- **合計**: **M**（3–7日）/ Risk **Medium**

## 5. 設計フェーズへの申し送り

### 推奨方針
- 討論: `summary`/`closing` → 単一 `chapter-end` 統合、`comments` stepKind 撤去、last-chapter で generated 確定
- 編集: **Option A**（`generate-comments` 前段 stepKind）でコメント生成→編集を順次化
- `persistPostDebateComments` を「生成部（再利用可能）」と「討論 generated 遷移部」へ分離

### 決めるべき設計判断（Research/Decision Needed）
1. **統合後 stepKind 名**: `chapter-end` / `complete-chapter` 等。非最終章と最終章を1 kind＋`isLastChapter` 分岐で表すか、2 kind を残すか
2. **debate generated 遷移ヘルパーの置き場**: `topic-phase.ts` の `GeneratePhase` に `debate` を足すか、debate 専用関数を新設するか（現状 debate は別規範で管理されている点を尊重）
3. **`persistPostDebateComments` の分割形**: 生成部の関数名・返り値（生成した comments を返すか、書込のみか）
4. **`generate-comments` ステージの冪等/再生成**: 既存 `postDebateComments/0` がある場合の上書き（[[feedback-regenerate-immediate-clear]] に従い開始時即時クリア）と、`clearPostDebateComments` の再利用
5. **discardChaptersWithSideData の位置づけ**: reset/restart で原本コメント消去は維持（R5.2）。編集リセット時の扱いは現状踏襲
6. **FE**: Phase6Editing が原本を購読する導線は不変。Phase5Debate は原本非表示のため影響なし（要最終確認）
