# Research & Design Decisions: chapter-grouping-separation

## Summary
- **Feature**: `chapter-grouping-separation`
- **Discovery Scope**: Extension（既存 `chapter-agent.ts` パイプラインの責務分離）
- **Key Findings**:
  - 現行 `composeChapters` がクラスタリングとタイトル・フォーカス問い生成を1回のAI呼び出しに混載しており、章数上限バイアスの原因になっている。
  - 論点は単一 `issues: Issue[]` 配列に集約し、`source` フィールドで general/persona を区別する。グループは `issues` へのインデックス参照（`IssueGroup{ issueIndexes }`）のみ持ち、テキストを複製しない。
  - グループ表示データは `topics/{id}/chapterAnalysis/0` の `issueGroups` フィールドに追記すれば、新コレクション・Firestoreルール・reset処理の追加を回避できる。

## Research Log

### グループ化とタイトル生成の混載問題
- **Context**: なぜ章立てが章数上限（5）に張り付くのか。
- **Sources Consulted**: `functions/src/agents/chapter-agent.ts` `composeChapters`/`groupingResultSchema`、`buildGroupingPrompt`。
- **Findings**: グループ化AIが `title`・`focusQuestion`・`assignedIssueIndexes` を同時に返す設計。AIは「タイトルを付けられる章」を上限まで作ろうとし、論点の自然なクラスタ数を無視する。
- **Implications**: グループ化を `{ issueIndexes }` のみに純粋化し、タイトル・フォーカス問いはグループ確定後の章生成へ移す。

### 並べ替えに必要なソース情報の保持
- **Context**: 「general由来論点が多い章を先頭」を純粋関数で実現するには、各グループの論点ソースが必要。
- **Findings**: 論点を単一 `issues: Issue[]` 配列に集約し、各 `Issue` が `source` フィールドを持つ。グループは `issues` へのインデックスで論点を参照する。
- **Implications**: グループは `IssueGroup{ issueIndexes: number[] }`（`issues` への参照のみ）とし、ローカルと Firestore で同一型を共用。ソースは `issues[index].source` を直接参照して判定する。

### グループ表示データの保存先
- **Context**: グループ構成を画面に表示するための永続化先。
- **Findings**: `chapterAnalysis/0` は既に `general`/`persona`/`scoredIssues` を保持する中間分析ドキュメント。Firestoreルールは `chapterAnalysis/{docId}` で設定済み。`resetChapters` は `chapterAnalysis/0` を削除済み。
- **Implications**: グループも同ドキュメントの `issueGroups` フィールドに追記。新コレクション不要、ルール・reset変更不要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: パイプライン全面書き直し | grouping/authoring/sort を3関数に分離 | 責務が明確・並べ替えを純粋関数化して単体テスト可能 | 既存テストのモック全面更新 | 採用 |
| B: 新旧並存・段階移行 | 旧 `composeChapters` を残しつつ追加 | 差分小 | 設計欠陥のある旧ロジックが残存し混乱 | 不採用 |

## Design Decisions

### Decision: 論点ドキュメント（Issue）にスコアを統合
- **Context**: 現行 `ChapterAnalysisDoc` は `general: string[]` と `scoredIssues: ScoredIssueDoc[]` で論点テキストが重複。
- **Alternatives Considered**:
  1. `scoredIssues` を独立配列のまま維持
  2. 論点を単一 `issues: Issue[]`（`score?` オプショナル・`source` 付き）に統合
- **Selected Approach**: (2)。論点生成直後は `{text}` のみ、スコアリング後に `score`/`reason`/`selected` を追記。
- **Rationale**: テキスト重複を排除し、論点の状態を段階的に1配列で表現できる。採用フラグ `selected` を保持するため、閾値再計算（選別ロジックの二重実装）が不要。
- **Trade-offs**: ✅ 単一の真実 / ❌ オプショナルフィールドの存在チェックが表示側に必要。

### Decision: 並べ替えは章生成後の純粋関数
- **Context**: 「general由来が多い章を先頭」を実装する位置。
- **Selected Approach**: `buildChapters` 完了後に `sortChaptersByGeneralIssueCount` を適用。グループと章は index 1:1 対応。
- **Rationale**: ユーザーの整理（ラインアップ確定 → 順番決定）に一致。JS の `Array.prototype.sort` は安定ソート（Node 24）なので、general数同数時は元のグループ順を維持できる。
- **Trade-offs**: グループ表示（クラスタリング順）と最終章順が一致しない場合がある。グループ表示はクラスタリングの可視化、章順は別概念として許容。

## Risks & Mitigations
- AI がグループ数と異なる章数を返すリスク — 章生成は「各グループに対応する章を生成」と明示し、欠落グループは論点テキスト（index解決）をフォールバック discussionPoints とする。
- 既存テスト大量更新によるリグレッション — モックヘルパー（`makeGroupingResult`/`makeAuthoringResult`）を新スキーマに合わせて一括更新し、`pnpm test:unit` で全件確認。

## References
- `functions/src/agents/chapter-agent.ts` — 現行パイプライン実装
- `functions/src/pipeline/chapters/chapter-generator.ts` — `planChapters` オーケストレーション
- `.kiro/specs/chapter-generation-scoring/` — 上流スペック（`ChapterProgress`/`onProgress` 機構の出自）
