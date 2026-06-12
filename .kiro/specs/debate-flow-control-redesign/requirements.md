# Requirements Document

## Project Description (Input)
討論の流れをコントロールする仕組みの整理。現状、いろいろなルールがコード化されているが、複雑化しており、バグを生んでいる。現状のコードを元に、本来どう言う動きを目指そうとしていたのかまず整理して欲しい。その上で、実現する動きを再精査し、コードを修正したい。

## Introduction

logotope の討論フロー制御は、複数の仕様（`debate-chapter-progression`・`engagement-driven-debate-flow`・`debate-quality-improvement`・`async-debate-execution`）で段階的に拡張された結果、ルールが層状に蓄積し、`debate-orchestrator.ts` を中心に複雑化している。指名が無視される・指名者が発言しないなどのバグ修正が繰り返されており（コミット履歴参照）、ルール間の相互作用が把握困難になっている。

現状コードから読み取れる「本来意図していた動き」は次の通りである：

1. **ライフサイクル**: 章立て生成 → オープニング → 章ごとの討論ループ → 章遷移（まとめ＋次章導入）→ クロージング → 事後コメント
2. **話者選択**: ファシリテーターの指名を最優先とし、次にペルソナ間の直接質問、緊急リアクション、意図キュー、発言意欲スコアの順で次話者を決める。同一ペルソナの連続発言は原則回避する
3. **発言意欲駆動**: 各ターン後に全ペルソナが自分の発言意欲（score 1〜5）と形式（full/reaction）を自己評価し、選ばれなかった強い意図はキューに保持して後で発言機会を与える
4. **ファシリテーター介入**: 一定間隔・長い沈黙をトリガーに、論点の引き戻し（topic_shift）や未発言者の招き入れ（invite）を行う
5. **章終了**: 全員が発言済みで発言意欲が枯れたら早期終了、上限（目標の150%）で強制遷移

本仕様はこの意図された動きを単一の一貫した動作仕様として再定義し、仕様に対応しないルール・デッドコードを排除した形にコードを修正する。

## Boundary Context

- **In scope**: 討論フロー制御の全体（話者選択・発言意欲評価・意図キュー・ファシリテーター介入・章進行・ライフサイクル・実行パス間の状態管理）の意図整理、動作仕様の再定義、コード修正
- **Out of scope**: ペルソナの語り口・発言品質プロンプトの内容（`debate-quality-improvement` の成果物）、信念変化の記録スキーマ、公開ページUI、LLMモデルルーティング（`persona-model-routing`）、Firestoreスキーマの変更
- **Adjacent expectations**: Cloud Tasks による章単位の非同期実行基盤（`async-debate-execution`）の構造は維持する。`assessEngagement` / `generateTurn` などエージェントの公開インターフェースは必要最小限の変更にとどめる

---

## Requirements

### Requirement 1: 討論ライフサイクルの全体構造

**Objective:** As a 管理者, I want 討論が定義された一連のフェーズで決定的に進行すること, so that 構造的で読みやすい討論コンテンツが安定して生成される。

#### Acceptance Criteria

1. When 討論が開始される, the Debate Orchestrator shall 章立て生成 → オープニング発言 → 章討論ループ → クロージング発言 → 事後コメント生成 → セッション完了 の順でフェーズを進行する
2. When オープニング発言を生成する, the Facilitator Agent shall 第1章のフォーカスに基づく具体的な問いかけと、最初に発言させるペルソナの指名（firstPersonaId）を返す
3. When 全章の討論が終了した, the Debate Orchestrator shall クロージング発言を保存した後、各ペルソナの事後コメントを生成・保存し、セッションを完了状態にする
4. The Debate Orchestrator shall 討論全体のターン数が上限（maxTurns）を超えないよう制御する
5. If セッションがキャンセル状態になった, the Debate Orchestrator shall 以降のターン生成を行わずに処理を終了する

### Requirement 2: 章立て生成と章進行

**Objective:** As a 読者, I want 各章が一つのフォーカス問いに集中し、適切な長さで次章へ移行すること, so that 討論に流れとテンポが生まれ理解しやすい。

#### Acceptance Criteria

1. When 討論が開始される, the Facilitator Agent shall テーマとペルソナ構成から3〜6章の章立て（章タイトル・フォーカス問い）を生成する
2. If 章立て生成に失敗した, the Debate Orchestrator shall エラーとして討論を中断する（既定章構成へのフォールバックは行わない）
3. The Debate Orchestrator shall 各章に目標ターン数（turnsPerChapter）とその150%を上限とするターン数制限を適用する
4. When 章内のペルソナ発言数が目標の75%以上に達し、かつ直近の発言意欲評価で積極的な発言意欲が継続して観測されない, the Debate Orchestrator shall 章を早期終了する（テーマがペルソナに合わない場合もあるため、全ペルソナの発言は章終了の条件としない）
5. While 章終了の早期判定を行う, the Debate Orchestrator shall 判定基準となる発言意欲の記録を話者の選択方法（直接指名・評価ベース）に関わらず一貫して更新する
6. When 章がターン数上限（150%）に達した, the Debate Orchestrator shall 章を強制終了する
7. While 章を強制終了する, if 未応答の指名・直接質問（ファシリテーターの問いかけ・addressedToPersonaId）が残っている, the Debate Orchestrator shall その応答ターンを生成してから章を終了する（話を振られたまま章が切れる中途半端な終わり方をしない）
8. When 章が終了し次章が存在する, the Debate Orchestrator shall 現章のまとめ発言と次章の導入発言（最初の発言者指名を含む）の2ターンを生成する
9. The Debate Orchestrator shall すべてのターンに所属する章のインデックス（chapterIndex）を付与して保存する
10. The Debate Orchestrator shall 章の終了判断をフロー制御ルール（本Requirementの判定）に一元化し、ファシリテーター介入評価の判断（close）に依存しない

### Requirement 3: 発言意欲評価

**Objective:** As a AIオーケストレーター, I want 各ペルソナが「次に何をどの強さで言いたいか」を自己評価すること, so that 発言したい人が発言する自然な討論が実現できる。

#### Acceptance Criteria

1. When ペルソナの発言ターンが完了し、かつ次話者が指名・直接質問で確定していない, the Debate Orchestrator shall 直前発言者を除く全ペルソナに対して並列で発言意欲評価を実行する
2. The Persona Agent shall 発言意欲評価として score（1〜5の整数）・mode（full/reaction/none）・intentSummary（言いたいことの要約）を返す
3. If 個別ペルソナの発言意欲評価が失敗した, the Debate Orchestrator shall そのペルソナを最低意欲（score 1）として扱い討論を継続する
4. The Debate Orchestrator shall 発言意欲評価の結果を Firestore に保存する（管理画面での可視化用）

### Requirement 4: 話者選択の優先順位

**Objective:** As a 管理者, I want 次話者の決定ルールが単一の明確な優先順位に従うこと, so that 指名が無視される等の不整合バグが発生しない。

#### Acceptance Criteria

1. The Debate Orchestrator shall 次話者を以下の単一の優先順位で決定する: (1) ファシリテーターによる指名、(2) 直前発言者からの直接質問（addressedToPersonaId）、(3) 緊急リアクション（mode=reaction かつ score 4以上）、(4) 全員の score が3以下の場合は意図キューの最古エントリ保持者、(5) score 降順（同点時は沈黙ターン数の長い方を優先）
2. When ファシリテーターがペルソナを指名した（オープニング・章導入・invite介入）, the Debate Orchestrator shall 連続直接交換の制限に関わらずそのペルソナを必ず次話者とし、full モードで発言させる
3. When ペルソナ間の直接質問の連鎖が3回連続した, the Debate Orchestrator shall 直接質問による話者確定を中断し、発言意欲評価に基づく選択に戻す
4. The Debate Orchestrator shall 直前の発言者を連続して選択しない（直前発言者が唯一の最高スコア保持者である場合を除く）
5. If 指名・直接質問されたペルソナIDが参加ペルソナに存在しない, the Debate Orchestrator shall その指定を無視して発言意欲評価に基づく選択を行う

### Requirement 5: 意図キュー（持ち越し発言）

**Objective:** As a 読者, I want 強く言いたいことがあったのに発言機会を得られなかったペルソナが後で発言すること, so that 重要な意見が埋もれない討論になる。

#### Acceptance Criteria

1. When 発言意欲評価で最高評価（score 5）を申告したペルソナが次話者に選ばれなかった, the Debate Orchestrator shall そのペルソナの intentSummary とトリガーターンをペルソナ別キューに追加する
2. The Debate Orchestrator shall トリガーターンから8ターン以上経過したキューエントリを失効・破棄する
3. When キューに基づいてペルソナが発言する, the Debate Orchestrator shall full モードで、キューに記録された intentSummary とトリガー発言を発言生成コンテキストとして渡す
4. When ペルソナが発言を完了した, the Debate Orchestrator shall そのペルソナの最古キューエントリを1件消費する
5. The Debate Orchestrator shall キューの状態を Firestore に永続化し、すべての実行パス（新規・再開・章単位実行）で一貫して復元する

### Requirement 6: ファシリテーター介入

**Objective:** As a 読者, I want 議論が停滞・脱線・偏りを見せたときに司会が適切に介入すること, so that 討論が常にフォーカスに沿って多様な声を含む。

#### Acceptance Criteria

1. When ペルソナの発言ターンが完了し、かつ次話者が指名・直接質問で確定していない, the Debate Orchestrator shall 経過ターン数に関係なく毎回ファシリテーターの介入要否評価を実行する
2. While 前回のファシリテーター発言からのペルソナ発言数が最小クールダウン（2ターン）未満, the Debate Orchestrator shall 介入評価をスキップする（司会の発言過多を防ぐ）
3. The Facilitator Agent shall 介入評価として「topic_shift（フォーカス問いへの引き戻し）」「invite（発言の少ない参加者への問いかけ）」「介入不要」のいずれかを、現在の章のフォーカスと各ペルソナの累計発言数を踏まえて返す
4. The Facilitator Agent shall 議論がフォーカスに沿って活発に進行している限り「介入不要」を返す（介入はあくまで論点ずれ・停滞・発言の偏りの是正手段とする）
5. When invite 介入で対象ペルソナの ID（targetPersonaId）が指定された, the Debate Orchestrator shall そのペルソナをファシリテーター指名として次話者に確定する（発言内容からの名前推定は行わず、ID のみで判定する。指名情報は保存ターンに永続化する）
6. When 介入発言を生成した, the Debate Orchestrator shall ファシリテーターターンとして保存し、クールダウンの起点を更新する

### Requirement 7: 発言生成への制御コンテキスト伝達

**Objective:** As a AIオーケストレーター, I want 話者選択の文脈（モード・意図・指名）が発言生成に正しく引き継がれること, so that 選択理由と実際の発言内容が一致する。

#### Acceptance Criteria

1. When ペルソナの発言を生成する, the Debate Orchestrator shall 現章の履歴・章フォーカス・発言モード・意図要約・持ち越しトリガー・ファシリテーター指名の有無を Persona Agent に渡す
2. When mode が reaction で発言する, the Persona Agent shall 短いリアクション（10〜25文字）を生成する
3. When mode が full で発言する, the Persona Agent shall 意見発言（最大200文字）を生成し、信念変化と直接質問先（addressedToPersonaId）を必要に応じて返す
4. When ファシリテーターから指名されて発言する, the Persona Agent shall 指名の問いかけに直接答える発言を生成する
5. When 発言で信念変化が報告された, the Debate Orchestrator shall 新しい信念バージョンを保存し、以後の発言意欲評価・発言生成に反映する

### Requirement 8: 実行パスと状態管理の一貫性

**Objective:** As a 管理者, I want 新規実行・再開・章単位実行のどの経路でも討論が同じルールで進行すること, so that 実行経路の違いによるバグが発生しない。

#### Acceptance Criteria

1. The Debate Orchestrator shall 新規実行・再開・章単位実行（Cloud Tasks）のすべての実行パスで同一のフロー制御ルールを適用する
2. When 討論を途中から継続する, the Debate Orchestrator shall 保存済みターンから話者選択に必要な状態（発言数・沈黙数・最終ファシリテーターターン・意図キュー・章情報）を単一の共通ロジックで復元する
3. When 同一章の実行が重複して要求された, the Debate Orchestrator shall 冪等に処理する（処理済みの章をスキップする）
4. If 継続時に章情報が存在しない, the Debate Orchestrator shall エラーとして処理を中断する（既定章構成での継続は行わない）

### Requirement 9: ルールの整理とコード健全性

**Objective:** As a 開発者, I want フロー制御コードが本仕様の要件と1対1で対応すること, so that ルールの相互作用が把握でき、変更時の回帰を防げる。

#### Acceptance Criteria

1. The system shall 本仕様の要件に対応しない制御ルール・分岐・パラメータを持たない（結果が使用されない評価呼び出し、未使用のエージェントメソッド、未参照のオプション値等のデッドコードを除去する）
2. The Debate Orchestrator shall フロー制御の主要ルール（話者選択・介入判定・章終了判定・状態復元）をそれぞれ独立してユニットテスト可能な形で実装する
3. When フロー制御ルールが変更された, the system shall ユニットテストにより既存動作の回帰を検出できる
4. The system shall 既存の Firestore データ（保存済みターン・セッション）との互換性を維持する
