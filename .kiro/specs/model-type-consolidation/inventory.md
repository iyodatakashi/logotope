# 対象型の棚卸しと分類（Task 1 成果物）

走査範囲: `src/lib/models` 全型ファイル、`src/lib/stores` / `src/lib/features` の表示派生（`.map` / `$derived` によるオブジェクト組み立て）、`functions/src/types` 全型ファイル。
分類軸（Req 1.2）: ①散在→集約 ②表示用もどき型 ③重複→一本化 ④死型→削除 ⑤責務境界違反。各候補に「整理対象／正当な派生」の判定根拠を付す（Req 1.4）。
参照ゼロは実 grep で確認（Req 1.3）。

---

## ① 散在→集約

| 候補 | 現配置 | 移動先 | 判定根拠 | 対応 |
|------|--------|--------|----------|------|
| `EditedTurnForFirestore` | functions `editorial.types.ts` | `turn.types.ts` | FE は `EditedTurn` を `turn.types` に集約済み。正準マッピングに合わせ turn 概念へ | Task 4 |
| `EditedChapterForFirestore` + `EditingChapterStatus` | functions `editorial.types.ts` | `chapter.types.ts` | FE は `EditedChapter*` を `chapter.types` に集約済み。編集後章＝chapter 概念 | Task 4 |
| `EngagementHistoryEntryWithPersona` | `stores/engagements.svelte.ts:5` | `models/engagement/engagement.types.ts` | store 内定義のデータ派生型。models 一元化（Req 7.1/7.3）。結合キー付与のみで責務は正当 | Task 3 |

- FE の turn/chapter 系集約は済み（直近作業）。functions のみ残（`editorial.types` が編集出力と編集後討論を混載）。

## ② 表示用もどき型（描画時解決へ・Req 3）

いずれも「解決済み話者ラベル（name/role）を build 時に畳む」＝責務境界違反。turn の先例に合わせ personaId を保持し描画時解決へ。

| 候補 | 箇所 | 現形 | 目標形 | 対応 |
|------|------|------|--------|------|
| `displayImpressions` | `EditingPage.svelte:192` | `{ personaId, name, role, part }`（`speakerLabel` で name/role 畳み込み） | personaId 保持、`ImpressionSection` が `personaMap` から描画時解決 | Task 2.1 |
| `awarenessesByTurn` | `GenerateDebatePage.svelte:96` / `EditingPage.svelte:89` / `ChapterSection.svelte`（Props/描画） | `Map<turnId, { personaName, content }[]>`（persona.name 畳み込み） | `{ personaId, content }` に変え描画時に name 解決 | Task 2.2 |
| `EngagementList` items | `EngagementList.svelte:14` | `{ personaId, name, mode, score }`（persona.name 畳み込み） | 描画時に `personaMap` から name 解決（既に personaMap 受領済み） | Task 3 |

## ③ 重複→一本化

| 候補 | 状態 | 判定根拠 | 対応 |
|------|------|----------|------|
| `EngagementLevel`（FE） | `topic.types.ts:54` と `persona.types.ts:53` で**二重定義**（同一 literal union）。`stakeholder.types` / `engagement.constants` は topic 版を import、`persona.types` は自前定義 | 完全一致の重複定義。persona.types を import に寄せ単一化 | Task 6（FE 是正） |
| functions `Chapter` vs `ChapterEntry` | `Chapter`={id,title,agenda}、`ChapterEntry`={id,chapterIndex,title,agenda,turns,status}（superset） | **完全一致ではない**（4.1/4.2 の対象外）。`StepContext` が両者を保持（`chapter` は `chapterDoc` と同一視）。一本化は形状変更＝リスクありのため保留、責務点検のみ | Task 5/6 で精査（原則維持） |

**正当な FE/functions 並行ミラー（一本化対象外）**: `Narration` / `ImpressionForFirestore` / `EditorialForFirestore` / `ArticleElement` / `EditorialElementStatus`、`FactBase`/`FactItem`/`FactBaseForFirestore`、`TurnFactCheckTrace`/`FactCheckFinding`、`Chapter`/`Issue`/`IssueGroup`、`Persona`/`Belief`/`Awareness*` は FE と functions に同一概念が並行で存在。Option B（共有パッケージ化）は Non-Goal のため、並行配置を維持（Req 8 許容）。

## ④ 死型→削除（参照ゼロを grep 確認）

**FE**

| 型 | 定義 | 確認 | 対応 |
|----|------|------|------|
| `ElementStatus` | `editorial.types.ts:41` | 参照ゼロ（テストの同名 local は別物・無関係） | Task 6 |
| `EngagementEntry` | `engagement.types.ts:1` | 参照ゼロ | Task 3（engagement 触時） |
| `EngagementForFirestore` | `engagement.types.ts:18` | 参照ゼロ。store は `history` を inline 型で読み本型を使わない未使用ミラー | Task 3（削除 or store を本型に配線するか要判断。`feedback-mirror-firestore-shape` と Req 5.1 が拮抗） |
| `PendingIntentEntry` | `engagement.types.ts:13` | `EngagementForFirestore` からのみ参照。上記削除で死型化 | Task 3（連動） |
| `PersonaData` | `persona.types.ts:79` | 参照ゼロ | Task 6 |
| `export type { Chapter }`（re-export） | `stores/chapters.svelte.ts:6` | この re-export 経由の消費者ゼロ。`feedback-no-reexport-shortcuts` に反する死 re-export | Task 6 |

**functions**

| 型 | 定義 | 確認 | 対応 |
|----|------|------|------|
| `ChapterAnalysisForFirestore` | `chapter.types.ts:24` | 参照ゼロ（定義行のみ） | Task 5 |
| `DebateSession` | `debate.types.ts:19` | 参照ゼロ（定義行のみ） | Task 5 |

## ⑤ 責務境界違反

- ②の render-baking 3件は責務境界違反（解決済みラベルを型/派生に畳む）を兼ねる。
- `ChapterSection` Props `awarenessesByTurn: Map<.., { personaName, content }[]>` は解決済みラベル形を Props に内包。Task 2.2 で `{ personaId, content }`（id 参照）へ。Props フィールド型は models 準拠か点検（Req 7.4/7.5） → Task 6。
- models（FE）ドメイン型: turn/chapter は整理済みで解決ラベル・JOIN・算出フィールドなし＝適合。
- functions ドメイン型: `ChapterEntry`/`TurnGenerationContext` 等は intrinsic＋id 参照（`{id,name}` 等は生成入力の最小 projection）で、生成/永続に不要な派生の畳み込みは未検出 → Task 6 で最終点検。

---

## 正当な派生（維持・整理対象外）

判定根拠付きで「似て非なる型」でないことを確認済み。

- `Turn` / `Belief` / `Awareness` / `Interview` / `TopicInput` / `FetchedSourceContent` = `Omit<*ForFirestore, 日付> & { Date }` — Timestamp→Date の実差。
- `Chapter`(FE) = `Omit<ChapterForFirestore,'turns'> & { id; turns: Turn[] }` — doc id materialize＋日付変換波及。
- `Stakeholder` = `StakeholderForFirestore & { id }` / `EditedChapter` = `EditedChapterForFirestore & { id }` — doc id materialize。
- `Impression` = `ImpressionForFirestore & { personaId }` — マップキー materialize（Chapter の doc id と同関係）。
- `TurnForEditing` = `EditedTurn & { removed }` — 差分行の削除フラグ拡張（描画時に sourceTurnIds から解決）。
- `EditedChapterDisplayStatus` = `EditingChapterStatus | 'missing'` / `PhaseLogicalState` = `PhaseStatus | 'approved'` — 表示論理状態の拡張（解決ラベルでなく状態値）。
- `EngagementHistoryEntryWithPersona` = `EngagementHistoryEntry & { turnId; personaId }` — 結合キー付与のみ（解決ラベルなし）。責務は正当、配置のみ models へ（①）。

---

## 後続タスクの確定対象（Task 1 完了状態）

- **Task 2**: displayImpressions（2.1）、awarenessesByTurn（2.2）。
- **Task 3**: `EngagementHistoryEntryWithPersona` の models 移設＋EngagementList 描画時解決＋engagement 死型（`EngagementEntry`/`EngagementForFirestore`/`PendingIntentEntry`）の掃除。
- **Task 4**: functions `editorial.types` 分離（`EditedTurnForFirestore`→turn、`EditedChapterForFirestore`＋`EditingChapterStatus`→chapter）。
- **Task 5**: functions 死型 `ChapterAnalysisForFirestore` / `DebateSession` 削除。`Chapter`/`ChapterEntry` は完全一致でないため一本化せず責務点検のみ。
- **Task 6**: FE 死型 `ElementStatus` / `PersonaData`、死 re-export `chapters.svelte.ts` の `Chapter`、`EngagementLevel` 二重定義の一本化、Props 内データ形の点検。
