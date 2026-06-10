# Requirements Document

## Introduction

本仕様は logotope の討論進行フローを再設計する。現行の問題点は「エンゲージメント評価が話者選択にしか使われておらず、選ばれたペルソナが自分の意図を参照して発言できていない」こと、および「発言ログ（最終成果物）に制御用データ（エンゲージメント・キュー）が混入している」ことである。

本仕様では、**エンゲージメント評価→話者選択→意図に基づく発言生成**を一貫したサイクルとして設計し直す。

## Boundary Context

- **In scope**: エンゲージメント評価・キュー管理・話者選択・発言生成の情報フロー全体の再設計
- **Out of scope**: ファシリテーターの発言ロジック、章管理（chapter progression）、公開ページのUI
- **Adjacent expectations**: 既存の `assessEngagement` / `generateTurn` インターフェースを拡張する形で実装する（破壊的変更を最小化）

---

## Requirements

### Requirement 1: ペルソナエンゲージメント評価の拡張

**Objective:** AIオーケストレーターとして、各ペルソナが「次に何を言いたいか」とその強さを具体的に評価してほしい。そうすることで、発言選択から発言生成まで一貫したコンテキストで動作できるようになる。

#### Acceptance Criteria

1. When 誰かの発言ターンが完了した後、the Debate Orchestrator shall 全ペルソナに対して並列で `assessEngagement` を呼び出す
2. The Persona Agent shall エンゲージメント評価として `score`（1–5の整数）・`mode`（full/reaction/none）・`intentSummary`（言いたいことの要約、mode が none 以外の場合に生成）を独立して返す
3. The Persona Agent shall `score`（1〜5）と `mode`（reaction/full/none）を独立して評価する。`mode` ごとのスコアラベルは以下の通り：
   - **reaction**（直前の発言への短い反応。新論点は出さない）:
     - score 1: パス（反応しない）
     - score 2: 反応したい（軽い相槌・同意）
     - score 3: 強く反応したい（明確な肯定・否定を一言で伝えたい）
     - score 4: 鋭く反応したい（強い反論・感情的な指摘を短く伝えたい）
     - score 5: 今すぐ反応しなければ（黙っていられない、即座に短く返したい）
   - **full**（自分の論点・主張を展開する発言）:
     - score 1: パス（発言しない）
     - score 2: 発言したい（自分の立場を簡潔に述べたい）
     - score 3: しっかり発言したい（論点・根拠を整理して展開したい）
     - score 4: ぜひ発言したい（重要な矛盾・新論点を正面から提示したい）
     - score 5: 今すぐ発言しなければ（信念の根幹が問われており、必ず言わなければ）
   - **none**: score 1 のときのみ選択する
4. The Persona Agent shall `score` とは独立して `mode` を評価する（score が高くても reaction を選んでよい）
5. When `mode` が `reaction` の場合、the Persona Agent shall `intentSummary` を25文字以内で返す
6. When `mode` が `full` の場合、the Persona Agent shall `intentSummary` を80文字以内で返す
7. When `mode` が `none` の場合、the Persona Agent shall `intentSummary` を返さない

---

### Requirement 2: ペルソナ別意図キューの管理

**Objective:** AIオーケストレーターとして、今回選ばれなかったペルソナの「強い言いたいこと」を後で使えるよう保持したい。そうすることで、話の流れが変わっても重要な意見が埋もれない討論になる。

#### Acceptance Criteria

1. When エンゲージメント評価の結果、あるペルソナが次の話者に選ばれず かつ `score` が 4 以上の場合、the Debate Orchestrator shall そのペルソナの `intentSummary` をペルソナ別キューに追加する（score 3 以下の弱い関心は後から蒸し返さない）
2. The Debate Orchestrator shall ペルソナごとに独立したキューを保持し、各エントリは `{ triggerTurnIndex: number; intentSummary: string }` の形式とする
3. The Debate Orchestrator shall 同一ペルソナが複数ターンにわたって強い言いたいことを蓄積できるよう、キューへの追加を都度行う（既存エントリを上書きしない）
4. The Debate Orchestrator shall キュー内の各エントリについて、`triggerTurnIndex` から8ターン以上経過したものを破棄する
5. When あるペルソナが発言した後、the Debate Orchestrator shall そのペルソナのキューから最古のエントリを1件消費（削除）する

---

### Requirement 3: エンゲージメントスコアに基づく話者選択

**Objective:** AIオーケストレーターとして、最もその場で発言する必要性が高いペルソナを選びたい。そうすることで、文脈に沿った自然な討論の流れを生成できる。

#### Acceptance Criteria

1. When エンゲージメント評価が完了した後、the Debate Orchestrator shall スコアの降順で話者候補をソートし、同率の場合は沈黙ターン数が長いペルソナを優先する
2. The Debate Orchestrator shall スコア最上位のペルソナを次の話者として選択する
3. When 全ペルソナのスコアが閾値（3以下）かつペルソナ別キューにエントリが存在する場合、the Debate Orchestrator shall 「話題がひと段落した」とみなしキューから最も古い `triggerTurnIndex` を持つエントリのペルソナを優先的に選択する
4. When スコアが低い（全員3以下）にもかかわらずキューも空の場合、the Debate Orchestrator shall 沈黙ターン数が最も長いペルソナを選択する
5. When キュー参照で話者が選ばれた場合、the Debate Orchestrator shall そのペルソナの発言モードを `full` に固定する
6. The Debate Orchestrator shall 直前の話者（`lastSpeakerId`）が唯一の最高スコアでない限り、直前話者を再選択しない（連続発言を回避する）

---

### Requirement 4: 意図に基づく発言生成

**Objective:** AIペルソナエージェントとして、自分が評価した意図（intentSummary）を参照して発言を生成したい。そうすることで、エンゲージメント評価と実際の発言が一貫したものになる。

#### Acceptance Criteria

1. When あるペルソナが話者として選ばれた場合、the Debate Orchestrator shall `generateTurn` に `assessedMode` と `intentSummary`（または pendingTrigger 由来の意図）を渡す
2. When `intentSummary` が存在する場合、the Persona Agent shall それを発言生成時のコンテキスト（「あなたはこの話を聞いてXXXXと感じており、それを伝えたい」）として参照する
3. When キューから選ばれたペルソナが発言する場合、the Persona Agent shall キューの `intentSummary` に加えて `triggerTurnIndex` の発言内容を発言コンテキストとして参照する
4. When `assessedMode` が `reaction` の場合、the Persona Agent shall `REACTION_TURN_TOOL`（content のみ、10–25文字）を使用する
5. When `assessedMode` が `full` の場合、the Persona Agent shall `buildFullTurnTool`（content + 任意のbeliefChange/addressedTo）を使用する
6. The Persona Agent shall 渡された `assessedMode` 以外のモードで発言を生成しない（ツール選択でモードを強制する）

---

### Requirement 5: エンゲージメントデータと発言ログの分離

**Objective:** システム管理者として、最終的な討論ログ（公開コンテンツ）と内部制御データ（エンゲージメント・キュー）を明確に分けたい。そうすることで、発言ログが純粋な討論の記録として維持される。

#### Acceptance Criteria

1. The Debate Orchestrator shall 発言ターンをFirestoreに保存する際、`TurnEmbed` にエンゲージメントデータを含めない（`engagements` フィールドを削除する）
2. The Debate Orchestrator shall エンゲージメント評価結果を `sessions/0` の別フィールド（例: `engagementLog: EngagementLogEntry[]`）または専用サブコレクションに保存する
3. The Debate Orchestrator shall エンゲージメントログの各エントリに `turnIndex`・`personaId`・`score`・`mode`・`intentSummary` を含める
4. Where 管理UIがエンゲージメント情報を表示する場合、the Admin UI shall 発言ターンのデータとは別のデータソースからエンゲージメント情報を取得する
5. The Debate Orchestrator shall 公開コンテンツ（発言ログ）にエンゲージメントデータが混入しないことを保証する
