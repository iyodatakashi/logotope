# Gap Analysis: facilitator-intervention-timing

## 1. 現状調査（Current State）

### 関連アセット

| 層 | ファイル | 役割 |
|---|---|---|
| チェーン駆動 | `pipeline/debate/debate-orchestrator.ts` | `advanceDebate` / `decideNextStep`。末尾指名の検出 `hasUnansweredTargetAtEnd` を既に持つ |
| ステップ実行 | `pipeline/debate/step.ts` | `executeTurn`（話者選択・**介入分岐**・発言生成）。`getLastTargetPersona` で末尾指名を取得 |
| 介入 | `pipeline/debate/intervention.ts` | `tryIntervention`（ドリフト→スタールのカスケード）、`countPersonaTurnsSinceFacilitator`、`shouldEvaluateIntervention` |
| 話者選択 | `pipeline/debate/speaker-selection.ts` | `selectSpeaker`（指名 > キュー > スコア）、`hasHighEngagement` |
| 介入エージェント | `agents/facilitator-agent.ts` | `evaluateTopicDrift` / `evaluateStallIntervention`（LLM 判定） |
| 発言生成 | `agents/persona-agent.ts` | `generateTurn`。`targetingGuide` / `targetBiasNote` の指名指示を保持 |
| 定数 | `constants/debate.constants.ts` | 閾値・上限の単一定義元 |
| ターン永続化 | `pipeline/debate/turn.ts` | `generatePersonaTurn`。自己/不正 target の無効化（L242-244）を既に実装 |

### 規約・テスト配置

- 純関数（`countPersonaTurnsSinceFacilitator` 等）は対応モジュールの近くに置き、`src/tests/pipeline/debate/*.test.ts` でユニットテスト（Firestore はモック）。
- 定数は `src/tests/constants/debate.constants.test.ts` で検証。
- `step.ts` 単体テストは無く、`debate-parity.test.ts` / `debate-step-idempotency.test.ts` が結合的に挙動を担保。
- 依存方向は一方向（orchestrator → step）。`intervention.ts` は step/orchestrator から参照される下層。

### 核心メカニズム（根本原因）

`step.ts` `executeTurn` L196: **`if (!targetPersona)` で介入評価が完全にゲートされている**。ペルソナ発言が `targetedBy='persona'` で他者を指名する限り、`getLastTargetPersona` が値を返し続け、ファシリテーター介入は一度も評価されない。連続指名のカウンタは存在せず、チェーンは章の強制終了上限（`AGENDA_TURN_CAP_RATIO=2.5` × `turnsPerChapter`）まで途切れない。これが「いつまでも話が途切れない」の直接原因。

## 2. 要件 → アセット対応マップ

| 要件 | 既存アセット | ギャップ | 種別 |
|---|---|---|---|
| R1 連続指名チェーン計測 | `countPersonaTurnsSinceFacilitator`（類似実装あり） | 末尾から `targetedBy='persona'` 連続数を数える純関数が未実装 | Missing（小） |
| R2 過剰連鎖時の介入 | `executeTurn` 介入分岐 / `tryIntervention` | ① `!targetPersona` ゲートの緩和、② **既存の drift/stall では盛り上がっている指名チェーンに介入が発火しない可能性** | Missing + **Unknown** |
| R3 介入後のチェーンリセット | `persistInterventionTurn`（`lastSpeakerId=undefined`、ファシリ末尾化） | チェーン計測が永続ターン由来のため、介入ターン挿入で自動的に 0 リセット。追加実装ほぼ不要 | Constraint（既存で充足） |
| R4 過剰指名の抑制 | `persona-agent.ts` `targetingGuide`/`targetBiasNote`、`turn.ts` 自己/不正target無効化 | R4.3（自己/不正target無効化）は**実装済み**。R4.1/4.2 はプロンプト強化のみ | Constraint（一部既存で充足） |
| R5 閾値の定数化 | `debate.constants.ts` | 新定数 `TARGET_CHAIN_INTERVENTION_THRESHOLD` 追加 | Missing（極小） |
| R6 既存保証の維持 | `addTurn`（runId世代照合・冪等）、freeze 分岐、cap/early-end | freeze 分岐を触らず、介入は既存 `persistInterventionTurn` 経路を再利用すれば自動充足 | Constraint |

## 3. 重要なギャップ（Research Needed）

> **最大の論点: 「盛り上がっている指名チェーン」に既存の介入経路が発火しない**

- `tryStallIntervention` は `hasHighEngagement(engagements)` が true のとき発火しない（出尽くし＝低意欲が前提）。指名が活発に連鎖している状態は通常 engagement が高く、スタール介入は抑止される。
- `tryTopicDriftIntervention` は「フォーカス問いから逸脱」時のみ。健全に盛り上がっているが終わらないチェーンは逸脱とは限らず、発火しない。
- 結果、ゲートを緩めて `tryIntervention` を呼ぶだけでは、肝心の「盛り上がったまま終わらないチェーン」を打ち切れない恐れがある。

→ **設計で決める必要がある**: 連続指名が閾値超過したときの介入を、(a) 既存スタール介入の高意欲ゲートを「チェーン閾値超過時は無視」して流用するか、(b) 専用の「チェーン打ち切り介入」評価関数を `facilitator-agent.ts` に新設するか。

その他の Research Needed:
- 閾値の初期値（連続何回でファシリテーターを入れるか）。`DEFAULT_INTERVENTION_COOLDOWN=3` との整合。
- 介入が発火条件を満たさず「指名先に応答継続」した場合に無限ループしないか（チェーンが伸び続けるだけにならない安全弁の要否）。

## 4. 実装アプローチ

### Option A: 既存 `tryIntervention` を拡張（ゲート緩和＋スタール高意欲ゲートの条件付き解除）
- `step.ts`: `if (!targetPersona)` を「target無し、または `targetedBy='persona'` かつチェーン長 ≥ 閾値」に緩和。
- `intervention.ts`: `tryStallIntervention` に「チェーン閾値超過時は `hasHighEngagement` を無視する」フラグを渡す。
- `countConsecutivePersonaTargets` を `intervention.ts` に追加、`debate.constants.ts` に閾値追加。
- **Trade-off**: ✅ 新規ファイル最小・既存カスケード再利用 / ❌ スタール介入のプロンプトは「出尽くし」前提のため、盛り上がり中のチェーンに自然な打ち切り文面を出せるかは要検証。

### Option B: 専用「チェーン打ち切り介入」を新設
- `facilitator-agent.ts` に `evaluateChainBreakIntervention`（盛り上がっていても、論点の一段落・別参加者への振り直し・章の前進を促す文面を生成）を追加。
- `intervention.ts` にチェーン閾値超過時の専用分岐を追加し、drift/stall とは別経路で発火。
- **Trade-off**: ✅ 「盛り上がったまま終わらない」に最適な介入文面・確実な発火 / ❌ 新規 LLM 評価関数・プロンプト設計・テストが増える（中規模）。

### Option C: ハイブリッド（推奨）
- 計測（`countConsecutivePersonaTargets`）＋定数＋ゲート緩和は共通土台として実装（Option A の骨格）。
- 介入の中身は、まず drift を試し、発火しなければ **チェーン閾値超過時専用にスタールの高意欲ゲートを解除**（Option A）。それでも文面品質が不足するなら専用評価関数（Option B）へ段階的に差し替え。
- **Trade-off**: ✅ 小さく入れて効果検証→必要時のみ専用化、リスク分散 / ❌ 段階導入の計画がやや複雑。

## 5. Effort & Risk

- **Effort: M（3〜5日）** — 純関数・定数・ゲート緩和は S だが、「盛り上がりチェーンに確実かつ自然に介入させる」介入文面の設計・検証に時間を要する。
- **Risk: Medium** — アーキテクチャ変更は無く既存パターンに沿う（Low 寄り）が、既存 drift/stall が当該ケースで発火しない点が未検証で、介入の効き具合がプロンプト品質に依存する（Medium 要因）。冪等性・世代分離・freeze・cap は既存経路再利用で温存可能。

## 6. 設計フェーズへの申し送り

> **方針確定（ユーザー指示）**: ターン数による強制介入は「一定ターンごとの機械的介入」になりがちで本質的でない。**本機構は「論点ずれ介入（drift）を指名チェーン中にも積極的に評価・発火させる」こと**とし、ターン数（連続指名長）ベースの強制介入は終了保証の**最終手段（安全弁）**に格下げする。要件は本方針に沿って改訂済み（R1=drift評価のゲート緩和、R2=drift積極化、R4=安全弁）。

- **推奨アプローチ: Option A 寄り（drift 経路の活性化）**。`evaluateTopicDrift` は「指名済みターンでも上書きしうる」設計（`facilitator-agent.ts` L107 コメント）であり、本体ロジックは流用可能。主たる変更は **呼び出しゲートの緩和**と**drift 判断基準の積極化**であって、新規 LLM 評価関数（旧 Option B）は原則不要。専用関数の新設は drift の文面・発火が不十分と判明した場合の予備案に留める。
- **主たる変更点**:
  1. `step.ts` `executeTurn`: 末尾がペルソナ指名でも、クールダウンを満たせば drift を評価する（`tryStallIntervention` の高意欲ゲートには手を入れない方向。出尽くし介入は従来どおり target 無し時のみで可）。
  2. `facilitator-agent.ts` `evaluateTopicDrift`: 「流れ最優先」バイアスを弱め、逸脱・論点消化済みをより拾う。連続指名長を文脈シグナルとして渡し、長いほど介入側に寄せる。
  3. `intervention.ts`: 連続指名長の計測関数（`countConsecutivePersonaTargets`）追加、安全弁閾値による強制発火分岐、`debate.constants.ts` に定数追加。
- **決めるべき重要判断**:
  1. drift をペルソナ指名チェーン中に評価する条件（クールダウンのみか、チェーン長も併用するか）。
  2. drift 積極化の度合い（プロンプト調整のみか、チェーン長に応じた段階的なしきい引き下げか）。過剰介入（R2.4）とのバランス。
  3. 安全弁閾値の初期値（「機械的にならない十分大きい値」の具体値）と、`DEFAULT_INTERVENTION_COOLDOWN` との関係。
- **持ち越し Research**:
  - drift プロンプトの積極化が「盛り上がったまま終わらないチェーン」に妥当な引き戻し／次論点投入文面を生成できるかの実地確認。
  - R6 のプロンプト強化が指名頻度を実際に下げるかの観測（定量化は別途）。
- **既存で充足済み（実装不要）**: R5 のチェーンリセット（永続ターン由来計測＋ファシリ末尾化で自動）、R6.3（自己/不正target無効化）、R7 の freeze 非適用（分岐分離済み）。drift 本体の「指名上書き」能力（L107）も既存。
