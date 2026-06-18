# Research & Design Decisions

---
**Feature**: `agent-extraction`
**Discovery Scope**: Extension（既存コードの責務整理）
**Key Findings**:
- 移動対象は4ファイル中2ファイルが「全体移動」、2ファイルが「分割（LLM部分のみ抽出）」
- `InterviewRunnerService` クラスはステートレスで、他のエージェントと同様の関数形式に変換できる
- `chapter-generator.test.ts` は旧SDK・旧クラス参照を持つ陳腐化テストで、この作業に合わせて削除が必要

---

## Research Log

### 呼び出し元の調査

- **Context**: 移動後にインポートパスが壊れないよう、全呼び出し元を特定する
- **Findings**:
  - `api/stakeholders.ts` → `pipeline/stakeholders/stakeholder-generator.ts`（`generateStakeholders`）
  - `api/interviews.ts` → `pipeline/interviews/interview-runner.ts`（`InterviewRunnerService`）
  - `api/personas.ts` → `pipeline/personas/personas.ts`（`generatePersonas`）
  - `api/chapters.ts` → `pipeline/chapters/chapter-generator.ts`（`planChapters`）
  - `pipeline/chapters/chapter-generator.ts`（`planChapters` 内）→ 同ファイルの `generateChapters` を呼ぶ
- **Implications**: `api/` 層のインポートパスの変更が必要。`pipeline/chapters/chapter-generator.ts` は `agents/chapter-agent.ts` への依存が追加される

### `InterviewOutput` 型の所在

- **Context**: `interview-runner.ts` に定義された型の移動先を決定する
- **Findings**: `InterviewOutput` は `interview-runner.ts` 内と `api/interviews.ts` の暗黙的返却型としてのみ使用。`types/interview.types.ts` には別の `Interview` 型が存在し用途が異なる
- **Implications**: `agents/interview-agent.ts` に同居させ、`api/interviews.ts` はそこからインポートする

### 陳腐化テストの確認

- **Context**: `chapter-generator.test.ts` の扱いを決定する
- **Findings**: 同テストは `ChapterGeneratorService`（現在のコードに存在しないクラス）、旧 Anthropic SDK、`repository.types.ts`（削除済み）を参照しており、実行不可能な状態
- **Implications**: 移動作業に合わせて削除する

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `generateChapters` を `facilitator-agent.ts` に統合 | ファシリテーターが章構造を決定するという概念的整合性 | ファイル数を増やさない | facilitator-agent.ts が肥大化する | 現在も `buildNeutralitySystemPrompt` をインポートして使っている |
| `generateChapters` を新規 `agents/chapter-agent.ts` に配置 | 単一責任・ファイル構成の明快さ | 各エージェントファイルの役割が明確 | ファイルが1つ増える | 採用 |

---

## Design Decisions

### Decision: `generateChapters` の配置先

- **Context**: `chapter-generator.ts` の LLM 呼び出し部分をどこに置くか
- **Alternatives Considered**:
  1. `agents/facilitator-agent.ts` に統合 — ファイルを増やさずに済む
  2. `agents/chapter-agent.ts` を新設 — 章生成専用エージェント
- **Selected Approach**: `agents/chapter-agent.ts` を新設
- **Rationale**: `facilitator-agent.ts` は既に opening/intervention/closing/chapter-introduction/chapter-summary を担当しており、章構造の事前生成（`generateChapters`）を加えると責務が広くなりすぎる。章構造生成は討論開始前のプランニングであり、討論中の司会とは性質が異なる
- **Trade-offs**: ファイルが1つ増えるが、各エージェントファイルの役割が明確になる

### Decision: `InterviewRunnerService` クラスの廃止

- **Context**: クラスを維持するか関数に変換するか
- **Alternatives Considered**:
  1. クラスをそのまま移動 — 変更量が最小
  2. ステートレスなのでトップレベル関数に変換 — 他のエージェントと統一
- **Selected Approach**: `runInterview(topicTitle, persona)` 関数として定義
- **Rationale**: 他のエージェント関数（`generateStakeholders`, `generatePersonas` 等）はすべてトップレベル関数。クラスにする理由（依存注入、状態管理等）がない
- **Trade-offs**: 呼び出し元（`api/interviews.ts`）の `new InterviewRunnerService().runInterview(...)` を `runInterview(...)` に変更する必要がある

---

## Risks & Mitigations

- 移動後に TypeScript パスエラーが発生するリスク → `tsc --noEmit` でビルド検証を各ステップ後に行う
- `chapter-generator.test.ts` の削除が見落とされるリスク → タスクに明示的に含める
- `personas.ts` の分割後に `generatePersonas` と `getPersonasByTopicId` の依存が逆転するリスク → `persona-generator-agent.ts` は `getPersonasByTopicId` を参照せず完全に独立している（topicId はパラメータとして受け取るのみ）
