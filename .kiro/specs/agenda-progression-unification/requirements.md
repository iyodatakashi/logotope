# Requirements Document

## Project Description (Input)

ファシリテーターのアジェンダ進行を「クールダウン＋3値判定」に一本化する。

### 背景（観測された問題）

盛り上がる討論では、1つ目の論点に対して司会が同じ趣旨の質問を別の参加者へ振り直し続け、論点終了フラグ（agendaItem の `addressed`）が立たないまま章のハードキャップ（AGENDA_TURN_CAP_RATIO）までターンを消費する。原因は、出尽くし判定（`verdict === 'exhausted'`）が出ても前進（addressed 化＋次論点投入）が以下の直列ゲートに封じられる構造にある:

1. 立場カバレッジゲート（`unheardActive`）: 未発言の関連参加者が1人でも残る限り前進を封じ bring-in（同一論点のまま別人を指名）に限定する。関連参加者集合（`relevantPersonaIds`）が広く取られがちで、話者選択で選ばれない参加者が残ると集合が永久に埋まらない。
2. 高意欲ゲート（`hasHighEngagement`）: score >= 4 の参加者が1人でもいると前進を抑止する。熱い討論では常に成立し、恒久的に前進が止まる。

さらに、介入評価のトリガー（no-target / persona-chain / facilitator指名中は評価なし、の3分岐と2種のクールダウン）と前進ゲート（カバレッジ・チェーン・高意欲の3条件）という2層の条件系が併存し、複雑さの温床になっている。

### 方針

- 出尽くし（exhausted）判定を前進の十分条件とする（exhausted 即前進）。exhausted 判定自体が「主要な意見・異なる立場がひととおり出た」の判定であり、中身としてのカバレッジはそこで担保されるという整理。
- 進行制御を「クールダウン1本＋3値判定（ongoing / drifted / exhausted）」に統合する:
  - ongoing → 何もしない（指名チェーンも自然に続く）
  - drifted → pull-back（アクティブ論点へ引き戻し）
  - exhausted → アクティブ論点を addressed 化し次論点を投入（未提示が残らなければ章終了へ）
- 撤去するもの:
  - 立場カバレッジ機構一式: bring-in 介入、`relevantPersonaIds` / `spokenPersonaIds` の追跡・永続、`recordSpeakerOnActiveAgendaItem`、`getUnheardRelevant`、オープニング/章導入での relevantPersonaIds 生成
  - 高意欲ゲート: `hasHighEngagement` による前進抑止（`STALL_INTERVENTION_THRESHOLD_SCORE` が他で未使用なら定数ごと）
  - トリガー種別: `InterventionTrigger`（no-target / persona-chain）、`countConsecutivePersonaTargets`、`PERSONA_CHAIN_INTERVENTION_COOLDOWN`（クールダウンを1本化）
  - 「facilitator 指名中は評価しない」の特別扱い（ファシリテーター発言直後はクールダウン未達で評価されないため冗長）
- 残すもの:
  - クールダウン（ファシリテーター発言以降のペルソナターン数による評価間引き）
  - 3値判定（`assessActiveAgendaItem`）と pull-back / introduce の介入発言生成
  - 章終了判定（decideNextStep の allAddressed / cap / earlyEnd）と committed-no-turn（chapter-exhausted）経路
  - 未消化論点が残る間の早期終了取り消し（reconcileEarlyEndCoverage）

### 補足

- 本 spec は chapter-agenda-progression spec が導入した立場カバレッジ（bring-in）機能を意図的に撤去する。exhausted 判定への一本化により役割が重複するため。
- `relevantPersonaIds` を絞る等の生成側の改善は本 spec の範囲外とし、本変更の効果検証後に判断する（検証変数を1つに絞る）。
- 影響範囲: functions 側の intervention / step / agenda / speaker-selection / facilitator-agent / 型 / 定数、および永続型 `AgendaItemState` の形状（relevantPersonaIds / spokenPersonaIds フィールドの廃止）。

## Introduction

本仕様は、討論のアジェンダ進行制御を「クールダウン＋3値判定」へ一本化する再設計を定義する。現行実装では、出尽くし判定が出ても立場カバレッジゲート・高意欲ゲートが前進を封じ、盛り上がる討論では論点が消化（addressed）されないまま同趣旨の問いかけが繰り返され、章ターン上限まで走り切る問題が観測されている。本仕様では exhausted 判定を前進の十分条件とし、判定と直交する介入トリガー種別・ゲート群を撤去することで、論点の進行を予測可能かつ検証可能にする。

## Boundary Context

- **In scope**: functions 側の討論進行制御（進行評価のトリガー、3値判定に基づく前進・引き戻し、論点ステータスの記録・永続、立場カバレッジ機構の撤去、章終了条件への接続）
- **Out of scope**: 3値判定（assessActiveAgendaItem）のプロンプト・判定品質の変更、章立て・論点リストの生成（chapter-agent）、関連参加者リストを絞る等の生成側改善（本変更の効果検証後に別途判断）、フロントエンドの表示変更
- **Adjacent expectations**: chapter-agenda-progression spec が導入した立場カバレッジ（bring-in）機能は本仕様で意図的に撤去する。章終了判定（decideNextStep）・committed-no-turn 経路・早期終了取り消しの既存挙動は維持する

## Requirements

### Requirement 1: 出尽くし判定による論点前進

**Objective:** As a 討論コンテンツの閲覧者, I want 論点が実質的に出尽くしたら討論が次の論点へ進むこと, so that 同じ問いの繰り返しがなく、読み進めるほど議論が展開するコンテンツになる

#### Acceptance Criteria

1. When アクティブ論点の判定が exhausted となったとき, the 討論進行システム shall アクティブ論点を addressed に更新した上で、未提示（untouched）論点から次の1件を投入する介入発言を生成する
2. When 判定が exhausted で未提示論点が残っていないとき, the 討論進行システム shall 新しい論点を発明せず、介入発言も生成せず、アクティブ論点の addressed 化のみを永続して章終了判定へ渡す
3. The 討論進行システム shall 前進（addressed 化と次論点投入）の可否を、関連参加者の発言済み状況（立場カバレッジ）に依存させない
4. The 討論進行システム shall 前進の可否を、参加者の発言意欲スコアの高低に依存させない
5. When 前進により論点ステータスが変化したとき, the 討論進行システム shall 変更後の論点ステータスを章ドキュメントへ永続する

### Requirement 2: 進行評価トリガーの一本化

**Objective:** As a 開発者, I want アジェンダ進行評価の起動条件が単一のクールダウンのみであること, so that 制御構造が単純になり、進行が止まる原因を特定しやすくなる

#### Acceptance Criteria

1. While 直近のファシリテーター発言以降のペルソナ発言数が既定クールダウン未満である間, the 討論進行システム shall アジェンダ進行評価（3値判定）を行わない
2. When クールダウンに達したとき, the 討論進行システム shall 末尾ターンの指名状態（指名なし・ペルソナ間指名・ファシリテーター指名）に関わらず、単一の3値判定を1回実行する
3. The 討論進行システム shall 指名チェーン等のトリガー種別ごとに異なるクールダウン値を持たない
4. When 判定が ongoing のとき, the 討論進行システム shall 介入発言を生成せず、論点ステータスも変更せず、討論を継続する

### Requirement 3: 論点ずれの引き戻し

**Objective:** As a 討論コンテンツの閲覧者, I want 会話が論点から逸れたら司会が本題へ戻すこと, so that 章の主題を見失わずに読み進められる

#### Acceptance Criteria

1. When 判定が drifted のとき, the 討論進行システム shall アクティブ論点へ引き戻すファシリテーター発言を生成し、1ターンとして永続する
2. When 引き戻しを行ったとき, the 討論進行システム shall 論点ステータスを変更しない（addressed を付けない）
3. If 引き戻し発言の指名先が有効な参加者IDでない場合, the 討論進行システム shall その介入を採用せず討論を継続する

### Requirement 4: 立場カバレッジ機構の撤去

**Objective:** As a 開発者, I want bring-in 介入と立場カバレッジ追跡が撤去されていること, so that exhausted 判定と役割が重複する制御が残らず、死んだコードのない状態を保てる

#### Acceptance Criteria

1. The 討論進行システム shall bring-in（未発言の関連参加者を引き込む）介入を行わない
2. The 討論進行システム shall 論点ごとの関連参加者・発言済み参加者（relevantPersonaIds / spokenPersonaIds）を追跡・永続しない
3. When オープニングまたは章導入の発言を生成するとき, the 討論進行システム shall 関連参加者リストの生成を要求しない
4. If 既存の章ドキュメントに旧形式のカバレッジフィールド（relevantPersonaIds / spokenPersonaIds）が残っている場合, the 討論進行システム shall エラーなく進行を継続する

### Requirement 5: 章終了条件の維持（回帰保護）

**Objective:** As a 討論コンテンツの管理者, I want 章終了の既存条件が本変更後も維持されること, so that 論点の取りこぼしや章の走りすぎが起きない

#### Acceptance Criteria

1. When 章の全論点が addressed になったとき, the 討論進行システム shall 盛り上がりの高低に関わらず章を終了する
2. While addressed でない論点が残っている間, the 討論進行システム shall 早期終了（沈静化による打ち切り）を取り消して章を継続する
3. The 討論進行システム shall 章ターン上限および討論全体のターン上限をハード終了条件として維持する
4. When 章終了と判定された時点で末尾に未応答の指名が残っているとき, the 討論進行システム shall 最終応答ターンを1回だけ挟んでから章を終了する
