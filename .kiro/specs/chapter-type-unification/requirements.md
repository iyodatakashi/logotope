# Requirements Document

## Project Description (Input)
debate ドメインで、FE（`src/lib/models`）と functions（`functions/src/types`）の境界をまたいで「わずかな違いで役割が重複する型」が複数存在する。同じ永続概念を別名で定義しているため、命名が不統一で認知負荷が高い。これらを概念ごとに一貫した命名へ統一する。

対象の重複ペア:
1. **チャプター永続形**: `ChapterStateData`（functions/`debate.types.ts`）↔ `ChapterDoc`（FE/`chapter.types.ts`）。中身はほぼ同一（`chapterIndex, title, focusQuestion, discussionPoints, turns, discussionPointStatuses?, status`）。差は `turns` の型（`DebateTurn` vs `TurnDoc`）のみ。
2. **論点ステータス**: `DiscussionPointState`（functions）↔ `DiscussionPointStatusDoc`（FE）。どちらも `{ point, status }`。

## 補足メモ（spec-requirements 時に精査）
- FE と functions の型ファイル分離ルール（steering）は維持する。統一するのは「同一概念の命名」であり、片側へ寄せて1ファイルに集約することではない。
- `turns` のように FE（`TurnDoc`）と functions（`DebateTurn`）で実体が異なる（Timestamp 変換等）部分は、命名規約に沿って区別を残すか検討する。
- 前提スペック `chapter-grouping-separation` の実装完了後に着手する（同じ `chapter.types.ts`/`debate.types.ts` を編集するため衝突回避）。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
