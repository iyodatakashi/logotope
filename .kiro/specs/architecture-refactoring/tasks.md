# 実装タスク: architecture-refactoring

## Task Format Template

- [x] 1. バックエンド共通基盤の整備
- [x] 1.1 AI設定・共通ユーティリティの新規作成
  - `functions/src/config/ai.ts` を作成し、モデル名（claude-opus-4-8 / claude-sonnet-4-6）とメソッド別 max_tokens 定数をエクスポートする
  - `functions/src/utils/auth.ts` を作成し、`request.auth` が未設定の場合に `HttpsError('unauthenticated')` を throw する `requireAuth` 関数を実装する
  - `functions/src/utils/conversation.ts` を作成し、`ConversationTurn[]` を `[名前(役割)]: 内容` 形式の文字列に変換する `formatHistory` 関数を実装する
  - TypeScript ビルド（`npm --prefix functions run build`）がエラーなしで通ること
  - _Requirements: 6.1, 6.2, 6.5_

- [x] 1.2 ProgressTrackerService の修正
  - `setError` メソッドを完全に削除する
  - `updateStatus` を `set()` の full overwrite（`merge: false`）に変更し、`status`, `currentStep`（引数値 or null）, `completed: 0`, `total: 0`, `updatedAt` の5フィールドのみを書き込む
  - `updateStatus` 呼び出し後に Firestore ドキュメントに `error` フィールドが残らないこと、`completed` と `total` が 0 にリセットされることを確認できる
  - _Requirements: 5.1, 5.2, 5.5_

- [x] 2. バックエンドコード品質の改善
- [x] 2.1 (P) Pipeline Services の DI対応とエラー伝播修正
  - `StakeholderAnalyzerService`、`PersonaGeneratorService`、`InterviewerService` のコンストラクタに `ProgressTrackerService` と `Anthropic` を省略可能引数として追加し、デフォルト値で従来動作を維持する
  - 各 service の catch ブロックから `this.tracker.setError()` 呼び出しを削除し、代わりに `throw err` に変更してエラーを API 層に伝播させる
  - ハードコードされたモデル名と max_tokens を `config/ai.ts` の定数に置き換える
  - `Anthropic` クライアントをコンストラクタ引数で差し替えられるため、ユニットテストでモックを注入できる状態になること
  - _Requirements: 5.3, 6.2, 6.4_
  - _Boundary: pipeline/stakeholder-analyzer, pipeline/persona-generator, pipeline/interviewer_
  - _Depends: 1.1, 1.2_

- [x] 2.2 (P) Agent Services の DI対応と formatHistory の集約
  - `FacilitatorAgentService`、`PersonaAgentService` のコンストラクタに `Anthropic` クライアントを省略可能引数として追加する
  - 各ファイルのローカル `formatHistory` 関数を削除し、`utils/conversation.ts` からインポートする
  - ハードコードされたモデル名と max_tokens を `config/ai.ts` の定数に置き換える
  - `formatHistory` が重複実装なくなり、一か所のみに存在することを確認できる
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: agents/facilitator-agent, agents/persona-agent_
  - _Depends: 1.1_

- [x] 2.3 API ハンドラーへの共通認証適用
  - `api/` 配下の全ハンドラー（stakeholders, personas, interviews, debates, topics）の先頭にある個別認証チェック（`if (!request.auth) throw ...`）を `requireAuth(request)` の一行呼び出しに置き換える
  - 全ハンドラーで認証チェックの実装が統一され、`utils/auth.ts` の `requireAuth` のみが認証ロジックを持つ状態になること
  - _Requirements: 6.5_
  - _Depends: 1.1_

- [x] 3. リセット API の基盤（Data Connect + リポジトリ）
- [x] 3.1 リセット用 GraphQL delete mutation の追加
  - `dataconnect/connector/mutations.gql` に以下の mutation を追加する: `DeletePersonaProfilesByTopicId`（topicId 指定）、`DeletePersonaInterviewsByTopicId`（Persona 経由で topicId 指定）、`DeletePersonaBeliefsByTopicId`（Persona 経由で topicId 指定）、`DeleteDebateSessionByTopicId`（topicId 指定）
  - Data Connect エミュレータ上でそれぞれの mutation が正常実行できることを確認する
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 3.2 リポジトリへの削除関数の追加
  - `functions/src/db/repository.ts` に `deletePersonaProfilesByTopicId`、`deletePersonaInterviewsByTopicId`、`deletePersonaBeliefsByTopicId`、`deleteDebateSessionByTopicId` を追加し、3.1 で追加した mutation を呼び出す実装にする
  - TypeScript ビルドがエラーなしで通ること
  - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - _Depends: 3.1_

- [x] 4. バックエンド承認 API の修正
- [x] 4.1 (P) approveStakeholders の修正
  - `approved=true` パスからペルソナ生成（`PersonaGeneratorService.generate`）の呼び出しを削除する
  - ステークホルダーマップ承認後、`repo.updateTopicStatus(topicId, 'generating_personas')` と `tracker.updateStatus(topicId, 'generating_personas')` を呼び出して即座に `{ status: 'ok' }` を返す
  - `approved=false`（差し戻し）パスは削除する（新 UX では「前のフェーズに戻る」に統一）
  - API が ~1 秒以内に返却され、ペルソナ生成処理を伴わないことを確認できる
  - _Requirements: 2.7, 5.3_
  - _Boundary: api/stakeholders_
  - _Depends: 1.2_

- [x] 4.2 (P) approvePersonas の修正
  - `approved=true` パスから取材実行（`InterviewerService.interviewAll`）の呼び出しを削除する
  - ペルソナ承認後、`repo.updateTopicStatus(topicId, 'interviewing')` と `tracker.updateStatus(topicId, 'interviewing')` を呼び出して即座に `{ status: 'ok' }` を返す
  - `approved=false`（差し戻し）パスは削除する
  - _Requirements: 2.7, 5.3_
  - _Boundary: api/personas_
  - _Depends: 1.2_

- [x] 4.3 (P) approveInterviews の修正
  - `repo.updateTopicStatus(topicId, 'debating')` に加え `tracker.updateStatus(topicId, 'debating')` を呼び出す処理を追加する
  - Firestore ステータスが `debating` に更新されることで、UI が Phase 4 に切り替わるトリガーとなること
  - _Requirements: 2.7_
  - _Boundary: api/interviews_
  - _Depends: 1.2_

- [x] 5. リセット API の実装
- [x] 5.1 resetToPhase1/2/3 エンドポイントの実装と Functions 登録
  - `functions/src/api/resets.ts` を新規作成し、以下の3関数を実装する:
    - `resetToPhase1`: personas/interviews/beliefs/debateSession+turns+comments を削除し、DB と Firestore のステータスを `surveying` に更新
    - `resetToPhase2`: interviews/beliefs/debateSession+turns+comments を削除し、ステータスを `generating_personas` に更新
    - `resetToPhase3`: debateSession/turns/comments を削除し、ステータスを `interviewing` に更新
  - Data Connect 削除処理が完了した後に Firestore ステータスを更新する（削除完了前に UI が切り替わらないよう順序を保証）
  - 削除対象データが存在しなくてもエラーを返さず、ステータス更新のみ実行して `{ status: 'ok' }` を返す
  - `functions/src/index.ts` に `resetToPhase1`、`resetToPhase2`、`resetToPhase3` を追加エクスポートする
  - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - _Depends: 3.2, 1.2_

- [x] 6. フロントエンド基盤の更新
- [x] 6.1 (P) ProgressState 型修正と DebateProgress コンポーネントの更新
  - `src/lib/types/index.ts` の `ProgressState` から `error` フィールドを削除し、`currentStep` の型を `string | null` に変更する
  - 型変更によってビルドエラーが発生する箇所（`DebateProgress.svelte` などで `progress.error` を参照している箇所）を特定して修正する
  - `ProgressState.error` への参照がコードベース全体から消えており、ビルドがエラーなしで通ること
  - _Requirements: 5.1, 5.4_
  - _Boundary: src/lib/types/index.ts, src/lib/components/admin/DebateProgress.svelte_

- [x] 6.2 (P) API クライアントへのリセット関数追加
  - `src/lib/api/topics.ts` に `resetToPhase1`、`resetToPhase2`、`resetToPhase3` の API 呼び出し関数を追加する
  - `approveStakeholders`、`approvePersonas` から `approved: boolean` 引数を削除する（承認のみの呼び出しに変更）
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: src/lib/api/topics.ts_

- [x] 7. フェーズ別コンポーネントの実装
- [x] 7.1 (P) Phase1Stakeholders.svelte の実装
  - Props: `topicId: string`、`topicTitle: string`
  - `onMount` でステークホルダーデータを `getStakeholders` で取得し、データが存在しない場合のみ `generateStakeholders` を自動呼び出しする（処理中状態 `loading = true`）
  - 処理中状態ではスピナーと `progressStore.progress.currentStep` を表示し、「次のフェーズへ進む」ボタンは表示しない
  - 結果状態では立場・スタンス・マイノリティ度・理由のステークホルダー一覧と「次のフェーズへ進む」ボタンを表示する
  - エラー状態では `catch` ブロックで受け取ったエラーメッセージを表示する（Firestore の error フィールドは使用しない）
  - 「次のフェーズへ進む」クリックで `approveStakeholders` を呼び出す
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1_
  - _Boundary: Phase1Stakeholders_
  - _Depends: 6.1, 6.2_

- [x] 7.2 (P) Phase2Personas.svelte の実装
  - Props: `topicId: string`、`topicTitle: string`
  - `onMount` でペルソナデータを `getPersonas` で取得し、データが存在しない場合のみ `generatePersonas` を自動呼び出しする
  - 処理中・結果・エラーの3状態を実装し、全状態で「前のフェーズに戻る」ボタンを常時表示する
  - 結果状態で名前・年齢・職業・立場・スタンス・背景のペルソナ一覧と「次のフェーズへ進む」ボタンを表示する
  - 「前のフェーズに戻る」クリックで `resetToPhase1` を呼び出し、「次のフェーズへ進む」クリックで `approvePersonas` を呼び出す
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 4.1, 4.4_
  - _Boundary: Phase2Personas_
  - _Depends: 6.1, 6.2_

- [x] 7.3 (P) Phase3Interviews.svelte の実装
  - Props: `topicId: string`、`topicTitle: string`
  - `onMount` で取材データを `getInterviews` で取得し、取材レコードが存在しない場合のみ `startInterviews` を自動呼び出しする
  - 処理中状態では `progressStore.progress.currentStep` と `completed`/`total` を使い「N人中M人完了」形式で進捗を表示する
  - 結果状態でペルソナ別取材レコードと初期信念ドキュメントを折りたたみ展開で表示する
  - 全状態で「前のフェーズに戻る」ボタンを常時表示し、クリックで `resetToPhase2` を呼び出す
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 4.2, 4.4_
  - _Boundary: Phase3Interviews_
  - _Depends: 6.1, 6.2_

- [x] 7.4 (P) Phase4Debate.svelte の実装
  - Props: `topicId: string`、`topicTitle: string`
  - `onMount` で討論セッションを `getAdminDebate` で取得し、セッションが存在しない場合のみ `startDebate` を自動呼び出しする
  - 処理中状態では `progressStore.progress.currentStep`（現在発言中のエージェント名）とターン数進捗を表示する
  - 結果状態で討論全文（発言者・立場・本文・信念変化マーカー）と討論後コメントを表示し、「次のフェーズへ進む」の代わりに「公開する」ボタンを表示する
  - 全状態で「前のフェーズに戻る」ボタンを常時表示し、クリックで `resetToPhase3` を呼び出す
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 3.4, 3.5, 4.3, 4.4_
  - _Boundary: Phase4Debate_
  - _Depends: 6.1, 6.2_

- [x] 8. ページオーケストレーターの刷新と統合
- [x] 8.1 debate/[id]/+page.svelte の刷新
  - `progressStore.progress?.status`（Firestore リアルタイム購読値）のみを用いて表示するフェーズコンポーネントを切り替える: `null|pending|surveying` → Phase1Stakeholders、`generating_personas` → Phase2Personas、`interviewing` → Phase3Interviews、`debating|completed` → Phase4Debate
  - `actionLoading` フラグと `topic.status`（API 取得値）を状態管理から完全に除去する
  - `getTopic` でトピックタイトルを取得し、各フェーズコンポーネントに `topicId`・`topicTitle` を props として渡す
  - トピック作成後に `/admin/debate/[id]` へ遷移する動作を確認し、Req 1.3 の遷移要件を満たしていない場合は `/admin/topics/new/+page.svelte` の遷移先 URL を修正する
  - Firestore ステータスが変化した際に API レスポンス完了を待たず即座にフェーズ画面が切り替わることを手動で確認できる
  - _Requirements: 1.3, 2.1, 2.7, 2.8_
  - _Depends: 7.1, 7.2, 7.3, 7.4_

- [x] 9. バックエンドユニットテスト
- [x] 9.1 ProgressTrackerService のユニットテスト追加
  - `updateStatus` が full overwrite で動作し、既存の `error`・`currentStep`・`completed` フィールドをクリアすることを Firestore モックで検証する
  - `setError` メソッドが存在しないことをテストで確認する（呼び出し試みが型エラーになること）
  - `pnpm test:unit` が追加したテストを含めて全パスすること
  - _Requirements: 5.1, 5.2, 5.5_

- [x] 9.2 リセット API のユニットテスト追加
  - `resetToPhase1`/`2`/`3` が正しい削除関数を正しい順序で呼び出し、Firestore 更新が最後に行われることをモックで検証する
  - 削除対象データが存在しない場合（モックが空を返す）でもエラーを throw せず成功を返すことを検証する
  - _Requirements: 4.1, 4.2, 4.3, 4.5_

- [x] 9.3 DI対応に伴う既存テストの修正確認
  - コンストラクタ変更（DI引数追加）によって既存のユニットテストが壊れている場合、モック注入方法を新しいコンストラクタシグネチャに合わせて修正する
  - `pnpm test:unit` が全テストパスすること（Req 6.6 の検証）
  - _Requirements: 6.6_
  - _Depends: 9.1, 9.2_

- [ ] 10.* E2Eテスト
- [ ] 10.1* フェーズ遷移の E2E テスト
  - Phase 1 マウント時に auto-start が実行され、処理完了後に結果表示になることを検証する
  - Phase 1 で「次のフェーズへ進む」クリック後、API レスポンス完了前に Phase 2 の処理中画面に切り替わることを検証する
  - API 失敗シナリオでエラーメッセージが表示され、「前のフェーズに戻る」ボタンが有効であることを検証する
  - _Requirements: 2.1, 2.2, 2.5, 2.6_

- [ ] 10.2* リセットフローの E2E テスト
  - Phase 3 で「前のフェーズに戻る」クリック後、Phase 2 の result 表示（ペルソナ一覧あり）に切り替わることを検証する
  - リセット後に Phase 2 が auto-start を実行しない（既存データ検出で result 状態に入る）ことを検証する
  - _Requirements: 4.2, 4.4_
  - _Depends: 10.1_
