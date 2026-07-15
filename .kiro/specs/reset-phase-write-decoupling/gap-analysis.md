# Implementation Gap Analysis: reset-phase-write-decoupling

## Analysis Summary

- 本仕様の核心は「`resetEditingRun` が現在フェーズを見ずに定数 `phase='editing', phaseStatus='not_started'` を書き込む」という一点の欠陥であり、修正は phase 書き込み行の除去に集約される（新規コンポーネント不要）。
- `startEditingRun`（editing-lifecycle.ts:19-24）が既に `phase='editing', phaseStatus='running'` を書くため、編集やり直し（`resetEditing → startEditing`）の最終状態は保たれる。`resetEditingRun` の phase 書き込みは冗長。
- 副作用を吸収するための「起動処理を最後に呼んで後勝ちさせる」回避策コメントが3画面（fact-research / chapters / debate）に存在。修正後は前提が偽になるため撤去対象。
- FE `personasStore.resetPersonas`（personas.svelte.ts:88）も同型（reset が phase を書く）だが、実配線されておらず（テストのみ参照）、createTopic 版 `resetPersonas` と挙動が矛盾する重複。整理が必要。
- 影響範囲は極小・パターン既知。**Effort: S / Risk: Low**。

## 1. Current State Investigation

### フェーズ状態モデル（真実の源）
- `PHASE_DEFS`（src/lib/models/phase/phase.constants.ts）: `theme → fact-research → personas → chapters → debate → editing` の順序配列。配列順がフェーズ進行順の唯一の真実。
- `phaseLogicalState()`（src/lib/models/phase/phase.ts:26-36）: `(phase, phaseStatus)` と対象フェーズのみから表示状態を純粋導出。`target < current → approved`（通過済み）、`target > current → not_started`、`target === current → phaseStatus`。
  - **この関数が「前方へ書き換えられた phase」を機械的に『下流は通過済み(approved)』へ変換する**ため、`resetEditingRun` の前方ジャンプが「討論完了済み」表示に直結する。

### リセット操作の現状（対称性の破れ）
| 操作 | 場所 | phase/phaseStatus を書くか |
|---|---|---|
| `resetStakeholders` | createTopic.svelte.ts:150 | 書かない（deleteDoc のみ） |
| `resetPersonas`(createTopic) | createTopic.svelte.ts:155 | 書かない（delete のみ） |
| `resetPersonas`(**store**) | stores/personas.svelte.ts:88 | **書く**（`personas/not_started`）※未配線・重複 |
| `resetChapters` | createTopic.svelte.ts:161 | 書かない |
| `resetDebate` | debate-lifecycle.ts:127 | 書かない（付随データ破棄のみ） |
| `resetEditingRun` | editing-lifecycle.ts:32 | **書く**（`editing/not_started`）← 本命 |

### フェーズ遷移の所有者（既存で正しく機能）
- `startEditingRun`（editing-lifecycle.ts:19）: `editing/running` ＋新 runId。
- `startPersonaGeneration`（api/personas.ts:36）: `personas/running` ＋新 runId。
- `advancePhase`（createTopic.svelte.ts:34）: 次フェーズ／`not_started`。
- `setTopicPhaseStatus`（utils/topic-phase.ts）／`setPhaseStatus`（createTopic.svelte.ts:138）: 明示的なステータス書き込み。

### 回避策コメントの分布（順序依存）
- FactResearchPage.svelte:60 —「generateFactResearch を最後に呼ぶことで phase が fact-research へ戻る（各 reset の phase 書込より後勝ち）」
- GenerateChaptersPage.svelte:63 —「generateChapters を最後に呼ぶことで…後勝ち」
- GenerateDebatePage.svelte:51 —「startDebate を最後に呼ぶことで…resetEditing の phase 書込より後勝ち」
- GeneratePersonaPage.svelte:59-68 — コメントは無いが同じ順序（startPersonaGeneration を最後）に依存。**まさにこの画面で不具合が観測された。**

### テスト配置
- `resetEditingRun` の phase 書き込みを**直接検証する単体テストは無い**。api の `resetEditing` onCall テスト（functions/src/tests/api/editing.test.ts:141-159）は `resetEditingRun` をモックしており phase を検証しない → 回帰リスク低。
- `personasStore.resetPersonas` は src/tests/stores/personas.test.ts:180 が「(2, not_started) へ戻す」と phase 書き込みを検証 → R5 対応時に更新要。

## 2. Requirement-to-Asset Map

| Req | 対象アセット | ギャップ種別 | 内容 |
|---|---|---|---|
| R1 リセットは現在フェーズを書き換えない | `resetEditingRun`（editing-lifecycle.ts:34-36） | Constraint | phase/phaseStatus 書き込み行を除去。`clearEditedArtifact` は残す |
| R2 遷移は起動・前進が所有 | `startEditingRun`（既存） | 充足済み | 追加実装不要。編集やり直しの最終状態は startEditing が保証 |
| R3 下流が完了表示にならない | `phaseLogicalState` 経由の各画面 | 派生（実装なし） | R1 の結果として自動的に満たされる。検証テストを追加すると良い |
| R4 順序依存の回避策解消 | FactResearch:60 / Chapters:63 / Debate:51 のコメント | Constraint | 偽になったコメント・前提の撤去。順序自体は無害なので維持可 |
| R5 重複 resetPersonas 整理 | `personasStore.resetPersonas`（personas.svelte.ts:88）＋ test:180 | Missing/Constraint | 未配線・矛盾の解消。phase 書き込み除去 or メソッド削除＋テスト更新 |
| R6 回帰防止 | editing api テスト（モック）／personas store テスト | Unknown/低 | editing 側は影響なし。personas store テストは更新 |

## 3. Implementation Approach Options

### Option A: 最小除去（Extend existing）— 推奨
- `resetEditingRun` から phase/phaseStatus 更新（editing-lifecycle.ts:34-36）を削除し、`clearEditedArtifact` のみにする（`resetDebate` と対称化）。docstring の「編集フェーズを not_started にする」も実態に合わせて修正。
- 3画面の「後勝ち」コメントを撤去（順序は現状維持で無害）。
- `personasStore.resetPersonas` は phase 書き込みを除去、または未配線のため削除（createTopic 版へ一本化）。対応するテストを更新。
- **Trade-offs**: ✅ 変更が局所・パターン既知・回帰面が明快 ／ ❌ 「起動処理が phase 所有」という原則がコードから暗黙のまま（ガードは無い）。

### Option B: 所有権をガードで明示（Broader normalization）
- Option A に加え、フェーズ書き込みを1ユーティリティ（例: `writePhaseTransition`）へ集約し、「前方へは start/advance のみ許可」を実行時に保証する薄いガードを設ける。
- **Trade-offs**: ✅ 将来の再発を構造的に防止 ／ ❌ 中央集約はステアリング「過度な共通化・中央ディスパッチャを作らない」に抵触しうる。今回の1点欠陥に対して過剰。

### Option C: Hybrid
- 今回は Option A のみ実施し、再発防止のガード（Option B）は必要が生じた時点で別 spec に切り出す。
- **Trade-offs**: ✅ スコープを絞りつつ将来余地を残す ／ ❌ 追加判断を先送り。

## 4. Effort & Risk

- **Effort: S（1日未満）** — 実質は phase 書き込み1箇所の除去＋コメント/重複整理＋テスト更新。新規ファイル・新パターンなし。
- **Risk: Low** — `startEditingRun` が最終状態を保証するため編集フローは不変。`resetEditingRun` の phase を直接検証する単体テストが無く回帰面が狭い。唯一の注意点は R5 の personas store テスト更新。

## 5. Research Needed / 設計フェーズへ持ち越す判断

1. **R5 の方式**: `personasStore.resetPersonas` を「phase 書き込み除去」で残すか、未配線ゆえ「メソッドごと削除して createTopic 版へ一本化」するか。削除の場合はテスト（personas.test.ts:180 他）と型/公開 API の整合を確認。
2. **回避策コメントの扱い**: 順序（起動処理を最後に呼ぶ）自体を維持しコメントのみ撤去するか、順序前提が完全に不要になった旨を最小限注記するか。
3. **観測不能な残存フラッシュ（対象外だが要合意）**: 下流フェーズ（例: editing）から persona 画面へ戻って再生成する場合、リセット中は phase が下流のまま留まり、startPersonaGeneration まで下流表示が残る。R3 が対象とするのは「personas からの前方ジャンプ」であり、この後方滞留の是正（起動処理を先頭で呼ぶ／サーバ側で reset+start を原子的に行う 等）は本仕様スコープ外。設計で扱うか別 spec 化するかを判断。
4. **R3 検証テスト**: 「personas からの再生成で editing が書かれない」ことの回帰テストを追加するか。

## Recommendations for Design Phase

- **推奨アプローチ: Option A（最小除去）＋ R5 は「メソッド削除で一本化」**。ステアリングの「過度な共通化をしない」に沿い、ガード集約（Option B）は今回見送り。
- 設計で確定すべき鍵: (a) personasStore.resetPersonas を削除するか温存するか、(b) 回避策コメント/順序の最終形、(c) R3 回帰テストの有無、(d) 残存フラッシュ（研究項目3）を本 spec で触るか。
