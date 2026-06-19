# Requirements Document

## Project Description (Input)
討論参加者（ペルソナ）が自分の意見を述べるだけでなく、他の参加者に質問したり意見を求めたりする相互交流を増やす。engagement評価にquestionモードを追加し、「誰に何を聞きたいか」を評価フェーズで計画させることで、ターン生成時に指名質問を促す。

## Introduction

現在の討論システムでは、ペルソナの発言意欲評価（engagement）が `fact / opinion / none` の3択であり、「特定の相手に質問したい」という意図を評価フェーズで表明する手段がない。そのため、ペルソナ同士の指名質問・直接対話が起きにくく、各自が意見を述べるだけの一方向的なターンになりやすい。

本仕様では、engagement評価に `question` モードを追加する。ペルソナは評価フェーズで「誰に何を聞きたいか」を計画し、ターン生成フェーズでその相手への指名質問として発言を生成する。これにより自然なペルソナ間対話が発生しやすくなる。

## Boundary Context

- **In scope**: engagement評価スキーマへの `question` モード追加、ターン生成における質問指示の強化、`Engagement` / `PersonaReply` / `DebateTurn` 型の拡張
- **Out of scope**: ファシリテーター介入ロジックの変更、`MAX_PAIR_CONVERSATION_TURNS` などの既存制限値の変更、話者選択アルゴリズム自体の変更（指名優先の仕組みは既存のまま活用）
- **Adjacent expectations**: `question` モードで生成されたターンが `targetPersonaId` を持てば、既存の話者選択ロジック（`targeted_by_persona`）がそのまま機能する

---

## Requirements

### 要件 1: engagementへのquestionモード追加

**Objective:** As a developer, ペルソナの発言意欲評価で「特定の参加者に質問したい」という発言形式を表明できるようにしたい。評価フェーズで質問意図を計画させることで、ターン生成を質問形式に誘導するため。

#### Acceptance Criteria
1. The debate system shall support `'question'` as a valid value for `Engagement.mode`, alongside existing `'opinion'`, `'fact'`, and `'none'`.
2. When a persona's engagement mode is `question`, the debate system shall require a non-empty `intentSummary` describing what they want to ask and, where applicable, whom they want to address.
3. The debate system shall pass the list of other participating personas (name only) to the engagement evaluation prompt so the LLM can reference specific participants in `intentSummary`.
4. If a persona evaluates engagement as `question` mode but provides no `intentSummary`, the debate system shall treat the engagement as `opinion` mode.

---

### 要件 2: questionモードでのターン生成

**Objective:** As a developer, questionモードで評価したペルソナのターン生成時に、他の参加者への質問として発言を生成させたい。質問がターンとして記録されることで、指名された参加者が次に応答する既存の仕組みを活性化するため。

#### Acceptance Criteria
1. When `generateTurn` is called with an engagement whose mode is `question`, the debate system shall include an explicit instruction directing the persona to ask a question of another participant, using `intentSummary` as the basis.
2. When a persona generates a turn in `question` mode, the debate system shall set `speechMode` to `'question'` on the resulting `PersonaReply`.
3. The debate system shall add `'question'` as a valid value for `speechMode` in both `PersonaReply` and `DebateTurn` types.
4. When a persona generates a turn in `question` mode, the debate system shall set `targetPersonaId` on the generated turn to identify the question recipient.
5. If `targetPersonaId` is not set on the generated turn despite `question` mode instruction, the debate system shall treat the resulting turn as `opinion` speechMode.

---

### 要件 3: questionモードの選択基準の明確化

**Objective:** As a developer, LLMがquestionモードをいつ選ぶべきかを明確に定義したい。適切な頻度で質問が発生し、過剰にも不足にもならないようにするため。

#### Acceptance Criteria
1. The debate system shall define `question` mode as: 直前または以前の発言を受けて特定の参加者に問い返し・確認・反論を向けたい場合に選択する。
2. The debate system shall instruct the engagement evaluator to apply the following priority when selecting mode: `question`（特定の相手に聞きたい・問い返したいことがある）> `fact`（紹介すべき事実・データを持っている）> `opinion`（考え・実感を述べたい）> `none`（発言不要）.
3. The debate system shall instruct the engagement evaluator that a persona must not select `question` mode to address themselves.
