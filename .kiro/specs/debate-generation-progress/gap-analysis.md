# Gap Analysis: debate-generation-progress

要件（requirements.md）と既存コードの差分を分析し、設計フェーズの判断材料を提示する。決定はしない。

## 1. 現状の把握（関連資産）

### 討論生成パイプライン（`functions/src/pipeline/debate/`）
- **ステップ駆動**: 「1ステップ＝1 Cloud Task」。`debate-orchestrator.ts` `advanceDebate` が毎回 Firestore から状態を再構築（`loadStepContext`）し、`decideNextStep`（純関数）で次段を決める。再入可能・冪等。
- **ターン実行**: `step.ts` `executeTurn`（L166）が1ターンを担う。順序は **evaluateEngagements（先頭 L212）→ 介入 → 話者選択 → generatePersonaTurn**。freeze（章末+1）は `executeFinalResponseTurn`（L109）へ委譲し、`evaluateEngagements` を**スキップ**（L135-137）。
- **評価と永続**: `engagement.ts` `evaluateEngagements` が全非話者を評価し、`history.<turnId>`（`turnId = chapterTurns[last].id`＝直前確定ターン, L116）に保存。`persistDetectedAwareness` で awareness を話者選択前に永続。`readReusableEngagement`（L68）が同一 turnId の既存評価を再利用（リトライ時の二重評価回避）。
- **ターン追記**: `turn.ts` `addTurn`（L56）が**単一トランザクション**で `turns.length === expectedTurnIndex`（frontier）＋ `runId` 世代照合を確認し、`turns: [...currentTurns, buildTurnRecord(...)]` を1件追記。棄却時は副作用なし。`generatePersonaTurn`（L177）が draft生成→stop確認→`verifyAndReviseDraft`（fact-check）→`addTurn` を1呼び出しで完結。
- **停止検出**: 生成の途中で `isDebateActive` を確認し、停止なら `skipped`（ターン未書き込み）。既存の中断ハンドリングとして流用可能。

### データ形状
- `DebateTurn`（`functions/src/types/turn.types.ts` L22）: `id, speakerType, personaId?, content, createdAt, speechMode?, engagementScore?, fromQueue?, targetPersonaId?, targetedBy?, searchUsed?, searchQueries?, factCheck?`。**`status` フィールドは無い**。
- FE ミラー `TurnForFirestore` / `Turn`（`src/lib/models/turn/turn.types.ts` L29/42）: 一部フィールド（targetedBy/searchUsed 等）は未ミラーで既にラフ。**`status` 無し**。
- FE 購読 `chapters.svelte.ts`（L18-29）: `chapters` を onSnapshot し `raw.turns` をそのまま `Turn[]` に変換。`turns` は全章 flatMap の derived（L11）。**turns 配列に入れたものは FE にそのまま流れる**。

### 状態再構築の要（重大）
- `debate-state.ts` `getDebateState`（L11）は **`turns` 配列の全要素**から speakCount・silenceMap・lastSpeakerId・queuedIntents 生存判定を導出する。
- `addTurn` の frontier（L73）と `decideNextStep`（`chapterTurns.length`）は **`turns.length` を期待位置**として使う。
- `id` は `addTurn` のトランザクション内で `nanoid()` 生成（L60）。**コミット前は id が確定しない**。

## 2. 要件↔資産マップ（ギャップ）

| 要件 | 主な対象資産 | ギャップ種別 |
|---|---|---|
| **R1** 評価タイミング再構成（末尾評価・freeze特例撤回・不変条件保持） | `step.ts`（executeTurn L212 の順序 / executeFinalResponseTurn L135）, `engagement.ts`（save/readReusable/persistAwareness）, `speaker-selection.ts`, open ステップ | **Constraint**（既存順序・reuseキー） + **Unknown**（先頭境界の評価位置・末尾評価の冪等性） |
| **R2** 各ターンへの status 付与（generating/fact-checking/evaluating/終了） | `DebateTurn`/`NewTurnFields`/`buildTurnRecord`, `addTurn`, FE `turn.types`＋`chapters.svelte.ts` | **Missing**（status フィールド・書き込み経路） + **Constraint**（id はコミット時生成） |
| **R3** 生成中ターンの残留防止・状態整合 | `getDebateState`, `addTurn` frontier, `decideNextStep`, `debate-lifecycle`（stop）, `completeChapterStep`（clear）, enqueue/frontier | **Constraint**（turns.length が load-bearing） + **Missing**（未完ターンの clean-up） |

### 中心的なギャップ（R2/R3 の核心）
「生成中（generating/fact-checking）のターンを **どこに置くか**」が全体を左右する。`turns.length` が frontier、`getDebateState` が全ターンを数えるため、**未確定ターンを素朴に `turns[]` へ入れると、frontier・speakCount・silence・lastSpeaker・LLMコンテキストが一斉に壊れる**。

## 3. 実装アプローチの選択肢

### Option A: 生成中ターンを `chapter.turns[]` の実要素として持つ
要件文言（3段階すべて turn に書く）に最も忠実。
- **必要な波及**: `turns[]` を読む全消費者に「確定のみ」フィルタを通す — addTurn frontier / decideNextStep / getDebateState（speakCount・silence・lastSpeaker）/ queuedIntents 生存判定 / generatePersonaTurn・engagement・intervention の LLM コンテキスト切り出し / getLastTargetPersona / FE derived turns。加えて id をコミット前に発番、コミットは「追記」ではなく「末尾の in-place 更新」へ変更。
- **Trade-offs**: ✅ 要件に直訳／単一の turns 表現。❌ load-bearing な `turns.length` 前提を全面改修、フィルタ漏れ1箇所で**サイレントな状態破壊**。frontier/トランザクション意味論の再設計が必要。
- **Effort: L / Risk: High**

### Option B: 生成中ターンを chapter doc の別フィールド `pendingTurn` に持つ（推奨）
`chapter.pendingTurn = { id, personaId, status: 'generating' | 'fact-checking' }`。コミット時に `turns[]` へ追記（現行どおり）し `status: 'evaluating'` を付与、`pendingTurn` をクリア。反応評価完了で当該確定ターンの status を終了へ。
- **必要な波及**: `DebateTurn` に `status` 追加（evaluating/終了のみ）、`pendingTurn` の set/clear、FE は `pendingTurn` ＋ `turns` を読む。**`turns[]` は確定のみのまま**なので frontier・getDebateState は不変。
- **Trade-offs**: ✅ frontier/状態の load-bearing 前提を触らない（R3.1/3.2 をほぼ自然に満たす）／別 `generationProgress` ドキュメントは作らず chapter doc 内に収める（ユーザ決定と整合）。❌ 表現が2系統（pending と committed）／generating・fact-checking は厳密には「turns[] の要素」ではない（chapter doc 上の per-turn 情報として持つ）。
- **Effort: M / Risk: Medium**

### Option C: 段階導入（フェーズ分割）
- **Phase 1**: R1（末尾評価・freeze特例撤回）＋ 確定ターンの `evaluating`/終了 status のみ（Option B の committed 側）。最終ターン awareness とそのターン自身の後処理シグナルを低リスクで先に届ける。
- **Phase 2**: `pendingTurn`（generating/fact-checking）を追加。
- **Trade-offs**: ✅ 最もリスクの高いプレースホルダ機構を切り離して段階検証。❌ 2段階の計画・レビューが必要。
- **Effort: 合計 M-L / Risk: Low→Medium**

## 4. 推奨（設計フェーズへ）

> **決定（2026-07-11）**: **Option B** を採用する（`chapter.pendingTurn` で生成中ターンを別フィールドに持ち、コミット時に `turns[]` へ移して `evaluating` を付与）。design は Option B を前提に進める。Phase 分割（Option C）は design 時に規模を見て判断する。

- **推奨アプローチ**: **Option B**（必要なら Option C で Phase 分割）。ユーザ決定「status を各ターンに・別 progress doc は作らない・3段階」を満たしつつ、`turns.length` を軸にした frontier/状態再構築の load-bearing 前提を保全できる。Option A は要件に直訳的だが、フィルタ漏れによるサイレント破壊のリスクが高く非推奨。
- **キー決定（design で確定）**:
  1. 生成中ターンの置き場所（B の `pendingTurn` か、A の turns[] 内か）と、それに伴う id 発番タイミング。
  2. R1 の末尾評価を `executeTurn` のどこに差し込むか（`finalizeCommittedTurn` 直後）、および話者選択が直前ターンの永続評価を読む形（`readReusableEngagement` の活用）。
  3. `evaluating` の status を終了へ落とす主体とタイミング（同一ステップ末尾か、次ステップ冒頭か）。
- **Research Needed**:
  - **先頭境界**: オープニング（ファシリテーターターン）への反応評価をどこで行うか（open ステップ末尾 or 最初のペルソナターン）。ファシリテーターターンにも status/末尾評価を課すか。
  - **冪等性**: 末尾評価がリトライ・frontier 敗者で二重実行されないこと。`history.<turnId>` の reuse キーとの整合。
  - **未完 clean-up**: 停止（`isDebateActive` 経由 skipped）・ステップ失敗・frontier 敗者・章末で `pendingTurn`（or 未確定 turns[] 要素）が残らない保証。既存 skipped パスに pending クリアを足す設計。
  - **FE ミラー範囲**: `TurnForFirestore` への `status` 追加と（B なら）`ChapterForFirestore` への `pendingTurn` 追加。描画（Skeleton）は本 spec 対象外だが型ミラーは必要（[feedback-mirror-firestore-shape]）。
  - **コスト**: 末尾評価復活による章あたり約 +1 sweep は requirements で許容済み。実測は不要だが design で明記。

## 5. 総合

- **総合 Effort**: M–L（Option B）／ L–XL（Option A）
- **総合 Risk**: Medium（Option B）／ High（Option A）
- 最大のリスク源は R2/R3 の「生成中ターンの置き場所」。ここを Option B で `turns.length` 前提から隔離できれば、残りは既存パターン（トランザクション追記・onSnapshot ミラー・skipped 中断）の延長で収まる。R1 の末尾評価移動は独立して価値があり、Phase 分割の第1段に適する。
