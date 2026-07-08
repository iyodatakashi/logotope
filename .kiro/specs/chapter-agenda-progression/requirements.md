# Requirements Document

## Introduction
討論の各章は、その章に割り当てられた agendaItem（論点）を消化するためのアジェンダを持つ。司会（ファシリテーター）は、アクティブな論点が「出尽くし（主要な意見・対立がひととおり出て、新しい視点・反論・具体例が加わらない状態）」と判断すると次の論点へ前進する。しかし現状は次の3点に問題がある：(1) 次論点への前進時、司会の発言が選んだ論点そのものに切り込まず、直前の流れの続きにすり替わる（記録される論点と実際の話題がずれる）。(2) 未提示論点が尽きても司会が章の趣旨で新論点を発明し、他章で扱うべき論点にまで踏み込みうる。(3) 出尽くし判断は前進のトリガーにしか使われず、前進元の論点が消化済み(addressed)として記録されない。addressed は別途、早期終了間際の一括カバレッジ評価でしか判定されないため、盛り上がっている間はアジェンダ完了を検知できず、拡張 cap（`AGENDA_TURN_CAP_RATIO`）まで章が惰性で続く。

本機能は、司会が章のアジェンダ（論点）を忠実に進行し（アジェンダ外を発明せず）、各論点を出尽くし判断の時点で消化済みとして記録し、全論点を消化しきった時点で章を終了する、という一連の「章アジェンダ進行」を正す。

## Boundary Context
- **In scope**: 次論点投入の忠実性（選んだ論点そのものへの問いかけ）、アジェンダ外の論点発明の禁止、出尽くし判断からの逐次的な addressed 記録、全論点消化の検知による章終了、消化専用の追加 LLM 評価を発生させないこと、未消化が残る間の既存継続挙動の維持。
- **Out of scope**: 論点そのものの生成・章立て（`chapter-generation-scoring` 系）、発言意欲（engagement）評価ロジックの変更、立場カバレッジ判定そのものの再設計（`discussion-point-standpoint-coverage` の既存挙動は前提として尊重）。
- **Adjacent expectations**: 論点チェックリスト管理（`chapter-agenda-tracking`）、立場カバレッジと未発言関連参加者ゲート（`discussion-point-standpoint-coverage`）、アクティブ論点＝最新 introduced の運用（`discussion-point-consolidation`）を前提とし、これらの既存挙動を壊さない。

## Requirements

### Requirement 1: 次論点投入の忠実性
**Objective:** As 討論の閲覧者, I want 司会が次の論点へ移るとき、その論点そのものについて問いかけてほしい, so that 記録される論点と実際の話題が一致し、討論が論点に沿って進む

#### Acceptance Criteria
1. When 司会が次の未提示論点へ前進する, the 討論オーケストレーション shall 司会の発言(content)を、選ばれた論点そのものを主題として正面から問いかける形にする
2. The 討論オーケストレーション shall 次論点投入の発言について、選んだ論点の語を混ぜるだけで実質は直前の流れの続きに留まる折衷を許さない
3. When 司会が次論点へ前進する, the 討論オーケストレーション shall 記録上 introduced 化する論点と、司会が実際に問いかける論点とを一致させる

### Requirement 2: アジェンダ外の論点発明の禁止
**Objective:** As プロダクト管理者, I want 司会が章のアジェンダ外の論点を作らないでほしい, so that 討論が章のアジェンダ内に留まり、他章で扱うべき論点に踏み込まない

#### Acceptance Criteria
1. While 章に agendaItem が定義されている, the 討論オーケストレーション shall 司会が投入する論点を、その章の未提示論点リストに存在するものだけに限定する
2. When 章の未提示論点が尽きている（全論点提示済み）, the 討論オーケストレーション shall 司会に新しい論点を発明・投入させない
3. Where 章が agendaItem を持たない, the 討論オーケストレーション shall 従来どおり章の趣旨に沿った自由な論点進行を許可する

### Requirement 3: 出尽くし判断による論点の消化記録
**Objective:** As プロダクト管理者, I want 司会が論点を出尽くしと判断した時点でその論点を消化済みとして記録してほしい, so that アジェンダの進捗を追加の LLM 評価なしに逐次追跡できる

#### Acceptance Criteria
1. When 司会がアクティブ論点を出尽くしと判断して次の未提示論点へ前進する, the 討論オーケストレーション shall 前進元（直前までアクティブだった）論点を addressed に更新する
2. When 司会がアクティブ論点を出尽くしと判断したが投入できる未提示論点が残っていない, the 討論オーケストレーション shall そのアクティブ論点を addressed に更新する
3. While アクティブ論点に立場を聞くべき未発言の関連参加者が残っている, the 討論オーケストレーション shall そのアクティブ論点を addressed に更新せず、既存の立場カバレッジゲート（前進の保留）を尊重する
4. If 司会介入がアクティブ論点への引き戻し（前進を伴わない）である, then the 討論オーケストレーション shall 論点の addressed 更新を行わない

### Requirement 4: 全論点消化の検知による章終了
**Objective:** As 討論コンテンツの管理者, I want 全論点が消化済みになった時点で章を終了してほしい, so that 消化後の惰性的な引き延ばしを避けられる

#### Acceptance Criteria
1. When 章の全 agendaItem が addressed になった, the 討論オーケストレーション shall その章を終了する
2. While 全 addressed の検知による章終了に至った, when 末尾に未応答の指名が残っている, the 討論オーケストレーション shall 最終応答ターンを1回だけ挟んでから章を終了する
3. The 討論オーケストレーション shall engagement スコアや quietStreak の高低に関わらず、全 addressed 検知時の章終了を成立させる
4. Where 章が agendaItem を持たない, the 討論オーケストレーション shall 本終了条件を適用せず、従来の終了挙動（cap / quietStreak）に従う

### Requirement 5: 消化専用の追加 LLM 評価を伴わないこと
**Objective:** As プロダクト管理者, I want 消化(addressed)判定のために追加の LLM 呼び出しを発生させたくない, so that コスト増を避けられる

#### Acceptance Criteria
1. The 討論オーケストレーション shall 論点の addressed 判定を司会の既存の出尽くし判断から導出し、消化判定専用の新たな LLM 呼び出しを追加しない
2. The 討論オーケストレーション shall 出尽くし由来の addressed 記録だけで章の消化完了を確定できるようにし、消化判定のための一括カバレッジ評価に依存しない

### Requirement 6: デグレ防止と既存ハード上限・全体制御との整合
**Objective:** As プロダクト管理者, I want 本機能が消化前の早期終了や既存の上限制御を壊さないことを保証したい, so that 論点の取りこぼしなく安全に導入できる

#### Acceptance Criteria
1. While 章に未 addressed の論点が1件以上残っている, the 討論オーケストレーション shall 全 addressed 起因の章終了を行わない
2. The 討論オーケストレーション shall 章ターン上限（cap）および討論全体のターン上限（maxTurns）を、本機能の導入後も引き続きハードな終了条件として尊重する
3. If 全 addressed の検知より前に章ターン上限または全体ターン上限へ到達した, then the 討論オーケストレーション shall 従来どおりその上限で章を終了する
