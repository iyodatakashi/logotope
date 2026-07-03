# Research & Design Decisions: phase-key-migration

## Summary
- **Feature**: `phase-key-migration`
- **Discovery Scope**: Extension（既存フェーズ管理の内部リファクタ＋一度きりリセット）
- **Key Findings**:
  - `PhaseSlug` 型は既に `phase.types.ts:3-9` に定義済み。slug 値そのものは新規作成不要で、識別子を数値 `Phase` から `PhaseSlug` へ移すだけ。
  - ルーティングは既に slug ベース（`phasePath` が `/admin/topics/{id}/{slug}`、`+layout.svelte` が slug↔phase を相互変換）。番号依存は「順序判定・ゲート・バッジラベル・永続化」に限定。
  - 順序判定は全て「番号の大小比較」（`phaseLogicalState`、`StepNav` の `phase > currentPhase`）。`PHASE_DEFS` 配列インデックスへ移せば単一情報源化できる。
  - 実データ無しのためデータ移行は不要（Option C: リセット）。`Phase` 数値型は完全撤廃。

## Research Log

### 番号依存箇所の網羅（grep 全走査）
- **Context**: 純粋リファクタのため、番号→slug 化の対象を漏れなく特定する必要。
- **Sources Consulted**: `rg` による FE/BE 全走査（gap-analysis.md にインベントリ掲載）。
- **Findings**:
  - FE 中核: `phase.types.ts`（`Phase` 数値）/ `phase.constants.ts`（`PHASE_DEFS` の `phase` フィールド＋`Record<Phase,string>`×4）/ `phase.ts`（`phaseLogicalState` 数値比較、`phase === 6` 直書き）。
  - FE 承認遷移: `createTopic.svelte.ts` approve*（`phase:2/4/5/6`）と `setPhaseStatus(phase:1|2|3|4|5)`、`personas.svelte.ts`（`phase:2/3`）、`topics.svelte.ts`（初期 `phase:1`）。
  - FE 参照: `Phase*.svelte` の `const PHASE=N`×6、`StepNav.svelte`/`+layout.svelte`/`+page.svelte`/`TopicListPage.svelte`。
  - BE: `topic-phase.ts`（`GeneratePhase=1..4`、`data.phase!==phase`）、`api/{stakeholders,personas,chapters}.ts` の `confirmPhaseGenerated`、`interview-completion.ts`（3）、`debate-lifecycle.ts`（5）、**`editing-lifecycle.ts`（6、前回調査漏れ）**。
  - テスト: FE/BE 多数が `phase:N` 直書き（要 slug 置換・意図不変）。
- **Implications**: 変更は機械的だが広域。`phase.test.ts`（順序判定網羅）と各 lifecycle テストを回帰の安全網にする。

### PhaseSlug 型の既存性
- **Context**: slug 識別子を新設する必要があるか。
- **Findings**: `PhaseSlug`（stakeholders/personas/interviews/chapters/debate/editing）が既存。`PhaseDef` も `slug` を保持済み。
- **Implications**: 新型導入は不要。`Phase`（数値）を撤廃し `PhaseSlug` を唯一の識別子に昇格。順序は `PHASE_DEFS` 配列位置に一元化。

### FE/BE の型分離方針
- **Context**: slug 値は Firestore を介した FE/BE 契約。共通化するか。
- **Sources Consulted**: steering `structure.md`（型は FE=models / BE=types で分離、共通は Functions 定義）。
- **Findings**: 既存の `PhaseStatus` 等も FE/BE 個別定義で運用。
- **Implications**: 共通パッケージ化はしない。FE `PhaseSlug` と BE 側 slug ユニオンをそれぞれ定義し、値の一致は規約＋テストで担保。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| slug 識別＋配列順序（採用） | 同一性を `PhaseSlug`、順序を `PHASE_DEFS` 位置に一元化 | 挿入が O(1)、番号散在を根絶、自己文書化 | 型波及が広い | 既存 `PhaseSlug`/routing に整合 |
| 数値のまま＋挿入時リナンバリング（不採用） | 現状維持 | 変更ゼロ | 挿入のたび全更新＋移行 | topic-fact-base で再発 |
| enum 外の独立フラグ（不採用） | 一部フェーズだけ特別扱い | 局所的 | 均一性が壊れる | steering の均一フェーズ思想に反する |

## Design Decisions

### Decision: `Phase`（数値）を撤廃し `PhaseSlug` を唯一の識別子にする
- **Context**: 番号が順序と同一性を兼ね、挿入で全体がずれる（R1, R2）。
- **Alternatives Considered**: 1) 数値維持＋リナンバリング 2) slug 併存で段階移行。
- **Selected Approach**: `Phase` 型を削除。`PhaseDef` から `phase` を除き `key: PhaseSlug` と状態別ラベルを保持。順序は `PHASE_DEFS` の配列位置。
- **Rationale**: `PhaseSlug`/routing が既に slug 前提。実データ無しで後方互換不要。
- **Trade-offs**: 型変更が FE/BE・テストに広く波及（機械的）。
- **Follow-up**: `phase.test.ts` を配列順序ベースに書き換え、順序判定の同値性を担保。

### Decision: 順序ユーティリティ（`phaseOrder`/`nextPhase`/`isLastPhase`）を導入
- **Context**: 数値比較（`<`/`>`）と `phase===6` 直書き、承認の `phase:N` ジャンプを排除（R2, R3, R4, R5）。
- **Selected Approach**: `PHASE_DEFS` 位置から `phaseOrder(key)`、`nextPhase(key)`、`isLastPhase(key)` を導出。`phaseLogicalState` は order 比較に、承認は `nextPhase` に置換。
- **Rationale**: 順序ロジックを一箇所へ集約。中央ディスパッチャではなく順序データの共有（steering 準拠）。
- **Trade-offs**: なし（純粋な内部整理）。

### Decision: データ移行は行わずリセット（Option C）
- **Context**: 本番直結・エミュレータ無し・進行中実データ無し（R6）。
- **Selected Approach**: 既存 topic は破棄。`topicFromFirestore` に number/slug 両対応の後方互換は入れない。新規は先頭 slug（`stakeholders`）で作成。
- **Rationale**: 実データが無く、移行スクリプト・後方互換は過剰。
- **Trade-offs**: 万一残存する旧トピックは破棄対象（表示不整合を許容）。
- **Follow-up**: 切替後、旧 topic の削除を手動で実施。

## Risks & Mitigations
- 番号依存の更新漏れ → grep インベントリ（gap-analysis.md）をチェックリスト化し、`tsc` の `Phase` 参照エラーで残存を検出。
- 挙動の非互換（ゲート・ラベル文言の差異）→ ラベル文言を現行と一字一句同一に保ち、既存テストを slug 化して通過を完了条件にする（R8）。
- FE/BE の slug 値不一致 → 両側の slug 集合一致を検証するテストを追加。

## References
- gap-analysis.md（本 spec）— 番号依存インベントリ
- steering `structure.md` — 型の FE/BE 分離方針
