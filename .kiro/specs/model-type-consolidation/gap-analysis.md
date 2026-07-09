# Gap Analysis — model-type-consolidation

## 現状調査（Current State）

### FE `src/lib/models`
直近の作業で大部分が整理済み:
- turn 系（`Turn` / `EditedTurn` / `TurnForEditing`）→ `turn.types.ts` に集約、`DisplayTurn` 廃止、`EditedTurnForFirestore` 一本化。
- chapter 系（`EditedChapter*`）→ `chapter.types.ts` に集約。
- 死型（`postDebateComment` / `editedPostDebateComment` / `editedIntroClosing`）削除済み。
- turns の display-baking（name/role/diff/awareness）→ 描画時解決へ移行済み。
- 正当な派生（`Stakeholder`/`Impression`/`EditedChapter` = `*ForFirestore & { id/personaId }`、`Turn`/`Belief` 等 = `Omit<…, 日付> & { Date }`）は維持で問題なし。

### FE `stores` / `features`（残件）
- **`EngagementHistoryEntryWithPersona`**（`stores/engagements.svelte.ts`）: model 型を store 内で拡張した派生型。models 外に居る（Req 7 対象の可能性）。
- **render-baking の残り**（Req 3）:
  - `EditingPage.displayImpressions`: `{ personaId, name, role, part }`（name/role を build 時に解決）。
  - `EngagementList`: `{ personaId, name, mode, score }`（persona.name を解決）。
  - `awarenessesByTurn`: `{ personaName, content }`（persona.name を畳む）— debate/editing 両方。
- `.svelte` 内の独自**データ**型は一掃済み（残るは `Props` interface のみ＝正当な UI 契約）。

### functions `functions/src/types`（主ギャップ）
ドメイン別分割済みだが、FE と**概念配置が不一致**:
- `editorial.types.ts` が「編集出力（`Narration`/`ImpressionForFirestore`/`EditorialForFirestore`/`ArticleElement`）」と「編集後討論（`EditedTurnForFirestore`/`EditedChapterForFirestore`/`EditingChapterStatus`）」を**混載**。
- `EditedTurnForFirestore` は `turn.types.ts`、`EditedChapterForFirestore` は `chapter.types.ts` に置くのが FE と整合（現状は editorial に居る）。
- `DebateTurn`（functions）と `Turn`/`TurnForFirestore`（FE）は同一概念で**命名が異なる**。
- FE/functions で同一概念（Chapter / Issue / Engagement / Persona / Editorial 要素）が重複定義（永続一致方針上は許容だが、配置の並行性は未整合）。
- 内部の dead/dup は名前だけでは断定不可（実装時の全走査が必要）。

## Requirement → Asset マップ（gap tags）

| Req | 対象資産 | 状態 |
|-----|----------|------|
| 1 棚卸し | FE models / stores / features＋functions/types | Constraint: 実装時に全走査（特に functions の dead/dup）|
| 2 集約(FE) | turn/chapter.types | 大部分 Done。Missing: `EngagementHistoryEntryWithPersona` の配置 |
| 3 表示もどき排除(FE) | displayImpressions / EngagementList / awareness | Missing（render-baking 残存）|
| 4 一本化 | FE=概ね Done / functions | Unknown: functions 内重複の精査 |
| 5 死型 | FE=Done / functions | Unknown: functions 側未監査 |
| 6 責務境界 | 上記 render-baking / functions ドメイン型 | Missing（FE render-baking、functions は「不要派生を畳まない」点検）|
| 7 models 一元化 | store 派生型 / Props フィールド | Missing: `WithPersona` の扱い、Props が models 型を使うか検証 |
| 8 functions 整合 | functions/types 再配置＋命名整合 | Missing（本 spec の主対象。editorial→turn/chapter へ分離、DebateTurn↔Turn）|
| 9 検証 | svelte-check / tsc / 両テスト | 実装時に維持（0 error・green）|

## 実装アプローチ

### Option A: 各層内で in-place にドメイン別整理
FE 残件（render-baking の描画時解決化、`WithPersona` 整理）＋ functions の型再配置（`editorial.types` から `EditedTurn`→`turn.types`、`EditedChapter`→`chapter.types`、dead/dup 除去）。
- ✅ 既存パターン（今回の FE 作業）の延長で低リスク。✅ 永続構造不変。
- ❌ FE/functions の重複そのものは残る（並行配置になるだけ）。

### Option B: FE/functions 共有型パッケージ化
永続/共通型を単一ソースに集約し両者が参照。
- ✅ 重複を根本解消。❌ steering 方針（「共通型は Functions 側で定義し API で渡す」）と現構成からの大きな乖離、XL・高リスク。**本 spec スコープ外を推奨**。

### Option C: Hybrid（推奨）
Option A を主軸に、**「概念 → 型ファイル」の対応表**を design で定め、FE(`models/<domain>.types`) と functions(`types/<domain>.types`) を**同じ粒度で並行**させる（命名整合含む）。共有パッケージ化はしない。
- ✅ FE/functions の責務境界・配置が同じ考え方でそろう（Req 8 の主眼）。✅ 段階適用可（ドメイン単位）。
- ❌ 対応表の設計と命名整合の判断が必要。

## Effort / Risk

- FE 残件（render-baking＋`WithPersona`）: **S / Low** — 今回の turn 作業と同型。
- functions 再配置＋dedup/dead: **M / Medium** — `*ForFirestore` 構造不変を守りつつ import 広範・`tsc`/vitest green 維持。
- 命名整合（`DebateTurn↔Turn` 等）: 実施するなら +M（behavior-neutral だが波及大）。
- 全体: **M / Low–Medium**。

## Research Needed（design へ持ち越し）

1. **functions の dead/dup 精査**: 名前だけでは不明。実装時に参照ゼロ・完全一致を全走査。
2. **命名整合の範囲**: `DebateTurn↔Turn` 等を本 spec で揃えるか（波及大のため design で線引き）。
3. **FE render-baking の適用範囲**: impressions/engagement/awareness を turn と同様に描画時解決へ寄せるか（一貫性 vs 変更量）。
4. **概念→ファイル対応表**: FE/functions を並行させる正準マッピングを design で定義。
5. **Option B の扱い**: 共有パッケージ化は本 spec 対象外とする前提で良いか。
6. 既存メモ `project-type-domain-decomposition`（FE/functions 横断の型再構成計画）と本 spec の関係整理。
