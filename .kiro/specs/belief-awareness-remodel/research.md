# Research & Discovery — belief-awareness-remodel

拡張向け（light）ディスカバリ。信念モデル固有の統合点のみを対象（キャッシュ・計測は下流 `debate-llm-cost-reduction` の範疇で本specでは扱わない）。

## Summary
- 初期信念は既に interview が `beliefs: [{ version: 0, content: initialBelief, createdAt }]` として書き込む（[api/interviews.ts:50](functions/src/api/interviews.ts#L50)）。→ **`beliefs[0]` をそのまま固定初期信念として流用**でき、interview 側の変更は不要。
- 討論中の信念上書きは `reply.beliefChange` → [step.ts:110 applyBeliefChange](functions/src/pipeline/debate/step.ts#L110) → `persona.beliefs[]` 追記（最新versionが現在信念）。可視化は `persona.beliefs[].triggeredByTurnId`/`changeSummary` を管理画面が参照。
- engagement は [evaluateEngagements](functions/src/pipeline/debate/engagement.ts#L38) が非話者を `evaluateEngagement`（[persona-agent.ts:378](functions/src/agents/persona-agent.ts#L378)）で個別評価し `saveEngagements` で永続。除外話者は `evaluateEngagementWithFallback`。
- 発言生成 [generateTurn](functions/src/agents/persona-agent.ts#L212) が `beliefChange`（`opinion_change`/`partial_acceptance`）を出力。`executeTurn`（turn.ts）が return し step が適用。closing は [turn.ts:344](functions/src/pipeline/debate/turn.ts#L344) `getLatestBelief`、事後コメントは [post-debate-comments.ts:27](functions/src/pipeline/debate/post-debate-comments.ts#L27) `getLatestBelief`。

## 現状コード地図（変更対象）
| 領域 | ファイル | 現状 | 変更 |
|---|---|---|---|
| 型(BE) | `types/persona.types.ts` | `Belief{id,version,content,createdAt,changeType?,changeSummary?,triggeredByTurnId?}` | `Belief` を初期信念のみにスリム化、`AwarenessForFirestore` 追加、`Persona.awarenesses?` |
| 型(BE) | `types/debate.types.ts` / `turn.types.ts` | `BeliefChangeEvent`、`Engagement{personaId,score,mode,intentSummary}` | `AwarenessEvent`、`Engagement` に `awareness?`、`executeTurn` 返却から `beliefChange` 除去 |
| 永続 | `pipeline/debate/belief.ts` | `applyBeliefChange`/`getLatestBelief`/`rollbackBeliefsForRemovedTurns` | → `awareness.ts`（`appendAwareness`/`getInitialBelief`/`rollbackAwarenessesForRemovedTurns`）に置換 |
| 生成 | `agents/persona-agent.ts` | system に最新信念を埋込、generateTurn が beliefChange 出力、engagement は score/mode/intent | 初期信念を主軸、engagement が awareness 検出、generateTurn は awareness 消費のみ |
| 傾聴永続 | `pipeline/debate/engagement.ts` | 評価と saveEngagements のみ | 評価結果の awareness を話者選択前に永続 |
| 適用 | `pipeline/debate/step.ts` | `applyBeliefChange(reply)` | 除去（awareness 永続は engagement へ） |
| 導出 | `pipeline/debate/turn.ts` / `post-debate-comments.ts` / `agents/facilitator-agent.ts` | `getLatestBelief` を finalBelief に | 「初期信念＋awareness」から導出 |
| 可視化(FE) | `persona.types.ts` / `personas.svelte.ts` / `Phase5Debate.svelte` / `Phase6Editing.svelte` | `BeliefForFirestore`/`BeliefChangeType`、beliefs[].changeSummary を描画 | 型スリム化＋`AwarenessForFirestore`、描画を awareness ベースへ。`InterviewItem`（初期信念）不変 |

## 設計決定
- **持ち回り**: `beliefs` は初期信念の保持に据え置き（interview 出力そのまま）。討論の追記先は新フィールド `awarenesses: AwarenessForFirestore[]`。
- **命名**: 新規永続型は `AwarenessForFirestore`（メモリ規約 `*ForFirestore`）。BE 既存 `Belief` 命名の *ForFirestore 統一は chapter-type-unification の範疇として触らない。
- **気づきの発生＝傾聴段階（engagement）**、消費＝発言生成。永続は engagement フローが話者選択の前に実施（step からは外す）。
- **同一 persona 参照の共有**: `appendAwareness` は engagement に渡された persona オブジェクトの in-memory `awarenesses` を更新し、同じ参照が話者選択→`generateTurn` に流れることで直前の気づきが発言に反映される（既存 `applyBeliefChange` の in-memory 更新と同型）。
- **プロンプト構成**: 初期信念は system（不変・主軸）、awareness は user（揮発）へ。これは信念モデルとして自然な分離であり、結果として下流 `debate-llm-cost-reduction` のキャッシュ適用を容易にする（本specはキャッシュを実装しない）。
- **移行**: なし。既存データはクリア・再生成（前方互換のみ）。

## Risks
- 気づき検出を engagement に足すことで engagement の主判定（score/mode）が乱れないか（二重タスク）。→ 検出は軽量・低干渉に留め、要件7でモデル自体の品質を確認。
- 「立場を反転させない（stance不変）」をプロンプトでどこまで担保できるか。→ 人格分離（7.2）で確認。
- 気づきの発生頻度は現状 beliefChange 同様に低い想定（毎発言では出ない）。
