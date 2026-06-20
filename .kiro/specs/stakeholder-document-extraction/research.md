# Research & Design Decisions

---
**Purpose**: 発見事項・設計判断の根拠を記録する。

---

## Summary

- **Feature**: `stakeholder-document-extraction`
- **Discovery Scope**: Extension（既存 CF・ストア・モデルの拡張）
- **Key Findings**:
  - `generateStakeholders` CF は現在 LLM 結果をそのままフロントエンドに返し、フロントエンドが `topic.stakeholders[]` に書き込む。CF 側で直接 Firestore に書けば往復が不要になる
  - `generatePersonas` CF は `stakeholders: Stakeholder[]` をリクエストから受け取るが、`stakeholders/0` から読めば引数が不要になりフロントエンド側のデータ保持が不要になる
  - `chapterAnalysis/0`・`postDebateComments/0` の `createXxxStore` パターンがそのまま適用できる

## Research Log

### 既存の固定 ID ドキュメントパターン

- **Context**: `stakeholders/0` に同じパターンを適用できるか確認
- **Findings**:
  - `createChapterAnalysisStore` は `doc(db, 'topics', topicId, 'chapterAnalysis', '0')` を `onSnapshot` で購読し、`data` と `isLoaded` を公開する（約30行）
  - `createPostDebateCommentsStore` は同パターン。`comments: PostDebateCommentDoc[]` を展開して公開する
  - どちらも `currentTopicStore.start()` 内で `create → start → stop` のライフサイクルを管理している
- **Implications**: `createStakeholdersStore` も同パターンで実装できる。展開フィールドは `stakeholders: StakeholderDoc[]`

### `generateStakeholders` CF の書き込み先変更

- **Context**: 現状は CF がレスポンスを返し、フロントが `updateDoc(topic, { stakeholders: data.stakeholders })` を呼ぶ
- **Findings**:
  - CF 内に Admin SDK での `setDoc(stakeholdersRef, { stakeholders })` を追加するだけで良い
  - レスポンスとして `stakeholders` を返す必要はなくなる（`{}` または void 相当を返す）
  - `functions/src/pipeline/stakeholders/` ディレクトリは存在しないため、Firestore 書き込みは `functions/src/api/stakeholders.ts` 内に直接追記するか `pipeline/stakeholders/` を新設する
- **Implications**: `generateStakeholders` の戻り値スキーマが変わるため、フロントの `httpsCallable` 型定義も変更が必要

### `generatePersonas` CF の引数除去

- **Context**: 現状は `request.data.stakeholders` を受け取り、直接 `generatePersonas(title, stakeholders, topicId)` に渡す
- **Findings**:
  - Admin SDK で `getDoc(doc(db, 'topics', topicId, 'stakeholders', '0'))` を読めばステークホルダーを取得できる
  - `stakeholders/0` が存在しない場合は `invalid-argument` エラーを返す
  - `persona-generator-agent.ts` のシグネチャ（`generatePersonas(title, stakeholders, topicId)`）は変わらない。CF 側で読んで渡すだけ
- **Implications**: フロント側 `createTopic.svelte.ts` の `generatePersonas` から `stakeholders: stakeholderItems` の引数が消える

### `resetStakeholders` の変更

- **Context**: 現状は `updateDoc(topic, { stakeholders: [] })` でクリア
- **Findings**:
  - `postDebateComments` リセットは `deleteDoc(doc(db, 'topics', id, 'postDebateComments', '0'))` を使用している
  - `chapterAnalysis` リセットも同様に `deleteDoc`
  - `stakeholders/0` も同じく `deleteDoc` でリセットするのが一貫性のある実装
- **Implications**: `resetStakeholders` の実装が `updateDoc` から `deleteDoc` に変わる

### フロントエンドの `stakeholders` $state 除去

- **Context**: `createTopicStates` の `let stakeholders = $state(topicDoc.stakeholders ?? [])` と `get stakeholders()` を除去する必要がある
- **Findings**:
  - `Phase1Stakeholders.svelte` は `currentTopicStore.topic?.stakeholders` を参照している（line 15）
  - `generatePersonas` では `stakeholders` ローカル変数を使用している（line 157）
  - `topic.types.ts` の `TopicDoc.stakeholders?: StakeholderDoc[]` フィールドを除去する
  - `StakeholderDoc` 型は `topic.types.ts` で定義されているが、除去後は専用ファイルまたは維持場所を決める必要がある

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| A: CF → Frontend 経由 Firestore（現状） | CF が返却 → Frontend が書き込む | 既存パターン変更なし | フロント側に不要なデータ保持・転送が残る |
| B: CF → Firestore 直接書き込み（採用） | CF が `stakeholders/0` に直接書く | データ転送不要。パターンが他 CF（chapters 等）と統一される | CF の責務が増えるが軽微 |

## Design Decisions

### Decision: `generateStakeholders` CF の書き込み責務

- **Context**: ステークホルダーを誰が Firestore に書くか
- **Alternatives Considered**:
  1. フロントエンドが受け取って書く（現状）
  2. CF が直接 `stakeholders/0` に書く
- **Selected Approach**: CF が Admin SDK で直接 `stakeholders/0` に `setDoc`
- **Rationale**: `generateChapters` CF が chapters コレクションに直接書くパターンと統一される。フロントエンドが LLM 出力を中継する不要な責務が消える
- **Trade-offs**: CF に Firestore 書き込みが追加されるが、軽微な変更

### Decision: `StakeholderDoc` 型の所在

- **Context**: `topic.types.ts` から `stakeholders` フィールドを除去すると `StakeholderDoc` 型の置き場が問題になる
- **Alternatives Considered**:
  1. `topic.types.ts` に残す（フィールドだけ除去）
  2. 専用の `stakeholder.types.ts` を `src/lib/models/` 配下に新設する
- **Selected Approach**: `StakeholderDoc` 型は `topic.types.ts` に残す（フィールド除去のみ）。型自体の移動は別スコープ
- **Rationale**: 型移動は参照箇所の全変更を伴うが、このスペックの主目的はドキュメント構造の変更。型移動は将来の整理として切り出す
- **Trade-offs**: `topic.types.ts` に `StakeholderDoc` が残るが、参照先の変更数を最小化できる

## Risks & Mitigations

- CF レスポンスの型変更 → フロントの `httpsCallable<...>` 型定義も同時に変更する
- `generatePersonas` が `stakeholders/0` を読めない場合（Phase1 未完了での操作） → CF が `invalid-argument` エラーを返す。フロントの Phase 遷移チェックで防ぐ（既存の `phaseLogicalState` ガードに依存）
- `topic.stakeholders` を参照している箇所の取りこぼし → Grep で `topic\.stakeholders\|topicDoc\.stakeholders\|stakeholders:` を全検索して確認する

## References

- `src/lib/stores/chapterAnalysis.svelte.ts` — 固定 ID ドキュメント購読パターンの参考実装
- `src/lib/stores/postDebateComments.svelte.ts` — 同上
- `src/lib/stores/currentTopic.svelte.ts` — ストアのライフサイクル管理パターン
- `functions/src/api/stakeholders.ts` — 変更対象の CF エントリポイント
- `functions/src/api/personas.ts` — 変更対象の CF エントリポイント
