# Research & Design Decisions

## Summary
- **Feature**: `agenda-progression-unification`
- **Discovery Scope**: Extension（既存討論パイプラインの縮約。新規外部依存なし）
- **Key Findings**:
  - `addressed` の付与箇所は `progressAgenda` の exhausted→前進分岐が唯一であり、そこへ到達するための直列ゲート（立場カバレッジ・persona-chain・高意欲）が盛り上がる討論では実質恒久的に閉じる。これが「論点終了フラグが立たない」問題の全容
  - 「facilitator 指名中は評価しない」トリガー分岐は、クールダウン（ファシリテーター発言直後はペルソナターン数 0）と完全に重複しており、撤去しても挙動不変であることをコード上で確認
  - 前進介入の直前に `addQueuedIntents` が高意欲者の発言意図をキューに積むため、高意欲ゲートを撤去しても意欲者の発言機会は失われない
  - フロントエンドの `AgendaItemState` は元から `point` / `status` のみで、カバレッジフィールド撤去による FE 影響はゼロ

## Research Log

### 論点終了フラグが立たない実行時経路の特定
- **Context**: 実討論ログで、第1論点に対し司会が同趣旨の問いを別参加者へ振り直し続け、章ハードキャップまで走る現象が観測された
- **Sources Consulted**: `functions/src/pipeline/debate/intervention.ts` / `step.ts` / `agenda.ts` / `speaker-selection.ts` / `debate-orchestrator.ts`、`agents/facilitator-agent.ts`、`constants/debate.constants.ts`、実討論の出力ログ
- **Findings**:
  - exhausted 判定が出ても `unheardActive`（未発言の関連参加者が残る）が先に評価され、bring-in（同一論点で別人指名）に差し替えられる。`relevantPersonaIds` は広く取られがちで、話者選択で選ばれない参加者が残ると集合が埋まらない
  - カバレッジが埋まっても `hasHighEngagement`（score >= 4）が前進を抑止する。熱い討論では常時成立
  - 観測されたループの実体は bring-in（主）＋ pull-back（従）で、`hasHighEngagement` 分岐には到達すらしていなかった（`unheardActive` が先に真になるため）
- **Implications**: ゲートの調整ではなく、exhausted 判定を前進の十分条件とする構造変更が必要

### 「facilitator 指名中は評価しない」分岐の冗長性検証
- **Context**: トリガー3分岐（no-target / persona-chain / undefined）の撤去可否
- **Sources Consulted**: `step.ts` の `interventionTrigger` 構築、`intervention.ts` の `shouldEvaluateIntervention` / `countPersonaTurnsSinceFacilitator`
- **Findings**: undefined（facilitator 指名中）になるのは末尾ターンがファシリテーター発言のときのみ。その時点で `countPersonaTurnsSinceFacilitator = 0 < cooldown` のため、トリガー分岐がなくてもクールダウンゲートで必ず評価スキップされる
- **Implications**: トリガー種別の撤去は facilitator 指名ケースについて挙動中立。persona-chain の別クールダウン（5）だけが実挙動差であり、これは単一クールダウンへの一本化として要件（2.2, 2.3）に明記済み

### 高意欲ゲート撤去の安全性
- **Context**: 前進時に高意欲者の発言機会が失われないか
- **Sources Consulted**: `intervention.ts` の `addQueuedIntents` 呼び出し順序、`queued-intents.ts`
- **Findings**: 介入ターン永続の直前に、意欲の高い他ペルソナの意図がキューに積まれる（`speakerSelection.personaId=''` で除外なし）。キューは話者選択で「指名 > キュー > スコア」の優先度を持つ
- **Implications**: 前進しても意欲者はキュー経由で発言機会を得る。高意欲ゲートは前進抑止の必要条件ではない

### 永続データ互換とフロントエンド影響
- **Context**: `AgendaItemState` から `spokenPersonaIds` / `relevantPersonaIds` を撤去した際の互換性
- **Sources Consulted**: `functions/src/pipeline/debate/chapter.ts`（復元）、`agenda.ts`（保存）、`src/lib/models/chapter/chapter.types.ts`、`GenerateDebatePage.svelte`
- **Findings**:
  - 両フィールドは optional。復元側は `agendaItemStatuses` をそのまま読むだけで、旧フィールドが残っていても参照されず無害
  - 保存（`saveAgendaItemStatuses`）は配列全体を書き換えるため、次回保存時に旧フィールドは自然に消える。章完了時はフィールドごと削除される
  - フロントエンドの型は元から `point` / `status` のみ。表示も同様
- **Implications**: マイグレーション不要。型定義からの削除のみで要件 4.4 が成立

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存フローの縮約（採用） | `progressAgenda` / `executeTurn` の構造を保ちゲート・トリガー・カバレッジ機構を削除 | 差分が削除中心でレビュー容易。維持対象に触れない | ファイル名・配置は現状のまま | gap-analysis の推奨 |
| B: 新モジュール切り出し | 進行編成を新ファイルに再実装し intervention.ts を廃止 | 名前と責務の一致 | 削除と移動が混ざり回帰リスク増。挙動に寄与しない | 不採用 |
| C: 縮約→後日改名 | A で縮約し、配置整理は別 spec に委ねる | 検証変数を1つに絞る方針と整合 | — | 実質 A と同一。改名をスコープ外に明示 |

## Design Decisions

### Decision: exhausted 判定を前進の十分条件とする
- **Context**: 出尽くし判定が出ても3つの直列ゲートが前進を封じ、論点が消化されない
- **Alternatives Considered**:
  1. bring-in の予算化（1論点あたり上限N回）— カバレッジ機構を保ちつつ有限化
  2. 高意欲ゲートの閾値調整のみ — 主因（カバレッジゲート）に触れない
  3. exhausted 即前進（採用）
- **Selected Approach**: verdict === 'exhausted' なら立場カバレッジ・意欲スコアに関わらず addressed 化＋次論点投入
- **Rationale**: exhausted 判定自体が「主要な意見・異なる立場がひととおり出た」の判定であり、中身のカバレッジはそこで担保される。ID集合ベースのカバレッジは粗い代理指標にすぎず、代理指標が本判定より優先される現構造が倒錯している
- **Trade-offs**: 制御が単純化し進行が予測可能になる一方、判定LLMの exhausted 感度が前進の唯一のドライバになる（早すぎる前進が新失敗モード）
- **Follow-up**: デプロイ後、論点あたりターン数・addressed 到達率・章終了理由比率を観測する

### Decision: カバレッジ機構は dormant 化ではなく完全撤去
- **Context**: exhausted 即前進により bring-in の発火経路が消滅する
- **Alternatives Considered**:
  1. コードを残し発火しないままにする（dormant）
  2. 機構ごと削除（採用）
- **Selected Approach**: bring-in 介入・追跡関数・永続フィールド・opening/導入プロンプトの関連参加者生成を一式削除
- **Rationale**: 死んだコードを残さないプロジェクト方針。追跡・永続・プロンプト生成のコストも純減
- **Trade-offs**: 将来カバレッジ的な制御を再導入する場合は git 履歴からの復元になる
- **Follow-up**: なし

### Decision: トリガー種別を撤去しクールダウン1本に統合
- **Context**: 進行評価の起動条件が2層（トリガー3分岐×2種クールダウン＋ゲート群）に分散
- **Alternatives Considered**:
  1. persona-chain の別クールダウンを残す
  2. 単一クールダウンへ統合（採用）
- **Selected Approach**: `DEFAULT_INTERVENTION_COOLDOWN` のみを起動条件とし、末尾指名状態に関わらず3値判定を実行
- **Rationale**: facilitator 指名ケースはクールダウンと重複（挙動中立）。persona-chain の保護は「議論が生きていれば ongoing」で実質担われる。チェーン切断の許容は exhausted 即前進の方針そのもの
- **Trade-offs**: 指名チェーン中の前進で末尾の未応答指名が切られうる（章末は最終応答+1で救済、章中はキュー積みで緩和）
- **Follow-up**: 観測時にチェーン切断の頻度・不自然さを確認

## Risks & Mitigations
- exhausted 判定の感度が高すぎて論点を駆け足消化する — 観測ポイント（論点あたりターン数・章終了理由比率）を設け、必要なら判定プロンプト調整を後続 spec で実施
- 指名チェーン中の前進で会話が不自然に切れる — introduce 発言は「話を完全に切り替える」設計のため文脈上は成立する。観測で確認
- テスト書き換え漏れによる回帰 — 維持対象（allAddressed 終了・早期終了取り消し・cap・最終応答+1）の回帰テストを先に固定してから削除に着手

## References
- `.kiro/specs/chapter-agenda-progression/` — 撤去対象（立場カバレッジ）を導入した先行 spec
- `.kiro/specs/agenda-progression-unification/gap-analysis.md` — Requirement→資産マップと影響ファイル一覧
