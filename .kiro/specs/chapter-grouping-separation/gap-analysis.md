# Gap Analysis: chapter-grouping-separation

## 1. 現状調査

### 変更対象ファイル

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `functions/src/agents/chapter-agent.ts` | グループ化・オーサリング・ChapterProgress型 | 修正 |
| `functions/src/pipeline/chapters/chapter-generator.ts` | Firestore書き込みオーケストレーション | 修正 |
| `functions/src/tests/agents/chapter-agent.test.ts` | chapter-agent ユニットテスト | 修正 |
| `functions/src/tests/agents/chapter-agenda.integration.test.ts` | 統合テスト | 修正 |
| `functions/src/tests/pipeline/chapters/chapter-generator.test.ts` | planChapters ユニットテスト | 修正 |
| `src/lib/features/admin/chapters/Phase4Chapters.svelte` | 中間表示UI | 修正 |
| `src/lib/models/chapter/chapter.types.ts` | ChapterDoc型 | 確認（assignedIssues? は既存） |
| `firestore.rules` | groups コレクションのアクセス制御 | 追加 |
| `src/lib/models/topic/createTopic.svelte.ts` | resetChapters | 修正（groups 削除を追加） |

### 現状の内部構造（chapter-agent.ts）

```
generateChapters
  └── scoreIssues (AI呼び出し)
  └── selectIssues (純粋関数)
  └── onProgress(issues_generated)
  └── onProgress(scoring_completed)
  └── composeChapters (AI呼び出し) ← グループ化+タイトル+FQ を同時生成
  └── onProgress(chapters_composed) ← タイトル・FQを含む
  └── authorChapterPoints (AI呼び出し) ← discussionPointsのみ生成
```

### 現状のスキーマ

**groupingResultSchema（変更前）**
```typescript
chapters: [{ title, focusQuestion, assignedIssueIndexes }]
```

**chapterPointsResultSchema（変更前）**
```typescript
chapters: [{ discussionPoints }]
```

### Firestore コレクション（現状）

- `topics/{id}/chapters` — 最終ChapterDoc（planChapters完了後）
- `topics/{id}/chapterAnalysis/0` — 論点・スコアリング結果
- `topics/{id}/groups` — **存在しない（新規追加が必要）**

---

## 2. 要件対応ギャップ分析

### Requirement 1: グループ化ステップの純粋化

| 要件 | 現状 | ギャップ |
|---|---|---|
| groupingスキーマが `groups:[{issueIndexes}]` のみ | `chapters:[{title, focusQuestion, assignedIssueIndexes}]` | **Missing** — スキーマ・プロンプト・関数を全面的に書き直す |
| タイトル・FQ生成をプロンプトに含めない | 含めている | **Missing** |
| 0グループフォールバック | 存在する（`composeChapters` 内） | 流用可能（ロジックは維持） |
| 未割り当て論点を最終グループに追加 | 存在する | 流用可能 |

### Requirement 2: 章立て生成ステップの拡張

| 要件 | 現状 | ギャップ |
|---|---|---|
| オーサリングスキーマに `title`, `focusQuestion` を追加 | `{discussionPoints}` のみ | **Missing** |
| グループ番号+論点テキストを入力とする | タイトル・FQを含むComposedChapterを入力 | **Missing** — 関数シグネチャ変更 |
| nanoid でIDを付与 | 実装済み | ✅ |

### Requirement 3: 章の並べ替え（純粋関数）

| 要件 | 現状 | ギャップ |
|---|---|---|
| general由来論点数でソートする純粋関数 | 存在しない | **Missing** |
| ScoredIssueのsource情報がグループ化後も参照可能 | ComposedChapterはstring[]のみ保持 | **Constraint** — IssueGroupの型をstring[]からScoredIssue[]に変更する必要がある |

**重要**: 現在 `composeChapters` は `ScoredIssue[]` を受け取るが、`ComposedChapter.assignedIssues` は `string[]`（テキストのみ）で返す。ソート関数がsource情報を使うためには、グループが `ScoredIssue[]` または `{ text, source }[]` を保持する必要がある。

### Requirement 4: Firestore書き込み更新

| 要件 | 現状 | ギャップ |
|---|---|---|
| `issues_grouped` イベント（`chapters_composed`から改名） | `chapters_composed` が存在 | **Missing** — イベント名・型を変更 |
| `topics/{id}/groups` コレクションへグループ書き込み | `chapters`コレクションへ書き込み | **Missing** — 新コレクション |
| グループドキュメントは `groupIndex`, `assignedIssues` のみ | ChapterDoc相当の全フィールドを書き込み | **Missing** |
| オーサリング完了後 `chapters` コレクションに `set` | `update` で `discussionPoints` のみ更新 | **Missing** — `set` に変更 |
| `resetChapters` が `groups` も削除する | `chapters`・`chapterAnalysis/0` のみ削除 | **Missing** |
| `firestore.rules` に `groups` コレクション追加 | 存在しない | **Missing** |

### Requirement 5: テスト整合性

| 要件 | 現状 | ギャップ |
|---|---|---|
| groupingモック: `{groups:[{issueIndexes}]}` | `{chapters:[{title, focusQuestion, assignedIssueIndexes}]}` | **Missing** — 全テストのモック修正 |
| authoringモック: `{chapters:[{title, focusQuestion, discussionPoints}]}` | `{chapters:[{discussionPoints}]}` | **Missing** |
| `issues_grouped`コールバックを発火するgenerator mock | `chapters_composed`を発火 | **Missing** |
| 並べ替え純粋関数の単体テスト | 存在しない | **Missing** |

---

## 3. 実装アプローチ

### Option A: chapter-agent.ts を全面書き直し（推奨）

`composeChapters` → `groupIssues`（スキーマ・プロンプト・戻り値を変更）
`authorChapterPoints` → `authorChapters`（スキーマ・プロンプト・戻り値を変更）
`sortChaptersByGeneralness` を新規追加（純粋関数）

**変更の流れ**:
1. `IssueGroup` 型: `{ assignedIssues: ScoredIssue[] }`（source情報を保持）
2. `groupingResultSchema`: `groups:[{issueIndexes}]` に変更
3. `chapterPointsResultSchema`: `chapters:[{title, focusQuestion, discussionPoints}]` に変更
4. `ChapterProgress.chapters_composed` → `issues_grouped` に改名、グループのみ送信
5. `sortChaptersByGeneralness(chapters, groups)` 純粋関数を追加
6. `generateChapters` の組み立てを更新

**Trade-offs**:
- ✅ 責務が明確に分離される
- ✅ テスト容易性が向上（並べ替えは純粋関数なので単体テスト可能）
- ❌ 既存テストの大部分を更新する必要がある

### Option B: 段階的移行（新旧並存）
現行の `composeChapters` を残しつつ新関数を追加する。

**Trade-offs**:
- ✅ 差分が小さい
- ❌ 旧ロジックが残り混乱を生む

**→ 不採用**。旧設計は設計上の欠陥なので残す意味がない。

---

## 4. 複雑度・リスク

| 項目 | 評価 | 根拠 |
|---|---|---|
| 実装規模 | **M** | 既存パターンの延長。ファイル数は少ないが全テスト修正が必要 |
| リスク | **Low** | 既存のスキーマ・モック・プロンプトのパターンが確立されている。破壊的変更だが影響範囲がpipelineに閉じている |

---

## 5. 設計フェーズへの申し送り

### 確定事項
- Option A（全面書き直し）を採用
- `IssueGroup.assignedIssues` は `ScoredIssue[]`（source情報保持）で設計する
- グループデータは `topics/{id}/groups` コレクションではなく `topics/{id}/chapterAnalysis/0` に追記する（`general`・`persona`・`scoredIssues` と同じドキュメント）
  - `firestore.rules` 変更不要
  - `resetChapters` 修正不要
  - フロントは既存の `chapterAnalysisStore` 購読のみで完結
- `ChapterAnalysisDoc` に `groups?: Array<{ groupIndex: number; assignedIssues: string[] }>` を追加
- `ChapterDoc` の変更なし（`assignedIssues?` は既に存在）

### 設計フェーズで決定すべき事項
- `sortChaptersByGeneralness` の関数シグネチャ（`Chapter[]` + `IssueGroup[]` を受け取るか、`Chapter` に source情報を埋め込むか）
- `GroupDoc` 型をどこに定義するか（`ChapterAnalysisDoc` 内インライン vs 独立型定義）
