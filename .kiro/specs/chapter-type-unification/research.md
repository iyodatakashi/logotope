# Research & Design Decisions: chapter-type-unification

## Summary

- **Feature**: `chapter-type-unification`
- **Discovery Scope**: Extension（既存型システムへの命名規約適用）
- **Key Findings**:
  - `chapters.svelte.ts` の `RawChapter` → `Chapter` 変換（inline）が Timestamp→Date 変換の先行パターン。`personas.svelte.ts` でも同パターンを適用する
  - `DiscussionPointState`（functions）と `DiscussionPointStatusDoc`（FE）は Timestamp を含まないため `ForFirestore` サフィックス不要。functions 名 `DiscussionPointState` を FE に合わせる形で統一する
  - `TopicBase` は `FetchedSourceContentForFirestore` を含むため内部的に `TopicBaseForFirestore` に変更が必要だが、外部から直接 import されているのは `topic.types.ts` 内のみのため影響は限定的

## Research Log

### 既存の Timestamp→Date 変換パターン

- **Context**: `BeliefDoc`・`InterviewDoc` に Date 版型を追加する際の実装パターンを確認
- **Sources**: `src/lib/stores/chapters.svelte.ts`, `src/lib/models/topic/createTopic.svelte.ts`, `src/lib/models/turn/turn.types.ts`
- **Findings**:
  - `turn.types.ts`: `type Turn = Omit<TurnDoc, 'createdAt'> & { createdAt: Date }` — Omit + 上書きパターン
  - `chapters.svelte.ts`: `raw.turns.map(t => ({ ...t, createdAt: t.createdAt.toDate() }))` — スプレッド変換パターン
  - `createTopic.svelte.ts`: `let createdAt: Date = topicDoc.createdAt.toDate()` — 個別変数パターン（Svelte state）
- **Implications**: `Belief`・`Interview`・`FetchedSourceContent` のアプリ型も `Omit<*ForFirestore, '日付フィールド'> & { 日付フィールド: Date }` パターンで定義する。ストアの変換は `.toDate()` マップで実施

### `DiscussionPointState` vs `DiscussionPointStatusDoc` の名前選択

- **Context**: FE と functions で同一の `{ point: string; status: DiscussionPointStatus }` 構造を統一名にする
- **Findings**:
  - `DiscussionPointStatus` という名前は既に union 型 `'untouched' | 'introduced' | 'addressed'` で使用中 → 構造体名に使うと衝突
  - functions 側で `DiscussionPointState` が `DebateState.discussionPoints`（インメモリ）と `ChapterStateData.discussionPointStatuses`（Firestore永続）の両方に使われている → 永続・インメモリ共用の概念
  - Timestamp を含まないため `ForFirestore` サフィックル不要
- **Implications**: `DiscussionPointState` を統一名とし、FE 側の `DiscussionPointStatusDoc` をこの名前にリネームする

### `TopicBase` の扱い

- **Context**: `TopicBase` は `FetchedSourceContent`（`fetchedAt: Timestamp`）を含むため、ForFirestore 変換の影響を受ける
- **Findings**:
  - `TopicBase` は `topic.types.ts` 内でのみ使われ、外部からは import されていない（`createTopic.svelte.ts` は `TopicDoc` のみ import）
  - `TopicBase` を `TopicBaseForFirestore` に改名しても外部影響ゼロ
- **Implications**: `TopicBase` → `TopicBaseForFirestore` に改名。`FetchedSourceContent`（Timestamp版）も `FetchedSourceContentForFirestore` に変更

### `createTopicStates` と FetchedSourceContent 変換

- **Context**: `createTopicStates` は `fetchedSourceContents` を Timestamp のまま state に保持している
- **Findings**:
  - `let fetchedSourceContents: FetchedSourceContent[] | undefined = $state(topicDoc.fetchedSourceContents);`
  - 現在は変換なし → `FetchedSourceContentForFirestore`（Timestamp）がアプリ内に露出している
  - Requirement 2 に従い `FetchedSourceContent`（Date版）を作成し変換が必要
- **Implications**: `createTopicStates` で `fetchedSourceContents` を `FetchedSourceContentForFirestore[]` → `FetchedSourceContent[]` に変換するロジックを追加する

## Architecture Pattern Evaluation

| オプション | 説明 | 採用可否 |
|---|---|---|
| Omit + 日付上書き | `Omit<XForFirestore, 'dateField'> & { dateField: Date }` | ✅ 採用（既存パターンと整合） |
| 完全独立型 | `ForFirestore` と App 型を完全別定義 | ❌ フィールド重複でメンテ負荷増 |
| 共通基底型 | 日付なし基底型を共有 | ❌ 過剰な抽象化 |

## Design Decisions

### Decision: `DiscussionPointState` を統一名とする

- **Context**: FE `DiscussionPointStatusDoc` vs functions `DiscussionPointState` の命名統一
- **Selected Approach**: `DiscussionPointState` に統一（functions 名を採用）
- **Rationale**: `DiscussionPointStatus` は union 型と衝突する。`State` はインメモリ・永続両用途に意味が通る
- **Trade-offs**: FE 側にリネームが発生するが外部使用箇所はゼロ（`chapter.types.ts` 内のみ）

### Decision: `PersonaForFirestore` / `Persona` のカスケード変換はストアに集約する

- **Selected Approach**: `personas.svelte.ts` で `PersonaForFirestore` → `Persona` の変換を行い、ストア外には `Persona` のみ公開
- **Rationale**: `chapters.svelte.ts` の `RawChapter` → `Chapter` と同じ境界パターン。変換は1か所に集約

## Risks & Mitigations

- `persons.svelte.ts` の変換追加で `updateDoc` 等の書き込みパスが `PersonaForFirestore` 型ではなく部分オブジェクトを渡している → 書き込みは既存のまま（型注釈なし）。読み取り変換のみ変更
- `FetchedSourceContent` のリネームで `createTopic.svelte.ts` の型注釈が変わる → import 更新のみ
- functions `ChapterStateData` を `ChapterForFirestore` に変更するが、pipeline/API から未使用 → テストファイル1件のみ更新

## References

- 既存変換パターン: `src/lib/stores/chapters.svelte.ts:20-24`
- 既存 Omit パターン: `src/lib/models/turn/turn.types.ts:17`
