# Gap Analysis: awareness-last-utterance-only

## 分析サマリー

- **変更範囲は単一関数 `evaluateEngagement`（[persona-agent.ts:377-439](../../../functions/src/agents/persona-agent.ts#L377)）にほぼ閉じる**。気づき検出は score/mode 評価と同一の1回の LLM 呼び出しに相乗りしており、その入力は `recentTurns = turns.slice(-8)`（直近8発言）、検出指示は `awarenessDetectionNote`。「直前の発言のみを発生源にする」制約はこの関数のプロンプトと後処理に加えるだけで成立する。
- **Requirement 2（リスナー限定）は既存構造でほぼ満たされている**。一括評価 `evaluateEngagements` は `assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId)` で直前話者を除外済み（[engagement.ts:115](../../../functions/src/pipeline/debate/engagement.ts#L115)）。フォールバック経路 `evaluateEngagementWithFallback`（[step.ts:162](../../../functions/src/pipeline/debate/step.ts#L162) / [step.ts:241](../../../functions/src/pipeline/debate/step.ts#L241)）が選択話者を個別評価するため、そこで直前話者が対象になり得る端ケースだけ、`evaluateEngagement` 内に「直前発言の話者＝評価対象なら気づきなし」のガードを1つ足せば堅牢になる。
- **Requirement 3（帰属の一貫性）はコードで確定できる**。発生源を直前発言に限定すると reception の sourcePersonaId は必ず直前発言の話者。現状は LLM が会話中の「(ID:...)」から拾う（[persona-agent.ts:426](../../../functions/src/agents/persona-agent.ts#L426)）が、直前発言の話者IDでコード正規化すれば LLM の取り違えを排除できる。
- **Requirement 4（非干渉）は自然に満たしやすい**。score/mode が参照する `recentTurns`（8発言）ウィンドウと判定基準は据え置き、気づき検出の「発生源」だけを直前発言に絞る。既存の気づき抑制文（同意・言い換え・既出の繰り返しを記録しない）はそのまま残す。
- **新規ファイル・データモデル変更・永続経路の変更は不要**。`AwarenessForFirestore` / `AwarenessEvent` 型、`appendAwareness`・`persistDetectedAwareness`・巻き戻し（[awareness.ts](../../../functions/src/pipeline/debate/awareness.ts)）はそのまま使う。

## Requirement → Asset マップ

| 要件 | 既存資産 | 状態 |
|---|---|---|
| Req1 発生源を直前の発言のみに限定 | `evaluateEngagement` の `recentTurns`（[persona-agent.ts:384](../../../functions/src/agents/persona-agent.ts#L384)）＋ `awarenessDetectionNote`（[persona-agent.ts:395](../../../functions/src/agents/persona-agent.ts#L395)）。プロンプトは現状「会話を聞いて」＝提示した8発言のどれからでも発生し得る | **Missing/Constraint**: 「気づきは会話の最後の1発言（直前の発言）に対してのみ発生。それ以前は文脈理解のためだけに読む」への検出指示の書き換え。過去ターンは score/mode 用の文脈として残す |
| Req2 リスナー限定（話者自身から発生させない） | 一括評価は直前話者を除外済み（[engagement.ts:115](../../../functions/src/pipeline/debate/engagement.ts#L115)）。フォールバックは選択話者を個別評価 | **Constraint**: 構造上ほぼ満たすが、フォールバックの端ケース向けに `evaluateEngagement` 内で「直前発言者＝評価対象なら awareness を null」ガードを追加（追加LLM評価は設けない＝Req2.3） |
| Req3 帰属の一貫性（reception source＝直前話者 / self は null） | 気づきの後処理正規化（[persona-agent.ts:422-429](../../../functions/src/agents/persona-agent.ts#L422)）。self は既に sourcePersonaId=null に正規化済み | **Reuse/Missing**: reception の sourcePersonaId を直前発言の話者IDで上書き正規化する後処理を追加 |
| Req4 score/mode・既存抑制への非干渉 | `recentTurns`（8）ウィンドウ、score/mode 判定基準、抑制文（同意・言い換え・既出の繰り返し）はすべて既存 | **Reuse**: ウィンドウ・基準・抑制文を据え置き、検出の発生源スコープだけ変更 |

## 「直前の発言」の識別

`evaluateEngagement` に渡る `turns` の末尾が直前の発言。turn 生成側 `generateTurn` には既に `lastTurn = recentTurns[recentTurns.length - 1]`（[persona-agent.ts:245](../../../functions/src/agents/persona-agent.ts#L245)）の前例があり、同型で `evaluateEngagement` 側にも直前発言を取り出せる。プロンプトでは `formatTurns` の各行が `[名前(役割)(ID:...)]: 内容` 形式なので、末尾行が直前発言＝発生源として指し示せる。

## 実装アプローチ

### Option A: プロンプトのみで発生源を限定
`awarenessDetectionNote` を「気づきは提示した会話の**最後の1発言（直前の発言）**に対してのみ発生させる。それ以前の発言は直前発言を理解するための文脈として読むだけで、発生源にはしない」に書き換える。`recentTurns`（8）はそのまま提示。
- ✅ 変更が最小（プロンプト文言のみ）、score/mode ウィンドウを一切触らない
- ✅ 追加LLM呼び出しゼロ（1回評価に相乗りのまま＝コスト中立）
- ❌ 「直前発言のみ」への追従は LLM 依存で、過去発言から漏れ出る余地が残る
- ❌ reception の sourcePersonaId 取り違え（別話者IDを拾う）を防げない

### Option B（推奨）: プロンプト限定＋コード後処理でのガード・帰属正規化
Option A のプロンプト変更に加え、`evaluateEngagement` の後処理で (1) 直前発言者＝評価対象なら awareness を null（Req2 ガード）、(2) reception の sourcePersonaId を直前発言の話者IDで正規化（Req3.1）、を加える。
- ✅ 決定的な部分（帰属・リスナー限定）をコードで担保し、LLM には意味判断だけ委ねる
- ✅ 追加LLM呼び出しゼロ、score/mode 完全据え置き（Req4）
- ✅ 変更は `evaluateEngagement` 1関数に収まり、既存の永続・巻き戻しは無改変
- ❌ 「発生源が本当に直前発言か」の意味判断自体は依然プロンプト依存（下記 Research）

### Option C: 気づき検出を score/mode 評価から分離した別呼び出しにする
気づき検出だけ直前発言のみを入力にした専用呼び出しに切り出す。
- ✅ 入力を物理的に直前発言だけに絞れ、混入余地が最小
- ❌ 評価が毎ターン2回になり LLM コストが増える（Req2/コスト方針＝追加評価を避ける、と矛盾）。**不採用寄り**

## Research Needed（design で確定）

- **プロンプト追従の信頼性**: 「最後の1発言のみを発生源」を検出指示だけで十分に守れるか。守れない場合、`recentTurns` は score/mode 用に残しつつ、気づき検出のために直前発言を末尾で明示ラベル（例:「◆直前の発言（気づきの発生源はこれのみ）」）付けする補強が要るか。
- **フォールバック経路の実挙動**: `evaluateEngagementWithFallback` で選択話者が直前話者になり得るかを確認し、Req2 ガードの要否を確定（不要でもガードは無害）。
- **self の位置づけ表現**: 「直前発言を聞いたのを契機に生じた self」をプロンプトでどう言語化し、`formatAwarenessSection` の「自分の気づき」表示（[prompt-formatters.ts:30](../../../functions/src/utils/prompt-formatters.ts#L30)）と齟齬なく保つか。

## 影響・テスト

- **既存テスト**: `awareness.test.ts` / `awareness-same-turn.test.ts` / `engagement.test.ts`（[functions/src/tests/pipeline/debate/](../../../functions/src/tests/pipeline/debate/)）。発生源限定・リスナーガード・reception 帰属正規化の新規ケースを追加し、score/mode 関連の既存アサーションが不変であることを確認する。
- **永続・可視化・発言生成での消費**: 無改変（belief-awareness-remodel の資産をそのまま使用）。

## Effort / Risk

- **Effort: S（1–3日）** — 単一関数のプロンプト書き換え＋後処理2点＋テスト追加。新規ファイル・型・永続経路変更なし。
- **Risk: Low〜Medium** — 構造リスクは低い。唯一の不確実性は「直前発言のみ」へのLLM追従で、コード側の帰属正規化とガード（Option B）で決定的部分を固めれば残余リスクは検出品質の調整（プロンプト補強）に収まる。
