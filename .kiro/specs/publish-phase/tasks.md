# Implementation Plan

## 1. 基盤: フェーズ定義と型に publish / published を追加

- [x] 1.1 フェーズ定義に `publish` を追加（FE/BE）
  - FE の `PhaseSlug` と `PHASE_DEFS` の末尾に `publish` を追加し、正準 slug リストが `[..., 'editing', 'publish']` になる
  - BE の `PhaseSlug` にも `publish` を追加し、正準リストコメントを更新（FE と値集合・順序が一致）
  - publish の `statusLabels` は全状態フォールバック（'未公開'）として定義し、`phaseStatus` が publish で意味を持たない旨のコメントを付す
  - 観測可能な完了: `nextPhase('editing')` が `'publish'` を返し、`phaseOrder` 上 publish が末尾になる
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 1.2 Topic 型に `published` を追加（FE/BE）
  - FE の永続型に `published?: boolean`、アプリ層型に `published: boolean`（必須）を追加
  - BE の永続型に `published?: boolean` を追加（FE 永続型と同一形の規約）
  - 観測可能な完了: 型チェックが通り、アプリ層 Topic が `published` を必須プロパティとして持つ
  - _Requirements: 1.1_
  - _Depends: 1.1_

- [x] 1.3 読み込み境界で `published` を非公開に正規化
  - Firestore 永続形→アプリ層変換で `published` 欠落時に `false` へ正規化し、アプリ層に optional を漏らさない
  - 観測可能な完了: `published` フィールドの無い既存トピックがアプリ層で `published === false` として読める
  - _Requirements: 1.1, 7.1, 7.2_
  - _Depends: 1.2_

## 2. 基盤: ドメイン純関数と Topic 操作

- [x] 2.1 (P) フェーズ表示ラベルを publish 対応にする
  - `phaseDisplayLabel` の入力に `published` を追加し、`phase === 'publish'` は `published` から「公開中(completed)/未公開(pending)」を導出（`phaseStatus` を参照しない）
  - 終端が publish へ移るのに伴い `generated && isLastPhase → completed` 分岐を削除して `generated → ready` に一本化し、未使用となる `isLastPhase` を削除
  - 観測可能な完了: publish フェーズで `published` に応じたラベル/スタイルが返り、`isLastPhase` の参照が無くなる
  - _Requirements: 2.3_
  - _Boundary: phaseDisplayLabel_
  - _Depends: 1.1_

- [x] 2.2 (P) フェーズごとの編集可否 `phaseEditable` を追加
  - phase モデルに純関数 `phaseEditable(current, target)` を追加し、`target === 'publish'` は常に `true`、それ以外は `!current.published` を返す
  - `phaseLogicalState` と同型の「トピック状態 × 対象フェーズ → 導出値」パターンに揃える
  - 観測可能な完了: 公開中に `phaseEditable(topic, 'editing')` が `false`、`phaseEditable(topic, 'publish')` が `true` を返す
  - _Requirements: 8.2, 8.3_
  - _Boundary: phase モデル_
  - _Depends: 1.1_

- [x] 2.3 編集承認・公開・非公開の Topic 操作を追加
  - 編集を承認して publish へ前進する操作を追加（既存の前進機構に委譲し、前進後 `phaseStatus` は `not_started`）
  - 公開操作に `published: true` の書き込みを追記（`publishedAt` 更新・personaCount 再集計の既存挙動は維持）
  - 非公開操作を新設し `published: false` のみ書く（`publishedAt` は保持）
  - 観測可能な完了: 承認で `phase='publish'` になり、公開/非公開で `published` が true/false に切り替わり `publishedAt` が保持される
  - _Requirements: 1.3, 1.4, 3.2, 3.3_
  - _Depends: 1.2_

## 3. コア: StepNav の完了判定

- [x] 3.1 StepNav ラッパーの progress を `{ step, status }` 化し公開ステップを追加
  - ステップ定義の末尾に「公開」ステップを追加
  - props に現在フェーズの `phaseStatus` と `published` を受け取り、`progress` を `{ step, status }` で導出（`step`=現在フェーズを含むグループのキー、`status`=publish なら `published`・それ以外は `phaseStatus === 'generated'` で `done`/`in-progress`）
  - レイアウトから `phaseStatus`/`published` を受け渡す（未ロード時の既定は `not_started`/`false`）
  - 観測可能な完了: 編集完了で publish へ前進すると「編集」ステップにチェックが付き、公開 ON で「公開」ステップにチェックが付く
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Depends: 2.3_

## 4. コア: 公開画面

- [x] 4.1 公開画面ルートと公開スイッチを追加
  - 公開フェーズのルート（thin wrapper）と公開画面コンポーネントを新設
  - トピックの `published` を真実として公開 ON/OFF スイッチを表示し、操作で公開/非公開操作を呼ぶ
  - 操作中は多重操作を抑止し、失敗時はエラー表示（表示の真実は永続値なので楽観状態を持たない）
  - 観測可能な完了: 公開フェーズで公開画面が表示され、スイッチ操作で `published` が切り替わり表示が追従する
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Depends: 2.3_

## 5. コア: 編集画面の「次に進む」

- [x] 5.1 編集画面に「次に進む」を追加
  - 既存フェーズ画面と同一パターンで、編集完了時に活性化する「次に進む」を追加（最終ステップ用の空プレースホルダを置換）
  - 押下で編集を承認して公開画面へ遷移し、承認失敗時はエラー表示・フェーズ不変
  - 観測可能な完了: 編集完了状態で「次に進む」を押すと公開フェーズへ前進し公開画面へ遷移する
  - _Requirements: 3.1, 3.4, 3.5_
  - _Depends: 2.3_

## 6. コア: 公開中のコンテンツ凍結（各画面への適用）

- [x] 6.1 各フェーズ画面の変更操作を `phaseEditable` で不活性化
  - 各フェーズ画面（テーマ設定・事実リサーチ・ペルソナ・章立て・討論・編集）とヘッダーのタイトル入力が `phaseEditable(topic, 自フェーズ)` を導出し、変更系要素（生成・再生成・インライン編集・並べ替え・追加削除・タイトル編集等）を不活性化
  - 画面ごとに変更系要素を列挙して網羅（遷移・閲覧・「次に進む」は不活性化しない）
  - 配下の編集系コンポーネントへは各画面が編集可否を props で伝播
  - 観測可能な完了: 公開中は各画面の変更操作が disabled になり閲覧・遷移は可能、非公開に戻すと全操作が復帰する
  - _Requirements: 8.1, 8.2, 8.3_
  - _Depends: 2.2_

## 7. 統合: 公開判定の寄せ替えとインフラ

- [x] 7.1 公開閲覧側の判定を `published` へ寄せ替え
  - 公開トップの一覧フィルタを `published` に変更（ソートの日時利用は維持）
  - 一覧アイテムの公開/非公開表示分岐を `published` に変更（日時表示は `publishedAt` のまま）
  - 観測可能な完了: 公開トップに `published === true` のトピックのみ表示され、`publishedAt != null` 判定が公開閲覧側に残らない
  - _Requirements: 1.2, 1.5, 6.1, 6.2, 6.3_
  - _Depends: 1.3_

- [x] 7.2 admin ダッシュボードのバッジに `published` を渡す
  - バッジ導出に `published` を渡し、公開フェーズで公開中/未公開が表示される
  - 観測可能な完了: 公開中トピックが一覧で「公開中」バッジになる
  - _Requirements: 2.3_
  - _Depends: 2.1_

- [x] 7.3 firestore.rules の一般公開読み取り条件を `published == true` へ
  - トピック本体および公開対象サブコレクション（personas / chapters / editedChapters / editorial）の一般読み取り条件を `publishedAt != null` から `published == true` へ変更
  - `== true` によりフィールド欠落時は読み取り不可（fail-safe）
  - 観測可能な完了: `published=true` のトピックのみ未認証で読め、非公開化（OFF）後は読めなくなる
  - _Requirements: 1.2, 6.3, 7.1_
  - _Depends: 1.2_

- [x] 7.4 BE の討論完了判定を publish 対応にする
  - 討論完了判定を「`phase` が editing または publish なら完了扱い」に修正し、非公開化後の再編集（publish からの編集開始）がブロックされないようにする
  - BE 型の publish / published 追加（1.1・1.2 の BE 分）と同一変更単位で実施
  - 観測可能な完了: `phase='publish'` のトピックで編集開始が討論未完了として弾かれない
  - _Requirements: 2.1_
  - _Depends: 1.1_

## 8. 検証

- [x] 8.1 (P) ドメイン純関数のユニットテスト
  - 正準リストへの publish 追加（`phaseOrder`・`nextPhase('editing') === 'publish'`）、`phaseDisplayLabel` の publish 分岐（公開中/未公開）、`isLastPhase` 削除への追従、`phaseEditable`（publish は常に true・他は公開中 false）、読み込み境界の `published` 欠落→false
  - 観測可能な完了: 上記ケースのテストが通る
  - _Requirements: 1.1, 2.1, 2.3, 2.4, 7.1, 8.2, 8.3_
  - _Boundary: phase モデル, 読み込み境界_
  - _Depends: 1.3, 2.1, 2.2_

- [x] 8.2 (P) StepNav ラッパーのユニットテスト
  - `{ step, status }` 導出 — 中間フェーズ generated→done、publish+published=true→done、publish+published=false→in-progress、前進済みフェーズが completed になる配置
  - 観測可能な完了: 公開ステップと done 判定のケースが通る
  - _Requirements: 5.3, 5.5, 5.6_
  - _Boundary: StepNav ラッパー_
  - _Depends: 3.1_

- [x] 8.3 (P) BE 討論完了判定のユニットテスト
  - `phase='publish'` で討論完了扱いになるケースを追加
  - 観測可能な完了: 既存テスト網羅に publish ケースが加わり通る
  - _Requirements: 2.1_
  - _Boundary: BE 討論ライフサイクル_
  - _Depends: 7.4_
