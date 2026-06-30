# Research & Design Decisions

## Summary
- **Feature**: `discussion-point-standpoint-coverage`
- **Discovery Scope**: Extension（既存の討論パイプライン／ファシリテーター介入への拡張）
- **Key Findings**:
  - カバレッジ・ゲートは新規機構を作らずに実現できる。既存の「未提示論点リストを withhold して論点投入（選択肢2）を封じる」パターン（`intervention.ts:160` の `hasHighEngagement(engagements) ? [] : untouchedDiscussionPoints`）と同型で、「未発言の関連参加者が残る間は untouched を withhold する」だけでよい。後段でのLLM出力補正や content 捏造が不要になる。
  - 「発言済みペルソナ」の記録は `finalizeCommittedTurn`（`updateSpeakerStats` と同じ位置、`reply.personaId` 保持）に追加し、永続化は永続型からそのまま書く既存手段 `saveDiscussionPointStatuses(topicId, chapterId, state)` を用いる。`ProgressPatch`（章ドキュメントのPartial転送形）には載せない（型の一貫性＝ランタイム型とFirestore永続型を乖離させない方針）。
  - `DiscussionPointState` は `ChapterForFirestore` / `ChapterProgress` から参照され、resume 時に `debate-orchestrator.ts:142` で `state.discussionPoints` へ復元される。optional 集合2つの追加は後方互換で、欠損は空集合として扱える。

## Research Log

### 介入経路と論点投入の単一遷移点
- **Context**: 関連参加者をどのLLM呼び出しで判定し、どこで論点状態へ記録するか。
- **Sources Consulted**: `pipeline/debate/intervention.ts`（`tryIntervention` L101-208、`markIntroduced` 呼び出し L185）、`pipeline/debate/discussion-points.ts`（`markIntroduced` L31-46）、`agents/facilitator-agent.ts`（`generateOpening` L72-107、`evaluateTopicDrift` L109-141、`runInterventionCheck` L38-70）、`pipeline/debate/step.ts`（`performOpenStep` L274-）。
- **Findings**:
  - 論点が introduced 化される単一経路は `markIntroduced(state, index)`。介入では `tryIntervention` 内 L185、opening では open ステップから呼ばれる。`selectedDiscussionPointIndex` を返すのは `generateOpening` と介入評価（`interventionSchema`）の2つ。
  - したがって「関連参加者の判定」を新規LLM呼び出しを足さずに相乗りさせる先は、この2つの reply（`FacilitatorReply`）。`markIntroduced` に関連参加者を渡して introduced 論点へ記録すればよい。
- **Implications**: `FacilitatorReply` と `interventionSchema` / `generateOpening` の返却に `relevantPersonaIds?: string[]` を追加。`markIntroduced(state, index, relevantPersonaIds)` に拡張。

### カバレッジ・ゲートの実現方式（withhold パターン）
- **Context**: 「未発言の関連参加者が残る間は次論点へ進ませない」をどう強制するか。R2-5 のコードゲート。
- **Sources Consulted**: `intervention.ts:157-179`（no-target 経路の `driftPoints = hasHighEngagement ? [] : untouchedDiscussionPoints`）、`facilitator-agent.ts:124-131`（`hasPoints` による三択／引き戻し専用プロンプトの切替）、`discussion-points.ts:32`（`markIntroduced(undefined)` は no-op）。
- **Findings**:
  - 既存実装は「未提示論点リストを渡さない＝選択肢2（論点投入）を封じ、逸脱の引き戻し・見送りのみ可能にする」手法を既に持つ。LLM は渡されていない index を選べず、`markIntroduced(undefined)` は no-op。
  - これを流用すれば、「未発言の関連参加者が残る間は untouched を withhold」するだけで前進が構造的に不可能になる。後段でのLLM出力の破棄・content 捏造・コードによる target 選定が一切不要。
- **Implications**: ゲート＝候補リストの出し分け。`candidates = (hasHighEngagement || unheardRelevant.length > 0) ? [] : untouchedDiscussionPoints`（no-target）、persona-chain も同様に unheard 残存時は withhold。あわせて unheard の名前リストとカバレッジを criteria に渡し、引き戻し／見送りプロンプトを「未発言の関連参加者を1人引き込む」へ拡張。

### 発言済みペルソナの記録地点と永続化
- **Context**: 誰が当該論点で発言したかをいつ・どう記録し永続化するか。
- **Sources Consulted**: `step.ts`（`executeTurn` 通常ターン L189-267、`finalizeCommittedTurn` L77-105、`updateSpeakerStats`）、`turn.types.ts`（`ProgressPatch.discussionPointStatuses` L51-54）、`debate-orchestrator.ts:142`（resume 復元）、`discussion-points.ts:55-70`（`saveDiscussionPointStatuses`）。
- **Findings**:
  - `finalizeCommittedTurn` は `topicId` / `chapterId` / `state` / `reply.personaId` を保持し、`updateSpeakerStats`（speakCount 更新）を呼ぶ位置がある。ここで `recordSpeakerOnActivePoint(state, reply.personaId)` により現アクティブ論点の `spokenPersonaIds` を更新し、`saveDiscussionPointStatuses(topicId, chapterId, state)` で永続化できる。
  - `saveDiscussionPointStatuses` は `state.discussionPoints`（＝永続型 `DiscussionPointState[]` と同一）から `discussionPointStatuses` を書き出す既存手段で、Partial転送形を介さない。集合なので重複追加は no-op（冪等）。resume は `discussionPointStatuses → state.discussionPoints` で同型復元。
- **Implications**: 記録は `finalizeCommittedTurn` で行う。トレードオフは通常ターンごとに `discussionPointStatuses` 書き込みが1回増えること（介入経路 `step.ts:230` と同じ）。追記とは非原子だが、欠落時も resume で「未発言」と見なされ再引き込みされるだけで自己回復的。型の一貫性（ランタイム型＝Firestore永続型）を優先し、`ProgressPatch` には載せない。freeze 経路は記録任意。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 境界復元方式（旧A/B） | ターン列から論点境界を割り出し、以降の発言者を数える | スキーマ変更小（A） | 境界特定が困難・drift引き戻しで曖昧・直近20ターン窓で数え落とし | **棄却**（ユーザー判断） |
| 論点状態フラグ方式 | `DiscussionPointState` に発言済み／関連参加者の2集合を保持 | 状態が権威的・窓非依存・既存永続経路に相乗り | optional 2フィールド追加 | **採用** |
| ゲート=後段補正 | LLM出力（advance）をコードで破棄し bring-in へ変換 | — | content 捏造／target をコードが選ぶ／"ordering=LLM" 方針に反する | 不採用 |
| ゲート=候補 withhold | unheard 残存時は untouched を渡さず advance を構造的に封じる | 既存パターン流用・補正不要・自然な文面 | プロンプト拡張が必要 | **採用** |

## Design Decisions

### Decision: カバレッジは論点状態の2集合で表現し、ターン列からは導出しない
- **Context**: R1。「その論点で誰が立場を表明したか」を権威的に把握する必要がある。
- **Alternatives Considered**:
  1. ターン境界復元方式（旧A/B） — 間接・脆弱
  2. 論点状態に `spokenPersonaIds` / `relevantPersonaIds` を保持
- **Selected Approach**: `DiscussionPointState` に2つの optional 文字列配列を追加。`spokenPersonaIds` は発言コミット時に現アクティブ論点へ追加、`relevantPersonaIds` は論点投入時にファシリテーター reply から記録。
- **Rationale**: 状態が単一の権威的源泉になり、LLM へ渡す履歴窓やドリフト引き戻しの影響を受けない。既存 `discussionPointStatuses` の永続・復元経路に相乗りできる。
- **Trade-offs**: スキーマに2フィールド増。だが optional で後方互換、`introducedOrder` と同じ取り回し。
- **Follow-up**: 既存データ（集合欠損）で空集合フォールバックが効くことをテスト。

### Decision: 前進可否ゲートは「未提示論点リストの withhold」で構造的に強制する
- **Context**: R2-5。未発言の関連参加者が残る間は次論点へ進ませない。
- **Alternatives Considered**:
  1. LLM出力（advance）を後段でコード破棄し bring-in に変換 — content 捏造／target 選定が必要
  2. 未発言が残る間は untouched 候補を渡さず、advance を構造的に封じる
- **Selected Approach（2段ゲート）**: ①誘導＝介入評価に渡す未提示論点候補を `(hasHighEngagement || unheardRelevant.length > 0) ? [] : untouchedDiscussionPoints` とし、LLM に論点投入（選択肢2）を選ばせない。②強制＝unheard 残存時は `markIntroduced` 呼び出し前に LLM 返却の `selectedDiscussionPointIndex` をコードで undefined に落とす。`markIntroduced` は渡した候補ではなく state の untouched から index を解決するため、候補 withhold だけでは LLM が index を返すと advance してしまう（design レビュー Critical Issue 1）。同時に unheard の名前リストを criteria に渡し「未発言の関連参加者を1人引き込む」を促す。
- **Rationale**: ①は既存の高意欲ゲートと同型の手法。②が R2-5 の実体（前進阻止の保証）。後段での content 捏造やコードによる話者選定は不要のまま。"関連集合の決定=LLM(投入時)／前進可否=コード／引き込み先=LLM(毎回)" の分担に合致。
- **Trade-offs**: ゲートはプロンプトの引き込み判断と協調して働く。LLM が引き込みを選ばず見送った場合は前進せず次の評価機会へ持ち越す（cap が最終保証）。
- **Follow-up**: unheard 残存時に引き戻し専用プロンプトが「未発言者の引き込み」を確実に出すかを観測。

### Decision: bring-in の target 検証は「unheard 残存時のみ unheard 所属を必須」とする
- **Context**: R3-4。引き込み先が未発言の関連参加者であることを保証。
- **Selected Approach**: 候補 withhold によりLLM返却は index 無し（同論点）に限定される。unheard が残る状況では、返却された `targetPersonaId` が未発言の関連参加者集合に属することを検証し、属さなければ採用しない（その回は介入せず通常フローへ）。unheard が空（カバレッジ充足）の場合は従来どおり（引き戻し／advance）。
- **Rationale**: カバレッジ未充足の間は「同論点の介入＝未発言者の引き込み」と一意化でき、既発言者への振り直しを防げる。
- **Trade-offs**: カバレッジ未充足時に既発言者へ振り直したい正当ケースは抑止されるが、本仕様の目的（多様な立場の収集）に合致するため許容。
- **Follow-up**: 検証で弾いた場合に通常フロー継続で不都合がないか確認。

### Decision: `relevantPersonaIds` が空のときはゲート不活性（現行挙動）
- **Context**: ファシリテーターが関連参加者を特定できず空で返す場合の既定。R5-1（全員を一律に含めない）との整合。
- **Selected Approach**: 関連集合が空の論点では unheard も空となり、ゲートは発火しない（現行の介入挙動に等しい）。全参加者へのフォールバックはしない。
- **Rationale**: R5-1 を尊重し「全員強制」を避ける。ファシリテーターには関連参加者の明示を促すため、空は例外的想定。
- **Trade-offs**: 関連情報が無い論点はカバレッジ担保が効かない（現行どおり）。プロンプト品質で空返却を最小化する。
- **Follow-up**: 空返却の頻度を観測し、必要なら最低人数しきい等を別途検討。

## Risks & Mitigations
- 隣接2spec（`discussion-point-consolidation`／`facilitator-intervention-timing`）の判断軸（流れ最優先・過剰介入防止・chainLength の出尽くしシグナル）と衝突しうる — withhold ゲートと chainSignal 文面の調整で「未発言者優先 → それでも残らなければ前進」の順序を明示。回帰は既存結合テスト（`debate-parity` 等）で監視。
- LLM が引き込みを選ばず見送り続けると前進が遅れる — プロンプトで bring-in を強く促し、最終保証は既存 cap（`AGENDA_TURN_CAP_RATIO` 等）に委ねる。
- `relevantPersonaIds` の過小判定で本来聞くべき立場を漏らす — 毎介入で「立場を加えうる未登録者を追加のみ可（削除不可）」とする保険（R5-2）を任意で用意。

## References
- 既存仕様: `.kiro/specs/discussion-point-consolidation/`（アクティブ論点・出尽くし判定の土台）
- 既存仕様: `.kiro/specs/facilitator-intervention-timing/`（chainLength 計測・指名チェーン中の介入）
- 既存仕様: `.kiro/specs/facilitator-intervention-engagement-fix/`（介入ターン順序保証）
