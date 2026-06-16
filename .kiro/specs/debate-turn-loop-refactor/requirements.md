# Requirements Document

## Introduction

討論オーケストレーターの章ループ（`runChapterLoop`）において、1回のループイテレーションが複数の発言を生成してしまうという構造的問題を解消する。具体的には、ファシリテーター介入とメンバー発言が同一イテレーション内で実行される現状を改め、「1イテレーション = 1発言」の原則を確立する。あわせて、各発言後に必ず最新の会話履歴を反映した engagement 評価を実施し、その評価に基づいて次の発言者を決定する流れを保証する。

## Boundary Context

- **In scope**: `debate-orchestrator.ts` の `runChapterLoop`、`tryStallIntervention`、`tryTopicDriftIntervention`、`saveFacilitatorTurn`、`evaluateEngagement` の動作と順序
- **Out of scope**: ファシリテーター・ペルソナ各エージェントの内部ロジック、Firestore スキーマ、フロントエンド表示
- **Adjacent expectations**: `state.pendingAddress`（`{ personaId, byFacilitator }` 型）による指名の繰り越し機構は既存のものを活用する

## Requirements

### Requirement 1: 発言ループの単一発言原則

**Objective:** As a システム設計者, I want 1回のループイテレーションがちょうど1つの発言（メンバーまたはファシリテーター）を生成すること, so that ループの動作が予測可能で、発言順とengagement評価の因果関係が追跡しやすくなる。

#### Acceptance Criteria

1. The Debate Orchestrator shall generate at most one utterance (member or facilitator) per loop iteration.
2. When a facilitator intervention fires in an iteration, the Debate Orchestrator shall not generate a member utterance in the same iteration.
3. When a facilitator intervention fires in an iteration, the Debate Orchestrator shall advance to the next iteration after saving the facilitator utterance.
4. The Debate Orchestrator shall process at most one `pendingAddress` nomination per iteration.

---

### Requirement 2: ファシリテーター介入イテレーションの完結

**Objective:** As a システム設計者, I want ファシリテーターの介入が独立したイテレーションとして完結すること, so that 介入ターン後の会話履歴が次イテレーションの engagement 評価に反映される。

#### Acceptance Criteria

1. When a facilitator stall intervention fires and nominates a member, the Debate Orchestrator shall store the nomination in `state.pendingAddress` and end the current iteration.
2. When a facilitator topic-drift intervention fires and nominates a member, the Debate Orchestrator shall store the nomination in `state.pendingAddress` and end the current iteration.
3. When a facilitator intervention fires without nominating a specific member, the Debate Orchestrator shall end the current iteration and let the next iteration determine the speaker via normal scoring.
4. After a facilitator intervention iteration completes, the Debate Orchestrator shall clear `state.lastSpeakerId` so that all members are eligible for engagement evaluation in the next iteration.

---

### Requirement 3: 毎イテレーションの engagement 評価

**Objective:** As a システム設計者, I want 各イテレーションの話者決定の前に必ず最新の会話履歴を用いた engagement 評価を実施すること, so that 直前の発言内容（メンバー発言・ファシリテーター介入いずれも）が次の話者選択に反映される。

#### Acceptance Criteria

1. The Debate Orchestrator shall run engagement evaluation at the start of every iteration, using the current `state.history` at that point.
2. When the previous utterance was a member turn, the Debate Orchestrator shall exclude that member from engagement evaluation (existing behavior).
3. When the previous utterance was a facilitator turn, the Debate Orchestrator shall include all members in engagement evaluation (no exclusion).
4. The Debate Orchestrator shall use the engagement scores from the evaluation performed in the current iteration to determine the speaker for that iteration.

---

### Requirement 4: 指名後の engagement 評価の保証

**Objective:** As a システム設計者, I want `pendingAddress` で指名が繰り越されたイテレーションでも engagement 評価が実行されること, so that 指名されたメンバーの engagement スコアが最新の会話履歴を反映した値になる。

#### Acceptance Criteria

1. When an iteration begins with a nomination in `state.pendingAddress`, the Debate Orchestrator shall run engagement evaluation before generating the nominated member's utterance.
2. When the nominated member is not in the current evaluation result (e.g., was the previous speaker before facilitator turn), the Debate Orchestrator shall perform a single-member engagement assessment for the nominated member as a fallback.
3. The Debate Orchestrator shall use the engagement score from the current iteration's evaluation to set the speech parameters (mode, score, intentSummary) of the nominated member's utterance.
