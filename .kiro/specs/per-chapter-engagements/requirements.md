# Requirements Document

## Introduction

討論パイプラインにおける「エンゲージメント（発言意欲評価）」のスコープをチャプター単位に限定する機能変更。
現状はエンゲージメント評価・保存が討論全体（トピック単位）にまたがって累積しているが、チャプターをまたいだ持ち越しをなくし、各チャプター内で完結するように変更する。

## Boundary Context

- **In scope**: エンゲージメント評価の入力ターン範囲をチャプター内ターンに限定すること。エンゲージメントの Firestore 保存パスをチャプター単位に変更すること。チャプター終了時のエンゲージメント状態リセット。発言意図キュー（queued intents）のエンゲージメントからの分離とチャプター単位管理。管理画面のエンゲージメント表示の参照先変更。
- **Out of scope**: エンゲージメントスコアのアルゴリズム・閾値変更。話者選択ロジック自体の変更。信念変化（belief）の管理。チャプター設計・agenda の変更。
- **Adjacent expectations**: `queued-intents.ts` はエンゲージメントドキュメントをキュー永続化に流用しているため、保存パスとドキュメント構造の変更対象となる。フロントエンドの `engagements.svelte` ストアは現在トピック単位のコレクションを購読しており、チャプター単位への変更に追従する必要がある。

## Requirements

### Requirement 1: チャプタースコープでのエンゲージメント評価

**Objective:** As a debate pipeline operator, I want engagement to be evaluated using only the current chapter's turns, so that personas' willingness to speak reflects the discussion context of the chapter they are in—not accumulated history from prior chapters.

#### Acceptance Criteria

1. When the Debate Pipeline evaluates engagement for a persona, the Debate Pipeline shall pass only the turns belonging to the current chapter as context (not all turns of the debate).
2. When the Debate Pipeline calls `evaluateEngagementWithFallback`, the Debate Pipeline shall provide chapter-scoped turns as the evaluation context.
3. The Debate Pipeline shall not reference turns from previous chapters when computing engagement scores or modes for the current chapter.

---

### Requirement 2: チャプター単位のエンゲージメント履歴保存

**Objective:** As a debate pipeline operator, I want engagement history to be stored under the chapter's Firestore path, so that each chapter's engagement scores are isolated and do not accumulate across chapters.

#### Acceptance Criteria

1. The Debate Pipeline shall store engagement history (entries keyed by `turnId`) at a path scoped to the chapter (e.g., `topics/{topicId}/chapters/{chapterId}/engagements/{personaId}`), not at the topic-level `engagements` collection.
2. The Debate Pipeline shall not write to or read from the topic-level `topics/{topicId}/engagements` collection for engagement history during normal debate execution.

---

### Requirement 3: 発言意図キューをエンゲージメントと同一ドキュメントでチャプター単位に管理

**Objective:** As a debate pipeline operator, I want queued intents to be stored in the same per-persona chapter-scoped document as engagement history, so that all intermediate speaker-selection data for a chapter is co-located and the chapter boundary is enforced consistently.

#### Acceptance Criteria

1. The Debate Pipeline shall store each persona's queued intents in the same document as their engagement history, scoped to the chapter (e.g., `topics/{topicId}/chapters/{chapterId}/engagements/{personaId}`).
2. When loading queued intents at the start of a chapter execution, the Debate Pipeline shall read from the chapter-scoped engagement documents.
3. When writing queued intent updates (`addQueuedIntents`, `expireQueuedIntents`, `consumeQueuedIntent`), the Debate Pipeline shall write to the chapter-scoped engagement document for the relevant persona.
4. The Debate Pipeline shall not read queued intents from the topic-level `topics/{topicId}/engagements` collection.

---

### Requirement 4: チャプター遷移時のエンゲージメント状態リセット

**Objective:** As a debate pipeline operator, I want engagement state (both in-memory and persisted) to be fully reset when a new chapter begins, so that no engagement carryover occurs between chapters.

#### Acceptance Criteria

1. When a new chapter starts, the Debate Pipeline shall initialize engagement evaluation with no queued intents from previous chapters.
2. If [a chapter's engagement data already exists in Firestore due to a prior partial execution], the Debate Pipeline shall overwrite (not merge) the queued intent state to ensure idempotent restarts.
3. While [a chapter is running], the Debate Pipeline shall only accumulate engagement history within that chapter's Firestore document scope.
4. The Debate Pipeline shall not carry over `queuedIntents` from a completed chapter to the next chapter.

---

### Requirement 5: 討論リセット時のチャプタースコープエンゲージメント削除

**Objective:** As a debate pipeline operator, I want the debate reset operation to correctly clean up chapter-scoped engagement data, so that stale engagement state does not persist after a reset.

#### Acceptance Criteria

1. When a debate reset is triggered, the Debate Pipeline shall delete all chapter-scoped engagement documents (`topics/{topicId}/chapters/{chapterId}/engagements/`) as part of the cleanup.
2. If [turn IDs are removed during a partial reset], the Debate Pipeline shall remove the corresponding history entries from the chapter-scoped engagement documents.

---

### Requirement 6: 管理画面のエンゲージメント表示の対応

**Objective:** As an admin user, I want the engagement display in the admin debate view to correctly read chapter-scoped engagement data, so that the displayed engagement scores reflect the actual per-chapter data.

#### Acceptance Criteria

1. When the Admin UI displays engagement scores for a turn, the Admin UI shall read engagement data from the chapter-scoped Firestore path that corresponds to the chapter containing that turn.
2. The Engagement Store shall subscribe to (or query from) the chapter-scoped path rather than the topic-level `engagements` collection.
3. If [chapter-scoped engagement data does not exist for a turn], the Admin UI shall display no engagement data (not stale cross-chapter data).
