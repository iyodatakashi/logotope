# Implementation Plan

> 順序メモ: タスク1〜4 が R1（末尾評価・evaluating status）＝設計の任意フェーズ1に相当し、これだけで「章の最後のターンにも反応が付く」が成立する。タスク5〜6 が pendingTurn（generating/fact-checking）＝フェーズ2。規模的に分割が必要になれば 5 以降を後続へ回せるが、本プランは依存順に一括で並べる。

- [x] 1. Foundation: 型定義と FE ミラー
- [x] 1.1 functions 側の永続型に status / pendingTurn を追加
  - 確定ターンに反応評価中を表す `status?: 'evaluating'` を追加する
  - 生成中ターンを表す PendingTurn（id・personaId・どの frontier かを示す expectedTurnIndex・`status: 'generating' | 'fact-checking'`）を定義し、章ドキュメントに任意フィールドとして持たせる
  - 追記入力の型にも status を通せるようにする
  - Observable: functions が strict でビルドでき、確定ターンの status と章の pendingTurn を型として参照できる
  - _Requirements: 2.7_

- [x] 1.2 (P) FE ミラー型に status / pendingTurn を追加
  - フロント側の永続ミラー型に、確定ターンの `status?: 'evaluating'` と章の pendingTurn を反映する（*ForFirestore をフロントで直接流用せず境界で保持）
  - Observable: chapters ストアが型エラーなく status/pendingTurn を保持し、FE がビルド通過する
  - _Requirements: 2.6_
  - _Boundary: FE 型ミラー_

- [x] 2. コミット契約の拡張（確定時の status 付与と pendingTurn 移送）
- [x] 2.1 追記処理に id 供給・evaluating 付与・pendingTurn クリアを組み込む
  - ターン id を任意入力にし、未指定時は従来どおりトランザクション内で発番する（facilitator ターン経路の互換を保つ）。persona ターンは生成開始時に発番した id を渡す
  - コミットするターンに `status='evaluating'` を含め、同一トランザクションで章の pendingTurn を削除する（生成中→確定の原子的移送）
  - 既存の frontier 照合（確定本数＝期待位置）と runId 世代照合を維持し、不一致は副作用なしで棄却する
  - Observable: persona ターン確定時に turns へ `status='evaluating'` 付きで1件だけ追記され pendingTurn が消える。index/generation 不一致では何も追記されない
  - _Requirements: 2.3, 2.4, 2.8, 3.6_

- [x] 3. 末尾評価（コミット済みターンへの反応評価と status 終了）
- [x] 3.1 コミット済みターンの反応評価と status クリアを一体化した処理
  - 直近コミットしたターン（turns 末尾）を対象に、全非話者の engagement/awareness を評価して当該ターン ID に紐づけ永続する（awareness の紐づけ元も当該ターン）
  - 既に永続済みの評価は再評価せず、awareness も再検出しない（同一ターンの二重評価回避）
  - 気づき検出は engagement 評価に相乗りさせ、専用の追加 LLM 呼び出しを設けない
  - 「反応の永続」と「当該ターンの evaluating 解除」を必ずセットで行い、片方だけ済んだ中間状態を残さない（世代ガード付き）
  - Observable: 対象ターンに反応が永続された後にそのターンの status が未設定へ戻る。同一ターンでの再実行で LLM を再呼び出ししない
  - _Requirements: 1.1, 1.2, 1.3, 1.7, 2.5_

- [x] 4. 末尾評価のステップ配線
- [x] 4.1 通常ターンの末尾評価と次ターンへの受け渡し
  - 発言確定後の共通後処理の直後に末尾評価を実行し、ステップ先頭の既存評価は「永続済みなら読むだけ」に退化させる
  - 次ターンの話者選択・介入・盛り上がり判定が、直前ターンの末尾評価で永続された反応を入力に使う
  - Observable: 連続する通常ターンで、各ターン確定後に反応が永続され、次ターンは再計算せず reuse する
  - _Requirements: 1.4_

- [x] 4.2 オープニングと章末最終応答の末尾評価
  - オープニング（導入）ターン確定後に末尾評価を実行し、最初のペルソナ発言の話者選択が反応を読める状態にする
  - 章末最終応答（freeze）ターンのコミット後にも末尾評価を実行し、従来の評価スキップを撤回する
  - Observable: 章の最初のペルソナ発言時にオープニングへの反応が存在し、章末最終応答ターンにも engagement/awareness が付与される
  - _Requirements: 1.5, 1.6_

- [x] 4.3 自己修復と章クローズ時の取りこぼし防止
  - 各ステップ先頭で、直前確定ターンの反応が未永続なら末尾評価を呼ぶ（通常は reuse で読み取りに退化）
  - 章完了ステップは completed 確定前に、最終ターンの反応が未永続なら末尾評価を呼ぶ
  - Observable: 末尾評価の途中で中断・リトライされても、最終ターンを含め evaluating が残らず反応が永続される
  - _Requirements: 3.3, 3.7_

- [x] 5. 生成中ターンの pendingTurn 反映とクリーンアップ
- [x] 5.1 生成段階に応じた pendingTurn の書き込み
  - 話者確定・本文生成開始で pendingTurn を generating（話者・発番 id・frontier 付き）として書き込み、ファクトチェック開始で fact-checking に更新する
  - コミットへは pendingTurn で発番した id を渡し、確定時に turns へ移送する（次の発言者は pendingTurn の話者で表現し、専用フィールドは設けない）
  - Observable: 生成中に章の pendingTurn が generating→fact-checking と観測でき、コミットで消える
  - _Requirements: 2.1, 2.2_

- [x] 5.2 pendingTurn のクリーンアップ（停止・失敗・敗者）
  - 討論停止（生成途中の停止検出）・生成/検証失敗・frontier 敗者で pendingTurn を削除する
  - 削除は自タスクが発番した id と一致するときだけ行い、後続 frontier の正当な pendingTurn を誤消去しない
  - Observable: 停止・失敗・敗者のいずれでも未確定の pendingTurn が残らず、turns は不変のまま
  - _Requirements: 3.4, 3.5, 3.6_

- [x] 6. 検証（回帰・不変条件・観測性）
- [x] 6.1 出力不変と状態隔離の回帰テスト
  - 末尾評価移行の前後で、通常ターンの発言内容・話者選択結果・awareness 内容が変わらないこと（status 付与と最終ターンへの awareness 付与を除く）を確認する
  - 状態再構築と発言生成の文脈が pendingTurn の影響を受けないこと（turns は確定のみを数える／未確定本文を討論の文脈に使わない）を確認する
  - Observable: 回帰テストが緑で、生成中ターンを混ぜても話者統計・沈黙度・frontier・LLM 文脈が従来と一致する
  - _Requirements: 1.8, 3.1, 3.2_
  - _Boundary: pipeline/debate テスト_

- [x] 6.2 進捗ライフサイクルと観測性のテスト
  - pendingTurn generating→fact-checking→コミット（evaluating）→status 解除の遷移、最終/オープニング/freeze への反応付与、停止・中断後の残留なしを検証する
  - 追加リスナーなしに、章ドキュメントの pendingTurn と各ターンの status が既存購読で観測できることを確認する
  - Observable: ライフサイクル遷移・境界ケース・観測性のテストが緑で、evaluating や pendingTurn が恒久残留しない
  - _Requirements: 2.6, 2.7, 3.3, 3.4, 3.5, 3.7_
  - _Depends: 4.3, 5.2_
  - _Boundary: pipeline/debate テスト, FE ストア_
