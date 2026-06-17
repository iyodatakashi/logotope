# Requirements Document

## Project Description (Input)
debate-orchestrator.tsの整理。無駄/冗長な処理がないか、メソッドの切り分けは適切か、など

## Introduction

`functions/src/pipeline/debate/debate-orchestrator.ts` は討論実行パイプラインの中核を担う。直近のクラス→関数変換リファクタの後、以下の具体的な問題が残っている：介入関数のコード重複、`chapterHistory` の冗長な再計算、`runChapterLoop` の番号付きコメントへの依存。本要件はこれらの解消条件を定義する。

振る舞いの変更は行わない。`executeChapterTask` の入出力・副作用（Firestoreの書き込み順序・内容）はリファクタ前後で同一でなければならない。

## Boundary Context
- **In scope**: `debate-orchestrator.ts` 内の重複排除・インラインコメント削減
- **Out of scope**: 外部モジュールの変更、型定義の変更、Firestore スキーマの変更、振る舞いの変更
- **Adjacent expectations**: Firestore書き込みと状態更新の順序・結合は変えない

## Requirements

### 1. 介入関数の重複パターン統合

**Objective:** 開発者として、`tryStallIntervention` と `tryTopicDriftIntervention` に同一構造のパターン（評価結果の検証 → ファシリテーターターン保存 → `SpeakerSelection` 返却）が繰り返されている状態を解消したい。

#### Acceptance Criteria
1. The Debate Orchestrator shall extract the common pattern of "save facilitator intervention and return speaker selection" into a shared helper.
2. When an intervention result contains content, the Debate Orchestrator shall use the shared helper to persist the facilitator turn and construct the `SpeakerSelection` return value.
3. The Debate Orchestrator shall not duplicate the `saveFacilitatorTurn` call + return-selection construction across multiple intervention functions.

---

### 2. 介入関数への chapterHistory パラメータ化

**Objective:** 開発者として、`tryStallIntervention` と `tryTopicDriftIntervention` が `state.history.filter(t => t.chapterId === chapter.id)` を独立して計算している状態を解消したい。`runChapterLoop` はすでに同じフィルタを持つため、計算を一元化できる。

#### Acceptance Criteria
1. The Debate Orchestrator shall compute `chapterHistory` once per turn in `runChapterLoop` and pass it to `tryStallIntervention` and `tryTopicDriftIntervention` as a parameter.
2. The `tryStallIntervention` and `tryTopicDriftIntervention` functions shall not recompute `state.history.filter(t => t.chapterId === chapter.id)` internally.

---

### 3. sessionId の冗長な別名の除去

**Objective:** 開発者として、`sessionId` という変数が `topicId` の単純な別名として存在しており、両者が別々の引数として渡されている冗長な状態を解消したい。セッションはトピックごとに必ず1つ存在し docId は `'0'` 固定であるため、`sessionId` という概念自体が不要である。

現状：
- `executeChapterTask` の先頭で `const sessionId = topicId` と代入している
- `runChapterLoop`、`generatePersonaTurn`、`generateUnansweredReply`、`finalizeDebate` などが `sessionId` と `topicId` の両方を別引数として受け取っている
- Firestore ヘルパー（`addTurn`、`saveEngagements`、`setPendingIntents` 等）が `sessionId` をパラメータとして持つが、常に `topicId` と同値

#### Acceptance Criteria
1. The Debate Orchestrator shall remove the `const sessionId = topicId` assignment and use `topicId` as the single identifier throughout.
2. The Debate Orchestrator shall not pass both `sessionId` and `topicId` as separate parameters to any function.
3. Firestore helper functions shall accept `topicId` in place of `sessionId` in their parameter types.

---

### 4. runChapterLoop のインラインコメント依存削減

**Objective:** 開発者として、`runChapterLoop` 内の番号付きインラインコメント（`// 1.` 〜 `// 10.`）への依存を下げたい。コメントなしで読める構造にすることで、コードの自己文書化度を高める。

#### Acceptance Criteria
1. The Debate Orchestrator shall extract the facilitator cooldown calculation (step 3 in the loop) into a named local variable or helper function with a self-documenting name.
2. The Debate Orchestrator shall extract the high-engagement queue enqueue logic (step 6) into a named function.
3. When `runChapterLoop` is modified, the Debate Orchestrator shall not require numbered inline step comments to convey the execution order.
