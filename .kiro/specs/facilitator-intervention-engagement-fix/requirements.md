# Requirements Document

## Introduction

討論オーケストレーター（`debate-orchestrator.ts`）において、ファシリテーター介入発火時にファシリテーターターンよりも先にメンバーターンが生成・保存されてしまう問題と、介入後の engagement 評価がファシリテーター発言を含まない古い履歴を参照する問題を解消する。介入を検出したイテレーションではファシリテーターターンのみを保存して終了し、メンバー発言は次のイテレーションで行う。これにより「介入 → ファシリテーター発言 → メンバー応答」という正しいターン順序と、ファシリテーター発言を反映した engagement 評価を保証する。

## Boundary Context

- **In scope**: `debate-orchestrator.ts` の `executeChapterTask`（メインループ）と `executeTurn` の動作と順序
- **Out of scope**: ファシリテーター・ペルソナ各エージェントの内部ロジック（`facilitator-agent.ts`、`persona-agent.ts`）、Firestore スキーマ変更、フロントエンド表示
- **Adjacent expectations**: `state.targetPersona`（`{ personaId, targetedBy }` 型）による指名の繰り越し機構は既存のものを活用する。`state.pendingIntervention` による遅延保存パターンは本修正で不要となる

## Requirements

### Requirement 1: 介入発火イテレーションでのファシリテーター即時発言

**Objective:** As a システム設計者, I want 介入が発火したイテレーションでファシリテーターターンをその場で保存しメンバーターンを生成しないこと, so that 討論履歴上のターン順序がファシリテーター発言 → メンバー応答の正しい順序になる。

#### Acceptance Criteria

1. When a facilitator intervention fires during an iteration, the Debate Orchestrator shall save the facilitator's utterance to the turn history in that same iteration.
2. When a facilitator intervention fires, the Debate Orchestrator shall not generate a member utterance in the same iteration.
3. When a facilitator intervention fires and nominates a specific member, the Debate Orchestrator shall store the nomination in `state.targetPersona` and end the current iteration.
4. When a facilitator intervention fires without nominating a specific member, the Debate Orchestrator shall end the current iteration and let the next iteration determine the speaker via normal scoring.

---

### Requirement 2: ファシリテーターターン後の lastSpeakerId クリア

**Objective:** As a システム設計者, I want ファシリテーターターン保存後に `state.lastSpeakerId` がクリアされること, so that 次イテレーションの engagement 評価がすべてのメンバーを対象として実行される。

#### Acceptance Criteria

1. When a facilitator intervention turn is saved, the Debate Orchestrator shall set `state.lastSpeakerId` to `undefined`.
2. When the next iteration begins after a facilitator turn, the Debate Orchestrator shall run engagement evaluation including all members with no exclusion based on the pre-intervention last speaker.

---

### Requirement 3: 介入後イテレーションの engagement 評価タイミング

**Objective:** As a システム設計者, I want 介入後のイテレーションでの engagement 評価がファシリテーターターンを含む最新の会話履歴を使って実行されること, so that 指名されたメンバーの発言パラメータがファシリテーターの介入内容を反映した値になる。

#### Acceptance Criteria

1. When an iteration begins after a facilitator intervention, the Debate Orchestrator shall run engagement evaluation using `state.turns` that includes the facilitator's utterance.
2. When the nominated member is absent from the evaluation result due to prior exclusion, the Debate Orchestrator shall perform a single-member fallback assessment for that member.
3. The Debate Orchestrator shall use the engagement score obtained in the current iteration to set the speech parameters (mode, score, intentSummary) of the nominated member's utterance.
