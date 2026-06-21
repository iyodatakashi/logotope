# Gap Analysis: chapter-type-unification

## Analysis Summary

- **スコープ確定**: 当初の2ペア統一に加え、プロジェクト全体の `*Doc` 型を `*ForFirestore` に一括改名する。命名規約の明確化が目的
- **前提スペック `chapter-grouping-separation` は実装完了**（全タスク [x]）。着手可能状態
- **変更対象は型定義ファイルとその直接消費側**（stores・テスト）。pipeline/AI ロジックは型アノテーションのみで実体なし
- **`DiscussionPointState` が Firestore 永続とインメモリの2用途で使われており、命名方針の判断が必要**（設計フェーズで確定）
- **Effort は全体で M 程度**。型名は限定的なファイルにしか広がっておらず、変更箇所は予測可能

---

## 0. 確定した命名規約

| 種別 | サフィックス | 日付型 | 用途 |
|------|-----------|------|------|
| Firestore永続型 | `*ForFirestore` | `Timestamp` | Firestore read/write の境界で使う |
| アプリケーション型 | なし（or 意味のある名前） | `Date` | アプリ内部で使う |

**パターン例（既存）:**
```typescript
// TurnDoc → TurnForFirestore（Timestamp）+ Turn（Date）
type TurnForFirestore = { ..., createdAt: Timestamp }
type Turn = Omit<TurnForFirestore, 'createdAt'> & { createdAt: Date }
```

このパターンをTimestampを含む全型に適用する。

---

## 1. Current State Investigation

### 1.1 プロジェクト全 `*Doc` 型の棚卸し

#### FE 側（`src/lib/models/`）— Timestamp有無を加えた分類

**Timestampを含む型（`*ForFirestore` + アプリ型の2種類が必要）:**

| 現在の型名 | Timestampフィールド | ForFirestore版 | アプリ型 | 現状 |
|-----------|------------------|--------------|---------|------|
| `TurnDoc` | `createdAt` | `TurnForFirestore` | `Turn`（既存） | ✅ 対応済み（リネームのみ） |
| `BeliefDoc` | `createdAt` | `BeliefForFirestore` | `Belief`（**新規作成**） | ❌ |
| `InterviewDoc` | `completedAt?` | `InterviewForFirestore` | `Interview`（**新規作成**） | ❌ |
| `TopicDoc` | `createdAt`, `updatedAt`, `publishedAt?` | `TopicForFirestore` | `Topic`（`createTopicStates` の戻り値型として実質存在） | ✅ 実質対応済み |
| `FetchedSourceContent` | `fetchedAt` | `FetchedSourceContentForFirestore` | `FetchedSourceContent`（**新規作成**） | ❌ |

> `PersonaDoc` は `BeliefDoc`・`InterviewDoc` を内包するため、変換後は `PersonaForFirestore`（Timestamp版）と `Persona`（Date版）も必要になる（詳細は 1.2 参照）。

**Timestampを含まない型（リネームのみ、1種類）:**

| 現在の型名 | 定義ファイル | 変更後 | 外部使用ファイル数 |
|-----------|------------|--------|-----------------|
| `ChapterDoc` | `chapter/chapter.types.ts` | `ChapterForFirestore` | 3 |
| `DiscussionPointStatusDoc` | `chapter/chapter.types.ts` | 命名要検討（後述） | 0 |
| `ChapterAnalysisDoc` | `chapter/chapter.types.ts` | `ChapterAnalysisForFirestore` | 3 |
| `PersonaDoc` | `persona/persona.types.ts` | `PersonaForFirestore` | 1（+ `Persona` 新規作成） |
| `StakeholderDoc` | `topic/topic.types.ts` | `StakeholderForFirestore` | 2 |
| `EngagementDoc` | `engagement/engagement.types.ts` | `EngagementForFirestore` | 0 |
| `PostDebateCommentDoc` | `postDebateComment/postDebateComment.types.ts` | `PostDebateCommentForFirestore` | 1 |
| `PostDebateCommentsDoc` | `postDebateComment/postDebateComment.types.ts` | `PostDebateCommentsForFirestore` | 1 |

#### functions 側（`functions/src/types/`）

| 現在の型名 | 定義ファイル | 外部使用ファイル数 | 備考 |
|-----------|------------|-----------------|------|
| `ChapterAnalysisDoc` | `chapter.types.ts` | 0（定義のみ） | `ChapterAnalysisForFirestore` に |
| `ChapterStateData` | `debate.types.ts` | 1（debate.types.test.ts） | `ChapterForFirestore` に（FE と統一） |
| `DiscussionPointState` | `debate.types.ts` | 定義ファイル内2箇所 | **永続 + インメモリの2用途、後述** |

### 1.2 `PersonaDoc` のカスケード変換

`PersonaDoc` は Timestamp を直接持たないが、`BeliefDoc`・`InterviewDoc` を内包するため、それらの変換にともない2種類が必要：

```typescript
// Firestore境界で使う版
type PersonaForFirestore = {
  ...,
  interview?: InterviewForFirestore;   // completedAt: Timestamp
  beliefs: BeliefForFirestore[];       // createdAt: Timestamp
}

// アプリ内で使う版
type Persona = Omit<PersonaForFirestore, 'interview' | 'beliefs'> & {
  interview?: Interview;               // completedAt: Date
  beliefs: Belief[];                   // createdAt: Date
}
```

現状の `personas.svelte.ts` は `PersonaDoc` を Timestamp のまま保持しており、ストアの変換ロジック追加が必要。

### 1.3 型の差異サマリー（functions ↔ FE の統一対象ペア）

| 概念 | functions 現在名 | FE 現在名 | 差異 |

|-----|----------------|----------|------|
| Firestore 章ドキュメント | `ChapterStateData` | `ChapterDoc` | `turns` の要素型のみ（`DebateTurn` vs `TurnDoc`） |
| 論点ステータス | `DiscussionPointState` | `DiscussionPointStatusDoc` | なし（同一構造） |
| 章分析ドキュメント | `ChapterAnalysisDoc` | `ChapterAnalysisDoc` | なし（同名・同一構造） |

### 1.3 `DiscussionPointState` の2用途問題

```typescript
// (1) Firestore 永続用（ChapterStateData の一部として保存）
ChapterStateData.discussionPointStatuses?: DiscussionPointState[]

// (2) インメモリ用（討論中の追跡状態、Firestore 非保存）
DebateState.discussionPoints: DiscussionPointState[]
```

`ForFirestore` サフィックスは (2) のインメモリ用途には意味的に不適切。設計フェーズでの判断が必要。

### 1.4 前提確認

- `chapter-grouping-separation` 全タスク [x] 完了済み → 同ファイルへの衝突なし
- 既存テストは全件通過済み（135件）

---

## 2. Requirements Feasibility Analysis

> `requirements.md` は未生成（`phase: "initialized"`）。プロジェクト記述と命名方針決定から推定。

### 2.1 技術的必要能力と現状ギャップ

| 必要能力 | 現状 | ギャップ |
|---------|------|---------|
| 全 `*Doc` 型を `*ForFirestore` に改名 | 12型が `*Doc` サフィックス | **Missing**: 型定義・インポート・型アノテーション更新 |
| functions `ChapterStateData` を FE と統一名に改名 | `ChapterStateData` vs `ChapterForFirestore` | **Missing**: 型名変更 |
| `DiscussionPointState` の永続用途を `ForFirestore` 名に統一 | インメモリ用途と共用 | **Constraint**: インメモリ用途の扱いを設計で決定 |
| functions `ChapterAnalysisDoc` と FE 側の名前を整合 | 同名だが今後 `ForFirestore` に変更 | **Missing**: 両ファイルで同時変更 |
| 変更後のテスト全件通過 | 型テスト複数ファイルに存在 | **Missing**: テスト内の型アノテーション更新 |
| FE/functions 型ファイル分離ルール維持 | 現行で分離済み | なし |

---

## 3. Implementation Approach Options

### Option A: FE 全 `*Doc` → `*ForFirestore` ＋ functions の重複型を統一（推奨）

**変更内容（FE）:**

| 変更前 | 変更後 |
|--------|--------|
| `TurnDoc` | `TurnForFirestore` |
| `ChapterDoc` | `ChapterForFirestore` |
| `DiscussionPointStatusDoc` | `DiscussionPointStatusForFirestore` |
| `ChapterAnalysisDoc` | `ChapterAnalysisForFirestore` |
| `PersonaDoc` | `PersonaForFirestore` |
| `BeliefDoc` | `BeliefForFirestore` |
| `InterviewDoc` | `InterviewForFirestore` |
| `TopicDoc` | `TopicForFirestore` |
| `StakeholderDoc` | `StakeholderForFirestore` |
| `EngagementDoc` | `EngagementForFirestore` |
| `PostDebateCommentDoc` | `PostDebateCommentForFirestore` |
| `PostDebateCommentsDoc` | `PostDebateCommentsForFirestore` |

**変更内容（functions）:**

| 変更前 | 変更後 |
|--------|--------|
| `ChapterStateData` | `ChapterForFirestore` |
| `ChapterAnalysisDoc` | `ChapterAnalysisForFirestore` |
| `DiscussionPointState` | `DiscussionPointStatusForFirestore`（※ `DebateState` 用途の扱いは設計で決定） |

**影響ファイル（FE）:**
- 型定義: 6ファイル（chapter.types.ts, turn.types.ts, persona.types.ts, topic.types.ts, engagement.types.ts, postDebateComment.types.ts）
- ストア: 7ファイル（chapters.svelte.ts, chapterAnalysis.svelte.ts, personas.svelte.ts, topics.svelte.ts, stakeholders.svelte.ts, postDebateComments.svelte.ts, engagement関連）
- テスト: 5ファイル（chapters.test.ts, chapter.types.test.ts, chapterAnalysis.test.ts, stakeholders.test.ts, models/テスト）
- モデル: 1ファイル（createTopic.svelte.ts）

**影響ファイル（functions）:**
- 型定義: 2ファイル（debate.types.ts, chapter.types.ts）
- テスト: 1ファイル（debate.types.test.ts）

**Trade-offs:**
- ✅ Firestore 永続型の意図が型名から明確になる
- ✅ `turns: DebateTurn[]`（functions）vs `turns: TurnForFirestore[]`（FE）の差異が名前から読み取れる
- ✅ 一括実施で後から「漏れ」が出ない
- ❌ 変更ファイル数が多い（~15ファイル）
- ❌ `DiscussionPointState` のインメモリ用途 (`DebateState.discussionPoints`) の扱いが宙に浮く

### Option B: 段階的実施（今回は debate ドメインのみ、残りは別スペック）

**変更内容（今回）:**
- `ChapterStateData` → `ChapterForFirestore`
- `ChapterDoc` → `ChapterForFirestore`
- `DiscussionPointStatusDoc` → `DiscussionPointStatusForFirestore`
- `DiscussionPointState`（永続用途のみ）→ `DiscussionPointStatusForFirestore`

**Trade-offs:**
- ✅ スコープが小さく、影響が限定的
- ❌ `TurnDoc` など他の `*Doc` 型が `ForFirestore` 統一前に残り、中途半端な状態が長続きする
- ❌ 別スペックで同様の作業を繰り返す

---

## 4. `DiscussionPointState` の設計フェーズへの持ち越し

`DiscussionPointState` は functions 側でインメモリ状態 (`DebateState`) にも使われているため、単純に `ForFirestore` へ改名すると意味的に不自然になる。設計フェーズで以下のいずれかを選択する：

1. **`DiscussionPointStatusForFirestore` に統一**（DebateState への使用は若干語感が悪いが許容）
2. **分割**: `DiscussionPointStatusForFirestore`（永続用）+ `DiscussionPointState`（インメモリ用）を別型として共存
3. **インメモリ型を別名で定義**: `DiscussionPointTracker` などを `DebateState` 専用として残す

---

## 5. Effort & Risk Assessment

| タスク | Effort | Risk | 理由 |
|-------|--------|------|------|
| `DiscussionPointState` の設計方針決定 | S | Low | 選択肢明確、技術的不確実性なし |
| FE 全 `*Doc` 型を `*ForFirestore` にリネーム | M | Low | ファイル数は多いが機械的な置換 |
| functions `ChapterStateData`/`ChapterAnalysisDoc` のリネーム | S | Low | 使用箇所が少ない |
| 型テスト・ストアの import・型アノテーション更新 | S | Low | grep で全箇所特定済み |
| 非退行確認（`pnpm test:unit`） | S | Low | 型エラーは `svelte-check` / tsc で即確認 |

**総合 Effort: M** / **総合 Risk: Low**

---

## 6. Recommended Design Direction

**推奨**: Option A（全 `*Doc` → `*ForFirestore` 一括改名）

**命名規則（確定）:**
- Firestore に永続するドキュメント型は `*ForFirestore` サフィックスを使う
- インメモリ専用の状態型は `*State` / `*Context` 等、用途を示す別サフィックスを使う

**`DiscussionPointState` への推奨:**
- `DebateState.discussionPoints` はインメモリ追跡用途 → `DiscussionPointState` のまま維持
- `ChapterStateData.discussionPointStatuses` は永続用途 → `DiscussionPointStatusForFirestore` を別途定義（または `DiscussionPointState` で兼用し`ForFirestore` 型は不要とする）
- 設計フェーズで最終決定

**前提条件**: `chapter-grouping-separation` 実装完了 ✅
