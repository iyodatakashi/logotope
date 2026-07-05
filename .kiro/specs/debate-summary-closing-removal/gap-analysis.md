# Gap Analysis: debate-summary-closing-removal

## 1. 現状調査（Current State）

### 対象の所在（討論チェーン側・削除対象）
章まとめ・クロージングはいずれも**識別マーカーを持たない通常のファシリテーター発言**として章の `turns` に追記される。生成は専用のステップ段（`summary` / `closing`）から呼ばれる。

| 役割 | 生成呼び出し（削除対象） | ターンビルダー（削除対象） | エージェント（削除対象） |
|------|--------------------------|----------------------------|--------------------------|
| 章まとめ | [step.ts:460-468](functions/src/pipeline/debate/step.ts#L460)（`performSummaryStep` 内の生成ブロック） | [turn.ts:302-325](functions/src/pipeline/debate/turn.ts#L302) `generateChapterTransition` | [facilitator-agent.ts:246-269](functions/src/agents/facilitator-agent.ts#L246) `generateChapterSummary` |
| クロージング | [step.ts:485-493](functions/src/pipeline/debate/step.ts#L485)（`performClosingStep` 内の生成ブロック） | [turn.ts:328-354](functions/src/pipeline/debate/turn.ts#L328) `appendClosingTurn` | [facilitator-agent.ts:216-244](functions/src/agents/facilitator-agent.ts#L216) `generateClosing`（討論側） |

- 呼び出し関係は一方向で閉じている：`generateChapterTransition` / `appendClosingTurn` は `step.ts` からのみ、`generateChapterSummary` / `generateClosing`（討論側）は `turn.ts` からのみ使用（grep で確認）。削除の波及は局所的。
- 生成は `speakerType: 'facilitator'` の素のターンとして永続（`personaId` なし・`speechMode` なし・フラグなし）。

### 進行・終端の骨格（**維持対象**）
- `StepKind = 'open' | 'turn' | 'summary' | 'closing' | 'comments'`（[step.types.ts:5](functions/src/types/step.types.ts#L5)）。
- 次段判定 [debate-orchestrator.ts:106-108](functions/src/pipeline/debate/debate-orchestrator.ts#L106)：章末で `isLastChapter ? closing : summary`。
- ステップ本体 [step.ts:453-497](functions/src/pipeline/debate/step.ts#L453)：`performSummaryStep` / `performClosingStep` はいずれも **生成ブロックに加え** `updateChapterStatus(...,'completed')` + `deleteDiscussionPointStatuses(...)` を実行する。
- 章遷移：`summary` の後に orchestrator が**次章 `open`** を、`closing` の後に**終端 `comments`** を enqueue（dispatch 部）。これらが討論の `generated` 到達を担う。

### 依存・消費者（下流）
- **なし（削除対象の発言に依存する下流は存在しない）**：`debate-state`（[debate-state.ts](functions/src/pipeline/debate/debate-state.ts)）は `speakerType==='persona'` のみ集計しファシリテーター発言を無視。事後コメント・編集パス・信念変化・ファクトチェック・engagement・論点追跡はいずれもペルソナ発言基準で、章まとめ/クロージング発言を識別・参照していない。FE（[Phase5Debate.svelte](src/lib/features/admin/topic-detail/debate/Phase5Debate.svelte)）は本数が減るだけで破綻しない。

### 別系統（**非対象**・混同注意）
- 編集フェーズの読み物クロージング＝ [intro-closing-agent.ts](functions/src/agents/intro-closing-agent.ts) の `generateClosing`（`editedIntroClosing` 成果物）。`facilitator-agent.ts` の同名 `generateClosing`（討論側・削除対象）と**名称衝突**。取り違え厳禁。

## 2. 要件 → 資産マップ（Gap タグ）

| 要件 | 関連資産 | Gap |
|------|----------|-----|
| R1 章まとめ生成停止 | `performSummaryStep` 生成ブロック / `generateChapterTransition` / `generateChapterSummary` | Constraint（生成のみ除去、ステップは残す） |
| R2 クロージング生成停止 | `performClosingStep` 生成ブロック / `appendClosingTurn` / `generateClosing`(討論側) | Constraint（同上） |
| R3 進行・終端の不変 | `updateChapterStatus` / `deleteDiscussionPointStatuses` / orchestrator dispatch・decideNextStep | Constraint（ステップ枠組みを維持） |
| R4 既存データ・下流非影響 | 過去 `turns`・下流各処理 | なし（下流は削除対象に非依存。マイグレーション不要） |
| R5 読み物クロージング分離 | `intro-closing-agent` / `editedIntroClosing` | なし（別系統・不変） |
| R6 未使用ロジック整理 | 上記4関数＋import＋関連テスト | Constraint（デッドコード除去とテスト更新） |

**Research Needed**: なし（挙動・依存は本調査で確定済み）。

## 3. 実装アプローチ

### Option A: 生成呼び出しのみ除去（最小・ステップ枠組みは維持）
`performSummaryStep` / `performClosingStep` から生成ブロックのみ削除し、両者を `completed` 化＋論点クリーンアップのみに。`generateChapterTransition` / `appendClosingTurn` / `generateChapterSummary` / 討論側 `generateClosing` と、`turn.ts:4` / `step.ts:47-48` の import を削除。`summary` / `closing` の StepKind・decideNextStep・dispatch・taskKey はそのまま。
- ✅ 差分が局所・低リスク。進行/終端ロジック（R3）に一切触れない。
- ✅ 下流非依存のため回帰面が狭い。
- ❌ `performSummaryStep` と `performClosingStep` が「ほぼ同一の薄いステップ」として残る（`summary`→次章 open / `closing`→comments の違いは orchestrator 側にあるため両ステップ本体は実質同一化）。

### Option B: `summary`/`closing` ステップの統合（構造整理）
生成除去後に同一化する2ステップを単一の「章終了」ステップ種別へ統合。decideNextStep の `summary`/`closing` 分岐を廃し、次段（次章 open か comments か）は dispatch 側の `isLastChapter` で分岐。
- ✅ StepKind と分岐が簡潔化し、意図（章まとめ/締めの生成）を持たない段が概念的にも消える。
- ❌ `StepKind` union・`NextStep` 型・decideNextStep・dispatch・taskKey・`enqueueChapterEnd` に波及。テスト改修が広い。R3（進行不変）への回帰検証が必須。
- ❌ 単章/複数章・最終応答ターン経路（`finalResponse`）の分岐を統合後も正確に保つ必要がある。

### Option C: ハイブリッド（段階）
Phase 1 で Option A（挙動変更を安全に確定）→ Phase 2 で Option B の統合を任意実施。
- ✅ 挙動（発言削除）を先に確定し、構造整理はリスクを見て後追い。
- ❌ 中間状態で「ほぼ同一の2ステップ」が一時的に残る。

## 4. 工数・リスク

| 項目 | Effort | Risk | 根拠 |
|------|--------|------|------|
| Option A | **S（1–3日）** | **Low** | 呼び出し2箇所除去＋デッド関数4つ削除＋import整理。進行/終端は不変。下流非依存。テストは主に mock/期待ターン列の更新。 |
| Option B | **M（3–7日）** | **Medium** | StepKind/decideNextStep/dispatch/taskKey に波及。単章・finalResponse 経路の回帰検証が必要。 |
| Option C | A + B の合算 | Low→Medium | 段階導入でリスク分散。 |

### 更新が必要なテスト（既知）
`tests/pipeline/debate/turn.test.ts`（`generateChapterTransition`/`appendClosingTurn` の describe・mock：L40,77,820-860）、`step.test.ts`（mock：L30-31）、`debate-parity.test.ts`（L46-47：期待ターン列に summary/closing を含む可能性）、`debate-step-idempotency.test.ts`（L42-43）、`intervention-gate.integration.test.ts`（L44-45）、`inline-fact-check.flow.test.ts`（L39-40）、`facilitator-agent.test.ts`（`generateChapterSummary`/討論側 `generateClosing` の直接テスト）。

## 5. 設計フェーズへの推奨

- **推奨アプローチ**: **Option A を主軸**（低リスクで R1–R6 を満たす）。同一化する2ステップの**統合（Option B）は任意の後続**とし、本スペックで一気に行うかは設計で判断（やるなら Option C の段階導入）。
- **主要な設計判断**:
  1. `summary`/`closing` の StepKind を残すか統合するか（A vs B）。
  2. 削除対象の関数・import・テストの具体的な線引き（討論側 `generateClosing` と編集側 `generateClosing` の取り違え防止を設計に明記）。
  3. 過去データ（既存の章まとめ/クロージング発言）は不変で放置する方針の明記（R4）。
- **Research to carry forward**: なし（本調査で挙動・依存関係は確定）。回帰確認は既存テスト群（parity/idempotency/intervention/fact-check flow）の緑維持で担保する。
