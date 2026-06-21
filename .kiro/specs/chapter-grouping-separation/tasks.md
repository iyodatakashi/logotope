# Implementation Plan

- [x] 1. Foundation: 論点・グループ型の再設計
- [x] 1.1 `Issue`・`IssueGroup`・`ChapterAnalysisDoc` を functions 側とフロント側に定義する
  - `Issue` を `text`・`source`・`score?`・`reason?`・`selected?` で定義し、論点の唯一の保持先とする
  - `IssueGroup` を `issueIndexes: number[]`（`issues` 配列への参照）のみで定義し、ローカル処理と Firestore 永続で同一型として共用する
  - `ChapterAnalysisDoc` を `issues: Issue[]` + `issueGroups?: IssueGroup[]` に再設計する（`general`/`persona` の2配列を廃止）
  - 旧 `ScoredIssueDoc` を削除し、`ChapterDoc` から `assignedIssues` を削除する
  - 型が両パッケージでコンパイルを通る状態になる
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 2. グループ化パイプラインの再実装（chapter-agent）
- [x] 2.1 採用論点をクラスタリングするグループ化を実装する
  - グループ化スキーマを `issueGroups: [{ issueIndexes }]`（タイトル・フォーカス問いを含まない、テキスト echo は任意で許容するが破棄）に改定する
  - プロンプトはクラスタリングのみを要求し、タイトル・フォーカス問いの生成を求めない
  - AI のローカル index を `issues` 配列の index に変換して返す
  - 0グループ時は全採用論点を1グループに束ね、未割り当ての採用論点は最終グループに追加する
  - 既存ユニットテストのグループ化モックを新スキーマに更新し、グループ化プロンプトにタイトル要求が含まれないことを検証する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.3_

- [x] 2.2 グループから章を生成する章生成を実装する
  - 章生成スキーマを `chapters: [{ title, focusQuestion, discussionPoints }]` に改定する
  - 各グループの `issueIndexes` を `issues` のテキストに解決してプロンプト入力とし、タイトル・フォーカス問い・discussionPoints を生成する
  - 各章に一意 ID を付与して `Chapter` を返し、章が欠落したグループは論点テキストを discussionPoints にフォールバックする
  - 既存ユニットテストの章生成モックを新スキーマに更新する
  - _Requirements: 2.1, 2.2, 2.3, 6.2_

- [x] 2.3 章をgeneral由来論点数で並べ替える純粋関数を実装する
  - 章とグループ（および `issues`）から、general 由来論点数の降順に章を並べる純粋関数をエクスポートする
  - 同数時は元のグループ順を維持し（安定ソート）、入力を破壊しない
  - 純粋関数を直接呼び出す単体テストで、降順整列・同数時の順序維持・入力非破壊を検証する
  - _Requirements: 3.1, 3.2, 3.3, 6.5_

- [x] 2.4 オーケストレーションと進捗イベントを更新する
  - `generateChapters` をグループ化→章生成→並べ替えの順で組み立て、戻り値を `Chapter[]` のみに簡素化する（旧 `generalIssues`/`personaIssues` を廃止）
  - 進捗イベントを `issues_generated`（text+source）・`issues_scored`（score 付き）・`issues_grouped`（issueIndexes）として順に通知する（`chapters_composed` を廃止）
  - 章生成完了後に並べ替えを適用してから返す
  - chapter-agent のユニットテストが全件通る
  - _Requirements: 3.4, 5.1_

- [x] 3. planChapters の Firestore 書き込み更新（chapter-generator）
- [x] 3.1 進捗イベントに応じた段階的書き込みと最終章書き込みを実装する
  - `issues_generated` で `chapterAnalysis/0` に `issues`（text+source）を `set`、`issues_scored` で `score`/`reason`/`selected` を `update`、`issues_grouped` で `issueGroups` を `update` する
  - 章生成完了後に `chapters` コレクションへ各章を並べ替え後の `chapterIndex` で `set` する
  - 旧プレースホルダーID追跡・件数不一致フォールバックを撤廃する
  - 統合テストとgeneratorテストのコールバックモックを新イベントに更新し、`chapterAnalysis/0` の set/update と `chapters` の最終 set を検証する
  - _Requirements: 4.4, 4.5, 4.6, 5.3, 6.4_

- [x] 4. (P) Phase4Chapters の中間表示更新
  - Step1 で `issues` を `source` でフィルタし一般／ペルソナ別に表示、Step2 で `score` 付与済み論点をスコア降順で表示する
  - Step3 で `issueGroups` の各 `issueIndexes` を `issues` で解決し「グループ N: 論点…」を表示、Step4 で章の discussionPoints を表示する
  - 4ステップを積み上げ表示し、`chapter.assignedIssues` 参照を廃止する
  - 生成進行に伴い各ステップが onSnapshot で順次画面に反映される
  - _Requirements: 5.2_
  - _Boundary: Phase4Chapters_
  - _Depends: 1.1_

- [x] 5. テスト整合と回帰確認
  - functions のユニット・統合テスト（chapter-agent / chapter-agenda.integration / chapter-generator）が全件通る
  - フロントの型チェックが通り、`ChapterAnalysisDoc` 消費側（store・Phase4Chapters）が新形状に整合する
  - 全体テストスイートを実行し回帰がないことを確認する
  - _Requirements: 6.1, 6.2, 6.4, 6.5_
