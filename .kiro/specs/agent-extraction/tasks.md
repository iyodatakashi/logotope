# Implementation Plan

- [x] 1. (P) ステークホルダーエージェントを作成・接続する
- [x] 1.1 ステークホルダー分析の LLM 呼び出しを agents/ に移動する
  - `pipeline/stakeholders/stakeholder-generator.ts` のコード（`generateStakeholders` 関数・ツール定義）をそのまま `agents/stakeholder-agent.ts` として新規作成する
  - `agents/stakeholder-agent.ts` がビルドエラーなく単体でコンパイルされる
  - _Requirements: 2.1, 1.1_
  - _Boundary: agents/stakeholder-agent_

- [x] 1.2 呼び出し元を新しいエージェントに切り替え、旧ファイルを削除する
  - `api/stakeholders.ts` のインポートパスを `agents/stakeholder-agent.js` に変更する
  - `pipeline/stakeholders/stakeholder-generator.ts` を削除する
  - `pipeline/stakeholders/` ディレクトリが空になる場合はディレクトリも削除する
  - `api/stakeholders.ts` が新しいパスからビルドエラーなくコンパイルされる
  - _Requirements: 2.2, 2.3, 2.4, 1.3_
  - _Boundary: api/stakeholders, pipeline/stakeholders_

- [x] 2. (P) インタビューエージェントを作成・接続する
- [x] 2.1 インタビュー実行の LLM 呼び出しを agents/ に移動し、クラスを関数に変換する
  - `agents/interview-agent.ts` を新規作成し、`InterviewOutput` 型とトップレベル関数 `runInterview(topicTitle, persona)` を定義する（`InterviewRunnerService` クラスは廃止）
  - `web_search` ツールのロジックは変更せずそのまま移植する
  - `agents/interview-agent.ts` がビルドエラーなく単体でコンパイルされ、`InterviewOutput` をエクスポートしている
  - _Requirements: 3.1, 3.4, 3.5, 1.1_
  - _Boundary: agents/interview-agent_

- [x] 2.2 呼び出し元を関数形式に変更し、旧ファイルを削除する
  - `api/interviews.ts` を `runInterview` 関数インポートに変更し、`new InterviewRunnerService().runInterview(...)` を `runInterview(...)` に書き換える
  - `pipeline/interviews/interview-runner.ts` を削除する
  - `pipeline/interviews/` ディレクトリが空になる場合はディレクトリも削除する
  - `api/interviews.ts` が新しい呼び出し形式でビルドエラーなくコンパイルされる
  - _Requirements: 3.2, 3.3, 3.4, 1.3_
  - _Boundary: api/interviews, pipeline/interviews_

- [x] 3. (P) ペルソナ生成エージェントを作成・接続する
- [x] 3.1 ペルソナ一括生成の LLM 呼び出しを agents/ に移動する
  - `pipeline/personas/personas.ts` の `generatePersonas` 関数とビルド用ツール定義を `agents/persona-generator-agent.ts` として新規作成する
  - `getPersonasByTopicId` は `pipeline/personas/personas.ts` に残し、このファイルには含めない
  - `agents/persona-generator-agent.ts` がビルドエラーなく単体でコンパイルされる
  - _Requirements: 4.1, 4.2, 4.4, 1.1_
  - _Boundary: agents/persona-generator-agent_

- [x] 3.2 呼び出し元を新エージェントに切り替え、pipeline 側から生成ロジックを除去する
  - `api/personas.ts` のインポートパスを `agents/persona-generator-agent.js` に変更する
  - `pipeline/personas/personas.ts` から `generatePersonas` 関数・ペルソナ生成ツール定義・関連 import を削除し、`getPersonasByTopicId` のみが残る状態にする
  - `api/personas.ts` と `pipeline/personas/personas.ts` が共にビルドエラーなくコンパイルされる
  - _Requirements: 4.2, 4.3, 1.2, 1.3_
  - _Boundary: api/personas, pipeline/personas_

- [x] 4. (P) 章生成エージェントを作成・接続する
- [x] 4.1 章構造生成の LLM 呼び出しを agents/ に移動する
  - `pipeline/chapters/chapter-generator.ts` の `generateChapters` 関数・ツール定義（`SUBMIT_ISSUES_TOOL`, `SUBMIT_CHAPTERS_TOOL`）を `agents/chapter-agent.ts` として新規作成する
  - `buildNeutralitySystemPrompt` は `agents/facilitator-agent.ts` からインポートして継続使用する
  - `agents/chapter-agent.ts` がビルドエラーなく単体でコンパイルされる
  - _Requirements: 5.1, 5.4, 1.1_
  - _Boundary: agents/chapter-agent_

- [x] 4.2 pipeline 側を新エージェント呼び出しに切り替え、陳腐化テストを削除する
  - `pipeline/chapters/chapter-generator.ts` から `generateChapters` の定義とそのツール定義を削除し、`agents/chapter-agent.js` から `generateChapters` をインポートするよう変更する（`planChapters` はそのまま残す）
  - `pipeline/chapters/chapter-generator.test.ts` を削除する（旧 SDK・旧クラス参照で実行不可能なため）
  - `pipeline/chapters/chapter-generator.ts` がビルドエラーなくコンパイルされ、`planChapters` が `agents/chapter-agent.ts` 経由で `generateChapters` を呼び出せる
  - _Requirements: 5.2, 5.3, 1.2, 1.3_
  - _Boundary: pipeline/chapters, agents/chapter-agent_

- [x] 5. ビルド検証とインポートパスの確認
  - `tsc --noEmit` を実行し、型エラーがゼロであることを確認する
  - 削除したファイル（`stakeholder-generator.ts`, `interview-runner.ts`）へのインポート参照が残っていないことを `grep` で確認する
  - `index.ts` のエクスポート名・シグネチャが変更されていないことを確認する
  - `tsc --noEmit` がエラーゼロで完了し、削除ファイルへの参照が検索結果に現れない
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 1.2, 2.2, 3.2, 4.2_
