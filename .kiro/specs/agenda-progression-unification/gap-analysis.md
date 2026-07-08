# Gap Analysis: agenda-progression-unification

## 1. 現状調査（Current State）

### 関連資産と責務

| ファイル | 責務 | 本 spec との関係 |
|---|---|---|
| `functions/src/pipeline/debate/intervention.ts` | 進行編成 `progressAgenda`（ゲート→判定→行動）、クールダウン判定、`InterventionTrigger` 型、`countConsecutivePersonaTargets` | 中心的変更対象。ゲート撤去・分岐単純化 |
| `functions/src/pipeline/debate/step.ts` | `executeTurn` でのトリガー構築（no-target / persona-chain / 評価なしの3分岐）、`finalizeCommittedTurn` での発言者記録 | トリガー構築の撤去、カバレッジ記録呼び出しの撤去 |
| `functions/src/pipeline/debate/agenda.ts` | 論点状態の遷移（`markIntroduced` / `markAddressed`）と永続、カバレッジ追跡（`recordSpeakerOnActiveAgendaItem` / `getUnheardRelevant`） | カバレッジ関数・フィールドの撤去。遷移・永続は維持 |
| `functions/src/agents/facilitator-agent.ts` | 3値判定 `assessActiveAgendaItem`、介入発言生成（introduce / pull-back / bring-in）、オープニング・章導入（relevantPersonaIds 生成込み） | bring-in 分岐と relevantPersonaIds 生成の撤去。判定・introduce・pull-back は維持 |
| `functions/src/pipeline/debate/speaker-selection.ts` | `hasHighEngagement`（前進抑止ゲート） | 撤去（他に使用箇所なし） |
| `functions/src/constants/debate.constants.ts` | `STALL_INTERVENTION_THRESHOLD_SCORE`、`PERSONA_CHAIN_INTERVENTION_COOLDOWN`、`DEFAULT_INTERVENTION_COOLDOWN` | 前2定数を撤去、`DEFAULT_INTERVENTION_COOLDOWN` に一本化 |
| `functions/src/types/chapter.types.ts` / `debate.types.ts` | `AgendaItemState`（spokenPersonaIds / relevantPersonaIds）、`FacilitatorReply.relevantPersonaIds` | フィールド撤去 |
| `functions/src/pipeline/debate/debate-orchestrator.ts` | `decideNextStep`（allAddressed / cap / earlyEnd）、options 組み立て | 変更なし（回帰保護対象） |
| `functions/src/pipeline/debate/chapter.ts` | 章進捗復元（`agendaItemStatuses` 読み出し） | 変更なし。旧フィールドは optional のため読み捨てで互換（R4.4） |

### フロントエンド影響

`src/lib/models/chapter/chapter.types.ts` の `AgendaItemState` は `point` / `status` のみで、`spokenPersonaIds` / `relevantPersonaIds` を最初から持たない。表示（`GenerateDebatePage.svelte`）も point/status のみ参照。**フロントエンド変更は不要**。

### 検証済みの重要事実

- `addressed` の付与箇所は `progressAgenda` 内の exhausted→前進分岐が唯一（一括消化評価は撤去済み）。
- 「facilitator 指名中は評価しない」特別扱いは冗長: ファシリテーター発言直後は `countPersonaTurnsSinceFacilitator = 0 < cooldown` で必ず評価スキップされるため、撤去しても挙動は変わらない（トリガー3分岐の undefined ケースはクールダウンで吸収される）。
- 介入直前の `addQueuedIntents` により高意欲者の意図はキューに積まれるため、前進しても意欲者の発言機会は失われない（高意欲ゲート撤去の安全根拠）。
- committed-no-turn（`chapter-exhausted`）経路・`reconcileEarlyEndCoverage`・`decideNextStep` の終了条件は本変更と独立に機能する（維持対象）。

### テスト資産

| テストファイル | 行数 | カバレッジ/ゲート関連参照 | 影響 |
|---|---|---|---|
| `tests/pipeline/debate/intervention.test.ts` | 567 | 15箇所 | ゲート・トリガー系テストの削除、前進系の書き換え |
| `tests/pipeline/debate/agenda.test.ts` | 299 | 29箇所 | カバレッジ関数テストの削除 |
| `tests/pipeline/debate/step.test.ts` | 437 | 7箇所 | トリガー構築・記録呼び出しの書き換え |
| `tests/pipeline/debate/intervention-gate.integration.test.ts` | 477 | 16箇所 | ゲート統合テスト。大半が撤去対象の挙動を検証しており再設計 |
| `tests/agents/facilitator-agent.test.ts` | 558 | 13箇所 | bring-in・relevantPersonaIds 系の削除 |
| `tests/pipeline/debate/discussion-point-consolidation.integration.test.ts` | 203 | — | allAddressed 終了等の回帰保護。原則維持 |
| `tests/pipeline/debate/chapter.test.ts` | 204 | — | 復元系。原則維持 |

## 2. Requirement → 資産マップ（gap タグ）

| Requirement | 既存資産 | Gap |
|---|---|---|
| R1.1 exhausted→addressed＋次投入 | `progressAgenda` の exhausted 分岐・`markAddressed`・`markIntroduced`・introduce 発言生成 | **Constraint**: 分岐は存在するが3ゲートの後段にある。ゲート撤去のみで成立 |
| R1.2 最終論点 committed-no-turn | `chapter-exhausted` 経路（実装・配線済み） | なし（維持） |
| R1.3 カバレッジ非依存 | — | **Missing**: `unheardActive` 分岐の撤去が必要 |
| R1.4 意欲スコア非依存 | — | **Missing**: `hasHighEngagement` ゲートの撤去が必要 |
| R1.5 ステータス永続 | `saveAgendaItemStatuses` | なし（フィールド縮小のみ） |
| R2.1 クールダウン未達は評価しない | `shouldEvaluateIntervention` / `countPersonaTurnsSinceFacilitator` | なし（維持） |
| R2.2 指名状態に関わらず単一判定 | — | **Missing**: `InterventionTrigger` 3分岐（step.ts）と persona-chain ゲート（intervention.ts）の撤去 |
| R2.3 単一クールダウン値 | `DEFAULT_INTERVENTION_COOLDOWN` | **Missing**: `PERSONA_CHAIN_INTERVENTION_COOLDOWN` の撤去 |
| R2.4 ongoing→何もしない | `verdict === 'ongoing' → 'none'` | なし（維持） |
| R3.1–3.3 drifted→pull-back | pull-back 分岐・発言生成・指名先検証 | なし（維持）。ただし現行は「unheard 優先で bring-in に差し替え」のため、撤去後は drifted が常に pull-back になる（単純化） |
| R4.1–4.3 カバレッジ機構撤去 | `recordSpeakerOnActiveAgendaItem` / `getUnheardRelevant` / bring-in 分岐 / `FacilitatorReply.relevantPersonaIds` / opening・introduction プロンプトの関連参加者生成 | **Missing**: 一式の削除。`markIntroduced` のシグネチャ縮小（relevantPersonaIds 引数廃止）を含む |
| R4.4 旧フィールド互換 | `AgendaItemState` の当該フィールドは optional、復元側は読み捨て | なし（型からの削除のみで自然に成立） |
| R5.1–5.4 章終了維持 | `decideNextStep`（allAddressed / cap / earlyEnd / 最終応答+1）、`reconcileEarlyEndCoverage` | なし（回帰テストで保護） |

**Unknown / Research Needed**（設計フェーズへ申し送り）:

- `assessActiveAgendaItem` の exhausted 感度が前進の唯一のドライバになる。判定プロンプトは本 spec のスコープ外だが、「早すぎる前進」（誤 exhausted で論点を駆け足消化）が新たな失敗モードになりうる。効果検証の観測ポイントとして設計に明記する。
- ペルソナ指名チェーン中に exhausted 前進すると、末尾の未応答指名が切られる。章末は `hasUnansweredTargetAtEnd` の最終応答+1 で救済されるが、章中の前進介入では指名先の応答機会が失われる（キュー積みで緩和）。許容とするか設計で明示する。

## 3. 実装アプローチ

### Option A: 既存フローの縮約（推奨）

`progressAgenda` / `executeTurn` の構造を保ったまま、ゲート・トリガー分岐・カバレッジ機構を削除する。新規ファイル・新規抽象なし。

- 変更: intervention.ts（分岐縮約）、step.ts（トリガー構築撤去・記録撤去）、agenda.ts（関数・フィールド削除）、facilitator-agent.ts（bring-in・relevantPersonaIds 削除）、speaker-selection.ts / constants / types（未使用物の削除）
- ✅ 差分が「削除」中心で、残るコードは既存パターンそのまま。レビュー・検証が容易
- ✅ 維持対象（判定・pull-back・introduce・章終了）に触れない
- ❌ `progressAgenda` という名前・置き場所は現状のまま（責務は縮小するが再配置しない）

### Option B: 進行編成の新モジュール切り出し

「クールダウン＋3値判定→行動」を新ファイル（例: `agenda-progression.ts`）に再実装し、intervention.ts を廃止する。

- ✅ 名前と責務が一致した綺麗な置き場所になる
- ❌ 削除と移動が混ざり差分が読みにくく、回帰リスクが上がる。ファイル分割自体は挙動に寄与しない

### Option C: ハイブリッド（縮約→後日改名）

Option A で縮約し、命名・配置の整理は別 spec（debate-orchestration-module-restructure 系）に委ねる。

- ✅ 本 spec は挙動変更の検証に集中できる（検証変数を1つに絞る方針と整合）
- 実質 Option A と同じ。改名を明示的にスコープ外へ出す点だけが違い

## 4. Effort & Risk

- **Effort: S–M（2–4日）** — ソース7ファイルの削除中心の変更＋テスト5ファイルの書き換え・削除。新規実装はほぼない
- **Risk: Low–Medium** — 変更自体は既存分岐の削除で機械的（Low）。ただし挙動面で「exhausted 判定単独駆動」への切り替えという設計上の賭けがあり、判定感度次第で論点の駆け足消化が起きうる（Medium 要素。ロールバックは容易）

## 5. 設計フェーズへの申し送り

- **推奨アプローチ**: Option A/C（既存フローの縮約、再配置しない）
- **キー判断（要件承認済み）**: exhausted 即前進、トリガー・クールダウン一本化、カバレッジ機構の完全撤去（dormant 化ではなく削除）
- **設計で明示すべき点**:
  1. `progressAgenda` の撤去後フロー（cooldown → assess → ongoing:none / drifted:pull-back / exhausted:advance）と各戻り値の配線
  2. `markIntroduced` シグネチャ変更（relevantPersonaIds 廃止）と opening / 章導入スキーマの縮小
  3. 削除対象の全列挙（関数・型・定数・プロンプト断片・テスト）— 死んだコードを残さない
  4. 観測ポイント: 効果検証時に「論点あたりターン数」「addressed 到達率」「章終了理由（allAddressed / cap / earlyEnd の比率）」を見る
- **Research 継続項目**: exhausted 判定の感度（早すぎる前進）は本変更のデプロイ後観測で判断。判定プロンプト調整・relevantPersonaIds 絞り込みは後続判断
