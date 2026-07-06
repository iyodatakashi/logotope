# Implementation Plan

> トラック順序制約（design.md より）: Track 0（削除）を最初に行い、後続の対象を減らす。討論チェーンのファイルは Track 4（R9）を先に入れてから Track 3（通読）で触る。同一ファイル群では Track 1（機械的改名）→ Track 3（構造整理）の順に直列実行する。各タスク完了時に検証4点セット（`pnpm check` / `pnpm lint` / `pnpm test` / 対象側ビルド）を回す。

- [x] 1. Foundation: 依存追加とベースライン確認
- [x] 1.1 dayjs をフロント・functions 両パッケージに導入
  - `dayjs@^1.11.x` を `package.json` と `functions/package.json` の依存に追加し、両環境でインストールする
  - 追加後に既存のビルド・型チェックが引き続き通ることを確認する
  - 観測可能な完了条件: 両パッケージで `dayjs` が import 可能になり、`pnpm check` と functions tsc がエラーなしで通る
  - _Requirements: 4.4_

- [x] 2. 章ファクトチェック機能の削除（Track 0）
- [x] 2.1 Functions 側の章FC実行経路を削除
  - 章FC の呼び出し口（`runFactCheck` / `runFactCheckTask` エンドポイントと index の export）、章単位検証ロジック（`checkChapter` / `checkTurn` / `OnTurnFindings`）、結果ドキュメントのリポジトリ、討論ライフサイクルからの結果削除呼び出しを除去する
  - インラインFC が依存する共有部分（`checkContent`・correction-worthiness 判定・`turn.factCheck` 埋め込み・編集の保護判定）は一切変更しない（research.md の維持リストを正とする）
  - 観測可能な完了条件: 章FC 専用の Functions コードが存在せず、`inline-fact-check` 系の維持対象テストが green で functions tsc が通る
  - _Requirements: 8.1, 8.3_
  - _Boundary: FC Deletion_

- [x] 2.2 フロントエンド側の章FC UI・ストアを削除
  - 章FC の実行 UI・結果表示、factCheck ストアとその配線、討論画面・編集画面での章FC指摘の突合表示を除去する
  - 結果ドキュメント型を削除し、`FactCheckFinding` 型は turn 埋め込みミラーからの参照が残る場合のみ turn モデル側へ移動する（re-export は作らず import 側を直接書き換える）
  - インライン検証トレース（turn 埋め込み由来の表示）は対象外として残す
  - 観測可能な完了条件: 管理画面から章FC の実行 UI・結果表示が消え、`pnpm check` と該当を除いた既存テストが green
  - _Requirements: 8.2, 8.3_
  - _Boundary: FC Deletion_
  - _Depends: 2.1_

- [x] 2.3 セキュリティルールと残存テストの整理・検証
  - `firestore.rules` の factCheck match ブロックを削除する（章FC 残存データの一括削除は行わない）
  - 章FC に対応するテスト（リポジトリ・ストア・FactCheckFindings spec、runner の章FC 部分）を削除し、checkContent 分は残す
  - 観測可能な完了条件: 検証4点セットが全て green で、削除により失敗するテストが残っていない
  - _Requirements: 8.4, 8.5_
  - _Boundary: FC Deletion, firestore.rules_
  - _Depends: 2.1, 2.2_

- [x] 3. 討論チェーンの世代照合（Track 4 / R9）
- [x] 3.1 討論ステップ入口の世代照合ゲートを追加
  - 討論ステップ処理の冒頭で、既存のアクティブ判定用トピック読み取りに相乗りしてタスクの runId と現行 runId を照合し、不一致時は LLM 呼び出し・状態変更・再エンキューを一切行わず正常終了する（例外を投げずリトライを誘発しない）
  - 双方に runId がある場合のみ照合する後方互換規約を追記トランザクションと揃える。追加の Firestore 読み取りを発生させない
  - open / turn / summary / closing / comments の全ステップ種別に共通適用する
  - 観測可能な完了条件: 旧世代 payload を与えた各ステップ種別が副作用ゼロ・再エンキューなしで正常終了する（ユニットテストで確認）
  - _Requirements: 9.1_
  - _Boundary: Generation Gate_
  - _Depends: 2.1_

- [x] 3.2 追記棄却理由をチェーン制御へ伝播
  - ターン追記の棄却理由（世代不一致 / 並走敗者）を null に潰さず呼び出し元まで判別可能な形で伝播させ、世代不一致は再エンキューせず終了、並走敗者は従来どおり最新状態から次ステップを再導出する
  - 既存の戻り値の列挙・意味は変更せず、世代不一致の分岐のみ加法的に追加する（単一世代内の遷移は不変）
  - 観測可能な完了条件: 世代不一致→resume なし、並走敗者→resumeFromFresh の分岐がユニットテストで確認できる
  - _Requirements: 9.2, 9.3, 9.4_
  - _Boundary: Generation Gate_
  - _Depends: 3.1_

- [x] 4. 機械的スイープ（Track 1）
- [x] 4.1 (P) デッドコードと旧スキーマ残骸の削除
  - どこからも参照されていないコンポーネント・型ファイル（空スタブ・0バイト・未参照ページ・未使用 Interview 型）を削除する
  - 実在しないモデルに対応するテストディレクトリ（旧 session スキーマの名残）を削除する
  - 削除前に最終参照チェックを行い、削除一覧を記録する
  - 観測可能な完了条件: 未参照エクスポート・ファイルが残っておらず、検証4点セットが green
  - _Requirements: 4.2, 6.1_
  - _Boundary: Mechanical Sweep_
  - _Depends: 2.2_

- [x] 4.2 (P) 関数宣言のアロー関数化と変換関数の移動
  - 残存する `function` 宣言（3ファイル・6箇所）をアロー関数へ置き換える
  - types ファイル内の変換関数を利用側へインライン化し、types ファイルを型定義と型ガードのみに戻す
  - 観測可能な完了条件: `function` 宣言が理由のある例外を除き存在せず、`*.types.ts` に変換関数が含まれない状態で検証4点セットが green
  - _Requirements: 2.1, 3.5_
  - _Boundary: Mechanical Sweep_
  - _Depends: 2.2_

- [x] 4.3 (P) 日付整形の dayjs 統一
  - 手書きの年月日組み立て・`toLocaleDateString` による日付整形を dayjs へ置き換え、重複する日付整形ヘルパーを一本化する
  - 置き換え前後で出力される文字列が同一であることを固定日付のテストで担保する
  - 観測可能な完了条件: 日付整形が dayjs に統一され、置換前後の出力一致テストが green
  - _Requirements: 4.4, 4.5_
  - _Boundary: Mechanical Sweep_
  - _Depends: 1.1_

- [x] 4.4 短縮変数・引数名の是正（フロントエンド）
  - フロントエンド（stores / models / features / routes）の省略コールバック引数・変数名を、意味の伝わる名前（対象の単数形を既定）へ改名する
  - 改名時に `any` を導入せず、シャドーイング・誤置換がないことをファイル単位の lint とテストで確認する
  - 観測可能な完了条件: フロントエンドに省略名が残らず、`pnpm check` / `pnpm lint` / `pnpm test` が green
  - _Requirements: 2.2, 2.3_
  - _Boundary: Mechanical Sweep_
  - _Depends: 2.2_

- [x] 4.5 短縮変数・引数名の是正（Functions）
  - Functions（agents / pipeline / api / utils）の省略コールバック引数・変数名を意味の伝わる名前へ改名する
  - 討論チェーンのファイルは Track 3 の構造整理より前に改名を完了させる（同一ファイルの直列制約）
  - 観測可能な完了条件: Functions に省略名が残らず、functions tsc と該当テストが green
  - _Requirements: 2.2, 2.3_
  - _Boundary: Mechanical Sweep_
  - _Depends: 2.1_

- [x] 5. CSS の BEM 統一（Track 2）
- [x] 5.1 (P) BEM 軽微違反の是正（Block 名不一致・Modifier 記法・page/layout 命名）
  - Block 名がコンポーネント名と不一致のもの、Modifier が `--` でないもの、page/layout の Block 命名不備を規約どおりに改名する（Block はコンポーネント PascalCase の kebab-case、page/layout は場所接頭辞 + `-page` / `-layout`）
  - class 属性と `<style>` を同期改名する
  - 観測可能な完了条件: 対象ファイルで svelte-check の未使用セレクタ警告が 0、かつ旧クラス名のリポジトリ全域 grep が 0 件
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: BEM Track_
  - _Depends: 2.2_

- [x] 5.2 BEM 未導入コンポーネントの構造化（A グループ）
  - フラットな独自クラス名で組まれたコンポーネント（約9ファイル）を BEM 構造へ書き直す。1ファイル=1単位で class 属性と `<style>` を同期改名する
  - 各ファイル完了ごとに未使用セレクタ警告 0・旧クラス名 grep 0 件を確認する
  - 観測可能な完了条件: 全 BEM 違反コンポーネントが規約準拠となり、管理画面各フェーズ・公開トップ・ログインの目視でスタイル欠落がない
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: BEM Track_
  - _Depends: 2.2, 5.1_

- [x] 6. 通読トラック（Track 3）
- [x] 6.1 配置基準とテスト配置規約の確認・是正
  - Firestore アクセス・Cloud Functions 呼び出しがエンティティの状態管理（ストア / createXXX インスタンス）に置かれ UI から直接呼ばれていないこと、フロント型が models 配下・Functions 型が types 配下にあること、UI 操作オーケストレーションが models に無いことを確認し、逸脱を是正する
  - テストが専用 tests ディレクトリにミラー配置され、命名規約に従い、フロントが `$lib/` エイリアスを使うことを確認する
  - 観測可能な完了条件: 配置逸脱が解消され（または逸脱なしを確認）、検証4点セットが green
  - _Requirements: 3.1, 3.2, 3.3, 6.2, 6.3_
  - _Boundary: Read-through_
  - _Depends: 4.4, 4.5_

- [x] 6.2 関数のトップダウン順への整序と過度な共通化・重複の判定
  - 各モジュールを通読し、関数を「呼び出し元が先、呼び出し先が後」の順へ並べ替え、インフラ層の関数をファイル末尾へ寄せる
  - 過度な共通化候補を structure.md の基準で判定し、該当があれば各画面へ分解する。画面非依存の真に共通な処理のみヘルパーへ集約し、画面依存の重複は許容する
  - 観測可能な完了条件: 対象モジュールの関数順序が規約に沿い、共通化判定の結論が記録され、検証4点セットが green
  - _Requirements: 3.4, 4.1, 4.3_
  - _Boundary: Read-through_
  - _Depends: 6.1_

- [x] 6.3 討論・生成チェーンの挙動保全整理
  - 挙動を変えずに直せるチェーン構造の込み入り（早期終了判定式の二重実装の純関数化、章末応答パスの独立化と summary/closing 選択の一本化、討論状態の組成一本化とエイリアス削除、死んだ分岐・同名別物関数・誤ったフォールバック既定値の解消、フロントの死にパラメータ送信の削除、エージェント層のエラー表現の統一）を整理する
  - 討論チェーンのファイルは世代照合（タスク3）適用後に着手する
  - 観測可能な完了条件: 対象の整理が入っても既存テストが green で、外部挙動が不変（検証4点セット通過）
  - _Requirements: 4.1_
  - _Boundary: Read-through_
  - _Depends: 3.2, 4.5, 6.2_

- [x] 6.4 通読中に発見した仕様不備・不整合の記録
  - 通読中に見つかった実装間の矛盾・明白なバグ・解釈が分かれるエッジケースを、該当箇所とともに記録する（ドキュメント陳腐化は対象外）
  - 観測可能な完了条件: 発見事項が構造化メモとして蓄積され、次タスクのレポート化に使える状態になっている
  - _Requirements: 7.1, 7.2_
  - _Boundary: Read-through_
  - _Depends: 6.1_

- [x] 7. 仕様不備・不整合レポートの提出
  - 既知のチェーン構造所見の未対応項目と通読で新規発見した不備を、「場所 / 事象 / なぜ不備か / 推奨対応」の形式で一覧レポートにまとめる
  - 挙動変更を伴う修正は本 spec では行わず、対応方針の判断をユーザーに委ねる旨を明記する。ドキュメント陳腐化は含めない
  - 観測可能な完了条件: 仕様不備・不整合の一覧レポートが成果物として存在する
  - _Requirements: 7.3, 7.4, 7.5_
  - _Depends: 6.4_

- [x] 8. 完了検証と挙動保全の最終確認
  - リファクタリング全体に対し、型チェック・ESLint・Prettier・フロントビルド・Functions ビルド・既存ユニットテストの全てがエラーなしで通ることを確認する
  - `any` 不使用・strict mode 通過を含め、明示的な例外（章FC削除・世代照合）を除いて公開ページ・管理画面・Functions 入出力・Firestore 永続データ形が不変であることを確認する
  - 観測可能な完了条件: 検証4点セット + 両ビルドが全て green で、例外2件以外の挙動差分がないことが確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4, 10.1, 10.2, 10.3_
  - _Depends: 2.3, 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 6.3, 7_
