# Implementation Plan

段階導入（design.md「Migration Strategy」）に沿い、Phase1 基盤 → Phase2 判定/文脈の付け替え → Phase3 focusQuestion 物理削除 → 検証 の順で並べる。各 Phase でテストが緑のままになるよう、参照を残しつつ付け替えてから最後に型を削除する。

- [x] 1. 基盤: アクティブ論点の解決と提示遷移の一本化
- [x] 1.1 アクティブ論点を解決する共通関数を用意
  - 章の論点状態から「最新に提示された論点（提示済みのうち提示連番が最大のもの）」を一意に解決する純関数を追加する。提示済みが無ければ未解決（undefined）を返す
  - 発言生成側に既にあるインラインの最新論点算出を、この共通関数に置き換える
  - 提示連番が未採番のデータ（移行期）は対象外とし、推測のための特別扱いは入れない
  - Observable: 提示済み論点が複数あるとき提示連番が最大の1件を返し、提示済みが無いとき undefined を返すユニットテストが緑
  - _Requirements: 3.1, 5.1, 7.1, 7.2_
  - _Boundary: getActiveDiscussionPoint_

- [x] 1.2 提示遷移を markIntroduced に統一し投入候補を未提示に限定
  - 論点を提示済みにする遷移をすべて markIntroduced 経由にし、介入処理内の直接更新を廃止する（提示連番が必ず採番される）
  - 介入の投入候補を未提示（untouched）の論点に限定し、候補リスト・選択インデックス・markIntroduced の対象集合を同一の並びにそろえる
  - Observable: 介入で投入された論点に提示連番が付与され最新アクティブ論点として解決されること、提示済み論点が投入候補に現れないことをユニットテストで確認
  - _Requirements: 4.2, 4.4_
  - _Boundary: markIntroduced, Intervention_

- [x] 2. ファシリテーター判断をアクティブ論点基準へ
- [x] 2.1 誘導・論点ずれ・出尽くしの判断軸を置換
  - 介入評価に「アクティブ論点（無ければ章タイトル）」を渡し、章のミッション提示・ずれ判定・出尽くし判定の文面をアクティブ論点基準に書き換える
  - 投入可能な未提示論点が無いときは引き戻し・振り直しに倒し、アクティブ論点も未提示論点も無いときは介入せずエラーにしない
  - 介入に渡す未提示論点リストを 1.2 の未提示限定の集合にそろえる
  - Observable: 介入評価のプロンプトにアクティブ論点（または章タイトル）が含まれ、focusQuestion 由来の文言が含まれないことをモックテストで確認
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 7.3_
  - _Boundary: evaluateTopicDrift, evaluateStallIntervention, runInterventionCheck_
  - _Depends: 1.1, 1.2_

- [x] 2.2 章導入の入口を先頭論点に一本化
  - オープニングと章導入で focusQuestion と先頭論点の二重提示を解消し、先頭論点を唯一の切り口にする。論点を持たない章は章タイトルを入口にする
  - Observable: 章導入発言の生成入力に同一の問いが二重に現れないことをモックテストで確認
  - _Requirements: 6.1_
  - _Boundary: generateOpening, generateChapterIntroduction_

- [x] 3. 発言者文脈とファクトチェックスコープの置換
- [x] 3.1 (P) 発言者文脈をアクティブ論点に一本化
  - 発言生成の文脈から章フォーカス（focusQuestion）の提示を外し、アクティブ論点を提示する（既存の注入を維持）。アクティブ論点が無いときは章タイトルを提示する
  - Observable: 発言生成の文脈に focusQuestion が含まれず、アクティブ論点が（不在時は章タイトルが）含まれることをテストで確認
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: generateTurn_
  - _Depends: 1.1_

- [x] 3.2 (P) ファクトチェックの話題スコープを置換
  - 検証文脈の「フォーカス問い」を「話題スコープ」に置き換える。インライン検証はアクティブ論点（無ければ章タイトル）、章バッチ検証は章タイトルで埋める。スコープ補足の参照を新フィールドに切り替える
  - Observable: インライン検証・章バッチ検証の双方で話題スコープが適切に埋まり、focusQuestion 参照が無いことをテストで確認
  - _Requirements: 6.2_
  - _Boundary: FactCheckContext, fact-check runner, fact-check judge_
  - _Depends: 1.1_

- [x] 4. (P) 章生成で論点を平易な問いとして生成
  - 章生成のスキーマ・組み立て・プロンプトから focusQuestion を外し、各論点を専門知識のない一般人が日常感覚で理解できる問いの形で生成する（第1章は特に平易、意味的重複は1件に統合、特定ペルソナ名・発言を前提にしない汎用の問い）
  - Observable: 生成スキーマが focusQuestion を含まず、生成される章が title と discussionPoints のみで構成される（生成出力に focusQuestion が現れない）
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4_
  - _Boundary: buildChapters_

- [x] 5. focusQuestion の物理削除
- [x] 5.1 functions の型・永続・読み出しから削除
  - 章のランタイム型・永続型・読み出しマッピング、永続化の書き込みから focusQuestion を除去する。既存データに残る focusQuestion を読み出しで参照しないことで後方互換を保つ
  - Observable: focusQuestion を含まない章ドキュメントが書き込まれ、focusQuestion を持つ既存データの読み出しがエラーにならないことを確認
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - _Boundary: Chapter型(functions), chapter読み出し, chapter-generator_
  - _Depends: 2.1, 2.2, 3.1, 3.2, 4_

- [x] 5.2 (P) front の型と表示から削除
  - 前面の章型から focusQuestion を除去し、章の表示を章タイトルと論点に切り替える。focusQuestion を含む既存テストフィクスチャを更新する
  - Observable: 管理画面の章表示に focusQuestion が出ず、章タイトルと論点が表示される。前面テストが緑
  - _Requirements: 1.1, 6.3_
  - _Boundary: Chapter型(front), Phase5Debate_

- [x] 6. 結合・回帰検証
  - 章開始 → オープニングが先頭論点を提示 → 後続発言の文脈にアクティブ論点が入る、の通しを結合テストで確認する
  - 介入で未提示論点を投入 → それが新たなアクティブ論点になり、ずれ判定の基準が更新される、を結合テストで確認する
  - focusQuestion を持つ既存データの読み出し・処理がエラーなく動くことを回帰確認する。既存ユニットテスト群が型・文面変更に追従して緑であることを確認する
  - Observable: 上記シナリオの結合テストと既存テスト群がすべて緑
  - _Requirements: 1.4, 3.1, 4.4, 6.2_
  - _Depends: 5.1, 5.2_
