# Implementation Plan

- [x] 1. 討論 generated 遷移ヘルパー `confirmDebateGenerated` を新設する
  - phase==='debate' かつ phaseStatus==='running' のときのみ `generated` へ遷移する冪等トランザクションを実装する（running 限定で停止済み討論の誤復活を塞ぐ）
  - phase が debate から前進済み（承認等）・doc 不在・既に generated の場合は no-op とする
  - Observable: 単体呼び出しで running→generated に遷移し true を返し、対象外状態では書き込まず false を返す
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. (P) 原本コメント生成の「生成部」と「遷移部」を分離する
  - 既存の生成＋書込＋phase 遷移を、生成＋書込のみ（各ペルソナの見解を生成し原本を単一書込）に再編し、phase 遷移責務を除去する
  - 入力はトピック・承認済みペルソナ・全ターンとし、原本 `postDebateComments/0` のスキーマ・保存パスを変更しない
  - 原本消去ヘルパーは維持し、討論チェーンからの呼び出しは行わない
  - Observable: 生成関数が原本をスキーマ通り単一書込し、phaseStatus に一切触れない
  - _Requirements: 3.1, 5.1, 5.3_
  - _Boundary: post-debate-comments_

- [x] 3. 討論チェーン末尾を単一 `chapter-end` に統合し命名を是正する
- [x] 3.1 章末 stepKind と次ステップ判定を `chapter-end` に統合する
  - stepKind を `open`/`turn`/`chapter-end` に整理し、`summary`/`closing`/`comments` および章末種別選択を撤去する
  - 次ステップ判定が章末で `chapter-end` を返すようにし、終端の frontier 特別扱いを廃して章ローカル位置ベースの一意キーに統一する
  - Observable: `summary`/`closing`/`comments` を参照する型・分岐がコードから消え、章末は `chapter-end` 単一種別で表現される
  - _Requirements: 1.1, 1.5_
- [x] 3.2 `chapter-end` ハンドラで章完了と討論終端を確定する
  - 章完了処理（章を completed 化＋論点状態クリーンアップ、発話生成なし）を実行し、非最終章では次章の open を投入、最終章では `confirmDebateGenerated` を呼んで終端する
  - 討論後コメント生成ステップと関連ハンドラを撤去し、討論チェーンからコメント生成を完全に除去する
  - Observable: 最終章の章末でコメント生成なしに phaseStatus が running→generated へ遷移し、章完了の重複適用でも状態が壊れない
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 3.1_
  - _Depends: 1, 2_

- [x] 4. (P) 編集工程の先頭に原本コメント生成ステージを追加する
- [x] 4.1 編集ステップ種別を拡張し編集の起動点を差し替える
  - 編集ステップ種別に原本コメント生成ステージを追加し、編集開始時に最初へ投入するステップをこのステージに変更する
  - Observable: 編集開始時に最初のタスクとして原本コメント生成ステージが投入される
  - _Requirements: 3.2_
  - _Boundary: editing pipeline_
- [x] 4.2 原本コメント生成ステージを「未生成時のみ生成」で実装する
  - 稼働世代ゲート後に原本 `postDebateComments/0` の存在を確認し、未生成（不在または空）なら分離済みの生成部で全ターン・承認済みペルソナから生成、既存非空なら再生成せずスキップする
  - いずれの分岐でも完了後に最初の章編集ステップへ連鎖する
  - Observable: 原本が無ければ生成して章編集へ、既存があれば生成せず章編集へ進み、編集失敗の再試行で要約を繰り返さない
  - _Requirements: 3.3, 3.4, 3.5, 4.3, 4.4_
  - _Depends: 2_
  - _Boundary: editing pipeline_

- [x] 5. 編集チェーンの結線と保全を確定する
- [x] 5.1 開始ゲートと restart/reset 後の再生成を結線する
  - 編集開始は討論完了（generated）を前提とするゲートを通してのみ起動し、討論の restart/reset で原本が消去された後の編集実行では生成ステージが原本を再生成することを保証する
  - コメント編集ステージが原本生成ステージ完了後にのみ到達し、その時点の原本を入力とする順序を保証する
  - Observable: 討論未完了では編集が起動できず、restart/reset 後の編集では原本が再生成され、コメント編集は生成後の原本を読む
  - _Requirements: 3.6, 4.1, 4.2, 4.5, 5.2_
- [x] 5.2 生成ステージ失敗時の整合を確定する
  - 生成ステージの終端失敗で編集フェーズを停止（stopped）にし、討論の generated 状態を後退させず再実行可能に保つ
  - 生成ステージの重複起動は世代照合と一意タスク鍵で1本へ収束させる
  - Observable: 生成ステージが終端失敗すると編集は stopped になり討論 generated は保持され、重複投入で二重生成が起きない
  - _Requirements: 3.7, 3.8_

- [x] 6. テストを更新・追加する
- [x] 6.1 (P) 討論側テストを新チェーンへ更新する
  - `summary`/`closing`/`comments` 撤去に伴い次ステップ判定・タスク投入・冪等性の既存テストを更新し、parity 参照モデルの終端も「コメント無しで generated」に揃える
  - 最終章 `chapter-end` の generated 到達と重複適用の冪等を検証するテストを追加する
  - Observable: 討論側テストが新チェーンで緑になり、最終章章末で generated へ到達することを検証する
  - _Requirements: 1.6, 2.1, 2.3_
  - _Boundary: debate tests_
- [x] 6.2 (P) 編集側の生成ステージテストを追加する
  - 未生成時の生成・既存非空時のスキップ・restart/reset 後の再生成・生成→章→コメント編集の順序・コメント編集の入力・失敗時 stopped を検証する
  - Observable: 生成ステージのスキップ/生成分岐と順次実行順序、失敗時挙動がテストで検証される
  - _Requirements: 3.4, 3.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: editing tests_

## 並行実行メモ
- Task 1 と Task 2 は別ファイル・無依存で並行可（2 に (P)）。
- Task 3（討論側）と Task 4（編集側）は基盤（1・2）完了後、別バウンダリのため並行可（4 に (P)）。
- Task 6.1 と 6.2 は別テスト領域で並行可。
- デプロイ注意（[project-no-emulator]）: Task 3 の討論側撤去と Task 4/5 の編集側追加は同一デプロイに含める（片方のみは generated 未遷移や原本未生成を招く）。
