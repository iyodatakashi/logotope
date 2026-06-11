# Requirements Document

## Introduction

`persona-model-routing` は、討論プラットフォーム logotope において、ペルソナの特性（最新情報への敏感度・SNS影響度・論理重視・バランス性）に応じて使用LLMモデルを動的に割り当てる機能である。現在はすべてのペルソナがClaude APIを使用しているが、本機能により各ペルソナの「情報収集スタイル」を反映したモデル（Gemini・Grok・Claude・GPT）を使い分え、討論コンテンツのリアリティと質を向上させる。また、現行のインタビューフェーズを廃止し、Tavilyウェブ検索によるペルソナ信念形成に置き換える。

## Boundary Context

- **In scope**: ペルソナ討論エージェント（`persona-agent.ts`）のLLMルーティング、ペルソナ生成フェーズでのLLMタイプ分類・属性付与、インタビューフェーズの廃止とTavilyウェブ検索による初期信念形成への置き換え
- **Out of scope**: ファシリテーターエージェント（`facilitator-agent.ts`）のLLM変更、ペルソナ生成処理自体（`persona-generator.ts`）のLLM変更（Claude Opusを継続）、フロントエンドUI変更
- **Adjacent expectations**: `interviewer.ts` は本スペックで廃止・置き換え対象となる。討論中のペルソナコンテキスト（現 `interviewRecord`）はリサーチサマリーが代替する

## Requirements

### Requirement 1: ペルソナLLMタイプの定義とデータモデル

**Objective:** As a AIパイプライン, I want ペルソナにLLMタイプを属性として持たせたい, so that 討論実行時に適切なモデルへルーティングできる

#### Acceptance Criteria

1. The Persona Model Router shall `gemini`（最新情報重視型）、`grok`（SNS影響型）、`claude`（学術・論理型）、`gpt`（バランス型）の4種類のLLMタイプを定義する
2. The Persona Model Router shall `PersonaAttributes` 型に `llmType` フィールド（`'gemini' | 'grok' | 'claude' | 'gpt'`）を追加する
3. When ペルソナがFirestoreに保存されるとき, the Persona Generator shall `llmType` を含めてペルソナドキュメントに書き込む
4. If `llmType` フィールドが存在しないペルソナを読み込んだとき, the Persona Agent shall `claude` をデフォルト値として使用する

### Requirement 2: ペルソナ生成時のLLMタイプ自動分類

**Objective:** As a 管理者, I want ペルソナ生成時にLLMタイプが自動的に決まってほしい, so that 手動設定なしにモデルルーティングが機能する

#### Acceptance Criteria

1. When ペルソナが生成されるとき, the Persona Generator shall ステークホルダーの役割・職業・関心事・スタンス方向を分析して `llmType` を決定する
2. The Persona Generator shall 情報収集が業務上必要なペルソナ（記者・アナリスト・IT従事者など）に `gemini` を割り当てる
3. The Persona Generator shall SNSや世論に敏感なペルソナ（活動家・インフルエンサー・若年層など）に `grok` を割り当てる
4. The Persona Generator shall 論文・理論・歴史的根拠を重視するペルソナ（研究者・教授・評論家など）に `claude` を割り当てる
5. The Persona Generator shall いずれにも明確に該当しないペルソナ（一般市民・会社員など）に `gpt` を割り当てる
6. If 分類が不確実な場合, the Persona Generator shall `gpt` をデフォルトとして割り当てる

### Requirement 3: マルチプロバイダーLLMクライアントの統合

**Objective:** As a AIパイプライン, I want 複数のLLMプロバイダーのクライアントを一元管理したい, so that プロバイダー切り替えをパイプライン全体に影響なく実現できる

#### Acceptance Criteria

1. The AI Client Factory shall Anthropic・Google Gemini・xAI Grok・OpenAI GPTの各プロバイダーに対応するクライアントを生成できる
2. The AI Client Factory shall Anthropic APIキーは既存の環境変数から取得し、Geminiは `GEMINI_API_KEY`、GrokはOpenAI互換として `GROK_API_KEY`（base URL: `https://api.x.ai/v1`）、GPTは `OPENAI_API_KEY` から取得する
3. While 討論パイプラインが実行中のとき, the AI Client Factory shall クライアントインスタンスをキャッシュして再利用する
4. If プロバイダーのAPIキーが未設定のとき, the AI Client Factory shall そのプロバイダーを無効として扱い、Claudeにフォールバックする

### Requirement 4: ペルソナ討論ターンのLLMルーティング

**Objective:** As a 討論パイプライン, I want ペルソナごとの `llmType` で実際の発言生成モデルを切り替えたい, so that 各ペルソナが異なるモデルの特性を持って討論に参加できる

#### Acceptance Criteria

1. When ペルソナが発言ターンを生成するとき, the Persona Agent shall `persona.llmType` に対応するLLMクライアントを使用する
2. When エンゲージメント評価を実行するとき, the Persona Agent shall `persona.llmType` に対応するLLMクライアントを使用する
3. When 討論後コメントを生成するとき, the Persona Agent shall `persona.llmType` に対応するLLMクライアントを使用する
4. If プロバイダーへのAPI呼び出しがエラーになったとき, the Persona Agent shall Claude APIにフォールバックしてリトライし、エラー発生プロバイダーと理由をログに記録する
5. The Persona Agent shall ツール定義（`submit_turn`・`submit_reaction`・`assess_engagement`・`submit_post_debate_comment`）の構造はLLMプロバイダーに関わらず統一する

### Requirement 5: ウェブ検索による初期信念形成（インタビュー廃止）

**Objective:** As a AIパイプライン, I want 現行のインタビューを廃止しTavilyウェブ検索に置き換えたい, so that ペルソナの初期信念がLLMのステレオタイプな推測ではなく、当事者の具体的な経験・コミュニティの声・最新の出来事に基づくリアリティを持てる

#### Acceptance Criteria

1. The Persona Research Service shall ペルソナのステークホルダー役割・職業・背景と討論テーマから検索クエリを生成し、Tavily Search APIで以下の2種類の情報を収集する: (a) この立場の人が実際に直面している具体的な問題・経験・当事者の声、(b) 討論テーマに関連する最新の出来事・動向
2. The Persona Research Service shall 収集した情報をもとにLLMでペルソナの初期信念ドキュメントを生成する
3. The Persona Research Service shall 生成した初期信念とリサーチサマリー（検索クエリ・主な収集内容）をFirestoreに保存し、討論中のペルソナコンテキストとして使用できるようにする
4. If Tavily検索が失敗した場合, the Persona Research Service shall 検索なしでLLMのみによる初期信念生成にフォールバックし、エラーをログに記録する
5. The Pipeline shall 既存の `interviewer.ts` によるインタビューフェーズをPersona Research Serviceに置き換える
