# Requirements Document

## Introduction
現在、logotope のすべての永続データ（トピック・ペルソナ・討論ターンなど）は Firebase Data Connect (PostgreSQL) に保存され、進捗状態のみ Firestore で管理している。この2データストア構成が複雑さとバグの温床となっているため、Data Connect を廃止し Firestore に一本化することで、アーキテクチャをシンプルにする。

## アーキテクチャ方針

```
フロントエンド（Firebase Client SDK）
  ├── 読み込み・CRUD書き込み → src/lib/stores/（onSnapshot + setDoc/addDoc等）→ Firestore
  └── AI処理起動 → src/lib/api/（httpsCallable）→ Cloud Functions (onCall)

Cloud Functions
  └── AI パイプラインのみ
        analyzeStakeholders / generatePersonas / startInterviews / startDebate
        ↓ パイプライン内部で repository.ts を使って Firestore に書き込む
```

Firestore へのアクセス（読み書き問わず）は `src/lib/stores/` に集約する。`src/lib/api/` は Cloud Functions 呼び出し（AI パイプライン起動）のみとする。

## Boundary Context

- **In scope**:
  - `functions/src/db/repository.ts` を AI パイプライン専用に縮小・Firestore Admin SDK で再実装
  - `src/lib/stores/` に Firestore リアルタイム同期ストア（読み込み）および書き込み関数を新規作成
  - 公開閲覧 SvelteKit サーバールートの Firestore 移行
  - DataConnect 設定・コード・依存の完全削除
  - Firestore セキュリティルールの定義
- **Out of scope**: AI パイプライン内部ロジック・ページコンポーネント・Firebase Auth
- **Adjacent expectations**: 既存の `debate_progress` Firestore コレクション・`progress.svelte.ts` は変更しない

---

## Requirements

### 1. Firestore コレクション設計

**Objective:** As a 開発者, I want 全エンティティを Firestore コレクションで表現できる, so that DataConnect/PostgreSQL を完全に廃止できる

#### Acceptance Criteria

1. The system shall use the following Firestore collection structure:

   **`topics/{topicId}`**
   ```
   {
     title: string,
     status: DebateStatus,
     createdAt: Timestamp,
     updatedAt: Timestamp,
     stakeholders?: {
       items: Stakeholder[],  // { role, reason, mainInterests: string[], stanceDirection, minorityLevel }
       approved: boolean,
       createdAt: Timestamp
     }
   }
   ```
   - DataConnect の `StakeholderMap` テーブルは廃止し、stakeholders を topic ドキュメントに埋め込む（1:1）

   **`topics/{topicId}/personas/{personaId}`**
   ```
   {
     topicId: string,
     stakeholderRole: string,
     name: string,
     age: number,
     occupation: string,
     background: string,
     interests: string,
     stanceDirection: string,
     approved: boolean,
     sortOrder: number,
     interview?: {
       interviewRecord: string,
       status: 'completed' | 'error' | 'pending',
       errorMessage?: string,
       completedAt?: Timestamp
     },
     beliefs: Array<{
       id: string,
       version: number,
       content: string,
       changeType?: 'opinion_change' | 'partial_acceptance',
       changeSummary?: string,
       triggeredByTurnId?: string,
       createdAt: Timestamp
     }>
   }
   ```
   - `PersonaInterview` テーブルは廃止し `interview` を埋め込む（1:1）
   - `PersonaBelief` テーブルは廃止し `beliefs` 配列を埋め込む（常に全件読むため）
   - `beliefs` への追加は `FieldValue.arrayUnion()` で原子的に行う

   **`topics/{topicId}/sessions/0`**（ドキュメントID固定 `'0'`）
   ```
   {
     status: string,
     totalTurns?: number,
     createdAt: Timestamp,
     completedAt?: Timestamp,
     publishedAt?: Timestamp,
     turns: Array<{
       id: string,
       turnIndex: number,
       speakerType: 'facilitator' | 'persona',
       personaId?: string,
       content: string,
       createdAt: Timestamp
     }>,
     postDebateComments: Array<{
       id: string,
       personaId: string,
       content: string,
       sortOrder: number
     }>
   }
   ```
   - 1トピック1セッション（1:1）のためドキュメントIDを `'0'` に固定し、常に `topicId` でパスを解決する
   - `DebateTurn`・`PostDebateComment` テーブルは廃止し session ドキュメントに埋め込む
   - `turns` への追加は `FieldValue.arrayUnion()`（最大200件 × 約1.5KB ≈ 300KB）
   - `postDebateComments` への追加も `FieldValue.arrayUnion()`

2. The system shall treat **sessionId = topicId**。session を返す関数の `id` フィールドには `topicId` を使う

3. The system shall generate document IDs using `nanoid()` when creating topics and personas（sessions/0 の固定IDを除く）

4. The system shall store timestamps as Firestore `Timestamp` 型（`Timestamp.now()` または `serverTimestamp()`）

5. The system shall leave `debate_progress/{topicId}` collection unchanged

---

### 2. Firestore リアルタイム同期ストア

**Objective:** As a 管理者, I want Firestore のデータをリアルタイムで画面に反映できる, so that Cloud Functions 経由のフェッチなしにデータを参照できる

#### Acceptance Criteria

1. The system shall create the following store files in `src/lib/stores/`、`$state` + `start()` + `stop()` パターンに従う:

   | ファイル | 購読対象 | データ state | isLoaded state |
   |---|---|---|---|
   | `topics.svelte.ts` | `topics` コレクション全件 | `topics: TopicDoc[]` | `isLoaded: boolean` |
   | `topic.svelte.ts` | `topics/{topicId}` 単一ドキュメント | `topic: TopicDoc \| null` | `isLoaded: boolean` |
   | `personas.svelte.ts` | `topics/{topicId}/personas` サブコレクション | `personas: PersonaDoc[]` | `isLoaded: boolean` |
   | `session.svelte.ts` | `topics/{topicId}/sessions/0` ドキュメント | `session: SessionDoc \| null` | `isLoaded: boolean` |

2. Each store shall expose `start()` — `onSnapshot()` でリアルタイム購読を開始する

3. Each store shall expose `stop()` — unsubscribe して購読を終了する

4. Each store shall use Svelte 5 `$state` for reactive state（データ state と `isLoaded` state の両方）

5. When the first snapshot is received, the store shall set `isLoaded` to `true`（ドキュメントの存在有無にかかわらず）

6. When a subscribed document does not exist, the store shall set data state to `null`（コレクション購読は `[]`）

6. `topics.svelte.ts` shall order by `createdAt` descending

7. `personas.svelte.ts` shall order by `sortOrder` ascending

8. The system shall use `onSnapshot`, `collection`, `doc`, `query`, `orderBy` from `firebase/firestore` and `db` from `$lib/firebase.js`

9. All functions within store files shall use arrow function syntax

10. The system shall add the following types to `src/lib/types/index.ts`:
    `TopicDoc`, `PersonaDoc`, `SessionDoc` および埋め込みサブ型（`StakeholderDoc`, `InterviewDoc`, `BeliefDoc`, `TurnDoc`, `PostDebateCommentDoc`）

---

### 3. ストアへの書き込み関数の追加

**Objective:** As a 管理者, I want Firestore への書き込みをストア経由で行える, so that Firestore アクセスが src/lib/stores/ に集約される

#### Acceptance Criteria

1. The system shall add write functions to the appropriate store files, alongside the existing reactive state and `start()`/`stop()`:

   **`topics.svelte.ts` に追加する書き込み関数:**
   | 関数 | 操作 | Firestore パス |
   |---|---|---|
   | `createTopic(title)` | `addDoc`（ID: `nanoid()`） | `topics/` |
   | `deleteTopic(topicId)` | batch delete | `topics/{topicId}` + サブコレクション全件 |

   **`topic.svelte.ts` に追加する書き込み関数:**
   | 関数 | 操作 | Firestore パス |
   |---|---|---|
   | `approveStakeholders(topicId)` | `updateDoc` | `topics/{topicId}.stakeholders.approved = true` |
   | `publishDebate(topicId)` | `updateDoc` × 2 | `topics/{topicId}.status`, `topics/{topicId}/sessions/0.publishedAt` |
   | `resetDebate(topicId)` | `deleteDoc` + `updateDoc` | `topics/{topicId}/sessions/0` 削除、`topics/{topicId}.status` 更新 |

   **`personas.svelte.ts` に追加する書き込み関数:**
   | 関数 | 操作 | Firestore パス |
   |---|---|---|
   | `approvePersonas(topicId)` | batch `updateDoc` | `topics/{topicId}/personas/*` |
   | `resetPersonas(topicId)` | batch delete + `updateDoc` | `topics/{topicId}/personas/*` 削除、`topics/{topicId}.status` 更新 |

2. The following operations shall remain as Cloud Functions calls in `src/lib/api/`（AI処理を伴うため）:
   - `analyzeStakeholders(topicId)` — ステークホルダー分析 AI
   - `generatePersonas(topicId)` — ペルソナ生成 AI
   - `startInterviews(topicId)` — インタビュー AI
   - `startDebate(topicId)` — 討論 AI

3. The system shall use `nanoid()` for new document ID generation on the client side

4. All functions shall use arrow function syntax

---

### 4. Firestore セキュリティルール

**Objective:** As a 開発者, I want Firestore セキュリティルールが適切に設定される, so that 認証済み管理者のみ書き込みでき、公開済みデータは誰でも閲覧できる

#### Acceptance Criteria

1. When an authenticated user writes to `topics/**`, the system shall allow the write
2. When an unauthenticated user writes to `topics/**`, the system shall deny the write
3. When any user reads `topics/{topicId}` where `session.publishedAt != null`, the system shall allow the read（公開済みトピック）
4. When an authenticated user reads any document in `topics/**`, the system shall allow the read
5. When an unauthenticated user reads `debate_progress/{topicId}`, the system shall allow the read（進捗は認証不要）
6. The system shall define rules in `firestore.rules`

---

### 5. repository.ts の縮小・Firestore 再実装（AI パイプライン専用）

**Objective:** As a AI パイプライン, I want repository.ts の関数が Firestore Admin SDK で動作する, so that AI パイプライン内部の読み書きが DataConnect なしで行える

#### Acceptance Criteria

**パイプライン書き込み関数（AI処理中に呼ぶもの）:**

1. `updateTopicStatus(id, status)` — `topics/{id}` の `status` と `updatedAt` を更新する

2. `createStakeholderMap(topicId, content)` — `content`（JSON文字列）をパースし `topics/{topicId}.stakeholders` を set する。`{ id: topicId }` を返す

3. `createPersonaProfile(params)` — `topics/{topicId}/personas/` に `nanoid()` IDで作成し `{ id }` を返す

4. `approvePersonaProfiles(topicId)` — `topics/{topicId}/personas` 全件の `approved` を `true` に更新（batch）

5. `createCompletedPersonaInterview(personaId, interviewRecord)` — persona の `interview` フィールドを set する。`{ id: personaId }` を返す

6. `createErrorPersonaInterview(personaId, errorMessage)` — persona の `interview.status` を `'error'` に更新する

7. `createPersonaBelief(params)` — `FieldValue.arrayUnion()` で persona の `beliefs` 配列に追記する。`{ id }` を返す

8. `createDebateSession(topicId)` — `topics/{topicId}/sessions/0` を冪等に作成する（存在する場合はスキップ）。`{ id: topicId }` を返す

9. `completeDebateSession(id, totalTurns)` — `topics/{id}/sessions/0` の `status`・`totalTurns`・`completedAt` を更新する

10. `createDebateTurn(params)` — `FieldValue.arrayUnion()` で session の `turns` に追記する。`{ id }` を返す

11. `createPostDebateComment(params)` — `FieldValue.arrayUnion()` で session の `postDebateComments` に追記する。`{ id }` を返す

**パイプライン読み込み関数（AI処理中に内部で使うもの）:**

12. `getTopicById(id)` — `topics/{id}` を読む。存在しない場合 `null` を返す

13. `getApprovedPersonasByTopicId(topicId)` — `approved === true` のペルソナを `sortOrder` 昇順で返す。`interview` と `beliefs` は persona ドキュメントに埋め込まれているため同時に取得できる

**削除する関数（ストアが代替するか、埋め込みにより不要になったもの）:**

16. The system shall remove from repository.ts:
    - 埋め込みにより不要: `getPersonaInterviewByPersonaId`（persona.interview で取得）、`getPersonaBeliefsByPersonaId`（persona.beliefs で取得）、`getPersonaById`（getApprovedPersonasByTopicId で代替）、`getStakeholderMapByTopicId`（topic.stakeholders で取得）
    - ストアが代替（読み込み）: `listTopics`, `getPersonasByTopicId`, `getDebateSessionById`, `getDebateSessionByTopicId`（createDebateSession の冪等化により不要）, `getDebateTurnsBySessionId`, `getPostDebateCommentsBySessionId`, `getPublishedSessions`
    - ストアが代替（書き込み）: `createTopic`, `approveStakeholderMap`, `deletePersonaProfilesByTopicId`, `deletePersonaInterviewsByTopicId`, `deletePersonaBeliefsByTopicId`, `deleteDebateSessionByTopicId`, `deleteDebateTurnsBySession`, `deletePostDebateCommentsBySession`, `deleteDebateSession`, `publishDebateSession`

**削除する死活コード:**

19. The system shall remove: `createPersonaInterview`, `completePersonaInterview`, `updatePersonaInterviewStatus`（アクティブなパイプラインから呼ばれていない）

20. The Repository shall use `firebase-admin/firestore` (`getFirestore()`) exclusively

---

### 6. DataConnect の完全撤廃

**Objective:** As a 開発者, I want DataConnect に関するコード・設定・依存が完全に削除される, so that システムの複雑さが解消される

#### Acceptance Criteria

1. The system shall remove all `firebase-admin/data-connect` imports from `functions/src/`
2. The system shall remove `src/lib/server/dataconnect.ts`
3. The system shall remove `src/routes/api/debates/` ディレクトリ（`+server.ts` を含む）
4. The system shall remove `src/routes/api/debates/[id]/` ディレクトリ（`+server.ts` を含む）
5. The system shall remove `src/routes/+page.server.ts` と `src/routes/debate/[id]/+page.server.ts`（DataConnect 経由の load 関数）
6. The system shall remove `src/dataconnect-generated/` ディレクトリ
7. The system shall remove the `dataconnect` emulator configuration from `firebase.json`
8. The system shall remove `firebase/data-connect` and `firebase-admin/data-connect` package references from all `package.json`
9. When `npm run build` is executed in `functions/`, the system shall compile without errors
10. When `pnpm build` is executed in the project root, the frontend shall compile without errors
