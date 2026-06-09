# Implementation Plan

- [x] 1. Foundation — 章関連型定義の追加
- [x] 1.1 Functions 側に章関連型を追加する
  - `DebateChapter` 型（index, title, focusQuestion, startTurnIndex, endTurnIndex?）を functions の共通型定義に追加する
  - `DebateState` インターフェースに `currentTurnIndex` フィールドを追加する
  - 章生成失敗時のフォールバック用に `DEFAULT_CHAPTERS`（導入・核心的対立・影響と懸念・まとめ の 4 章）定数を定義する
  - Functions の TypeScript コンパイルが通り、既存テストが通る状態になっている
  - _Requirements: 1.4, 4.4_

- [x] 1.2 (P) フロントエンド側に章関連型を追加する
  - `ChapterDoc` 型（index, title, focusQuestion）を追加する
  - `SessionDoc` に `chapters?` / `currentChapterIndex?` フィールドを追加する
  - `TurnDoc` に `chapterIndex?` フィールドを追加する
  - `PublishedTurn` に `chapterIndex?` フィールドを追加する
  - `PublishedDebateDetail` に `chapters?` フィールドを追加する
  - フロントエンドの TypeScript コンパイルが通る状態になっている
  - _Requirements: 4.4_
  - _Boundary: src/lib/types/index.ts_

- [x] 2. (P) Firestore リポジトリの章データ書き込み対応
  - `saveChapters` 関数を追加する（sessions/0 に chapters 配列と currentChapterIndex の初期値 0 を書き込む）
  - `updateCurrentChapterIndex` 関数を追加する（sessions/0 の currentChapterIndex フィールドのみを更新する）
  - `createDebateTurn` の引数に `chapterIndex?` を追加し、値が存在するときのみ turn embed に含めて arrayUnion で保存する
  - Firestore emulator 上で章データの読み書きが確認できる
  - _Requirements: 1.3, 2.3, 4.1, 4.2, 4.3_
  - _Boundary: functions/src/db/repository.ts_
  - _Depends: 1.1_

- [x] 3. FacilitatorAgentService の章機能追加
- [x] 3.1 章の 2 ステップ生成メソッドを実装する
  - Step 1 として、テーマとペルソナ一覧から討論論点を 5〜10 件洗い出す AI 呼び出しを実装する（`submit_issues` ツール）
  - Step 2 として、洗い出した論点をコンテキストに含めて章立て（目安 3〜6 章）に整理する AI 呼び出しを実装する（`submit_chapters` ツール）
  - どちらかのステップが失敗した場合は `PipelineError` を返す
  - モックを使ったユニットテストで、2 回の API 呼び出しを経て章リストが返ることを確認できる
  - _Requirements: 1.1, 1.2_

- [x] 3.2 章終了判定と章遷移発言メソッドを追加する
  - 現章の会話履歴のみを受け取り「章のフォーカスに関して議論が出尽くしたか」を boolean で返す章終了判定メソッドを実装する（`evaluate_chapter_end` ツール）
  - 現章・次章情報を受け取り章遷移発言を生成するメソッドを実装する（次章が undefined の最終章では現章の要約のみ生成）
  - 各メソッドが `Result<T, PipelineError>` を返す型コントラクトを満たしている
  - _Requirements: 3.2_

- [x] 3.3 既存メソッドへ章コンテキスト引数を追加する
  - `generateOpening` に第 1 章情報の引数を追加し、冒頭発言のプロンプトに第 1 章のタイトルとフォーカス問いが含まれるようにする
  - `evaluateIntervention` に現在章の引数を追加し、介入判定プロンプトに現在の章フォーカスが反映されるようにする
  - 両メソッドの既存呼び出し箇所の型エラーが解消されコンパイルが通る
  - _Requirements: 2.1, 2.2_

- [x] 4. (P) PersonaAgentService に章コンテキストを追加する
  - `generateTurn` の引数に現在章（`currentChapter`）を追加し、ペルソナの発言プロンプトに現在の章タイトルとフォーカス問いが含まれるようにする
  - 既存の呼び出し箇所の型エラーが解消されコンパイルが通る
  - _Requirements: 2.1_
  - _Boundary: functions/src/agents/persona-agent.ts_
  - _Depends: 1.1_

- [x] 5. DebateOrchestratorService の章進行ロジック実装
- [x] 5.1 章の生成・保存フローを実装する
  - `executeDebate` の冒頭で `generateChapters` を呼び出し、失敗時は `DEFAULT_CHAPTERS` を使用するフォールバック処理を実装する
  - 生成した章リストを `saveChapters` で Firestore に書き込む
  - 第 1 章コンテキストを渡して冒頭発言を生成する
  - 討論開始直後に sessions/0.chapters と sessions/0.currentChapterIndex が Firestore に書き込まれている
  - _Requirements: 1.1, 1.3, 1.4_
  - _Depends: 2, 3.1, 3.3_

- [x] 5.2 executeChapter メソッドと 2 層ループ構造を実装する
  - `executeDebate` をアウターの章ループ（章ごとに `executeChapter` を呼ぶ構造）に再編し、全章終了後にクロージング生成へ進む
  - `executeChapter` プライベートメソッドを実装する（インナーターンループ、各ターンに chapterIndex を付与して保存）
  - 章のターン数が目標値（maxTurns ÷ 章数）に達したとき章終了判定を呼び出し、true のとき遷移発言を生成して `currentChapterIndex` を更新する
  - 目標ターン数の 150% に達しても章終了判定が true にならない場合は強制的に次章へ遷移する
  - `evaluateIntervention` が `close` を返しても `executeChapter` ループが中断されない
  - 討論完了後に sessions/0 のすべてのターンに chapterIndex が付与されていて、全章が最終的に遷移している
  - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.2_
  - _Depends: 3.2, 4_

- [x] 5.3 resume の章対応を実装する
  - `resume()` 内で sessions/0 の `chapters` と `currentChapterIndex` を読み取り、再開する章を特定する
  - 既存ターンデータの `chapterIndex` から当該章の startTurnIndex を導出して章ループの再開位置を決定する
  - `chapters` が存在しない旧セッションでは既存の resume 動作（fromTurnIndex 指定）にフォールバックする
  - 途中停止した討論を再開したとき、中断した章から正しく再開される
  - _Requirements: 4.1_

- [x] 6. フロントエンドの章表示実装
- [x] 6.1 (P) 討論閲覧ページで章別のターングループ表示を実装する
  - `DebateViewer` で `debate.chapters` が存在する場合、同じ `chapterIndex` を持つターンをグループ化し、各グループの先頭に章番号・タイトル・フォーカス問いの見出しを表示する
  - `debate/[id]/+page.svelte` で session の chapters を `PublishedDebateDetail.chapters` として DebateViewer に渡す
  - `debate.chapters` が存在しない旧データでは章見出しなしのフラット表示を維持する
  - 章つきデータで討論閲覧ページを開くと章見出しで整理されたターン一覧が表示される
  - _Requirements: 5.1, 5.2, 5.4_
  - _Boundary: src/lib/components/public/DebateViewer.svelte, src/routes/debate/[id]/+page.svelte_
  - _Depends: 1.2_

- [x] 6.2 (P) 管理画面 Phase4 に現在の章進行状況を表示する
  - `Phase4Debate` で `session.chapters` と `session.currentChapterIndex` から現在の章タイトルと進行状況（第 N 章 / 全 M 章）を導出して表示する
  - `session.chapters` が存在しない旧セッションでは「討論中...」の既存表示にフォールバックする
  - 討論進行中に管理画面で現在の章タイトルと進行状況が表示される
  - _Requirements: 5.3, 5.4_
  - _Boundary: src/lib/components/admin/Phase4Debate.svelte_
  - _Depends: 1.2_

- [x] 7. ユニットテスト
- [x] 7.1 章生成ロジックのユニットテストを書く
  - `generateChapters` の正常系として、AI 呼び出し 2 回後に正しい形式の章リストを返すことをモックテストで確認する
  - `generateChapters` 失敗時に PipelineError が返ることを確認する
  - オーケストレーターの章生成フェーズでエラー発生時に `DEFAULT_CHAPTERS` にフォールバックすることを確認する
  - _Requirements: 1.1, 1.4_

- [x] 7.2 章進行オーケストレーターのユニットテストを書く
  - 目標ターン数到達で `evaluateChapterEnd` が呼ばれることを確認する
  - 目標ターン数の 150% 到達で強制遷移が発動することを確認する
  - `evaluateIntervention` が `close` を返しても章ループが中断されないことを確認する
  - _Requirements: 3.1, 3.2, 3.5_
