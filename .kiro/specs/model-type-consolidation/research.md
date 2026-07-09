# Research Log — model-type-consolidation

## Summary

- **Discovery type**: Light（既存コードベースのリファクタ／Extension）。詳細な棚卸しは `gap-analysis.md` に収録済み。
- **Scope**: FE `src/lib/models`（＋ `stores` / `features` 境界）と functions `functions/src/types` の型定義の配置・重複・死型・責務境界の整理。
- **Key findings**:
  1. FE は直近作業で大部分整理済み（turn/chapter 集約・死型除去・turns の描画時解決）。残件は小（render-baking 3件、store 派生型1件）。
  2. functions は概念配置が FE と不一致（`EditedTurn`/`EditedChapter`/`EditingChapterStatus` が `editorial.types.ts` に混載）。→ 本 spec の主対象。
  3. `*ForFirestore` は永続書き込み境界として構造・命名を維持（配置整理のみ）。

## Research Log

### Topic 1: FE の残 render-baking（Req 3 の適用範囲）
- `EditingPage.displayImpressions` = `{ personaId, name, role, part }`（name/role を build 時に解決）。
- `EngagementList` = `{ personaId, name, mode, score }`（persona.name を解決）。
- `awarenessesByTurn` = `Map<turnId, { personaName, content }[]>`（persona.name を畳む・debate/editing 両方）。
- **Implication**: turn の先例（描画時解決）に合わせ、いずれも `personaId` を保持して描画時に `personaMap` で解決する形に統一するのが一貫。変更量は小。

### Topic 2: functions/types の概念配置
- `editorial.types.ts` が「編集出力（Narration/Impression/Editorial/ArticleElement）」と「編集後討論（EditedTurnForFirestore/EditedChapterForFirestore/EditingChapterStatus）」を混載。
- FE は `EditedTurn`→`turn.types`、`EditedChapter`→`chapter.types` に集約済み。
- **Implication**: functions も同じ粒度に分離（`EditedTurnForFirestore`→`turn.types`、`EditedChapterForFirestore`＋`EditingChapterStatus`→`chapter.types`）し、`editorial.types` は編集出力専用に絞る。

### Topic 3: 命名整合（`DebateTurn`(functions) ↔ `Turn`(FE)）
- 同一概念だが命名が異なる。統一は behavior-neutral だが波及が広い（functions 多数ファイル）。
- **Decision**: 本 spec では**責務境界と配置の整合を優先**し、識別子リネームは Non-Goal（別対応候補）。ユーザ要望「責務境界をそろえる」は命名一致を必須としない。

### Topic 4: store 派生型 `EngagementHistoryEntryWithPersona`
- `stores/engagements.svelte.ts` に定義（model を拡張し `turnId`/`personaId` の結合キーを付与）。解決済みラベルは持たない。
- **Decision**: 型自体は正当（結合キー付きの派生形）。Req 7 に沿い定義場所を `models/engagement/engagement.types.ts` へ移す。

## Architecture Pattern Evaluation

| Option | 概要 | 評価 |
|--------|------|------|
| A: 各層内 in-place 整理 | FE 残件＋functions 再配置を層内で | ○ 低リスク・段階適用可。重複自体は残る |
| B: FE/functions 共有型パッケージ化 | 単一ソースを両者参照 | ✗ steering 方針と乖離・XL/高リスク。**スコープ外** |
| C: Hybrid（A＋概念→ファイル正準マッピング） | A に加え FE/functions を同粒度で並行 | ◎ 採用。責務境界・配置がそろう |

**採用: Option C**。

## Design Decisions

- **D1**: 1ドメイン=1型ファイル。FE `models/<domain>/<domain>.types.ts` と functions `types/<domain>.types.ts` を同粒度で並行させる（正準マッピングを design に明記）。
- **D2**: functions `editorial.types.ts` を分離（EditedTurn→turn、EditedChapter＋EditingChapterStatus→chapter、editorial は編集出力専用）。
- **D3**: 責務境界＝ドメイン/永続型は intrinsic＋id 参照のみ。派生（ラベル/JOIN/diff）は FE では描画時解決、functions では型に畳まない。FE 残 render-baking（Topic 1）を描画時解決へ統一。
- **D4**: `EngagementHistoryEntryWithPersona` を models へ移設。
- **D5**: 識別子リネーム（DebateTurn↔Turn 等）は Non-Goal。
- **D6**: `*ForFirestore` の構造・命名・書き込み挙動は不変（配置/重複/死型のみ）。
- **D7**: 各ドメインの移動は独立に適用し、都度 `svelte-check` / functions `tsc` / 両 vitest green ＋ grep（旧パス・死型ゼロ）で検証。

## Risks

- functions の import 付け替えが広範 → 段階（ドメイン単位）＋型チェックで担保。
- `*ForFirestore` 構造を誤って変えると永続互換が壊れる → 構造不変を厳守（移動・改名のみ、フィールド不変）。
- FE render-baking の描画時解決化で微細な表示差が出ないか → 既存テスト＋出力不変で担保。
