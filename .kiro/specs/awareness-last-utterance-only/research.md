# Research & Design Decisions: awareness-last-utterance-only

## Summary
- **Feature**: `awareness-last-utterance-only`
- **Discovery Scope**: Extension（既存の気づき検出モデル `belief-awareness-remodel` への挙動制約追加）
- **Key Findings**:
  - 気づき検出は score/mode 評価と同一の1回の LLM 呼び出し（`evaluateEngagement`）に相乗りしており、変更は当該関数のプロンプト＋後処理に閉じる。新規ファイル・型・永続経路の変更は不要。
  - リスナー限定（Req2）は一括評価 `evaluateEngagements` が直前話者を除外済みでほぼ成立。フォールバック（指名話者の個別評価）経路の端ケースだけ、`evaluateEngagement` 内のガードで堅牢化する。
  - 帰属（Req3）と発生源限定（Req1）は、プロンプトで「発生源は直前発言のみ」と制約しつつ、reception が反応した**発言ID（`sourceTurnId`）を直前発言IDと突合**し、一致時のみ採用・話者を導出、不一致は drop することで決定的に担保できる。話者IDでの突合は同一話者の過去発言への反応を取りこぼすため、発言粒度で突合する。

## Research Log

### 気づき検出の現在の入力と発生源
- **Context**: 「直前の発言のみから発生させる」ための変更点を特定する。
- **Sources Consulted**: [persona-agent.ts `evaluateEngagement`](../../../functions/src/agents/persona-agent.ts#L377)、[engagement.ts](../../../functions/src/pipeline/debate/engagement.ts)、[awareness.ts](../../../functions/src/pipeline/debate/awareness.ts)、[prompt-formatters.ts](../../../functions/src/utils/prompt-formatters.ts)。
- **Findings**:
  - 検出入力は `recentTurns = turns.slice(-8)`。score/mode と気づき検出が同じ会話ブロックを共有し、`awarenessDetectionNote` は「会話を聞いて」＝提示8発言のどれからでも発生可。
  - 後処理（[persona-agent.ts:422-429](../../../functions/src/agents/persona-agent.ts#L422)）で self は既に `sourcePersonaId=null` 正規化済み。reception は LLM が会話中の「(ID:...)」から拾う。
  - 気づきは同一 persona 参照で in-memory に追記され、同ターンの発言生成へ即反映される（[awareness-same-turn.test.ts](../../../functions/src/tests/pipeline/debate/awareness-same-turn.test.ts)）。この結合は本変更でも維持する。
- **Implications**: `recentTurns`（8）ウィンドウは score/mode 用に温存し、気づきの「発生源」だけを末尾1発言に限定する。プロンプト文言＋後処理2点（ガード・帰属正規化）で実現。

### リスナー限定とフォールバック経路
- **Context**: 「話者自身から気づきを発生させない」（Req2）の成立条件を確認する。
- **Sources Consulted**: [engagement.ts:115](../../../functions/src/pipeline/debate/engagement.ts#L115)（`assessTargets` が `lastSpeakerId` を除外）、[step.ts:162](../../../functions/src/pipeline/debate/step.ts#L162) / [step.ts:241](../../../functions/src/pipeline/debate/step.ts#L241)（`evaluateEngagementWithFallback` に `speakerSelection.personaId` を渡す）。
- **Findings**:
  - 一括評価は直前話者を対象外にするため、通常フローでは話者自身は気づき検出されない。
  - フォールバックは選択（指名）話者を個別評価する。指名話者が直前話者と一致する端ケースでは `evaluateEngagement` が直前話者に対して走り得る。
- **Implications**: 追加のLLM評価は設けない（Req2.3）。`evaluateEngagement` 内に「直前発言の話者＝評価対象なら awareness を null」のガードを1つ置き、経路に依存せず Req2 を担保する。

### ファシリテーター発言が直前の場合
- **Context**: 直前発言がファシリテーター（`personaId` なし）のとき reception の帰属をどうするか。
- **Sources Consulted**: [prompt-formatters.ts `formatTurns`](../../../functions/src/utils/prompt-formatters.ts#L45)（ファシリテーターターンは `personaId` 無し）、[persona-agent.ts engagementSchema](../../../functions/src/agents/persona-agent.ts#L362)（`sourcePersonaId` は nullable）。
- **Findings**: reception の source はペルソナIDを想定。直前がファシリテーターだと該当ペルソナが存在しない。`sourcePersonaId` は既に nullable。
- **Implications**: 帰属正規化を「reception の `sourcePersonaId := 直前ターンの personaId ?? null`」の単一規則にすれば、ファシリテーター直前時は自然に null になり、リスナー（ペルソナ）は依然として気づきを得られる。ガードもファシリテーターでは発火しない（`personaId` 未定義）ため整合する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: プロンプトのみ | `awarenessDetectionNote` を「発生源は直前発言のみ」に書き換え | 最小変更・追加コストなし | 追従がLLM依存／reception 帰属の取り違えを防げない | 単独では Req3 を保証できない |
| B: プロンプト＋後処理・話者ID突合 | A に加え、ガード（Req2）と reception の `sourcePersonaId` を直前話者へ正規化 | 追加呼び出しゼロ・score/mode 据え置き | 同一話者が直前と過去の両方に登場すると、過去発言への反応も「直前話者一致」で通過（1.2 の穴） | 話者粒度の限界 |
| B': プロンプト＋後処理・発言ID突合（採用） | B の突合を話者IDから**発言ID（`sourceTurnId`）**へ変更。一致時のみ採用・話者導出、不一致は drop | 発言粒度で 1.2 をコード強制・同一話者の過去発言反応も検出・追加呼び出しゼロ | engagement 会話に発言識別子提示＋schema に一時 `sourceTurnId` が要る | 変更は1関数に収まる |
| C: 気づき検出を別呼び出しに分離 | 直前発言のみを入力にした専用LLM呼び出し | 混入余地が物理的に最小 | 毎ターン2回評価＝コスト増（Req2/コスト方針と矛盾） | 不採用 |

## Design Decisions

### Decision: プロンプト制約＋発言ID突合の後処理（Option B'）を採用
- **Context**: 気づきの発生源を直前発言に限定しつつ（Req1）、score/mode とコストを変えない（Req4/Req2.3）。
- **Alternatives Considered**:
  1. Option A（プロンプトのみ）— 帰属・リスナー限定・1.2 を保証できない。
  2. Option B（話者ID突合）— 同一話者が直前と過去に登場すると過去発言への反応を取りこぼす（1.2 の穴）。
  3. Option C（別呼び出し分離）— コスト増で方針違反。
- **Selected Approach**: `evaluateEngagement` 1関数のみを変更。(1) `awarenessDetectionNote` を「発生源は直前発言のみ、reception は `sourceTurnId` に反応した発言を記す」に書き換え、(2) engagement 会話に発言識別子（実 turnId またはウィンドウ内ローカル序数）を提示、(3) `engagementSchema.awareness` を `sourcePersonaId` 申告から `sourceTurnId` へ差し替え、(4) 後処理で直前発言話者＝評価対象なら null（ガード）、reception は `sourceTurnId` を直前発言IDと突合し一致時のみ採用して `sourcePersonaId` を直前ターン話者から導出、不一致は drop。`recentTurns`（8）は score/mode の文脈として温存。
- **Rationale**: 「直前発言のみ」を話者粒度でなく発言粒度でコード強制でき、同一話者の過去発言への反応も検出・drop できる。追加LLM呼び出しゼロでコスト中立、既存の永続・巻き戻し・発言消費は無改変。
- **Trade-offs**: engagement 会話に発言識別子の提示が要り、LLM が直前発言IDを誤申告する残余リスクは残る（意味判断はプロンプト依存）。テストで監視。
- **Follow-up**: 発言識別子は実 turnId（nanoid）だと転記ミスしやすいため、ウィンドウ内ローカル序数を提示し序数→turnId をコード解決する実装を優先検討。

## Risks & Mitigations
- 「直前発言のみ」への LLM 追従不足で過去発言から気づきが漏れる — reception は `sourceTurnId` を直前発言IDと突合して不一致を drop することで発言粒度でコード強制。残る意味判断はプロンプト明確化とテストで軽減。
- LLM が直前発言IDを誤申告し、正当な直前反応が drop される／過去反応が通過する — 発言識別子をローカル序数で提示し転記負荷を下げる。テストで採用・drop 双方を検証。
- 既存の同ターン反映結合（awareness-same-turn）の破壊 — 追記・永続経路は無改変。当該テストを維持し回帰確認する。

## References
- [belief-awareness-remodel requirements](../belief-awareness-remodel/requirements.md) — 気づきモデルの上流定義（本仕様が制約を追加する対象）。
