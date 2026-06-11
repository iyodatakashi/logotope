# Implementation Plan

## Feature: persona-model-routing

---

- [x] 1. Foundation — 依存関係・型・設定の準備
- [x] 1.1 新規パッケージ依存関係の追加
  - `functions/package.json` に `ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/xai`, `@tavily/core` を追加
  - functions ディレクトリで `npm install` を実行してインストールを確認
  - `npm run build`（functions）がコンパイルエラーなく成功すること
  - _Requirements: 3.1_

- [x] 1.2 LLMType 型・データモデル・設定の追加
  - `types/index.ts` に `LLMType = 'gemini' | 'grok' | 'claude' | 'gpt'` union 型を追加し、`PersonaAttributes` に `llmType?: LLMType` オプションフィールドを追加
  - `repository.ts` の `PersonaProfile` と `CreatePersonaProfileParams` に `llmType` フィールドを追加
  - `config/ai.ts` に `PERSONA_MODELS: Record<LLMType, string>` マップ（claude: claude-sonnet-4-6, gemini: gemini-2.5-flash, gpt: gpt-4o, grok: grok-4）を追加
  - TypeScript コンパイルが通り、`LLMType` と `PersonaAttributes.llmType` が全ファイルで型チェック対象になること
  - _Requirements: 1.1, 1.2, 3.1, 3.2_

---

- [x] 2. (P) `getPersonaModel` 関数の実装
  - `functions/src/llm/models.ts` を新規作成し、`getPersonaModel(llmType: LLMType): LanguageModel` を実装
  - `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/xai` の各プロバイダーパッケージでモデルインスタンスを生成
  - `GEMINI_API_KEY`・`OPENAI_API_KEY`・`XAI_API_KEY` が未設定のプロバイダーは `anthropic('claude-sonnet-4-6')` にフォールバックし警告ログを出力する
  - Vercel AI SDK のプロバイダーインスタンスはモジュールスコープで生成するためキャッシュは SDK が自動管理する
  - `getPersonaModel('gemini')` が `GEMINI_API_KEY` 設定時は Gemini の `LanguageModel` を、未設定時は Claude の `LanguageModel` を返すこと
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: llm/models.ts_

---

- [x] 3. ペルソナ信念リサーチサービスの実装
- [x] 3.1 (P) Tavily 検索クエリの生成と情報収集
  - `pipeline/persona-research.ts` を新規作成し `PersonaResearchService` クラスを定義
  - グラウンディング用クエリ（ステークホルダー役割・職業に基づく具体的経験・当事者の声）とニュース用クエリ（討論テーマの最新動向）を生成するロジックを実装
  - `@tavily/core` クライアントを初期化し、2 クエリを順次実行
  - Tavily 例外発生時は空の検索結果で後続処理を継続するフォールバックを実装し、エラーをログに記録する
  - `runResearch()` が Tavily から 2 件の検索結果を取得、または例外時に空配列でフォールバックできること（モックで検証）
  - _Requirements: 5.1, 5.4_
  - _Boundary: pipeline/persona-research.ts_

- [x] 3.2 初期信念の生成と Firestore への保存
  - 検索結果をコンテキストに含めた Claude Opus へのプロンプトで `initialBelief`（6 項目 Markdown）と `researchSummary` を生成するロジックを実装
  - `repository.createCompletedPersonaInterview` で `researchSummary` を Firestore の `interviewRecord` フィールドに保存
  - `repository.createPersonaBelief` で `initialBelief` を version=0 で保存
  - `runResearch()` 完了後に Firestore の `interviewRecord` フィールドとペルソナ信念が更新されること
  - _Requirements: 5.2, 5.3, 5.5_
  - _Boundary: pipeline/persona-research.ts_

---

- [x] 4. (P) ペルソナ生成での llmType 自動分類の実装
  - `pipeline/persona-generator.ts` の `submit_personas` ツール items スキーマに `llmType` enum フィールドを追加（値: `gemini`/`grok`/`claude`/`gpt`）
  - description に各 llmType の割り当て基準（gemini=最新情報重視型、grok=SNS影響型、claude=学術・論理型、gpt=バランス型）を明記
  - `required` 配列に `llmType` を追加
  - `createPersonaProfile` 呼び出し時に `llmType: p.llmType` を引数に含める
  - ペルソナ生成後の Firestore ドキュメントに有効な `llmType` フィールドが含まれること
  - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - _Boundary: pipeline/persona-generator.ts_

---

- [x] 5. PersonaAgentService の Vercel AI SDK への移行
- [x] 5.1 討論ターン生成メソッドの移行
  - `persona-agent.ts` のコンストラクタから `new Anthropic()` 依存を除去し、`generateText` と `getPersonaModel` をインポートして使用するよう変更
  - `generateTurn` メソッドを `generateText({ model: getPersonaModel(persona.llmType ?? 'claude'), ... })` に変更
  - `FULL_TURN_TOOL`（`submit_turn`）と `REACTION_TURN_TOOL`（`submit_reaction`）を `jsonSchema()` でラップして `tools` に渡す
  - プロバイダー API エラー時に `getPersonaModel('claude')` でリトライするフォールバックを実装し、エラープロバイダーと理由をログに記録する
  - `generateTurn` が `persona.llmType` に応じたモデルで `generateText` を呼び出し、`toolCalls[0].args` から発言内容を取得できること（`getPersonaModel` をモックして検証）
  - _Requirements: 4.1, 4.4, 4.5_
  - _Depends: 2_

- [x] 5.2 エンゲージメント評価・討論後コメントメソッドの移行
  - `assessEngagement` を `generateText` + `getPersonaModel` に変更し、`ASSESS_ENGAGEMENT_TOOL` を `jsonSchema()` でラップ
  - `generatePostDebateComment` を同様に変更し、`POST_DEBATE_COMMENT_TOOL` を `jsonSchema()` でラップ
  - エンゲージメント評価と討論後コメントが各 llmType のモデルで正常に生成できること
  - _Requirements: 4.2, 4.3, 4.5_

---

- [x] 6. パイプライン統合と interviewer.ts の廃止
- [x] 6.1 (P) debate-orchestrator の llmType デフォルト対応
  - `debate-orchestrator.ts` の `toPersonaAttributes()` に `llmType: p.llmType ?? 'claude'` のデフォルト割り当てを追加
  - `llmType` フィールドが存在しない既存ペルソナを読み込んでも `toPersonaAttributes()` が `'claude'` を返すこと
  - _Requirements: 1.4_
  - _Boundary: pipeline/debate-orchestrator.ts_

- [x] 6.2 (P) api/interviews.ts の PersonaResearchService への差し替えと interviewer.ts の廃止
  - `api/interviews.ts` で `InterviewerService` の呼び出しを `PersonaResearchService.runResearch()` に差し替え
  - `pipeline/interviewer.ts` を削除
  - インタビュー API エンドポイントが `PersonaResearchService` を呼び出し、Firestore の `interviewRecord` にリサーチサマリーが保存されること
  - _Requirements: 5.5_
  - _Boundary: api/interviews.ts_
  - _Depends: 3.2_

---

- [x] 7. テストとバリデーション
- [x] 7.1 getPersonaModel のユニットテスト
  - 各 `llmType` に対して対応する `LanguageModel` が返されることを検証
  - `GEMINI_API_KEY`・`OPENAI_API_KEY`・`XAI_API_KEY` が未設定の場合に Claude の `LanguageModel` にフォールバックすることを検証
  - 4 つの llmType すべてのフォールバック動作を含む全テストケースが pass すること
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 7.2 (P) PersonaResearchService のユニットテスト
  - Tavily クライアントをモックして 2 件の検索クエリ実行フローを検証
  - Tavily 例外時に空のコンテキストで信念生成を継続するフォールバック動作を検証
  - Anthropic SDK をモックして `initialBelief` 生成と Firestore 保存呼び出しを検証
  - Tavily 成功・失敗両パスの全テストケースが pass すること
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7.3 (P) PersonaAgentService の LLM ルーティングテスト
  - `getPersonaModel` をモックして、`generateTurn`・`assessEngagement`・`generatePostDebateComment` それぞれが `persona.llmType` に応じたモデルで `generateText` を呼び出すことを検証
  - 全 llmType（gemini・grok・claude・gpt）のルーティングを網羅した全テストケースが pass すること
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Depends: 5_
