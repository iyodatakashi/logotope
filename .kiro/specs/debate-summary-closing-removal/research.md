# Research & Design Decisions: debate-summary-closing-removal

## Summary
- **Feature**: `debate-summary-closing-removal`
- **Discovery Scope**: Extension（既存討論チェーンからの削除）
- **Key Findings**:
  - 章まとめ・クロージングは識別マーカーのない素のファシリテーター発言で、**下流に依存者がいない**（`debate-state` はファシリテーター発言を集計から除外）。削除の回帰面は狭い。
  - 生成を担う `summary`/`closing` ステップは、発言生成に加えて「章の完了確定」「次段（次章 open / comments）の enqueue」という**進行・終端の役割**を持つ。発言生成のみを外し、進行・終端は不変に保つ必要がある。
  - `generateClosing` は討論側（削除対象・`facilitator-agent`）と編集側（維持・`intro-closing-agent`）に**同名で2つ存在**。取り違え厳禁。

## Research Log

### 削除対象の呼び出し連鎖と閉鎖性
- **Context**: 削除の波及範囲を確定するため。
- **Sources Consulted**: `functions/src/pipeline/debate/step.ts`, `turn.ts`, `debate-orchestrator.ts`, `agents/facilitator-agent.ts`, `types/step.types.ts`（grep + Read で線番号検証）。
- **Findings**:
  - 章まとめ: `performSummaryStep`([step.ts:460-468]) → `generateChapterTransition`([turn.ts:302-325]) → `generateChapterSummary`([facilitator-agent.ts:246-269])。
  - クロージング: `performClosingStep`([step.ts:485-493]) → `appendClosingTurn`([turn.ts:328-354]) → `generateClosing`([facilitator-agent.ts:216-244])。
  - `generateChapterTransition` / `appendClosingTurn` は `step.ts` からのみ、`generateChapterSummary` / 討論側 `generateClosing` は `turn.ts` からのみ使用。呼び出しは一方向で閉じている。
- **Implications**: 削除は局所的。エントリ（step 内の生成ブロック）を外せば、ビルダー・エージェント関数は自然に未使用化する。

### 共有ヘルパーの保持判定
- **Context**: エージェント削除に伴い巻き添えで消してよいヘルパーの切り分け。
- **Findings**:
  - `buildNeutralitySystemPrompt` は `chapter-agent` や `generateOpening` / `generateChapterIntroduction` 等でも使用 → **保持**。
  - `contentOnlySchema` は `generateClosing`(討論側) と `generateChapterSummary` の2箇所のみで使用 → 両者削除で**未使用化 → 削除**。
- **Implications**: `facilitator-agent.ts` からは `generateClosing`(討論側)・`generateChapterSummary`・`contentOnlySchema` のみ削除。他は不変。

### 進行・終端の骨格
- **Context**: R3（進行不変）を壊さない削除方法の確定。
- **Findings**: dispatch([debate-orchestrator.ts:261-280])で `summary` → `performSummaryStep` 後に**次章 open** を、`closing` → `performClosingStep` 後に**comments** を enqueue。enqueue 判断はステップ本体ではなく orchestrator にある。ステップ本体は `updateChapterStatus(completed)` + `deleteDiscussionPointStatuses` も担う。
- **Implications**: ステップ本体から生成のみ外せば、章の完了確定・次段起動は不変。StepKind/decideNextStep/dispatch は変更不要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 生成のみ除去（採用） | step 本体から生成ブロックを外し、StepKind・進行・終端は維持 | 低リスク・局所差分・R3 に非接触 | 生成除去後、2ステップ本体が同一化 | gap 分析の推奨 |
| B: summary/closing の StepKind 統合 | 単一「章終了」種別へ統合し decideNextStep/dispatch を簡素化 | union/分岐が簡潔化 | StepKind/NextStep/decideNextStep/taskKey/enqueue に波及。単章・finalResponse 経路の回帰検証必須 | 本スペックでは Non-Goal |
| C: 段階（A→後日 B） | まず A で挙動確定、後日 B | リスク分散 | 中間で同一2ステップが残る | 将来判断 |

## Design Decisions

### Decision: Option A（生成のみ除去）を採用し、進行・終端は不変に保つ
- **Context**: R1/R2（生成停止）と R3（進行不変）の両立。
- **Alternatives Considered**:
  1. A — step 本体の生成ブロックのみ除去。
  2. B — summary/closing の StepKind を統合。
- **Selected Approach**: `performSummaryStep`/`performClosingStep` から生成呼び出しを外す。StepKind・`decideNextStep`・dispatch・taskKey は不変。
- **Rationale**: 下流非依存かつ進行ロジックに触れないため最小リスク。R3 を構造的に保証。
- **Trade-offs**: 生成除去後、2ステップ本体が同一化する（D2 で解消）。
- **Follow-up**: parity/idempotency 系テストの期待ターン列を更新。

### Decision: 同一化する2ステップを単一の章完了ルーチンへ集約（D2）
- **Context**: 生成除去後 `performSummaryStep`/`performClosingStep` が「章完了＋論点クリーンアップ」で同一になる（R6：未使用・重複を残さない）。
- **Alternatives Considered**:
  1. 2つの薄い関数をそのまま残す。
  2. 単一 `completeChapterStep` に集約し、dispatch の両分岐から呼ぶ。
- **Selected Approach**: `completeChapterStep(ctx, payload)`（= `updateChapterStatus(completed)` + `deleteDiscussionPointStatuses`）に集約。dispatch は `summary`/`closing` 分岐を維持し、次段 enqueue の差（次章 open / comments）はそのまま。
- **Rationale**: バックエンドの完全重複関数の解消は素直な DRY で、StepKind/decideNextStep に波及しない。
- **Trade-offs**: dispatch 2箇所の呼び出し名変更のみ。意図（章まとめ/締め）を持つ関数名は消えるが、進行の意味は StepKind と dispatch 分岐に残る。
- **Follow-up**: step.test.ts の対象関数名・mock を更新。

### Decision: 過去データは不変・マイグレーションなし（R4）
- **Selected Approach**: 既存 `turns` 内の章まとめ/クロージング発言は削除・改変しない。今後の生成のみ止める。
- **Rationale**: 下流はこれらに依存せず、除去は表示本数が減るだけ。移行コスト・リスクを負わない。

## Risks & Mitigations
- 討論側 `generateClosing` と編集側 `generateClosing` の取り違え — import 元（`facilitator-agent` vs `intro-closing-agent`）で明確に区別し、編集側は不変を回帰テストで担保（R5）。
- parity テストが summary/closing 発言を期待している — 期待ターン列を更新し、章遷移・comments 到達・generated を検証する形へ寄せる（R3）。
- ステップ本体が使わなくなる ctx フィールド・import の取り残し — 型チェック（`tsc`）と lint で検出・除去（R6）。

## References
- 討論側章まとめ: `functions/src/pipeline/debate/step.ts:453-472`, `turn.ts:302-325`, `agents/facilitator-agent.ts:246-269`
- 討論側クロージング: `functions/src/pipeline/debate/step.ts:478-497`, `turn.ts:328-354`, `agents/facilitator-agent.ts:216-244`
- 進行・終端 dispatch: `functions/src/pipeline/debate/debate-orchestrator.ts:261-280`
- 編集側（維持・非対象）: `functions/src/agents/intro-closing-agent.ts`, `functions/src/pipeline/editing/intro-closing-step.ts`
