# Requirements Document

## Project Description (Input)
pipelineなどに含まれるコードのうち、エージェントとして切り出すべきものとagents以下に移動

## Introduction

`functions/src/pipeline/` 配下には、LLMを直接呼び出すコードとFirestore操作・オーケストレーションのコードが混在している。`functions/src/agents/` の役割（LLM呼び出し専門モジュール）に合致するコードを pipeline から抽出し、agents 配下に移動する。これにより「LLMを呼ぶのは agents」「Firestoreを触るのは pipeline（またはapi）」という責務分離を完徹する。

## Boundary Context

- **In scope**: `pipeline/` 内で LLM（generateText等）を直接呼び出している関数・クラス・ツール定義
- **Out of scope**: Firestore 操作のみを行う関数（`getPersonasByTopicId` 等）、オーケストレーション関数（`planChapters` 等）、`agents/` 既存ファイルの内部実装変更
- **Adjacent expectations**: 呼び出し元（`api/`、`pipeline/`、`index.ts`）のインポートパスを移動後に更新する。外部 API インターフェースや Firestore スキーマは変更しない

## Requirements

### 要件 1: エージェント識別基準

**Objective:** 開発者として、「エージェント」と「パイプライン」の配置基準を明確にしたい。将来の追加コードで配置を迷わないようにするため。

#### Acceptance Criteria
1. The codebase shall place code that directly calls `generateText` or equivalent LLM API functions exclusively under `functions/src/agents/`.
2. The codebase shall place orchestration code that reads/writes Firestore, composes agent calls, or manages business flow under `functions/src/pipeline/` or `functions/src/api/`.
3. The codebase shall not place LLM prompt definitions or tool schemas under `functions/src/pipeline/`.

---

### 要件 2: ステークホルダーエージェントの抽出

**Objective:** 開発者として、`stakeholder-generator.ts` をエージェントに移動したい。ファイルが LLM 呼び出しのみで構成されており、pipeline に置く理由がないため。

#### Acceptance Criteria
1. When `generateStakeholders` is called, the Codebase shall have this function defined in `functions/src/agents/stakeholder-agent.ts`.
2. The codebase shall remove `functions/src/pipeline/stakeholders/stakeholder-generator.ts`.
3. When the api layer calls `generateStakeholders`, the Codebase shall import it from `agents/stakeholder-agent.js`.
4. The codebase shall preserve the function signature `(title: string) => Promise<{ stakeholders: Stakeholder[] }>` unchanged.

---

### 要件 3: インタビューエージェントの抽出

**Objective:** 開発者として、`interview-runner.ts` をエージェントに移動したい。ファイルが LLM + web search ツール呼び出しのみで構成されており、Firestore 操作を持たないため。

#### Acceptance Criteria
1. When `runInterview` is called, the Codebase shall have this logic defined in `functions/src/agents/interview-agent.ts`.
2. The codebase shall remove `functions/src/pipeline/interviews/interview-runner.ts`.
3. When `api/interviews.ts` calls the interview logic, the Codebase shall import from `agents/interview-agent.js`.
4. The codebase shall preserve the `InterviewOutput` type and the function signature `(topicTitle: string, persona: Persona) => Promise<InterviewOutput>` unchanged.
5. If `InterviewOutput` type is used beyond `interview-agent.ts`, the codebase shall export it from `agents/interview-agent.ts` or move it to `types/interview.types.ts`.

---

### 要件 4: ペルソナ生成エージェントの抽出

**Objective:** 開発者として、`personas.ts` 内の `generatePersonas` をエージェントに移動したい。Firestore 読み取り関数と LLM 呼び出し関数が同居しており、責務が混在しているため。

#### Acceptance Criteria
1. When `generatePersonas` is called, the Codebase shall have this function defined in `functions/src/agents/persona-generator-agent.ts`.
2. The codebase shall keep `getPersonasByTopicId` in `functions/src/pipeline/personas/personas.ts`.
3. When `api/personas.ts` calls `generatePersonas`, the Codebase shall import it from `agents/persona-generator-agent.js`.
4. The codebase shall preserve the function signature `(title: string, stakeholders: Stakeholder[], topicId: string) => Promise<{ personas: Persona[] }>` unchanged.

---

### 要件 5: 章生成エージェントの抽出

**Objective:** 開発者として、`chapter-generator.ts` 内の `generateChapters` をエージェントに移動したい。LLM 呼び出し部分（章構造生成）と Firestore 書き込み部分（`planChapters`）が混在しているため。

#### Acceptance Criteria
1. When `generateChapters` is called, the Codebase shall have this function defined in `functions/src/agents/chapter-agent.ts`.
2. The codebase shall keep `planChapters` in `functions/src/pipeline/chapters/chapter-generator.ts`.
3. When `planChapters` calls `generateChapters`, the Codebase shall import it from `agents/chapter-agent.js`.
4. The codebase shall preserve the function signature and return type `Result<{ chapters: Chapter[]; generalIssues: string[]; personaIssues: string[] }, PipelineError>` unchanged.

---

### 要件 6: インポートパスの一貫性

**Objective:** 開発者として、移動後もビルドエラーがなくコードが動作することを確認したい。インポートが壊れると本番環境に影響するため。

#### Acceptance Criteria
1. When the TypeScript compiler runs after the refactoring, the Codebase shall produce zero type errors.
2. The codebase shall not have any import paths pointing to the removed files (`stakeholder-generator.ts`, `interview-runner.ts`) after the migration.
3. When `index.ts` exports pipeline entry points, the Codebase shall not require changes to exported function names or signatures.
