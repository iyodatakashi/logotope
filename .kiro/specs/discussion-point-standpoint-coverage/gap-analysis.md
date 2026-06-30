# Gap Analysis: discussion-point-standpoint-coverage

## 1. 現状調査（Current State）

### 関連アセット

| 層 | ファイル | 役割 |
|---|---|---|
| 介入オーケストレーション | `pipeline/debate/step.ts` | `executeTurn` の介入トリガー構築（`no-target` / `persona-chain`、L204-233）。`reconcileEarlyEndCoverage`（L331-380）で論点カバレッジを LLM 再確認する前例あり |
| 介入評価 | `pipeline/debate/intervention.ts` | `tryIntervention`（drift→stall カスケード）、`countConsecutivePersonaTargets`（L24-35）、`countPersonaTurnsSinceFacilitator`（L38-44）、`persistInterventionTurn`（L50-93） |
| 介入エージェント | `agents/facilitator-agent.ts` | `evaluateTopicDrift`（三択プロンプト L109-141）、`evaluateStallIntervention`（L143-164）、`runInterventionCheck`（`interventionSchema`、会話履歴は **直近20ターンのみ** 提示 L59） |
| 論点状態 | `pipeline/debate/discussion-points.ts` | `getActiveDiscussionPoint`（最新 introduced、L19-25）、`markIntroduced`（introducedOrder 採番、L31-46）、`saveDiscussionPointStatuses` |
| 話者選択 | `pipeline/debate/speaker-selection.ts` | `selectSpeaker`（指名>キュー>スコア）、`hasHighEngagement`（L24-25） |
| 型 | `types/turn.types.ts` / `types/chapter.types.ts` | `DebateTurn`（`personaId?` / `targetedBy` / `targetPersonaId`）、`DiscussionPointState`（`point` / `status` / `introducedOrder?`） |
| 定数 | `constants/debate.constants.ts` | クールダウン（3 / 5）、`STALL_INTERVENTION_THRESHOLD_SCORE=4`、cap 比率（1.5 / 2.5）、`MAX_TURNS` |

### 規約・テスト配置

- 永続ターン列から決定論的に値を算出する純関数は `intervention.ts` に置く（`countConsecutivePersonaTargets` が前例）。`src/tests/pipeline/debate/*.test.ts` で Firestore モックのユニットテスト。
- 介入の LLM 文面・判断軸は `facilitator-agent.ts` のプロンプト（criteria セクション）に集約。`step.ts` は単体テストを持たず結合テストで担保。
- 依存方向は一方向（orchestrator → step → intervention / facilitator-agent）。

### 核心メカニズム（根本原因）

出尽くし判断は **「直近応酬の新規性」一軸**に依存している。`evaluateTopicDrift` の選択肢2（`facilitator-agent.ts:126`）は「最近のやり取りが新しい視点・反論・具体例を加えていない＝出尽くし」と定義し、`evaluateStallIntervention` も同様。**「その論点について各参加者の立場が出そろったか」という被覆（カバレッジ）軸を持たない**。さらに `runInterventionCheck` は会話履歴を **直近20ターンしか LLM に渡さない**（L59）ため、長い章では「序盤に誰が当該論点で発言したか」を LLM が構造的に知り得ず、カバレッジ判断を主観に委ねること自体が不可能に近い。persona-chain 経路では `chainLength` を「出尽くしを疑うシグナル」として渡す（`facilitator-agent.ts:133-137`）が、向きが「次へ進む」側に作用しており、本来の「未発言者を呼ぶ」方向と逆。

## 2. 要件 → アセット対応マップ

| 要件 | 既存アセット | ギャップ | 種別 |
|---|---|---|---|
| R1 論点ごと発言済み記録／カバレッジ導出 | `DiscussionPointState`、`saveDiscussionPointStatuses`（introducedOrder 永続化の前例）、`getActiveDiscussionPoint`、ペルソナ発言コミット経路（`step.ts` / `finalizeCommittedTurn`） | `DiscussionPointState` に発言済みペルソナ集合を増設し、ペルソナ発言コミット時に現アクティブ論点へ加える配線（小さなスキーマ拡張＋更新点1箇所） | Missing（小） |
| R2 出尽くし二軸分離 | `evaluateTopicDrift` / `evaluateStallIntervention` のプロンプト | カバレッジ軸の追加と「新規性のみでは前進不可」のゲート文面化（プロンプト拡張） | Missing（中・プロンプト） |
| R3 未発言者の引き込み | `interventionSchema`（content+targetPersonaId、index 省略）、`persistInterventionTurn` | **新スキーマ不要**: 「引き戻し」と同じ返り値形（index 無し＝論点不変）。未発言者リスト提示＋target 選定の指示が要 | Missing（小・既存形を流用） |
| R4 chainLength 解釈是正 | `facilitator-agent.ts:133-137` `chainSignal`、`intervention.ts:155` | シグナル文面を「まず未発言者を引き込む」方向へ書き換え。順序ロジック（未発言者優先）の明文化 | Missing（小・プロンプト） |
| R5 適用範囲と前進保証 | 既存 cap（`AGENDA_TURN_CAP_RATIO` 等）、forced response 機構 | 「寄与しうる参加者」の関連度は LLM 判定。前進保証は後述のとおり構造的にほぼ自動充足 | Constraint（ほぼ既存で充足） |
| R6 既存挙動の維持 | クールダウン定数、`markIntroduced`、`persistInterventionTurn`（ファシリ単独ターン保存） | 触らず流用すれば自動充足。カバレッジ算出を `no-target` / `persona-chain` 両経路へ等しく注入する配線のみ | Constraint |

## 3. 重要なギャップ（Research Needed）

> **方針確定（ユーザー決定）: カバレッジは「論点ごとの発言済みペルソナ集合」を `DiscussionPointState` に持たせて記録する（ターン列からの境界復元はしない）**

当初検討した「境界ターン以降の発言者をターン列から数える」間接方式（旧 境界A／B）は棄却した。理由: (1) どのファシリテーター発言が現アクティブ論点を投入したかの境界特定が構造的に困難（drift 引き戻しと論点投入が区別できない）、(2) LLM へ渡す直近20ターン窓を超える長い論点で数え落とす、(3) これを避けるために境界マーカーを足すなら、最初から発言済みフラグを持つのと手間が変わらない。

**採用方式**: `DiscussionPointState` に2つの集合を追加する — (a) 発言済みペルソナ集合（例 `spokenPersonaIds: string[]`）、(b) 関連参加者集合（例 `relevantPersonaIds: string[]`）。(a) はペルソナ発言コミット時に現アクティブ論点へ発言者を加える。(b) は論点投入時に記録する。`markIntroduced` で新規論点は (a) を空集合から開始。`saveDiscussionPointStatuses`／`ChapterProgress` の既存永続経路に相乗りし、resume 時は章ドキュメントから `state.discussionPoints` に復元（既存 introducedOrder と同じ扱い）。これにより境界復元も20ターン窓問題も消え、状態が権威的な単一の源泉になる。残るのは「発言コミット箇所での更新点をどこに置くか（`finalizeCommittedTurn` 付近か `executeTurn` か）」という小さな配線判断のみ。

> **関連度（誰が発言すべきか）の入れどころ（ユーザー決定）: 論点投入のLLM呼び出しに相乗り**

「誰が立場を聞くべきか」は構造だけでは決められない意味的判断のため、論点を投入するファシリテーターのLLM呼び出し（`generateOpening`／介入の `selectedDiscussionPointIndex` を返す経路）に `relevantPersonaIds` の判定を相乗りさせる（**新規LLM呼び出しは増やさない**）。これにより、コードのカバレッジ・ゲートの分母は「全参加者」ではなく「関連参加者」になり、全員を毎論点で強制しない。役割分担は「**関連集合の決定＝LLM（論点投入時1回）／前進可否ゲート＝コード（`relevantPersonaIds − spokenPersonaIds ≠ ∅` の間は次論点投入を不採用）／次に誰を引き込むか＝LLM（毎介入）**」。関連度が狭すぎた場合の保険として、毎介入のLLMが関連集合へ追加のみ可（削除不可）とすれば終了の有界性（最大で全ペルソナ）を保てる。`interventionSchema` に `relevantPersonaIds`（任意）を追加する小変更が要る。

> **重要な安全性の発見: 無限滞留（R5）は原理的に起きにくい**

未発言者の引き込みは `targetedBy='facilitator'` の指名であり、**次ターンで対象ペルソナが強制応答する**（forced response）。応答すれば当該ペルソナは境界以降の発言者に加わり、**カバレッジは1介入につき確実に1人ぶん単調に埋まる**。つまり未発言者集合は有限回で空になり、ゲートは必ず開く。R5 の「同一人物を繰り返し引き込んで前に進めない」ループは構造的にほぼ生じない（cap は最終安全弁として温存）。→ R5-3 の追加実装は最小で済む見込み。

その他の Research Needed:
- 「寄与しうる参加者（関連度）」を LLM 判定に委ねる前提でよいか（構造的な関連度モデルは持たない）。未発言者リスト＋ペルソナ属性を渡し、ファシリテーターに「異なる立場を加えうる1人」を選ばせる。
- カバレッジを「人数しきい（最低N人）」で足切りするか、「寄与しうる全員」を基準にするか（R5-1/5-2 の運用）。
- カバレッジ充足の判定主体: 構造シグナル（未発言者リスト）を渡したうえで最終判断は LLM に委ねるか、コード側で「未発言者ゼロ＝充足」とハードに扱うか。

## 4. 実装アプローチ

データ方式は確定済み（論点状態に発言済みペルソナ集合）。残る選択は **(i) カバレッジ充足ゲートをコードで効かせるか LLM 判断に委ねるか**、**(ii) 介入文面の拡張範囲**の2点。

### Option A: 既存プロンプトの拡張のみ（充足判断も LLM）
- `DiscussionPointState` に `spokenPersonaIds` 追加＋発言コミット時更新＋導出純関数（未発言者）。
- `evaluateTopicDrift` / `evaluateStallIntervention` に「表明済み／未発言の参加者」を criteria として注入し、三択を「逸脱／出尽くし（=新規性なし **かつ** カバレッジ充足）／未発言者を同論点へ引き込み／見送り」へ再構成。`chainSignal` を未発言者優先へ。充足可否の最終判断は LLM。
- **Trade-off**: ✅ 変更が `facilitator-agent.ts` 中心で局所的 / ❌ 「未発言者が残るのに前進」を LLM がやり得る（R2.3 の確実性がプロンプト品質依存）。

### Option B: コード側カバレッジ・ゲート（充足判断をコードで担保）
- データ＋導出は Option A と同じ。加えて `intervention.ts` で「未発言者が残る間は drift/stall の『次論点投入（selectedDiscussionPointIndex 指定）』を採らせない」ゲートをコードで適用し、未発言者がいれば引き込み（index 省略）へ寄せる。
- **Trade-off**: ✅ R2.3「未発言者が残る限り前進しない」を構造的に保証・挙動が安定 / ❌ LLM 出力の後段補正ロジックが増え、引き込み対象選定の妥当性チェック（`validPersonaId` に加えた未発言者所属チェック）が要る。

### Option C: ハイブリッド（推奨）
- データ＋導出＋プロンプト二軸化＋chainLength 是正（Option A の骨格）を入れたうえで、**前進可否のゲートだけはコードで担保**（Option B の中核）。文面生成は LLM、ゲート判断はコード、という役割分担。
- **Trade-off**: ✅ 多様性担保の核（前進しない保証）を構造化しつつ文面は LLM の自然さを活かす / ❌ コードゲートと LLM 出力の整合（LLM が引き込みを選ばなかった場合の扱い）を設計で明示する必要。

## 5. Effort & Risk

- **Effort: M（3〜5日）** — `DiscussionPointState` 拡張＋発言コミット時更新＋導出純関数＋永続/復元＋テストは S（既存 introducedOrder と同じ取り回し）。時間を要するのは二軸プロンプトの再設計と、隣接2spec（drift 積極化 / chainLength）への回帰を出さない文面調整・観測。
- **Risk: Medium** — アーキテクチャ変更は無く既存パターン踏襲（Low 寄り）。Medium 要因は (1) 挙動が LLM プロンプト品質に依存、(2) `discussion-point-consolidation`／`facilitator-intervention-timing` の判断軸を上書きするため両者の意図（過剰介入防止・流れ最優先）と衝突しないチューニングが要る点。冪等性・順序保証・cap は既存経路再利用で温存。

## 6. 設計フェーズへの申し送り

- **データ方式（確定）**: `DiscussionPointState` に発言済みペルソナ集合を持たせる。ターン列からの境界復元方式（旧 境界A／B）は棄却。
- **推奨アプローチ: Option C（コードでゲート・文面は LLM）**。前進可否（未発言者が残る限り次論点へ進ませない）はコードで担保し、引き戻し／引き込み／次論点投入の文面生成は既存 LLM 経路を活かす。
- **主たる変更点**:
  1. `types/chapter.types.ts`: `DiscussionPointState` に `spokenPersonaIds: string[]` と `relevantPersonaIds: string[]` を追加（optional・後方互換）。`ChapterForFirestore` / `ChapterProgress` は同型参照のため自動波及。
  2. `agents/facilitator-agent.ts`: ① `generateOpening` と介入経路（`interventionSchema`）に `relevantPersonaIds` を返させる（論点投入時に関連参加者を判定）。② `evaluateTopicDrift`／`evaluateStallIntervention` のプロンプトを「新規性 × カバレッジ」二軸へ。未発言の関連参加者がいる間は「同論点でその中の1人を指名」を選ばせる選択肢を追加（返り値は content+targetPersonaId、`selectedDiscussionPointIndex` 省略＝論点不変）。`chainSignal` を未発言者優先へ反転。
  3. `pipeline/debate/discussion-points.ts`: `markIntroduced` で新規論点に `relevantPersonaIds` を記録し `spokenPersonaIds` を空初期化。`saveDiscussionPointStatuses` の書き出しに両集合を追加。発言コミット時に現アクティブ論点へ発言者を加える更新関数と、未発言の関連参加者を導出する純関数（`relevantPersonaIds − spokenPersonaIds`）を追加。
  4. `pipeline/debate/step.ts`: ペルソナ発言コミット箇所（`finalizeCommittedTurn` 付近）で現アクティブ論点へ発言者を記録。`tryIntervention` へ未発言の関連参加者を渡す配線。
  5. `pipeline/debate/intervention.ts`: 未発言の関連参加者が残る間は介入の「次論点投入（index 指定）」を不採用にする**コードゲート**と、引き込み対象が未発言の関連参加者に属するかの検証（`validPersonaId` に追加）。
- **決定済み（要件反映済み）**: データ＝論点状態に2集合。関連度の決定＝論点投入のLLMに相乗り。前進可否＝コードゲート（`relevantPersonaIds − spokenPersonaIds ≠ ∅` の間は次論点投入を不採用）。
- **決めるべき重要判断（設計）**:
  1. 集合フィールド名（`spokenPersonaIds` / `relevantPersonaIds` を仮置き。略語回避・意味の通る名前）。
  2. LLM が引き込みを選ばなかった／`relevantPersonaIds` が空で返ったときのフォールバック挙動（未発言者を残したまま見送り＝継続か、コード側で未発言者から強制指名するか）。
  3. 関連集合の追加（保険）を初版に入れるか後回しか（R5-2）。最低N人しきいの要否。
  4. `relevantPersonaIds` が空のとき（ファシリテーターが「全員関連」または「特定できない」と返す）のゲート挙動の既定。
- **持ち越し Research**:
  - 二軸プロンプト＋コードゲートが、既存 drift の「流れ最優先（選択肢3）」「過剰介入防止」と両立して「未発言者を呼ぶ」挙動を生むかの実地確認。
- **既存で充足済み（実装不要）**: R3 の引き込みは `interventionSchema` の既存形（index 省略）で表現可。R5 の前進保証は forced response によるカバレッジ単調充足（引き込み→強制応答→発言済みに加算）＋既存 cap で構造的に担保。R6 のクールダウン・`markIntroduced`・順序保証・冪等は既存経路再利用で温存。
- **隣接整合の注意**: `discussion-point-consolidation` の `feedback-firestore-type-naming`（永続型 `*ForFirestore`）方針と矛盾しない形で `DiscussionPointState` を拡張する（`ChapterForFirestore.discussionPointStatuses` 経由で永続化される点に留意）。
