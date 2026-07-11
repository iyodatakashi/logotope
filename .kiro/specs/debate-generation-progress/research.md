# Research & Design Decisions: debate-generation-progress

## Summary
- **Feature**: `debate-generation-progress`
- **Discovery Scope**: Extension（既存の討論生成パイプラインの改修）
- **Key Findings**:
  - `evaluateEngagements` は既に `readReusableEngagement`（engagement.ts:68）で「同一 turnId の既存評価があれば LLM 再評価せず、awareness も再検出しない」冪等機構を持つ。これにより「末尾で評価 → 次ターン先頭は読むだけ」を**追加コストなし**で実現できる（最小改修）。
  - `turns.length` が frontier（turn.ts:73 / decideNextStep）で、`getDebateState`（debate-state.ts）は全ターンを数える。未確定ターンを `turns[]` に入れると frontier・speakCount・silence・lastSpeaker が壊れる → **Option B（`chapter.pendingTurn` 別フィールド）**を採用。
  - ターン id は `addTurn` のトランザクション内で `nanoid()` 生成（turn.ts:60）。pendingTurn は id を**生成開始時に発番**し、コミットで同 id を turns[] へ移す。
  - `loadStepContext` は毎ステップ personas（awarenesses 含む）を再ロードするため、前ステップで永続した awareness は次ステップの話者生成に自然に反映される（in-memory by-ref の裏技は不要になる）。

## Research Log

### 末尾評価への移行を「最小改修」で実現できるか
- **Context**: R1 は「発言ターン末尾で当該ターンへの反応を評価し次ターンへ渡す」。素朴には executeTurn のパイプライン順序を大改造することになる。
- **Sources Consulted**: `engagement.ts`（evaluateEngagements L101 / readReusableEngagement L68 / saveEngagements L39 / persistDetectedAwareness L17）, `step.ts`（executeTurn L166 / executeFinalResponseTurn L109）。
- **Findings**:
  - 現状 `evaluateEngagements` は各ペルソナについて `readReusableEngagement(topicId, chapterId, personaId, turnId)` を呼び、既存永続があれば **LLM 再評価せず reuse**（L122-125）。reuse 時は awareness を null で返し再検出しない（L94 のコメント）。`saveEngagements` は mergeFields で冪等。
  - よって「turn N の末尾で `evaluateEngagements`（keyed to N）を実行して永続」しておけば、turn N+1 の先頭に残る既存の `evaluateEngagements`（keyed to N）呼び出しは**純粋な読み取り**に化ける（再計算・awareness 再検出なし）。
- **Implications**:
  - R1 の実装は「executeTurn 等の**末尾に** end-eval（コミット済みターンへの反応評価）を1つ足す」で足りる。既存の start 側呼び出しは自己修復リード兼フォールバックとして残す。
  - 計算量は非最終ターンでは不変（計算がステップ1つ前へ移るだけ）。最終ターンにのみ +1 sweep（要件で許容済み）。

### 生成中ターンの置き場所（frontier 保全）
- **Context**: R2 は各ターンに status。generating/fact-checking はコミット前段階。
- **Findings**: `turns.length` は frontier 期待位置（turn.ts:73, decideNextStep）。`getDebateState` は turns 全要素から speakCount/silence/lastSpeaker/queue 生存を導出。未確定要素を混ぜると全て破綻。
- **Implications**: 生成中は `chapter.pendingTurn`（turns[] 外）に持つ（Option B）。turns[] は確定のみを維持し frontier/状態を不変に保つ。`evaluating` のみ確定ターンの `status` に載せる。

### クラッシュ/リトライ時の未完・スタック回避
- **Context**: R3。end-eval 中のクラッシュで turn が `evaluating` のまま、または pendingTurn 残留。
- **Findings**: 既存の停止検出（`isDebateActive` → skipped, turn.ts:241）は「未コミットで中断」の実績パターン。ステップは毎回 Firestore から再構築するため、次ステップは前ステップの残骸を観測できる。
- **Implications**: 各ステップ先頭で「直前確定ターンの反応が未永続なら評価し、`evaluating` を終了へ」を行う（この処理は話者選択に必要な入力取得と同一なので追加負担が小さい）。章末ステップも最終ターンに対して同処理を行う。pendingTurn は commit・停止・失敗・章末でクリアする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: turns[] に生成中ターンを実要素で持つ | 要件文言に直訳 | 単一の turns 表現 | `turns.length` 前提を全消費者で改修、フィルタ漏れでサイレント破壊 | 非採用（High risk） |
| **B: `chapter.pendingTurn` 別フィールド** | 生成中を別フィールド、確定時 turns[] へ移送 | frontier/状態不変、影響局所 | 表現2系統（pending/committed） | **採用** |
| C: 段階導入 | R1+evaluating を先、pendingTurn を後 | リスク最小化 | 2フェーズ計画 | design では単一フェーズで進め、規模拡大時に分割 |

## Design Decisions

### Decision: 末尾評価は「end-eval 追加」で実装（順序大改造をしない）
- **Context**: R1 の末尾評価。
- **Alternatives Considered**:
  1. executeTurn の順序を「選択→生成→末尾評価」に再構成し、start 側呼び出しを削除。
  2. start 側呼び出しを残し、コミット後に end-eval を追加（既存 reuse 機構が二重計算を防ぐ）。
- **Selected Approach**: 2。コミット済みターンへの end-eval を executeTurn / executeFinalResponseTurn / performOpenStep の末尾に追加。start 側 `evaluateEngagements` は reuse により読み取りへ退化しつつ、フォールバック（前ステップ未永続時の再計算）と自己修復を担う。
- **Rationale**: 既存 `readReusableEngagement` の冪等性を活用し、パイプライン順序・介入・quietStreak 判定のセマンティクスを保ったまま最終ターンをカバーできる。
- **Trade-offs**: ✅ 影響局所・回帰リスク小。❌ 概念上「評価は end」だが start 側呼び出しコードが読み取りとして残る（コメントで意図を明示）。
- **Follow-up**: 最終ターン・freeze・open の end-eval が漏れなく走ること、reuse により二重 awareness 検出が起きないことをテストで確認。

### Decision: 生成中ターンは `chapter.pendingTurn`、`evaluating` は確定ターン status
- **Context**: R2/R3。frontier 保全と per-turn status の両立。
- **Selected Approach**: `chapter.pendingTurn = { id, personaId, status: 'generating' | 'fact-checking' }`。コミットで同 id を turns[] へ追記し `status: 'evaluating'` を付与、pendingTurn をクリア（同一トランザクション）。end-eval 完了で当該ターン status を終了（フィールド削除）。
- **Rationale**: turns[] を確定のみに保ち `turns.length` 前提を不変化。別 `generationProgress` ドキュメントは作らず chapter doc 内に収める（ユーザ決定）。次の発言者は pendingTurn.personaId で表現（nextSpeakerId 不要）。
- **Trade-offs**: ✅ frontier/状態不変、影響局所。❌ pending と committed の2表現を消費側が結合して読む。
- **Follow-up**: pendingTurn の停止/失敗/敗者/章末クリアと、`evaluating` スタックの自己修復。

## Risks & Mitigations
- **end-eval 中のクラッシュで turn が `evaluating` スタック** — 次ステップ（章末含む）先頭で「直前ターン反応の未永続を評価し status を終了」する自己修復を入れる。
- **frontier 敗者が pendingTurn を stale 書き込み** — pendingTurn は advisory。確定は frontier ガードで1タスクのみ。コミット時に pendingTurn をクリアして収束。確定ターン status 更新は世代（runId）ガード付きトランザクションで行い、敗者の上書きを弾く。
- **FE 型ミラーの漏れ** — `TurnForFirestore`/`ChapterForFirestore` に status/pendingTurn を追加（[feedback-mirror-firestore-shape]）。描画は対象外だが型は整合させる。
- **facilitator ターンの扱い混線** — status/pendingTurn は persona ターンのみ。facilitator（open/intervention）ターンは直接コミットし、end-eval（反応評価）だけ対象とする。

## References
- 既存 spec: `debate-llm-cost-reduction`（freeze skip 決定の改訂元）, `belief-awareness-remodel`（傾聴段階検出の不変条件）, `awareness-last-utterance-only`（source=turns 末尾・追加 LLM 評価なし）。
- 主要コード: `functions/src/pipeline/debate/{engagement,turn,step,debate-state,debate-orchestrator}.ts`, `functions/src/types/{turn,chapter}.types.ts`, `src/lib/stores/chapters.svelte.ts`, `src/lib/models/{turn,chapter}/*.types.ts`。
