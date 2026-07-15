# Research Log: reset-phase-write-decoupling

## Summary

- **Discovery scope**: Extension（既存システムの局所修正）。外部依存の調査は不要。統合点は Firestore の `topics/{id}` ドキュメントの `phase` / `phaseStatus` フィールドと、それを純粋導出する `phaseLogicalState`。
- **Key finding**: フェーズ表示不整合の唯一の実欠陥は `resetEditingRun`（functions/src/pipeline/editing/editing-lifecycle.ts:32-37）が現在フェーズを見ずに定数 `phase='editing', phaseStatus='not_started'` を書くこと。`startEditingRun` が既に `editing/running` を書くため、この phase 書き込みは冗長かつ有害。
- **Design decision**: リセット操作は「現在フェーズを書き換えない（データ破棄のみ）」へ統一。フェーズ遷移は起動（`start*`/`generate*`）・前進（`advancePhase`）・明示停止のみが所有する。

## Research Log

### Topic 1: フェーズ状態の導出経路（なぜ「討論完了」表示になるか）
- **調査**: `phaseLogicalState`（src/lib/models/phase/phase.ts:26-36）は `(phase, phaseStatus)` と対象フェーズのみから表示状態を導出する純粋関数。`target < current → 'approved'`（通過済み）。
- **含意**: `phase` を前方（editing）へ書き換えると、下流の全フェーズが機械的に「通過済み(approved)」＝完了表示へ変換される。UI 側の分岐ではなく、フェーズポインタの値が原因。修正は phase 書き込み側で行うのが正しい。
- **Source**: phase.ts, phase.constants.ts, GeneratePersonaPage.svelte, GenerateDebatePage.svelte（`generated`/`approved` の分岐）

### Topic 2: リセット操作の対称性（誰が phase を書くか）
- **調査**: `resetStakeholders` / `resetPersonas`(createTopic) / `resetChapters` / `resetDebate` はいずれも phase を書かない。`resetEditingRun` のみが書く。FE `personasStore.resetPersonas`（stores/personas.svelte.ts:88）も書くが未配線かつ createTopic 版と矛盾。
- **含意**: 「リセットは phase を書かない」が既存の支配的パターン。`resetEditingRun` を同パターンへ揃えるのが最小・自然。`personasStore.resetPersonas` は重複解消（削除一本化）が妥当。
- **Source**: createTopic.svelte.ts, debate-lifecycle.ts:127-132, editing-lifecycle.ts:32-37, stores/personas.svelte.ts:88-99

### Topic 3: 編集やり直しフローの最終状態保証
- **調査**: 全 `resetEditing` 呼び出しは直後に起動処理を伴う（FactResearch/Chapters/Debate/Persona の各カスケードは `generate*`/`start*` を最後に、EditingPage.regenerate は `startEditing` を）。`startEditingRun`（editing-lifecycle.ts:19-26）は `editing/running`＋新 runId を書く。
- **含意**: `resetEditingRun` から phase 書き込みを外しても、編集やり直しの最終状態 `editing/running` は `startEditing` が保証。reset 単独で phase を残す必要のあるフローは存在しない。
- **Source**: 5画面の regenerate ハンドラ、editing-lifecycle.ts

### Topic 4: 順序依存の回避策
- **調査**: FactResearchPage:60 / GenerateChaptersPage:63 / GenerateDebatePage:51 に「起動処理を最後に呼ぶことで phase が戻る（reset の phase 書込より後勝ち）」コメント。GeneratePersonaPage はコメント無しだが同じ順序に依存。
- **含意**: reset が phase を書かなくなれば「後勝ち」で戦う相手が消え、順序依存は解消。コメントは偽になるため撤去。呼び出し順序自体は無害なので維持してよい。
- **Source**: 各画面 regenerate ハンドラ

### Topic 5: 回帰面（テスト）
- **調査**: `resetEditingRun` の phase 書き込みを直接検証する単体テストは無い。api の `resetEditing` onCall テスト（functions/src/tests/api/editing.test.ts:141-159）は `resetEditingRun` をモックしており phase を検証しない。`personasStore.resetPersonas` は src/tests/stores/personas.test.ts:180 が phase 書き込みを検証。
- **含意**: editing 側は回帰リスク低。personas store 側はテスト更新が必要。R1 を固定する新規単体テスト（resetEditingRun が phase を書かないこと）を追加すると良い。
- **Source**: functions/src/tests/api/editing.test.ts, src/tests/stores/personas.test.ts

## Architecture Pattern Evaluation

| 案 | 概要 | 採否 |
|---|---|---|
| A 最小除去 | resetEditingRun の phase 除去＋コメント撤去＋store 重複解消のみ | 不採用（残存フラッシュ・順序回避策・命名乖離が残る＝部分対応） |
| B クライアント先頭確定 | 各再生成先頭で beginPhase(target,running) を先出し | 不採用（runId 世代窓・途中失敗滞留・クライアント破棄オーケストレーションが残る） |
| C ガード集約 | フェーズ書込を1ユーティリティへ集約し前方書込を実行時禁止 | 不採用（中央ディスパッチャ化。ステアリング抵触） |
| **D サーバ権威の原子的再生成** | 各起動 onCall が phase確定＋自層/下流破棄＋生成/投入を原子所有。クライアントは1回呼ぶだけ | **採用（徹底解消）** |

**D 採用理由**: 前方ジャンプ・残存フラッシュ・順序依存・runId 世代窓・途中失敗滞留・クライアント破棄オーケストレーションを単一の構造変更でまとめて排除できる。`phase-generation-server-authority`（running/generated はサーバ権威）を再生成の下流破棄まで自然に拡張する。代償はサーバ変更の広さ（4 onCall）と破棄のサーバ移設だが、onCall 単位に分割して固定できる。

## Design Decisions

1. **サーバ権威の再生成（D）**: 各起動 onCall（generateFactResearch / startPersonaGeneration / generateChapters / startDebate）が「phase=target/running＋新 runId（update 1回）→ 自層＋下流破棄 → 生成/投入」を**この順序で**所有。初回生成は破棄 no-op で同一経路。必要なのは順序であってトランザクションではない。フェーズ確定は単一文書の update で原子的。トランザクションは使わない（実際にレースが観測された場合のみ最小範囲を後から追加）。
2. **リセットは phase 中立**: `resetEditingRun` は phase を書かない。下流破棄は `clearEditedArtifact` を直接使い、無参照なら削除。
3. **クライアント破棄オーケストレーションの廃止**: 各再生成ハンドラは単一サーバ操作の呼び出しへ単純化。未使用化するクライアント reset ラッパ・`resetEditing` onCall は参照確認のうえ削除。
4. **R5 は削除一本化**: 未配線・矛盾の `personasStore.resetPersonas` を削除。
5. **命名是正の全件処置（R7）**: phase を書く名の乖離（`setPhaseStatus`→`setPhase`、`updateDebatePhaseStatus`→`beginDebateRun`、`markInterviews*`）を改名。非 phase 系の乖離は「現状維持＋docstring 根拠」または別仕様切り出しを処置表で明示（design.md 参照）。

## 命名・責任乖離の全件監査（FE＋BE）

phase/status を書く乖離（**是正**）: `resetEditingRun`, `personasStore.resetPersonas`, `setPhaseStatus`, `updateDebatePhaseStatus`, `markInterviewsStarted/Stopped`。
名前が広い副作用を隠す非 phase 系（**現状維持＋根拠 or 別仕様**）: `fetchSourceContents`（fetch が書く）, `runIntroOutroStep`/`regenerateChapter`/`runInterviewCore`（局所名がラン全体を終端確定）, `discardChaptersFrom`（discard が status を pending 化）, `clearEditorial`（clear が再初期化）, `publishDebate`（publish が personaCount 再計算）, `save`（save が削除・巻き戻し）, `resetChapters`（chapters 名で chapterAnalysis も削除・文書化済み）。

## Risks

- **破棄のサーバ移設**: personas サブコレクション等の一括削除はバッチ化。大規模時のタイムアウト注意。
- **削除・改名の波及**: クライアント reset ラッパ・`resetEditing`・phase 非書込化した `resetEditingRun` の削除、`setPhaseStatus`/`updateDebatePhaseStatus` の改名は、いずれも実参照を grep で網羅確認してから一括実施。フォールバックは「削除せず docstring 是正＋副作用のみ除去」。
- **変更の広さ**: 4 起動 onCall の原子化。タスクは onCall 単位で分割し各々テストで固定する。
