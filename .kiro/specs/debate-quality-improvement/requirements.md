# Requirements Document

## Introduction
logotope のマルチエージェント討論システムにおける発言品質の改善。現状、同一ペルソナが連続発言するケースや、ペルソナの属性（年齢・職業・経験レベル）に沿わない語り口が生成されるケースが確認されている。本仕様はこれら2つの問題を解決し、読者にとって自然で多様性のある討論コンテンツを実現する。

## Boundary Context
- **In scope**: ペルソナエージェントの発言スタイル制御、討論オーケストレーターの発言順序制御
- **Out of scope**: ペルソナ生成フェーズ（Phase2）の改善、ファシリテーターの発言スタイル、フロントエンド表示
- **Adjacent expectations**: persona-agent.ts・debate-orchestrator.tsの変更のみでFunctions再デプロイが必要

## Requirements

### Requirement 1: 連続発言の防止

**Objective:** 討論管理者として、同じペルソナが連続して発言しない順番制御を求める。そうすることで、複数の視点が交互に展開される対話的な討論が生成される。

#### Acceptance Criteria
1. When ファシリテーターが次の発言者を選択するとき, the Debate Orchestrator shall 直前に発言したペルソナと同一のペルソナを次の発言者として選択しない。
2. When 直前の発言者が特定のペルソナへの返答を明示的に指定した場合（addressedToPersonaId）, the Debate Orchestrator shall そのペルソナを次の発言者として優先する（連続発言防止より優先）。
3. If 連続発言禁止により選択できるペルソナが存在しない場合（参加者が1名のみなど）, the Debate Orchestrator shall 直前の発言者の再選択を許容する。
4. The Debate Orchestrator shall 連続発言防止ルールをファシリテーターの自動選択（selectNextSpeaker）とオーケストレーター側の両方で適用する。

---

### Requirement 2: ペルソナ属性に応じた語り口の個性化

**Objective:** 討論管理者として、各ペルソナの年齢・職業・経験レベルを反映した個性的な語り口での発言生成を求める。そうすることで、ペルソナの人物像が読者に伝わり、討論コンテンツの信頼性と多様性が高まる。

#### Acceptance Criteria
1. The Persona Agent shall ペルソナの年齢・職業・経験レベルから推定される言語スタイルの指針をシステムプロンプトに含める。
2. When ペルソナが若手・エントリーレベルの人物として定義されている場合, the Persona Agent shall 平易な語彙・短い文・口語体（「〜だと思います」「〜なんですが」など）で発言を生成する。
3. When ペルソナが上級管理職・専門家として定義されている場合, the Persona Agent shall その職業・業界に固有の専門語彙と論理的な構文で発言を生成する。
4. When ペルソナが現場作業者・職人として定義されている場合, the Persona Agent shall 経験談や具体的な現場感を伴う語り口で発言を生成する。
5. The Persona Agent shall ペルソナの属性から語り口の指針を動的に生成し、画一的なビジネス敬語での発言を禁止する。
6. The Persona Agent shall ペルソナの性別を語り口に微細に反映する（強調しすぎず、自然な差異として）。
7. When ペルソナが上位の地位・権力を持つ立場（管理職・経営者・有識者など）として定義されている場合, the Persona Agent shall 過度な謙遜・丁寧すぎる言い回しを避け、自信を持った断言的な話し方で発言を生成する。
8. When ペルソナが下位の地位・立場（新人・一般市民・サービス利用者など）として定義されている場合, the Persona Agent shall 遠慮がちな表現や疑問形での主張（「〜じゃないかと思うんですが」など）を自然に含めて発言を生成する。

---

### Requirement 3: ファシリテーターによる参加バランスの調整

**Objective:** 討論管理者として、ファシリテーターが特定の参加者間のやりとりを邪魔せず、会話に区切りがついたタイミングで発言量の少ない参加者に話を振ることを求める。そうすることで、討論全体を通じた参加の公平性が保たれる。

#### Acceptance Criteria
1. The Debate Orchestrator shall ファシリテーターの介入評価を固定ターン間隔ではなく、会話の状態に基づく条件でのみ実行する。
2. When 直前ターンで特定のペルソナへの直接指名（addressedToPersonaId）が連続している場合, the Debate Orchestrator shall ファシリテーターの介入評価をスキップし、直接やりとりを継続させる。
3. When 直接やりとりに区切りがついた（直接指名なしのターンが発生した）タイミングで, the Debate Orchestrator shall 各ペルソナの累計発言数（speakCount）を参照して参加バランスを評価する。
4. When 参加バランスの評価を行う場合, the Facilitator Agent shall 発言数の少ないペルソナのうち、直近の会話コンテキスト（論点・テーマ）に関連度が高い人物を優先して invite 型介入を行う。
5. When 最後のファシリテーター介入から一定ターン数が経過した場合, the Debate Orchestrator shall 直接やりとり中であっても参加バランスの評価を実行する（上限付き遅延）。
6. When 特定のペルソナが沈黙閾値（ペルソナ総数を超えるターン数）以上発言していない場合, the Debate Orchestrator shall 緊急の invite 型介入を実行する。

---

### Requirement 4: ファシリテーター主導の討論終了

**Objective:** 討論管理者として、固定のターン数上限ではなくファシリテーターが「議論が尽くされた」と判断したタイミングで討論が終了することを求める。そうすることで、話に区切りがつく前に打ち切られることなく、自然な締めくくりの討論コンテンツが生成される。

#### Acceptance Criteria
1. The Debate Orchestrator shall 討論の主たる終了条件をターン数上限ではなく、ファシリテーターが close 型介入を行ったタイミングとする。
2. When ファシリテーターが close 型介入を返し、かつ全ペルソナが最低発言回数（minTurnsPerPersona）を満たしている場合, the Debate Orchestrator shall 討論を終了する。
3. The Debate Orchestrator shall 際限なく討論が継続することを防ぐためのセーフティネットとして、上限ターン数（maxTurns）を設ける。ただし通常の討論ではこの上限に達しないよう、十分に大きな値を設定する。
4. When 討論がセーフティネットの上限ターン数に達した場合, the Debate Orchestrator shall 強制的に討論を終了してクロージングへ移行する。
