# Firebase 開発ガイドライン

## アーキテクチャ方針

```
フロントエンド（Firebase Client SDK）
  ├── 読み込み・CRUD書き込み → src/lib/stores/（onSnapshot + setDoc/addDoc等）→ Firestore
  └── AI処理起動 → src/lib/api/（httpsCallable）→ Cloud Functions (onCall)

Cloud Functions（firebase-admin）
  └── AI パイプラインのみ（長時間処理・サーバーサイドAI SDK）
        ↓ 内部で repository.ts を使って Firestore に書き込む
```

**Firestore へのアクセスは `src/lib/stores/` に集約する。**
`src/lib/api/` は Cloud Functions 呼び出し（httpsCallable）のみとする。

---

## Firestore 設計原則

### 課金モデルを意識する
- Firestore の課金は**ドキュメント読み込み数**で発生する（クエリ件数ではない）
- 100件のドキュメントを1クエリで取得しても 100課金
- 常に一緒に読むデータは**同じドキュメントに埋め込む**

### 埋め込み vs サブコレクション
| 埋め込む | サブコレクションにする |
|---|---|
| 1:1 の関係（interview, stakeholders） | 独立して取得する必要があるもの |
| 親と常に一緒に読むもの（turns, beliefs, comments） | リスト取得時に重くなるもの（personas） |
| 件数が有界で小さいもの | 件数が無制限に増えるもの |

### 1:1 関係は固定 ID で表現する
```
topics/{topicId}/sessions/0   ← '0' 固定、1トピック1セッション
```
`getSessionByTopicId(topicId)` のような「クエリで探す」関数は不要。パスが決定的に定まる。

### ドキュメント上限（1MB）を意識する
- ターン最大200件 × 平均1.5KB ≈ 300KB → 上限内
- 埋め込みが限界に近づく場合はサブコレクション化を検討する

---

## Firestore スキーマ

### コレクション構造
```
topics/{topicId}
  title, status, createdAt, updatedAt
  stakeholders?: { items: Stakeholder[], approved, createdAt }  ← 埋め込み（1:1）

topics/{topicId}/personas/{personaId}
  topicId, stakeholderRole, name, age, occupation, background, interests
  stanceDirection, approved, sortOrder
  interview?: { interviewRecord, status, errorMessage?, completedAt? }  ← 埋め込み（1:1）
  beliefs: BeliefEmbed[]  ← 埋め込み（常に全件読む）

topics/{topicId}/sessions/0
  status, totalTurns?, createdAt, completedAt?, publishedAt?
  turns: TurnEmbed[]          ← 埋め込み（FieldValue.arrayUnion で逐次追加）
  postDebateComments: PostDebateCommentEmbed[]  ← 埋め込み

```

### sessionId = topicId
新スキーマでは sessionId という概念を廃止し、topicId に一本化する。
`topics/{topicId}/sessions/0` のパスが常に正解。

---

## ストアパターン（src/lib/stores/）

### onSnapshot をデフォルトとする理由
`onSnapshot` はキャッシュを活用するため、同じドキュメントへの重複読み込みを抑制し課金を削減できる。`getDocs`/`getDoc` は毎回サーバー読み込みが発生する。リアルタイム更新が不要な場合でも、原則 `onSnapshot` で実装する。`getDocs` が適切なケース（一度きりの取得・サーバーサイド処理）では使ってよい。

### 基本構造
```typescript
export const createXxxStore = (topicId: string) => {
  let data = $state<XxxDoc | null>(null);
  let isLoaded = $state(false);
  let unsubscribe: (() => void) | null = null;

  const start = () => {
    const ref = doc(db, 'topics', topicId);
    unsubscribe = onSnapshot(ref, (snap) => {
      data = snap.exists() ? ({ id: snap.id, ...snap.data() } as XxxDoc) : null;
      isLoaded = true;  // ドキュメントの存在有無にかかわらず、初回スナップショット受信で true
    });
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    get data() { return data; },
    get isLoaded() { return isLoaded; },
    start,
    stop,
  };
};
```

### 書き込み関数もストアに含める
読み込みだけでなく、そのエンティティへの書き込み関数もストアファイルに定義する。

```typescript
const createTopic = async (title: string) => {
  const id = nanoid();
  await setDoc(doc(db, 'topics', id), { title, status: 'pending', createdAt: now(), updatedAt: now() });
};
```

---

## ID 生成

```typescript
import { nanoid } from 'nanoid';

// ✅ 正しい
const id = nanoid();

// ❌ 使わない
const id = crypto.randomUUID();
```

---

## Cloud Functions との役割分担

### Cloud Functions に置くもの
- AI パイプライン処理（Anthropic SDK、長時間実行）
- **フロントエンドから直接できない処理のみ**

### フロントエンドで直接やるもの
- Firestore 読み込み（onSnapshot ストア）
- Firestore への CRUD 書き込み（setDoc / updateDoc / addDoc / deleteDoc）
- 承認・公開・リセットなどの管理操作

### repository.ts（functions/src/db/）
AI パイプライン専用。フロントエンドからは使わない。
Admin SDK（`firebase-admin/firestore`）を使用。

---

## 配列への追記（FieldValue.arrayUnion）

ターン・信念・コメントの逐次追記には `arrayUnion` を使い原子的に更新する。

```typescript
// Cloud Functions 側（Admin SDK）
import { FieldValue } from 'firebase-admin/firestore';

await sessionRef.update({
  turns: FieldValue.arrayUnion({ id: nanoid(), turnIndex, content, ... })
});
```

---

## タイムスタンプ

Firestore に保存する全ての日付は **`Timestamp` 型**に統一する。

```typescript
// ✅ クライアント側（firebase/firestore）
import { Timestamp } from 'firebase/firestore';
createdAt: Timestamp.now()

// ✅ サーバー側（firebase-admin/firestore）
import { Timestamp } from 'firebase-admin/firestore';
createdAt: Timestamp.now()

// ❌ 使わない
createdAt: new Date().toISOString()  // 文字列では日付クエリ・ソートが不正確になる
```

表示する際は `.toDate()` で Date に変換する。

---

## コードスタイル

- 関数は理由がない限りアロー関数を使う
- `function foo() {}` より `const foo = () => {}`
