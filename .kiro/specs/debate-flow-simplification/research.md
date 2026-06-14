# Research & Design Decisions: debate-flow-simplification

## Summary
- **Feature**: `debate-flow-simplification`
- **Discovery Scope**: Extension（既存討論フローの内部リファクタリング＋確定したバグ修正。外部依存の追加なし）
- **Key Findings**:
  - 整理対象は `functions/src/pipeline/debate-orchestrator.ts`（654行）と `flow/` 4モジュール・`agents/facilitator-agent.ts`。flow 配下は純関数として独立テスト済みで、これが behavior oracle になる。
  - 「複雑さ」の主因は、ターンごとに評価する／しない分岐が混在し、評価経路が二系統（全員評価／話者1人再評価）になっていること。**評価を毎ターン全員に統一**すると分岐が浅くなり、第2経路が消える。
  - 確定した振る舞い変更が3件（B クールダウン除去・指名優先・毎ターン評価）。純粋な整理と振る舞い変更をステップ分離して進める必要がある。

## Research Log

### 評価経路の二系統化（要件4の根因）
- **Context**: `resolveSpeech` がなぜ存在するか、なぜ評価が二経路あるのか。
- **Sources Consulted**: debate-orchestrator.ts:218-424（runChapterLoop / evaluateAndDecide / resolveSpeech）, persona-agent.ts:379（assessEngagement）。
- **Findings**:
  - `evaluateAndDecide`（全員評価）を通るのは「指名なし・直接質問なし・A不成立」のターンのみ。
  - 指名・直接質問・A成立のターンは全員評価を経ないため、選ばれた話者の mode/score を `resolveSpeech` が**話者1人だけ再評価**して補う（assessEngagement の第2呼び出し経路）。
  - 同時に、これらのターンでは `saveEngagements`（可視化）とキュー保守もスキップされる。
- **Implications**: 毎ターン全員評価に統一すれば、選ばれた話者は常に評価済み → 第2経路（resolveSpeech のフォールバック評価）は edge ケース（直前話者の指名等）のみに縮退。可視化・キュー保守も毎ターン一貫。

### 介入A/Bの発火条件とクールダウンの帰属
- **Context**: クールダウン（`shouldEvaluateIntervention`）が A・B どちらの制約か。
- **Sources Consulted**: debate-orchestrator.ts:206-244, 326-330, intervention-policy.ts, facilitator-agent.ts:239-261。
- **Findings**:
  - 現行は `interventionAllowed`（クールダウン）が A の先行評価と B の評価の**両方**を gate（:219, :328）。
  - A（論点ずれ）は毎ターン先行評価し、成立時に保留中の指名・直接質問を破棄。
  - B（出尽くし）は `!hasHighEngagement` のときのみ評価。
- **Implications（確定）**:
  - クールダウンは A 専用にする（B は「出尽くし」のみで発火、クールダウン非依存）＝バグ修正。
  - 優先順位を「指名/直接質問 ＞ A ＞ B ＞ キュー ＞ スコア」に変更し、A は指名が無いときのみ評価（指名を破棄しない）。
  - A と B は別処理として保持（共通介入ハンドラに統合しない）。

### 制御閾値の散在
- **Context**: マジックナンバーと二重定義の所在。
- **Findings**:
  - `INTENT_EXPIRY_TURNS = 8` が debate-orchestrator.ts:35 と state-restore.ts:4 に二重定義。
  - スコア境界: キュー追加 `score >= 4`(:369)、キュー選択 `topScore <= 3`(speaker-selection:66)、活性シグナル `>= 4`/`>= 5`(chapter-progress:11)、`MAX_CONSECUTIVE_DIRECT = 3`(speaker-selection:3)。
  - 比率: `EARLY_END_PROGRESS_RATIO`/`TURN_CAP_RATIO`/`RECENT_SIGNAL_WINDOW`（chapter-progress、命名済み）。
- **Implications**: `flow/constants.ts` に集約。キュー追加 `>= 4` とキュー選択 `<= 3` は同じ「高意欲境界=4」を逆向きに使うため、`HIGH_ENGAGEMENT_SCORE = 4` を定義し、選択側は `< HIGH_ENGAGEMENT_SCORE`（整数スコアで `<= 3` と等価）と表現して向きの取り違えを防ぐ。

### 呼び出し契約と状態復元の制約
- **Context**: リファクタで変えてはいけない境界。
- **Findings**:
  - 公開メソッドは `generateChaptersOnly` / `executeChapterTask` の2つのみ（api/debates.ts が依存）。
  - タスクはステートレス。`restoreDebateState` が保存済みターン＋永続化キューから状態を一意復元する性質に依存（state-restore.test.ts が担保）。
- **Implications**: 公開2メソッドのシグネチャ不変。状態復元の決定性を維持。整理は private メソッドの分解と flow 純関数の調整に限定。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: インプレース整理のみ | 既存メソッド内で分岐抽出・定数集約 | 差分最小・テスト流用 | god-method が残りやすい | 振る舞い変更を載せにくい |
| B: ターンステップ全面再構造化 | 1ターンをステップ関数群へ分割し orchestrator は調整役 | フローとコードが1対1 | 過度な抽象化リスク・テスト更新大 | steering の「過度な共通化禁止」に注意 |
| **C: ハイブリッド（採用）** | 定数を `flow/constants.ts` に集約＋ god-method を平易な private メソッドへ分解、A/B は別関数のまま priority 合成 | 効果の高い箇所に集中、平易な分解、共通化最小 | 純整理と振る舞い変更の切り分けが必要 | 要件の「平易な分解優先」指針に合致 |

## Design Decisions

### Decision: 毎ターン全員評価への統一（評価経路の一本化）
- **Context**: 評価する／しない分岐の混在と、話者1人再評価の第2経路（要件4・5、②の解消）。
- **Alternatives Considered**:
  1. 現状維持＋可視化・キュー保守だけ各分岐に複製 → 分岐がさらに増え複雑化（指針に反する）。
  2. 毎ターン全員評価に統一 → 評価ステップと決定ステップが分離、第2経路が消える。
- **Selected Approach**: 各ターン冒頭で全員（直前話者を除く）を評価し、その結果を「話者決定・発言パラメータ・可視化保存・キュー保守」に共通利用する。
- **Rationale**: 分岐が浅くなり「評価 → 決定 → 生成」が素直に読める（平易な分解）。可視化の穴・キュー保守の偏りも同時に解消。
- **Trade-offs**: 従来スキップしていたターン（指名・直接質問・論点ずれ）でも評価 LLM 呼び出しが最大 N-1 件増える。可視化・一貫性のための意図的選択。
- **Follow-up**: integration テストの assessEngagement 呼び出し回数の期待値更新（R5）。

### Decision: 話者決定を priority 合成で表現（A/B は別関数のまま）
- **Context**: 採番の不整合・指名破棄・god-method（要件2・3・9、①の解消）。
- **Selected Approach**: 決定を `指名/直接質問 → A → B → キュー/スコア` の null 合成（`?? `）で表現。A=`tryTopicDriftIntervention`、B=`tryStallIntervention` を**別 private メソッド**として保持し、`decideNextSpeaker`（純関数）は queue/score のみに縮退。
- **Rationale**: 各分岐が小さな名前付き処理になり、優先順位が読んで分かる。A/B を共通ハンドラに統合しない（指針・要件3-1）。`decideNextSpeaker` から invite 分岐が消え (1)(2) の素直な採番になる。
- **Trade-offs**: 決定が orchestrator private メソッドに分散するが、各々が単一責務で短い。
- **Follow-up**: A/B は「指名が無いとき」のみ評価する gate を orchestrator 側に置く。

### Decision: 制御閾値を `flow/constants.ts` に単一定義
- **Context**: 二重定義・無名境界（要件6）。
- **Selected Approach**: `INTENT_EXPIRY_TURNS` / `HIGH_ENGAGEMENT_SCORE` / `MAX_CONSECUTIVE_DIRECT` ほかを単一ファイルに集約。キュー選択は `< HIGH_ENGAGEMENT_SCORE` で表現。
- **Rationale**: 真に共通な「値の定義」のみの共通化＝条件分岐を増やさない（指針2に合致）。
- **Trade-offs**: なし（純粋な前進）。

## Risks & Mitigations
- **純整理と振る舞い変更の混在** — コミット/タスクを「振る舞い不変の整理」と「確定変更（B クールダウン・指名優先・毎ターン評価）」に分け、各段で Vitest をグリーンに保つ。
- **状態更新順序の取り違え（キュー追加は決定後）** — キュー追加は話者決定後の post-turn ステップに置くことを設計で固定。
- **スコア境界の向き逆転** — `HIGH_ENGAGEMENT_SCORE` 単一定数＋選択側 `<` 表現で固定。
- **エミュレータ非使用** — ロジックは Vitest、最終確認のみ本番デプロイ（project-no-emulator）。

## References
- `.kiro/specs/debate-flow-simplification/requirements.md` — 要件1〜9
- `.kiro/specs/debate-flow-simplification/gap-analysis.md` — §4 確定した振る舞い変更、§7 推奨
- `functions/src/pipeline/debate-orchestrator.ts` / `flow/*` / `agents/facilitator-agent.ts` — 整理対象
