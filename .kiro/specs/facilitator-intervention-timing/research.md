# Research & Design Decisions: facilitator-intervention-timing

## Summary
- **Feature**: `facilitator-intervention-timing`
- **Discovery Scope**: Extension（既存の討論チェーン駆動パイプラインへの介入タイミング修正）
- **Key Findings**:
  - 介入が起きない直接原因は `step.ts` `executeTurn` の `if (!targetPersona)` ゲート。ペルソナ間指名（`targetedBy='persona'`）が続く間、論点ずれ介入が一度も評価されない。
  - `evaluateTopicDrift` 本体は「指名済みターンでも上書きしうる」設計（`facilitator-agent.ts` L107 コメント）。介入ロジックの新規作成は不要で、呼び出しゲートの緩和＋判断軸の拡張が主作業。
  - 指名チェーンの病理は「高活性なのに発展性のない応酬（無理やり答え合う往復）」であり、既存の drift（逸脱）でも stall（低エンゲージメントの落ち着き）でも捕捉できない第3の判断軸。drift の criteria に「出尽くし＝発展性のない応酬」を加えることで対応する。
  - 連続指名チェーン長は永続ターン列末尾から決定論的に算出でき、`countPersonaTurnsSinceFacilitator` と同じ純関数パターンで実装・テストできる。外部依存・新ライブラリ・新定数は不要。

## Research Log

### 介入ゲートの所在と発火経路
- **Context**: 「指名チェーン中に介入が起きない」の機序を特定する。
- **Sources Consulted**: `functions/src/pipeline/debate/step.ts`（`executeTurn`）、`intervention.ts`（`tryIntervention` / `tryTopicDriftIntervention` / `tryStallIntervention`）、`agents/facilitator-agent.ts`（`evaluateTopicDrift` / `evaluateStallIntervention`）。
- **Findings**:
  - `executeTurn`: `targetPersona = getLastTargetPersona(state.turns)` が末尾指名を返すと、`if (!targetPersona)` ブロックを丸ごとスキップし `selectSpeaker` が指名先を強制選択する。
  - `tryIntervention` は `shouldEvaluateIntervention(countPersonaTurnsSinceFacilitator(chapterTurns), cooldown)` を満たすときだけ drift→stall をカスケード評価する。
  - drift: `evaluateTopicDrift` は「未完了論点あり」のとき三択（引き戻し／次論点投入／介入しない）で、プロンプトが「流れ最優先」「深まっている最中は介入しない」に寄っている。
  - stall: `tryStallIntervention` は `hasHighEngagement(engagements)` が true なら発火しない。盛り上がった指名チェーンは高 engagement になりやすく、stall は元々抑止される。
- **Implications**: 主機構は drift をチェーン中に評価させること。stall の高意欲ゲートは触らない（盛り上がりチェーンには stall は不向き）。終了保証は別途「安全弁」で担保する。

### 連続指名チェーン長の算出
- **Context**: R3 の計測を既存パターンで実装できるか。
- **Sources Consulted**: `intervention.ts` `countPersonaTurnsSinceFacilitator`、`turn.ts`（`targetedBy`/`targetPersonaId` の永続化）、`debate-orchestrator.ts` `hasUnansweredTargetAtEnd`。
- **Findings**:
  - 末尾ターンから遡り `speakerType==='persona' && targetedBy==='persona' && targetPersonaId` が連続する数を数えれば良い。ファシリテーター発言・指名なし発言・`targetedBy==='facilitator'` で連鎖は途切れる。
  - 既に `hasUnansweredTargetAtEnd`（章末 +1 判定）が末尾指名を見ており、同じ永続ターン列から決定論的に計算する前例がある。
- **Implications**: 純関数 `countConsecutivePersonaTargets(chapterTurns)` を `intervention.ts` に追加。`__tests__` 同様 `intervention.test.ts` でユニットテスト可能。

### 既存の冪等性・世代分離・freeze との関係
- **Context**: 介入ターン追加で並走・再入の保証を壊さないか。
- **Sources Consulted**: `turn.ts` `addTurn`（`expectedTurnIndex` 照合・`runId` 世代照合）、`intervention.ts` `persistInterventionTurn`、`step.ts` freeze 分岐、`debate-orchestrator.ts` `decideNextStep`。
- **Findings**:
  - 介入ターンは `persistInterventionTurn` → `addTurn` を通り、frontier 照合と `runId` 照合で単一勝者に絞られる。既存経路の再利用で冪等・世代分離は自動的に維持される。
  - freeze（章末 +1 最終応答）分岐は `executeTurn` の独立ブロックで、介入・話者選択・キュー更新を一切行わない。ここに手を入れなければ R7.3 は自動充足。
- **Implications**: 介入は必ず `persistInterventionTurn` を経由する。freeze 分岐は不変。

### ペルソナ過剰指名の抑制余地（R6）
- **Context**: 指名頻度を発言生成側で下げられるか。
- **Sources Consulted**: `agents/persona-agent.ts`（`targetingGuide`、`targetBiasNote`、`questionInstruction`）、`turn.ts` L242-244（自己/不正 target 無効化）。
- **Findings**:
  - 既に「直接関係しなければ targetPersonaId を指定しない」指示（`targetingGuide`）と「直前話者への再 target は確認・反論時のみ」注意（`targetBiasNote`）が存在。R6.1/6.2 は既存指示の強化、R6.3 は実装済み。
- **Implications**: R6 はプロンプト強化に限定。スキーマ・制御フロー変更は不要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: drift 経路の活性化＋判断軸拡張（採用） | 呼び出しゲートを緩め drift をチェーン中に評価。判断軸に「出尽くし（発展性のない応酬）」を加え、チェーン長をソフトシグナル化。終了保証は既存ハードキャップ | 既存ロジック流用・最小変更・完全な内容駆動・新定数なし | drift プロンプトの判断軸拡張が効くかは実地検証が必要 | ユーザー方針に合致 |
| B: 専用「チェーン打ち切り介入」LLM を新設 | drift/stall と別経路で必ず発火させる | 発火確実・専用文面 | 新規 LLM 関数・プロンプト・テスト増。過剰介入リスク | 不採用（drift の判断軸拡張で代替） |
| C: ターン数による強制介入（安全弁） | 連続指名長が閾値以上で強制介入 | 終了が確実 | drift が「発展性あり」と判断してもターン数で機械的に割り込む＝ユーザーが明確に否定。drift の判断を不完全な前提で上書きしてしまう | 不採用（終了保証は既存ハードキャップで足りる） |

## Design Decisions

### Decision: 介入トリガーを判別共用体で表現し `tryIntervention` を一元化
- **Context**: 「指名なし通常」「指名チェーン中」で評価すべき経路が異なるが、介入ターンの永続化・キュー積みは共通。
- **Alternatives Considered**:
  1. 経路ごとに別関数を作る — 永続化ロジックが重複し単一所有が崩れる。
  2. `tryIntervention` に `trigger` 判別共用体を渡し、内部で評価経路を選ぶ — 永続化は単一所有のまま。
- **Selected Approach**: `trigger: { kind: 'no-target' } | { kind: 'persona-chain'; chainLength }` を `tryIntervention` に渡す。`no-target`=従来（drift→stall、`hasHighEngagement` 抑止維持）、`persona-chain`=drift のみ（未完了論点を常に渡し、chainLength をシグナル化）。
- **Rationale**: 介入永続化（`persistInterventionTurn`・`addQueuedIntents`・論点 introduced 更新）の単一所有を保ちつつ、評価経路だけ分岐できる。steering の「過度な共通化をしない」に反しない（中央ディスパッチャではなく、1機能内の自然な判別）。
- **Trade-offs**: ✅ 重複なし・テスト容易 / ❌ `tryIntervention` のシグネチャが1段複雑化。

### Decision: forced 安全弁を撤去し、drift の判断を完全化して信頼する
- **Context**: 当初は連続指名長の閾値で強制介入（forced）する安全弁を設計したが、ユーザーから「drift が論点ずれでないと判断したならスルーでよい。ターン数で機械的に割り込むのは不自然」との指摘。
- **Key Insight**: forced が必要に見えたのは drift の判断が**不完全**だったため。高エンゲージメント時、drift は `hasHighEngagement` で論点リストを空にされ「逸脱のみ」を見ており、「出尽くし（発展性のない応酬）」を判断できなかった。判断軸に出尽くしを加えれば drift は逸脱＋出尽くしの**完全な判断者**になり、その「介入不要」は信頼できる。
- **Alternatives Considered**:
  1. forced 強制介入＋`TARGET_CHAIN_SAFETY_LIMIT` を残す — drift の判断を不完全な前提で上書きし、機械的になる。
  2. forced を撤去し、drift の判断軸を拡張（逸脱＋出尽くし）＋chainLength をソフトシグナルに。終了保証は既存ハードキャップ。
- **Selected Approach**: 2 を採用。`evaluateTopicDrift` に `{ chainLength? }` のみ追加し、criteria に「発展性のない応酬（出尽くし）」を加える。`forced` トリガー・`TARGET_CHAIN_SAFETY_LIMIT` 定数は作らない。
- **Rationale**: 完全に内容駆動になり、ユーザーの哲学（機械的でない）に一致。新定数ゼロで見通しが良い。暴走時の終端は既存ハードキャップ（`TURN_CAP_RATIO`/`AGENDA_TURN_CAP_RATIO`/`MAX_TURNS`）が保証済み。
- **Trade-offs**: ✅ 最小surface・完全内容駆動 / ❌ チェーン打ち切りの確実性は drift のプロンプト品質に依存（ただし終端はハードキャップが保証）。
- **Follow-up**: 高活性・オンテーマ・低発展性のチェーンで drift が出尽くしを拾えるか実地検証。

## Risks & Mitigations
- drift が出尽くしを拾えず依然チェーンが続く — 暴走時の終端は既存ハードキャップ（`TURN_CAP_RATIO`/`AGENDA_TURN_CAP_RATIO`/`MAX_TURNS`）が保証。drift criteria・chainLength シグナルは実地で調整可能。
- 介入過多で議論が細切れになる（R2.5 と緊張） — クールダウンを維持し、本題が新たに深まっている最中は見送り可能な判断を drift に残す。
- 既存テスト（`debate-parity` / `intervention` / `decide-next-step`）の回帰 — 介入は `persistInterventionTurn` 経由で冪等経路を再利用、`no-target` 経路・freeze 分岐は不変に保つ。

## References
- `functions/src/pipeline/debate/step.ts` — `executeTurn` 介入ゲート（本修正の中心）
- `functions/src/pipeline/debate/intervention.ts` — `tryIntervention` / cooldown / chain 計測の追加先
- `functions/src/agents/facilitator-agent.ts` — `evaluateTopicDrift`（判断軸拡張＝逸脱＋出尽くし・chainLength シグナル）
- `functions/src/agents/persona-agent.ts` — 指名指示（R6 プロンプト強化）
- `functions/src/constants/debate.constants.ts` — 既存閾値の参照元（新定数は追加しない）
