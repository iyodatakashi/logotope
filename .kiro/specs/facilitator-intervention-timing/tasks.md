# Implementation Plan

> **R6（ペルソナの過剰指名抑制）は当初は意図的に延期していた。**
> 理由: 指名抑制を同時に入れると指名連鎖そのものが減り、コアの仕組み（指名チェーン中の drift 出尽くし判断＝R1〜R5）が効いたのか、単に入力（指名頻度）が減っただけなのかを切り分けられなくなるため。まず R1〜R5 を実装・検証した。
>
> **その後、実走フィードバック（介入が「ペルソナ3発言→ファシリテーター」の3ターン周期に固定化）を受けて R6 を前倒し実装（Task 6）。** あわせて介入頻度を下げるチューニング（drift 判断の中庸化・`persona-chain` 専用クールダウン `PERSONA_CHAIN_INTERVENTION_COOLDOWN=5`）も実施した（Task 7）。

- [x] 1. 連続指名チェーン長の計測関数を追加する
  - 章ローカルの永続ターン列を受け取り、末尾から遡って `targetedBy='persona'` のペルソナ指名が連続する数を返す純関数を `intervention.ts` に実装する
  - ファシリテーター発言・指名なしペルソナ発言・`targetedBy='facilitator'` 指名に当たった時点で打ち切る（それらでは 0 を返す）
  - 既存 `countPersonaTurnsSinceFacilitator` と同じ純関数パターンに揃える（乱数・時刻・I/O なし、決定的）
  - 観測可能な完了条件: 空列=0 / 末尾 facilitator=0 / `targetedBy='facilitator'`=0 / 連続 N=N / 途中の指名なし発言で打ち切り、を検証するユニットテストが `intervention.test.ts` で green
  - _Requirements: 3.1, 3.2, 3.4, 5.2_

- [x] 2. (P) 論点ずれ介入の判断軸を「逸脱＋出尽くし」に拡張する
  - `evaluateTopicDrift` の criteria を、フォーカス問いからの逸脱に加えて「この応酬に新たな発展性が残っているか（指摘・質問に無理やり答えるだけの往復になっていないか）」も判断するよう拡張する（has-points / no-points 両方の criteria に反映）
  - 出尽くしと判断したら未完了論点を投入（無ければ引き戻し・振り直し）、逸脱なら引き戻し、本題が新たに深まっている最中なら見送り、の三択に整理する
  - 後方互換なオプション引数 `{ chainLength?: number }` を追加し、与えられたら「同じ相手指名が N 回続いている。長いほど発展性が尽きている可能性を疑う」旨を criteria に含める
  - 戻り値の型と `content`/`targetPersonaId`/`selectedDiscussionPointIndex` の意味は不変に保つ（options 省略時は従来挙動）
  - 観測可能な完了条件: criteria に出尽くし判断軸と chainLength 反映が含まれることをモックで検証するユニットテストが green
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.3_
  - _Boundary: evaluateTopicDrift_

- [x] 3. 介入トリガー判別を導入し tryIntervention を分岐する
  - `tryIntervention` に介入トリガー判別共用体（`no-target` / `persona-chain`）を受け取らせ、評価経路を分ける
  - `no-target` は従来どおり drift→stall（`hasHighEngagement` による論点空化も維持）
  - `persona-chain` は drift のみ評価し、未完了論点を常に渡す（`hasHighEngagement` による空化を適用しない）＋ `chainLength` を drift に渡す
  - いずれもクールダウン（`shouldEvaluateIntervention`）を満たすときのみ評価し、発火時は既存どおり `addQueuedIntents`→`persistInterventionTurn` で1ターン保存し論点を introduced に更新する
  - 観測可能な完了条件: `no-target` は drift→stall を呼ぶ／`persona-chain` は drift のみ・未完了論点と chainLength を渡す／クールダウン未達は評価しない、をモックで検証するユニットテストが green
  - _Requirements: 1.1, 1.2, 1.4, 2.4, 3.3, 7.4_
  - _Depends: 1, 2_
  - _Boundary: tryIntervention_

- [x] 4. executeTurn の介入ゲートを緩和しトリガーを構築する
  - 通常ターンで末尾指名を取得後、`!targetPersona` は `no-target`、`targetedBy='persona'` はチェーン長を算出して `persona-chain`、`targetedBy='facilitator'` は介入を試みず指名先に応答、と分岐する
  - 介入発火時はファシリテーターターンのみ保存して `quietStreak=0` で return し、同イテレーションでペルソナ応答を生成しない（順序保証を維持）
  - 非発火時は従来フロー（`selectSpeaker`→発言生成）にフォールスルーし、指名先または通常選択で応答する
  - ターン数（連続指名長）閾値による強制介入は実装しない（発火可否は drift 判断にのみ委ねる）。freeze 分岐には介入判定を一切適用しない
  - 観測可能な完了条件: ペルソナ指名チェーン中に drift 発火でファシリテーターターンのみ保存／`targetedBy='facilitator'` では介入せず指名先応答／介入後の次ターンでチェーン長が 0、が結合的に確認できる
  - _Requirements: 1.1, 1.3, 1.5, 4.1, 5.1, 5.2, 5.3, 7.3_
  - _Depends: 1, 3_
  - _Boundary: executeTurn_

- [x] 5. 結合テストと回帰確認を行う
  - 指名チェーン中の drift 発火フロー（ファシリテーターのみ保存・`quietStreak=0`・ペルソナ応答なし）と、drift 見送り時の指名先応答継続を結合テストで検証する
  - drift が一度も発火しなくても既存ハードキャップ（`TURN_CAP_RATIO`／`AGENDA_TURN_CAP_RATIO`／`MAX_TURNS`）で終端することを確認する
  - 既存の自己/不正 target 無効化（`turn.ts`）が変更なく維持されることを確認する
  - 観測可能な完了条件: `debate-parity` / `debate-step-idempotency` を含む既存テスト一式が回帰なく green、frontier/`runId` 世代照合・freeze・早期終了/カバレッジ補正が不変
  - _Requirements: 4.2, 5.1, 5.2, 5.3, 7.1, 7.2, 7.3_
  - _Depends: 4_

- [x] 6. ペルソナの過剰指名を抑制する（R6・前倒し実装）
  - `persona-agent.ts` の `targetingGuide` を強化し、指名は直接反論・確認が必要なときだけ・既定は未指定で場全体へ話すよう指示する（R6.1）
  - `targetBiasNote` を強化し、直前話者への再指名は「同じ二人の往復で議論が固定化する」ため原則控えるよう指示する（R6.2）
  - 自己/不正 target の無効化（R6.3）は `turn.ts` で実装済み・不変（Task 5 で回帰確認）
  - 観測可能な完了条件: opinion プロンプトに「既定は未指定／場全体」、`targetedBy='persona'` 時に「往復／固定」の文言が含まれることをモックで検証するユニットテストが green
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: persona-agent prompts_

- [x] 7. 介入頻度のチューニング（実走フィードバック対応）
  - `evaluateTopicDrift` の判断軸を中庸化（「原則介入しない」ではなく「論点がひととおり出尽くしたら前進、まだ新規性があれば見送り」）し、`chainLength` シグナルを中立化する
  - `persona-chain` 経路に専用クールダウン `PERSONA_CHAIN_INTERVENTION_COOLDOWN=5` を導入し、`step.ts` でトリガー種別に応じて使い分ける（no-target は既定3のまま）
  - 観測可能な完了条件: チェーンがクールダウン未満（5未満）では介入評価せず指名先が応答する／中庸な判断軸がプロンプトに含まれる、を結合・ユニットテストで検証して green
  - _Requirements: 1.4, 2.5_
  - _Depends: 4, 6_
  - _Boundary: evaluateTopicDrift, step executeTurn_

## Requirements Coverage

- R1（指名チェーン中の介入評価）: 1.1→3,4 / 1.2→3,4 / 1.3→4 / 1.4→3 / 1.5→4
- R2（出尽くしの検知と介入）: 2.1,2.2,2.3,2.5→2 / 2.4→3
- R3（チェーン長の計測とシグナル化）: 3.1,3.2,3.4→1 / 3.3→2,3
- R4（終了保証は既存ハードキャップ）: 4.1→4 / 4.2→5
- R5（介入後のリセットと復帰）: 5.1→4,5 / 5.2→1,4,5 / 5.3→4,5
- R6（過剰指名の抑制）: 6.1→6 / 6.2→6 / 6.3→既存維持（`turn.ts`、Task 5 で回帰確認）。当初延期したが実走フィードバックを受けて前倒し実装。
- R7（既存保証の維持）: 7.1,7.2→5 / 7.3→4,5 / 7.4→3
