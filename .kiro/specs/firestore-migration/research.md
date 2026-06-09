# Research & Design Decisions

---

## Summary
- **Feature**: `firestore-migration`
- **Discovery Scope**: Complex Integration（既存システム全体のデータ層を置換）
- **Key Findings**:
  - `repository.ts` は全 API ハンドラとパイプラインから呼ばれており、フロントエンドからは直接参照されていない
  - `src/lib/api/topics.ts` の関数群は CRUD 読み込み（listTopics, getPersonas 等）を Cloud Functions 経由で行っているが、移行後はストアで代替できる
  - 公開 API ルートは `src/lib/server/dataconnect.ts` に強く依存しており、ほぼ全面書き換えが必要
  - 既存の `firestore.rules` は `debate_progress` のみ許可し、他は全拒否しているため、新コレクション用のルールを追加する必要がある

## Research Log

### repository.ts の呼び出し元分析
- **Context**: どの関数を repository.ts に残すか判断するため
- **Findings**:
  - API ハンドラ（topics.ts, stakeholders.ts, personas.ts, interviews.ts, debates.ts, resets.ts）が呼ぶ読み込み関数: `getTopicById`, `listTopics`, `getStakeholderMapByTopicId`, `getPersonasByTopicId`, `getApprovedPersonasByTopicId`, `getPersonaInterviewByPersonaId`, `getDebateSessionByTopicId`, `getDebateSessionById`
  - パイプライン専用読み込み: `getPersonaBeliefsByPersonaId`
  - 死活コード（呼び出しなし）: `createPersonaInterview`, `completePersonaInterview`, `updatePersonaInterviewStatus`
- **Implications（確定）**: 移行後に repository.ts に残る読み込み関数は **2つのみ**
  - `getTopicById` — AI パイプラインがトピック情報を取得するために必要
  - `getApprovedPersonasByTopicId` — interview・beliefs が persona に埋め込まれているため、これ1つで全データが揃う
  - `getPersonaInterviewByPersonaId`, `getPersonaBeliefsByPersonaId` → persona に埋め込みのため不要
  - `getStakeholderMapByTopicId` → topic に埋め込みのため不要
  - `getDebateSessionByTopicId` → `createDebateSession` を冪等化することで不要
  - `getDebateSessionById`, `listTopics`, `getPersonasByTopicId` 等 → ストアが代替するため不要

### src/lib/api/topics.ts の現状
- **Context**: どの関数がストアの write 関数に置き換わるかを確認
- **Findings**:
  - 読み込み系（ストア代替）: `listTopics`, `getTopic`, `getStakeholders`, `getPersonas`, `getInterviews`, `getAdminDebate`
  - 書き込み系（ストアの write 関数に移行）: `createTopic`, `approveStakeholders`, `approvePersonas`, `publishDebate`, `resetDebate`, `resetToPhase1/2/3`
  - AI トリガー系（Cloud Functions のまま）: `generateStakeholders`, `generatePersonas`, `startInterviews`, `retryInterview`, `startDebate`
- **Implications**: ページコンポーネントの更新は本 spec のスコープ外。ストアの write 関数は作るが、既存の `src/lib/api/topics.ts` の Cloud Function 呼び出しはそのまま残す（別 spec でページ更新時に差し替え）

### 公開 API ルートの依存分析
- **Context**: `/api/debates` と `/api/debates/[id]` の書き換え範囲
- **Findings**:
  - `src/routes/+page.server.ts` → fetch('/api/debates') → `api/debates/+server.ts` → DataConnect（不要な中継）
  - `src/routes/debate/[id]/+page.server.ts` → fetch('/api/debates/[id]') → DataConnect（同上）
  - `+page.server.ts` は常にサーバーサイドで実行されるが、HTTP 経由の中継は不要な往復
  - 公開ページは Firestore セキュリティルールで `publishedAt != null` のトピックを許可すれば、ブラウザから直接 Client SDK で読める
- **Decision（確定）**: `/api/debates` ルート・`+page.server.ts` load 関数を **削除**。公開ページのデータ取得はクライアントサイド Firestore 読み込みに委ねる（別 spec でページ更新時に実装）。本 spec ではファイル削除のみ行う

### Firestore セキュリティルール設計
- **Context**: 現行ルールは全拒否のため新規に設計が必要
- **Findings**:
  - 管理者はすべての操作が必要（認証済み）
  - 公開ビューアーは `published` なトピックとそのサブコレクションを読める（未認証可）
  - `debate_progress` は未認証でも読める（進捗表示に使用）
  - Firestore security rules での cross-document `get()` は可能だが課金が発生する
- **Selected Approach**: セッションドキュメントの `publishedAt` フィールドで公開判定（sessions/0 に直接アクセス）。personas は親トピックの status を `get()` で参照

### Timestamp 型の統一
- **Context**: 既存コードは `createdAt: string` (ISO 8601) を使用
- **Findings**:
  - 既存の `src/lib/types/index.ts` の型定義（TopicSummary.createdAt: string 等）は互換性のために変更しない
  - 新たに追加する Firestore ドキュメント型（TopicDoc 等）は `Timestamp` を使用
  - Admin SDK と Client SDK で同名の `Timestamp` クラスが存在するが、型構造は同じ（`.toDate()`, `.seconds`, `.nanoseconds`）
- **Implications**: `src/lib/types/index.ts` に追加する型は `import type { Timestamp } from 'firebase/firestore'` を使用

## Architecture Pattern Evaluation

| Option | 説明 | 強み | リスク |
|--------|------|------|--------|
| Store に読み書き集約 | onSnapshot + write 関数を同一ファイルに | Firestore アクセスが一箇所 | Store が大きくなる可能性 |
| 読み書き分離（stores/ + db/） | stores は read-only、別 module で write | 責務明確 | ファイルが増える |
| Cloud Functions 経由のまま | 既存アーキテクチャを維持 | 変更最小 | ネットワーク往復コスト |

→ **Store に読み書き集約** を採用。ユーザーの明示的な指示に沿い、Firestore アクセスを stores/ に集約する。

## Design Decisions

### Decision: sessionId = topicId
- **Context**: 1:1 関係の session をどう識別するか
- **Alternatives**:
  1. 別の UUID を sessionId として維持 → `getDebateSessionById` がクエリが必要
  2. topicId を sessionId として扱う → パスが決定的
- **Selected**: topicId を sessionId として扱い `topics/{topicId}/sessions/0` 固定パス
- **Rationale**: クエリ不要でコストゼロ。1:1 関係の構造的に正しい表現
- **Trade-offs**: 既存の sessionId を URL に使うページ（`/debate/[id]`）は URL が topicId ベースになるが、公開 API の `[id]` パラメータの意味が変わるだけでパス自体は変わらない

### Decision: ページコンポーネント更新を本 spec のスコープ外とする
- **Context**: `src/lib/api/topics.ts` の Cloud Function 呼び出しをストアに差し替える作業はページ側の変更を伴う
- **Rationale**: ページコンポーネントは Out of scope。ストアの write 関数を先に実装し、ページ側の差し替えは別 spec で行う
- **Trade-offs**: この spec 完了時点でストアは作られるが、ページから使われない期間が生じる

### Decision: 公開ビューアーは SvelteKit サーバールート（Admin SDK）を維持
- **Context**: 公開ページは SSR、セキュリティルール不要
- **Rationale**: Admin SDK は security rules をバイパスするため、公開コンテンツの読み込みに安全に使える。クライアントサイドへの移行は不要

## Risks & Mitigations
- **`debate_progress` の write 権限**: Cloud Functions が Admin SDK で書くため現行ルールのまま（`allow write: if false`）で動作する
- **`get()` コストのある security rules**: personas の公開判定で `get(topics/topicId)` を呼ぶと読み込みコストが発生する。影響は軽微（公開ページの読み込み時のみ）
- **Timestamp 型の不整合**: 既存の `PublishedDebateSummary.publishedAt: string` は文字列期待。Admin SDK から取得した Timestamp は `.toDate().toISOString()` で変換して渡す
