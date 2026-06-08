# Research & Design Decisions

---
**Purpose**: 技術設計の根拠となる調査結果・アーキテクチャ検討・設計判断を記録する。

---

## Summary
- **Feature**: `debate-platform`
- **Discovery Scope**: New Feature (Greenfield) — 複雑なマルチエージェントAIパイプラインを含む新規システム
- **Key Findings**:
  1. Anthropic の推奨するマルチエージェントパターンは「オーケストレーター＋ワーカー」構造であり、各エージェントは独立したコンテキストを持つ。logotope のターン制討論設計はこのパターンと整合する。
  2. Firebase Functions v2（Cloud Run 基盤）はHTTPトリガーで最大60分のタイムアウトをサポートする。討論生成が長時間化しても対応可能。
  3. 公開コンテンツページの SEO 対応のため `adapter-static` から Firebase App Hosting + SSR（`adapter-auto`）に変更。公開ページは `+page.server.ts` でSSR配信、短時間 CRUD API は `+server.ts` に実装、長時間 AI 処理のみ Firebase Functions に委譲する役割分担とする。

## Research Log

### マルチエージェントパターン（Anthropic）
- **Context**: 討論に参加するファシリテーターと各ペルソナを独立したAIエージェントとして設計する際の最適パターンを調査
- **Sources Consulted**:
  - Anthropic Engineering Blog: "How we built our multi-agent research system"
  - Anthropic Docs: "Building Effective AI Agents"
  - Anthropic Docs: "Multiagent sessions"
- **Findings**:
  - Anthropic のマルチエージェントシステムはオーケストレーター（Coordinator）がサブエージェントの実行を管理するパターンを採用
  - 各エージェントは独立したセッション（会話コンテキスト）を持つ
  - 全エージェントが共有するコンテキスト（ファイルシステム等）と、エージェント個別のコンテキストは分離されている
  - 「多くの依存関係を持つ並行タスク」はマルチエージェントに不向き。ターン制の討論は逐次処理が適切
  - シングルエージェントより15倍程度トークン消費が増加する点を考慮した設計が必要
- **Implications**:
  - logotope の討論は完全に並行ではなく「ターン制（逐次）」で実行する設計が適切
  - 各エージェントへの入力 = 個別のシステムプロンプト（ペルソナ属性＋信念ドキュメント）＋共有会話履歴
  - エージェントは独立した Claude API 呼び出しとして実装する（会話セッションの管理は不要）

### Firebase Functions v2 長時間実行
- **Context**: 討論生成（複数エージェントの逐次 API 呼び出し）が長時間化した場合の対応策を調査
- **Sources Consulted**:
  - Firebase Docs: "Manage functions"
  - Blog: "How to Use Firebase Cloud Functions v2 with Cloud Run Under the Hood"
- **Findings**:
  - v2 HTTP/Callable 関数: 最大60分タイムアウト（`timeoutSeconds: 3600`）
  - v2 は Cloud Run 基盤のため、コンテナが継続実行される
  - 長時間処理は非同期化（即時 202 返却 → バックグラウンド実行）が推奨
- **Implications**:
  - 討論生成 API は即時 `debateSessionId` を返し、バックグラウンドで `DebateOrchestrator` を実行する
  - 生成進捗は Firestore に書き込み、フロントエンドがリアルタイムリスニングで取得する

### Firebase Data Connect スキーマ設計
- **Context**: リレーショナルデータ（テーマ・ペルソナ・討論ターン等）の永続化スキーマ設計
- **Sources Consulted**:
  - Firebase Docs: "Design Data Connect schemas"
  - Firebase Blog: "Data Connect: All About Schemas"
- **Findings**:
  - GraphQL の `@table` 型が PostgreSQL テーブルに直接マッピングされる
  - `@col(dataType: "text")` で大容量テキスト（Markdown等）を格納可能
  - 外部キー関係は型フィールドで表現する（自動的に `_id` カラムが生成される）
  - `@unique` で 1対1 関係を表現できる
- **Implications**:
  - 信念ドキュメント（Markdown テキスト）は `String` 型で格納する（構造化不要）
  - ペルソナ × セッションの会話ターンは `DebateTurn @table` で表現し、`round` と `turnIndex` で順序を管理する

### Firebase App Hosting + SSR への移行
- **Context**: 公開コンテンツページの SEO を確保するため、`adapter-static` から SSR 対応の構成に変更
- **Findings**:
  - Firebase App Hosting は SvelteKit の `adapter-auto` をネイティブサポートする
  - `+page.server.ts` でサーバーサイドデータ取得が可能になり、HTMLにコンテンツが含まれた状態でクローラーに配信できる
  - `+server.ts` ルートが使用可能になり、短時間の読み取り API を Firebase Functions を経由せず実装できる
  - 管理画面（`/admin/**`）は Firebase Auth が必要なため SEO 不要。クライアントサイド SPA のまま動作する
  - `apphosting.yaml` で Cloud Run のスペック（CPU・メモリ・並行数）を設定する
- **Implications**:
  - `adapter-static` → `adapter-auto` に変更（`package.json`・`svelte.config.js` を更新）
  - `firebase.json` の `hosting` セクションは不要になり Firebase App Hosting 設定（`apphosting.yaml`）に移行
  - Firebase Functions の役割が「AI パイプライン専用」に明確化され、短時間 CRUD は SvelteKit 側に移動
  - 公開討論ページに OGP メタタグを `+page.server.ts` 内で動的生成することが可能になる

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 完全逐次オーケストレーター | Orchestratorが全エージェントを逐次呼び出す | 状態管理がシンプル、デバッグ容易 | 1エージェントのエラーで全体停止 | **採用** — ターン制討論に最適 |
| 並行マルチエージェント | 全ペルソナを並行して呼び出す | 高速 | 会話の文脈が共有されず討論にならない | 不採用 — 討論の本質に反する |
| Firestore イベントドリブン | 各ターン完了後に Cloud Functions がトリガー | 耐障害性が高い | 実装複雑度が高い | 将来の改善候補 |
| 長時間同期 HTTP | Functions が完了まで接続を維持 | シンプル | 60分超のリスク、UX 劣悪 | 不採用 |

## Design Decisions

### Decision: 討論進捗管理に Firestore を使用する
- **Context**: 討論生成は非同期バックグラウンド処理で、フロントエンドはリアルタイムに進捗を表示する必要がある
- **Alternatives Considered**:
  1. HTTP ポーリング — 定期的に Functions に問い合わせる
  2. Firestore リアルタイムリスナー — 書き込みを即時反映
  3. Server-Sent Events — 一方向のストリーミング（静的ホスティングと非互換）
- **Selected Approach**: Firestore リアルタイムリスナー
- **Rationale**: firebase.json に Firestore が既設定済み。SDK によるリアルタイムリスニングは SvelteKit Store と相性が良い。ポーリングよりもレイテンシが低くサーバー負荷も軽い。
- **Trade-offs**: Firestore の書き込みコストが発生するが、生成処理1回のターン数（数十回）は許容範囲内

### Decision: 討論を「ペルソナ主体の自由会話＋ファシリテーター役割分離」モデルにする
- **Context**: 当初の設計はラウンド制（固定ローテーション）だったが「掛け合いのような自然な会話」というユーザー要件と乖離。ファシリテーター毎回介入案も「毎回間に入る必要はない」として不採用。さらに「指名なし発言に対して言いたいペルソナが応答するパターン」の必要性が指摘された
- **Alternatives Considered**:
  1. ラウンド制 — 機械的で不採用
  2. ファシリテーター毎回介入（全ターン指名） — 司会感が強すぎ不採用
  3. ペルソナ主体＋ファシリテーター役割分離（採用） — 最も自然な掛け合いを実現
- **Selected Approach**:
  - ペルソナは発言に `addressedToPersonaId` を含む（明示的な指名、なければ省略可）
  - 次話者決定の優先順位: ① `addressedToPersonaId` あり → そのペルソナ（LLM不要）② なし → `FA.selectNextSpeaker` で文脈に基づき選択（サイレント、表示されない）
  - `selectNextSpeaker`: 直前の発言内容・各ペルソナの立場・沈黙状況を考慮して「最も応答したそうなペルソナ」を選ぶ LLM 呼び出し
  - `evaluateIntervention`: 一定ターン数ごとの可視介入判断。`topic_shift`・`invite`・`close` の3種
- **Rationale**: 指名あり発言（A→B）と指名なし発言（→言いたい人が応答）の両パターンをカバー。ファシリテーターは「場のコントロール」に集中し、会話の自然な流れを邪魔しない
- **Trade-offs**: `selectNextSpeaker` の追加 LLM 呼び出しがターン数分増える。ただし指名あり発言が多い場合は省略されるため許容範囲内

### Decision: 信念データを PersonaBelief テーブルに一元管理する
- **Context**: 各ペルソナの信念状態（初期・変化後・最終）が複数テーブルに分散していた（`PersonaInterview.initialBelief`・`DebateTurn.updatedBelief`・`PostDebateComment.finalBelief`）
- **Alternatives Considered**:
  1. 複数テーブルに分散して保持 — シンプルだが再構築ロジックが必要
  2. `PersonaBelief` テーブルで version 管理 — 1テーブルに一元化
- **Selected Approach**: `PersonaBelief @table` で version を持つ履歴テーブルとして管理。`version = 0` が取材後の初期値、以降は変化のたびにインクリメント
- **Rationale**: 初期・現在・最終の信念がすべて `ORDER BY version` で取得できる。フロントエンドの再構築ロジックが不要になり、`triggeredByTurnId` でどのターンが変化を引き起こしたかも追跡できる
- **Trade-offs**: テーブルが1つ増えるが、`DebateTurn` から beliefChange 関連フィールドが消え全体のテーブル定義はシンプルになる

### Decision: 信念ドキュメントを Markdown テキストで管理する
- **Context**: 各ペルソナの信念状態を Claude API のシステムプロンプトとして渡す際のフォーマット
- **Alternatives Considered**:
  1. JSON 構造化データ — 型安全だが LLM への受け渡し時に変換が必要
  2. Markdown テキスト — LLM が直接解釈できる自然な形式
- **Selected Approach**: Markdown テキストで保存し、データベース側では `String` 型として格納
- **Rationale**: Claude API はシステムプロンプトを自然言語で解釈するため、Markdown が最も適合する。フロントエンドでの表示もそのままレンダリングできる。
- **Trade-offs**: 構造化クエリ（例：「賛成ペルソナを絞り込む」）が難しいが、現要件では不要

### Decision: 管理者認証をクライアントサイド Firebase Auth で行う
- **Context**: 管理者専用機能へのアクセス制御
- **Selected Approach**: Firebase Auth（メール/パスワード）でクライアントサイドでログインし、APIコール時に ID トークンを Authorization ヘッダーで Functions に渡す。Functions 側で `firebase-admin` を使ってトークンを検証する。
- **Trade-offs**: 静的ビルドのためルートガードはクライアントサイドのみ。セキュリティは Functions のトークン検証が担保する。

## Risks & Mitigations
- **Claude API レート制限**: 大量のペルソナ取材（並行）や討論ターン（逐次）で API 呼び出しが集中する → ペルソナ取材は `Promise.allSettled` で並行実行しつつ、レート制限エラー時はリトライロジックを実装する
- **討論生成のコスト増大**: マルチエージェント構造は通常の単一エージェントより大幅にトークン消費が多い → 会話履歴をトリムするロジックを検討（直近Nターンのみ渡すなど）
- **長時間タイムアウト**: ペルソナ数が多く討論ラウンドが増えると60分を超える可能性 → 最大ペルソナ数（8体）と最大ラウンド数（5）の制限を設ける
- **Data Connect の Markdown 大容量テキスト**: 取材レコードや信念ドキュメントが大きくなる → PostgreSQL の `text` 型（制限なし）で対応済み

## References
- [Anthropic: Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Firebase Functions: Manage functions](https://firebase.google.com/docs/functions/manage-functions)
- [Firebase Data Connect: Schema guide](https://firebase.google.com/docs/data-connect/schemas-guide)
