# Implementation Plan

- [x] 1. 対象型の網羅的な棚卸しと分類
  - `src/lib/models` の全型、`stores` / `features` の表示派生（`.map` / `$derived` によるオブジェクト組み立て）、`functions/src/types` の全型を走査する
  - 候補を「散在→集約」「表示用もどき」「重複→一本化」「死型→削除」「責務境界違反」に分類し、各々に整理対象か正当な派生（doc id / マップキーの materialize、Timestamp→Date の実差）かの判定根拠を付す
  - Props に独自データ型を内包する箇所も洗い出す
  - 完了状態: 分類と判定根拠付きの候補一覧が得られ、以降タスク（3・5）の対象が確定する
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. フロント表示派生の描画時解決化
- [x] 2.1 所感（impressions）の話者ラベルを描画時解決にする
  - build 時に name/role を畳んでいる所感の組み立てを、personaId を保持したまま描画時解決に変える
  - 所感表示コンポーネントが personaId から name/role を解決して描画する
  - 完了状態: 所感表示が build 時のラベル畳み込みなしで従来と同一出力になり、該当テストが green
  - _Requirements: 3.1, 3.4, 6.1, 6.2_
- [x] 2.2 気づき（awareness）を id 保持＋描画時解決にする
  - awareness の集約形を `{ personaName, content }` から `{ personaId, content }` に変え、描画時に name を解決する（討論・編集の両画面）
  - 由来 id 参照は維持し、表示出力は不変に保つ
  - 完了状態: 討論・編集の awareness 表示が従来と同一で、該当テストが green
  - _Requirements: 3.2, 3.4, 6.1, 6.2, 6.3_

- [x] 3. (P) エンゲージメント型の models 移設と描画時解決
  - store 内に独自定義されたエンゲージメント派生型を `models` のエンゲージメント型へ移し、参照を付け替える
  - エンゲージメント一覧が話者名を型に畳まず描画時に解決する
  - 完了状態: エンゲージメント表示が従来と同一で、型定義が store から models に移り、該当テストが green
  - _Requirements: 2.2, 2.3, 3.1, 6.1, 6.2, 7.1, 7.2, 7.3_
  - _Boundary: EngagementList, engagements store, models/engagement_
  - _Depends: 1_

- [x] 4. (P) functions の編集後ターン/章型をドメインファイルへ分離
  - 編集出力の型ファイルに混載された編集後ターン・編集後章・編集章ステータスを、turn / chapter のドメイン型ファイルへ移す
  - 編集出力の型ファイルは導入/締め/所感の出力専用に縮小し、参照 import を全付け替えする
  - 永続書き込み形の構造・命名・フィールドは不変に保つ
  - 完了状態: functions の型配置が FE の正準マッピングと同粒度に並行し、functions の型チェックとテストが green
  - _Requirements: 2.1, 2.2, 2.3, 8.1, 8.2, 8.3_
  - _Boundary: functions/src/types_
  - _Depends: 1_

- [x] 5. functions 内の重複型の一本化と死型の削除
  - 棚卸しで特定した完全一致の永続/実行時型・無意味化した派生を一本化する
  - 参照ゼロの型・ファイルと、それに言及する残存コメントを削除する
  - 永続書き込み形の役割・命名・構造は維持する
  - 完了状態: functions に重複・死型が残らず、型チェックとテストが green
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 8.1, 8.2_
  - _Depends: 4_

- [x] 6. 責務境界の統一と FE/functions 整合の点検・是正
  - ドメイン/永続型（FE・functions とも）が intrinsic な値と id 参照のみを持ち、解決済みラベル・JOIN・算出結果を持たないことを点検し、逸脱を是正する
  - 同一概念の型が FE/functions で同じ責務境界・配置粒度にそろっていることを確認する
  - Props のフィールド型が `models` の型を用い、Props に独自データ型を内包しないことを確認する（Props 型は `models` に定義しない）
  - 完了状態: 全ドメイン/永続型が責務境界ルールに適合し、FE/functions の同一概念が整合している
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.4, 7.5, 8.3, 8.4_
  - _Depends: 2, 3, 4, 5_

- [x] 7. 全体検証（型チェック・テスト・静的検査）
  - FE の型チェック（`svelte-check` 0 error / 0 warning）と functions の型チェック（`tsc` 0 error）を通す
  - FE・functions の既存テストを全て green にする
  - 旧パス/旧フォルダ参照ゼロ・死型ゼロ・ドメイン型に派生フィールド無しを grep で確認する
  - 永続書き込み形（`*ForFirestore`）の構造が不変であることを確認する
  - 完了状態: 型チェックと両テストが green で、静的検査で残存アンチパターンがゼロ
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Depends: 6_
