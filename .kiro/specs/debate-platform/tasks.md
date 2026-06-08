# Implementation Plan

## debate-platform

---

- [x] 1. Foundation: プロジェクト基盤・スキーマ・共通型のセットアップ

- [x] 1.1 Firebase Data Connect スキーマと TopicRepository の実装
  - DebateTopic・StakeholderMap・PersonaProfile・PersonaInterview・PersonaBelief・DebateSession・DebateTurn・PostDebateComment の8テーブルを GraphQL スキーマとして定義し `dataconnect/schema/schema.gql` に書く（サンプルスキーマは完全削除）
  - 討論詳細取得（ペルソナ + ターン + 信念履歴 + コメント）・公開一覧取得・ペルソナ別信念履歴取得などの頻出パターンを `connector/queries.gql` と `connector/mutations.gql` に定義する
  - Data Connect の型付き操作をラップする TopicRepository を実装し、全パイプラインサービスが使う DB アクセスを一箇所に集約する
  - Firebase Emulators でスキーマのマイグレーションが通り、TopicRepository の基本 CRUD が動作することを確認する
  - _Requirements: 1.1, 2.1, 3.1, 4.4, 6.1, 7.1_

- [x] 1.2 SvelteKit と Firebase App Hosting の設定
  - `@sveltejs/adapter-static` を `@sveltejs/adapter-auto` に差し替えて `svelte.config.js` と `package.json` を更新する
  - `apphosting.yaml` を新規作成し Cloud Run の CPU・メモリ・並行数を最小設定で記述する
  - `firebase.json` の `hosting` セクションを削除する
  - `src/routes/admin/+layout.ts` に `export const ssr = false` を設定して管理画面を SPA モードにする
  - Firebase Emulators（Functions・Firestore・Data Connect）の起動設定を整備し `firebase emulators:start` で全サービスが起動することを確認する
  - _Requirements: 1.1, 7.1_

- [x] 1.3 Functions プロジェクトと共通型定義のセットアップ
  - Functions の TypeScript strict mode 設定と依存パッケージ（firebase-admin・firebase-functions v2・Anthropic SDK）を整備する
  - フロントエンド共通型（DebateStatus・SpeakerType・BeliefChangeType・PublishedDebateDetail・PersonaSummaryForViewer・PublishedTurn など）を `src/lib/types/index.ts` に定義する
  - Functions 共通型（Stakeholder・PersonaAttributes・ConversationTurn・AgentTurnResult・FacilitatorOpeningResult・FacilitatorIntervention・BeliefChangeEvent など）を `functions/src/types/index.ts` に定義する
  - 両プロジェクトで型コンパイルが通ることを確認する
  - _Requirements: 6.1, 6.2_

- [x] 1.4 テスト基盤のセットアップ
  - Vitest（ユニット・インテグレーション）と Playwright（E2E）の設定ファイルを作成する
  - Firebase Emulators に接続するインテグレーションテスト用のセットアップファイルを追加する
  - `pnpm test:unit` と `pnpm test:e2e` が空のテストスイートで正常実行されることを確認する
  - _Requirements: 6.10_

---

- [x] 2. ステークホルダー調査パイプラインと API

- [x] 2.1 テーマ管理 API と Auth ミドルウェア
  - Firebase Auth ID トークンを検証する `middleware.ts` を実装し、全管理者エンドポイントに適用する
  - POST /api/topics（テーマ作成・500文字バリデーション）・GET /api/topics（一覧）・GET /api/topics/:id（詳細）を実装する
  - テーマが空欄または500文字超の場合は 400 を返し、未認証リクエストには 401 を返す
  - テーマ作成リクエストが Data Connect に `status: "pending"` で保存され topicId が返ることを確認する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2.2 StakeholderAnalyzerService（ステークホルダー分析サービス）
  - Anthropic SDK の structured output を使ってテーマから StakeholderMap を生成する StakeholderAnalyzerService を実装する
  - 各立場に role・reason・mainInterests・stanceDirection・minorityLevel を付与し、直接・間接の当事者を含めて5件以上を出力する
  - 生成結果を TopicRepository 経由で StakeholderMap テーブルに保存し、Firestore のステータスを更新する
  - Vitest で Claude API をモックし、返却件数（5件以上）と全必須フィールドの存在を検証する
  - _Requirements: 2.1, 2.2, 2.3, 2.7_
  - _Boundary: StakeholderAnalyzerService_

- [x] 2.3 ステークホルダー調査 API と承認フロー
  - POST /api/topics/:id/stakeholders/generate（非同期・即時 jobId 返却）を実装し、バックグラウンドで StakeholderAnalyzerService を起動する
  - POST /api/topics/:id/stakeholders/approve を実装し、承認時は `status: "generating_personas"` に遷移させ差し戻し時は再生成を起動する
  - API エラー時は Firestore にエラー状態を書き込み管理者がリトライできる形でレスポンスを返す
  - _Requirements: 2.4, 2.5, 2.6, 2.7_

---

- [x] 3. ペルソナ生成パイプラインと API

- [x] 3.1 PersonaGeneratorService（ペルソナ生成サービス）
  - 承認済み StakeholderMap の各立場から PersonaAttributes（名前・年齢・職業・背景・利害関心・主張方向）を1体ずつ生成する PersonaGeneratorService を実装する
  - 年齢層・社会的立場・職業の多様性を確保するようプロンプトを設計する
  - 生成結果を TopicRepository 経由で PersonaProfile テーブルに保存する
  - Vitest でペルソナ属性の必須フィールドが全て揃っていることを検証する
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3.2 ペルソナ生成 API と承認フロー
  - POST /api/topics/:id/personas/generate（非同期）・POST /api/topics/:id/personas/approve を実装する
  - 承認時はステークホルダーマップとの対応関係を保持したまま `status: "interviewing"` へ遷移させ、差し戻し時は再生成を起動する
  - API エラー時は Firestore にエラー状態を書き込む
  - _Requirements: 3.4, 3.5, 3.6, 3.7_

---

- [x] 4. 事前取材パイプラインと API

- [x] 4.1 ProgressTrackerService（Firestore リアルタイム進捗管理）
  - Firestore の `/debate_progress/{topicId}` に status・currentStep・completed・total・error を書き込む ProgressTrackerService を実装する
  - updateStatus・updateProgress・setError が Firestore に即時反映されることをエミュレーターで確認する
  - _Requirements: 4.7, 6.9_

- [x] 4.2 InterviewerService（並行取材と初期信念ドキュメント生成）
  - 全ペルソナに対して `Promise.allSettled` で並行して Claude API 取材を実行する InterviewerService を実装する
  - 各取材でペルソナの生活・業務への具体的な影響・不安・期待・価値観を深掘りし interviewRecord を生成する
  - 取材結果から初期信念ドキュメント（Markdown: 立場と根拠・核心的主張・懸念事項・価値観・妥協点の6項目）を生成し PersonaInterview テーブルと PersonaBelief(version=0) テーブルに保存する
  - Vitest で一部ペルソナのエラーが他ペルソナの取材結果に影響しないことを検証する
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.9_

- [x] 4.3 取材 API・リトライ・承認フロー
  - POST /api/topics/:id/interviews/start（非同期）を実装し、ProgressTrackerService を起動してペルソナ取材完了ごとに Firestore を更新する
  - POST /api/topics/:id/interviews/:personaId/retry（特定ペルソナのリトライ）を実装する
  - POST /api/topics/:id/interviews/approve を実装し、承認時は `status: "debating"` へ遷移させる
  - _Requirements: 4.6, 4.7, 4.8, 4.9_

---

- [ ] 5. 討論エージェント

- [x] 5.1 (P) FacilitatorAgentService（ファシリテーターエージェント）
  - generateOpening（冒頭発言 + firstPersonaId 返却）・selectNextSpeaker（サイレントルーティング）・evaluateIntervention（可視介入判断）・generateClosing（クロージング発言）を実装する
  - システムプロンプトに中立性制約（特定立場・結論への誘導禁止）を必ず含める
  - selectNextSpeaker は会話履歴・各ペルソナの立場・silenceMap を考慮して「最も応答したそうなペルソナ」を1名選び personaId を返す（発言ターンは生成しない）
  - evaluateIntervention は shouldIntervene が false の場合は content を返さず、true の場合のみ topic_shift・invite・close いずれかの type と content を返す
  - Vitest で Claude API をモックし、各メソッドが正しい型・制約のレスポンスを返すことを検証する
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: FacilitatorAgentService_

- [x] 5.2 (P) PersonaAgentService（ペルソナエージェント）
  - generateTurn（発言生成・信念変化判定・addressedToPersonaId 出力）・generatePostDebateComment（討論後コメント）を実装する
  - システムコンテキストにペルソナ属性・取材レコード・現在の信念ドキュメントを含め、他ペルソナの内部コンテキストは含めない
  - 発言テキスト本文に加え JSON ブロックとして beliefChange（opinion_change・partial_acceptance・null）と addressedToPersonaId を出力するようプロンプトを設計する
  - 討論後コメントは「他の参加者の意見を聞いてどう感じたか・印象に残った意見・自分の考えの変化」を2〜4文で生成する
  - Vitest で信念変化の3ケース（意見変化・部分承認・変化なし）と addressedToPersonaId の有無をテストする
  - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.7, 6.12, 6.13_
  - _Boundary: PersonaAgentService_

---

- [ ] 6. 討論オーケストレーションと API

- [x] 6.1 DebateOrchestratorService（討論ループ管理）
  - ConversationTurn 履歴・currentBelief マップ・silenceMap（ペルソナごとの沈黙ターン数）をオーケストレーター内で管理し討論ループを実装する
  - 次話者決定: addressedToPersonaId あり → 直接指名（LLM 呼び出しなし）、なし → selectNextSpeaker でサイレントルーティング
  - 5ターンごとまたは沈黙閾値超過時に evaluateIntervention を呼び出す。close シグナルまたはターン上限（最大40ターン）で討論を終了する
  - 全ペルソナが最低3回ずつ発言するまでは close シグナルを受け付けない制約を実装する
  - DebateTurn 保存後に beliefChange があれば PersonaBelief(version+1, triggeredByTurnId) を保存し、各ターン完了後に ProgressTrackerService を更新する
  - クロージング後に全ペルソナの PostDebateComment を順次生成して保存する
  - resume(sessionId, fromTurnIndex) で指定ターンから再開できることを Vitest で検証する
  - _Requirements: 6.1, 6.3, 6.4, 6.8, 6.9, 6.10, 6.11, 6.14_
  - _Depends: 5.1, 5.2_

- [x] 6.2 討論・公開 API
  - POST /api/topics/:id/debate/start（非同期・即時 debateSessionId 返却）を実装し、バックグラウンドで DebateOrchestratorService を起動する
  - POST /api/debates/:id/publish（公開操作・publishedAt 設定）を実装する
  - GET /api/debates（公開一覧）と GET /api/debates/:id（PublishedDebateDetail 型: personas + turns + postDebateComments）を実装する
  - 討論生成中のエラーは Firestore にエラー状態を書き込み、フロントエンドにリトライ可能であることを示す
  - _Requirements: 6.1, 6.9, 6.10, 6.15, 7.1, 7.9_

---

- [x] 7. 管理画面フロントエンド

- [x] 7.1 Firebase Auth ストアと管理者レイアウト
  - Firebase Auth（メール/パスワード）のログイン・ログアウトと auth ストア（Svelte 5 runes の `$state`）を実装する
  - `/admin/+layout.svelte` でクライアントサイドの認証ガードを実装し、未認証時はログインページへリダイレクトする
  - API 呼び出しクライアント（`src/lib/api/client.ts`）で Auth ID トークンを `Authorization: Bearer` ヘッダーに自動付与する
  - ログイン済みユーザーが `/admin` にアクセスするとダッシュボードが表示され、未認証時はリダイレクトされることを確認する
  - _Requirements: 1.4_

- [x] 7.2 テーマ作成・一覧・詳細ページ
  - @14ch/svelte-ui を活用してテーマ作成フォーム（500文字バリデーション・空欄エラー表示付き）を実装する
  - テーマ一覧ページで各テーマのステータス（未着手〜完了）をバッジで表示する
  - テーマ詳細ページで現在のフェーズ・進捗状態の概要を確認できるレイアウトを実装する
  - テーマ作成後にデータベースへ保存されて一覧に反映されることを確認する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 7.3 ステークホルダー・ペルソナレビューフロー
  - StakeholderReview コンポーネントを @14ch/svelte-ui のカード形式で実装し、各立場の role・stanceDirection・minorityLevel を表示して承認・差し戻しボタンを提供する
  - PersonaReview コンポーネントでペルソナ一覧をステークホルダーとの対応関係付きで表示し、承認・差し戻しボタンを提供する
  - 承認操作後に次フェーズへ遷移し、差し戻し操作後に再生成が起動されることを確認する
  - _Requirements: 2.4, 2.5, 2.6, 3.4, 3.5, 3.6_

- [x] 7.4 取材・討論進捗モニタリング
  - `onMount` で Firestore `onSnapshot` を開始し `onDestroy` でサブスクリプションを解除する DebateProgress コンポーネント（Svelte 5 `$state`）を実装する
  - 取材フェーズ: 各ペルソナの取材ステータス（completed・error・pending）をリアルタイム表示し、エラーペルソナにリトライボタンを表示する
  - 討論フェーズ: 現在発言中のエージェント名とターン進捗をリアルタイム表示する
  - InterviewReview コンポーネントで取材レコードと初期信念ドキュメントの一覧確認UIと討論開始承認ボタンを実装する
  - Firestore の進捗更新がUIに1秒以内に反映されることを確認する
  - _Requirements: 4.6, 4.7, 4.8, 6.9_

- [x] 7.5 討論レビューと公開操作
  - DebatePreview コンポーネントで討論生成完了後の全発言ターン・信念変化ログ・討論後コメントを管理者が確認できる画面を実装する
  - 公開ボタン押下で POST /api/debates/:id/publish を呼び出し、成功後に公開 URL を管理者に表示する
  - _Requirements: 6.15, 7.1_

---

- [x] 8. 公開討論閲覧フロントエンド（SSR）

- [x] 8.1 (P) 公開討論一覧ページ（SSR）
  - `+page.server.ts` でサーバーサイドから GET /api/debates を呼び出し、公開済み討論一覧を SSR で配信する
  - @14ch/svelte-ui のカードコンポーネントでテーマ名・生成日・ペルソナ数を表示する
  - `<head>` に OGP メタタグ（og:title・og:description）を動的生成する
  - クローラーが HTML にコンテンツが含まれた状態でページを受け取れることを確認する
  - _Requirements: 7.9_
  - _Boundary: Public pages SSR_

- [x] 8.2 (P) 討論詳細ページと DebateViewer（SSR）
  - `/debate/[id]/+page.server.ts` で GET /api/debates/:id を呼び出し PublishedDebateDetail を取得して SSR で配信する
  - DebateViewer コンポーネントで参加ペルソナ一覧と全発言ターンを turnIndex 順に表示する
  - TurnDisplay コンポーネントで各発言にペルソナ名・立場ラベルを表示し、beliefChangesTriggered がある発言ターンに @14ch/svelte-ui の Badge 等を使った BeliefChangeMarker を付与する
  - OGP メタタグ（テーマ名・参加ペルソナ情報）を `+page.server.ts` 内で動的生成する
  - _Requirements: 7.2, 7.3, 7.4, 7.5_
  - _Boundary: Public pages SSR_

- [x] 8.3 (P) BeliefEvolution パネルとペルソナフィルター
  - BeliefEvolution コンポーネントで特定ペルソナの beliefHistory（version 昇順）から初期・最終信念を Markdown レンダリングし、変化ポイント一覧と該当ターンへのアンカーリンクを表示する
  - PersonaFilter コンポーネントでペルソナを選択すると filteredTurns として選択ペルソナの発言のみを表示する
  - _Requirements: 7.6, 7.8_
  - _Depends: 8.2_
  - _Boundary: Public components_

- [x] 8.4 討論後コメントセクション
  - PostDebateComments コンポーネントで討論本文と区別された「討論を終えて」セクションに各ペルソナのショートコメントをペルソナ名・立場ラベル付きで表示する
  - _Requirements: 7.7_
  - _Depends: 8.2_

---

- [x] 9. テストと品質検証

- [x] 9.1 パイプラインサービスのユニットテスト
  - StakeholderAnalyzerService: 返却件数（5件以上）・全立場への minorityLevel 付与・structured output フォーマットを検証する
  - PersonaAgentService: 信念変化の3ケース（opinion_change・partial_acceptance・変化なし）と addressedToPersonaId の出力形式を検証する
  - DebateOrchestratorService: ターンシーケンスの正しい実行順序・信念変化時の PersonaBelief 保存・resume 動作を検証する
  - _Requirements: 2.1, 6.6, 6.7, 6.10_

- [x] 9.2 API インテグレーションテスト
  - Firebase Emulators を使って不正な状態遷移（ステークホルダー未承認でのペルソナ生成要求など）が 409 を返すことを検証する
  - 未認証リクエストが 401 を返すことを検証する
  - Firestore への進捗書き込みと管理画面での読み取りの整合性を検証する
  - InterviewerService の部分失敗シナリオ（1体エラー時に他ペルソナが完了すること）を検証する
  - _Requirements: 1.3, 2.7, 3.7, 4.9, 6.10_

- [x] 9.3 E2E: 管理者ゴールデンパス
  - Playwright で「ログイン → テーマ作成 → ステークホルダー承認 → ペルソナ承認 → 取材完了・承認 → 討論生成完了 → 公開」の一連フローを E2E テストする
  - 公開後に `/debate/[id]` で討論コンテンツが SSR で表示されることを確認する
  - _Requirements: 1.1, 2.5, 3.5, 4.8, 6.15, 7.1_

- [ ] 9.4* 公開ページの E2E テスト（任意）
  - Playwright で討論詳細ページのペルソナフィルター・信念変化マーカー・BeliefEvolution パネルの動作を検証する
  - _Requirements: 7.5, 7.6, 7.8_
