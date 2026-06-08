# Research Log: architecture-refactoring

## Summary

既存コードベースの拡張（Extension）として分類。現行の問題点を分析し、Firestore駆動UIへの移行設計を検討した。

---

## Research Log

### Topic 1: 現行アーキテクチャの問題点

**Source**: `src/routes/admin/debate/[id]/+page.svelte`, `functions/src/api/stakeholders.ts`, `functions/src/api/personas.ts`

**Findings**:
- 現行UIは `topic.status`（API取得、Data Connect由来）でフェーズを判定
- `actionLoading = true` を長時間保ちながら次フェーズ処理を待つ設計
- `approveStakeholders(approved=true)` は承認 + ペルソナ生成（最大540秒）を同期的に実行。完了するまでステークホルダー画面でスピナーが回り続ける
- `approvePersonas(approved=true)` も同様に承認 + 全取材を同期実行
- 原因：Firestoreの `status` が次フェーズに更新されるのはAPIが返却した後

**Implications**:
- 承認操作後に即座に次フェーズ画面へ切り替えるには、APIが返却する前にFirestoreを更新する必要がある
- 解決策：承認APIはステータス更新のみ行い、次フェーズ処理は次フェーズ画面のauto-startに委ねる

---

### Topic 2: ProgressTrackerService の error フィールド持続問題

**Source**: `functions/src/pipeline/progress-tracker.ts`

**Findings**:
- `setError()` は `merge: true` で `error` フィールドを書き込む
- `updateStatus()` も `merge: true` のため、statusを更新しても `error` フィールドが残る
- 結果：エラー後に新しい処理を開始しても、前回のエラーメッセージが残り続ける
- フロントエンドの `DebateProgress.svelte` は `progress.error` を表示するため、消えない

**Implications**:
- `setError()` を完全削除し、`updateStatus()` をfull overwrite（merge: falseに相当）に変更
- エラーはAPIレスポンスのみで返す設計に統一

---

### Topic 3: formatHistory の重複実装

**Source**: `functions/src/agents/facilitator-agent.ts:77-80`, `functions/src/agents/persona-agent.ts`（推定）

**Findings**:
- `facilitator-agent.ts` に `formatHistory(history: ConversationTurn[]): string` が実装されている
- `persona-agent.ts` にも同一または類似の実装が存在する（Req 6.1の記述より）
- `ConversationTurn` 型は `functions/src/types/index.ts` に定義済み

**Implications**:
- `functions/src/utils/conversation.ts` に集約
- エクスポートは `export function formatHistory(history: ConversationTurn[]): string`

---

### Topic 4: AI設定の散在

**Source**: `functions/src/agents/facilitator-agent.ts`, `functions/src/pipeline/stakeholder-analyzer.ts`, `functions/src/pipeline/persona-generator.ts`

**Findings**:
- `facilitator-agent.ts`: `model: 'claude-sonnet-4-6'`, `max_tokens: 1024/256/512/1024`（メソッドごとに異なる）
- `stakeholder-analyzer.ts`: `model: 'claude-opus-4-8'`, `max_tokens: 4096`
- `persona-generator.ts`: `model: 'claude-opus-4-8'`, `max_tokens: 8192`
- Anthropicクライアントは各サービスで `private client = new Anthropic()` として直接インスタンス化

**Implications**:
- `functions/src/config/ai.ts` に `AI_MODELS` と `MAX_TOKENS` の定数を集約
- コンストラクタDIでテスト可能性を向上

---

### Topic 5: リセット処理に必要なデータ削除の範囲

**Source**: `functions/src/db/repository.ts`

**Findings**:
- 既存の削除関数: `deleteDebateTurnsBySession(sessionId)`, `deletePostDebateCommentsBySession(sessionId)`, `deleteDebateSession(id)` — これらは存在する
- 不足している削除関数: `deletePersonaProfilesByTopicId`, `deletePersonaInterviewsByTopicId`, `deletePersonaBeliefsByTopicId`
- Data Connect経由でGraphQL mutationとして実装が必要

**Implications**:
- 新たに3つのリポジトリ関数と対応するGraphQL mutationを追加
- 実装は `functions/src/db/repository.ts` と `dataconnect/connector/mutations.gql` の両方に必要

---

### Topic 6: フェーズ別のデータ存在チェックとauto-startロジック

**Source**: 設計検討

**Findings**:
- Phase 1 (surveying): `stakeholderMap` が存在するか → 存在すればresult表示
- Phase 2 (generating_personas): `personas.length > 0` → 存在すればresult表示
- Phase 3 (interviewing): interview recordが存在するか → 存在すればresult表示
- Phase 4 (debating/completed): debateSessionが存在するか → 存在すればresult表示
- ページリロード・リセット後の再マウント両方でこのロジックが機能する

**Implications**:
- 各フェーズコンポーネントの `onMount` でデータ存在確認 → なければauto-start
- リセット後は前フェーズデータが残存するため、正しくresult表示に入る（Req 4.4を満たす）

---

### Topic 7: Firestore status のフェーズマッピング

**Source**: `src/lib/types/index.ts`, `functions/src/types/index.ts`

**Findings**:
- `DebateStatus` 型は両ファイルで同一定義: `pending | surveying | generating_personas | interviewing | debating | completed | published`
- `pending` はDB上のトピックの初期状態。`debate_progress` ドキュメントは存在しない可能性がある

**Decisions**:
```
null/undefined/pending/surveying → Phase 1 (ステークホルダー調査)
generating_personas              → Phase 2 (ペルソナ生成)
interviewing                     → Phase 3 (取材)
debating/completed               → Phase 4 (討論生成・結果)
```

---

## Architecture Decisions

### Decision 1: 承認APIと処理APIの分離

**選択**: 承認APIは「承認 + Firestoreステータス更新」のみ実行。次フェーズの処理は次フェーズ画面のauto-startが担う。

**根拠**: 
- 承認後即座に次フェーズ画面に切り替えられる（Req 2.7）
- 各フェーズ画面が自身の処理を制御することで責務が明確化
- APIのタイムアウト問題を分離（承認は即座、処理は次フェーズのコールとして独立）

**トレードオフ**:
- 承認後のFirestoreステータス更新 → UI切り替え → auto-start呼び出しという連鎖が発生するが、これはFirestoreのリアルタイム性により100ms以内に完了する

### Decision 2: ProgressTrackerService のfull overwrite

**選択**: `updateStatus()` で `set()` をmergeなしで実行し、documentをフル上書きする。

**根拠**: legacyな `error` フィールドを含む古い値をすべてクリアできる。`updateProgress()` は `merge: true` を維持して良い（statusを変えずに進捗のみ更新するため）。

### Decision 3: フロントエンド型定義の `error` フィールド削除

**選択**: `src/lib/types/index.ts` の `ProgressState` から `error` フィールドを削除する。

**根拠**: フロントエンドからerrorの読み取りロジックを完全に排除することで、コンパイラレベルで誤用を防ぐ。

---

## Risks

| リスク | 深刻度 | 対策 |
|--------|--------|------|
| Phase 2 auto-startが重複実行される | 中 | onMount一度のみ実行、データ存在チェックで呼び出し抑制 |
| リセット中にFirestoreが更新されてUI切り替えが先行する | 低 | リセットAPIはData Connect削除完了後にFirestore更新 |
| GraphQL mutation (deletePersonaProfilesByTopicId等) の追加が必要 | 高 | タスク化して実装フェーズで対応 |
| `updateStatus` のfull overwrite で `updateProgress` との競合 | 低 | 呼び出し順序が保証されている（updateStatusが先、updateProgressが後） |
