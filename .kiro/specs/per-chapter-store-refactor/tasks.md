# Implementation Plan

- [x] 1. チャプターを章単位ストアインスタンスへ再構成
- [x] 1.1 章単位 ChapterStore とコレクション集約 chaptersStore を構築し ChapterWithId を廃止
  - 章コレクションを `chapterIndex` 昇順で購読し、各章を 1 章分の状態（chapterIndex・title・focusQuestion・discussionPoints・turns・discussionPointStatuses・status・id）を公開する ChapterStore インスタンスとして保持する
  - 同一トピックの複数章がそれぞれ別個の ChapterStore インスタンスになる
  - 全章の turns を章順・配列順に連結した一覧と isLoaded を提供する
  - スナップショットコールバック内で running 章の id を currentChapterId として設定する（$effect を使わない）
  - ChapterWithId 型を定義・公開せず、既存参照を ChapterStore もしくは ChapterStateDoc へ置き換える
  - 観測可能な完了状態: スナップショット投入で chapters が昇順の ChapterStore 群になり、currentChapterId が running 章を指し、ChapterWithId への参照がコードベースから消える
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 5.1, 5.4_
  - _Boundary: ChapterStore, chaptersStore_

- [x] 1.2 currentChapterStore で current 章を導出
  - currentChapterId に一致する ChapterStore を返し、running 章が無ければ null を返す
  - 可変状態・セッターを持たず、判定は chapterId と currentChapterId の比較に一元化する
  - 観測可能な完了状態: running 章があれば該当 ChapterStore、無ければ null が得られる
  - _Requirements: 1.4_
  - _Boundary: currentChapterStore_

- [x] 1.3 chaptersStore と currentChapterStore のユニットテストを新構造へ更新
  - スナップショットから ChapterStore 群生成・chapterIndex 昇順・turns 連結・currentChapterId 設定（running 有/無）・stop での購読解除を検証する
  - currentChapterStore が currentChapterId に対応する ChapterStore を返す/null を返すことを検証する
  - 観測可能な完了状態: 更新後のチャプターストア系テストがパスする
  - _Requirements: 7.3_
  - _Boundary: chaptersStore, currentChapterStore_

- [x] 2. (P) エンゲージメントを章単位ストアインスタンスへ再構成
- [x] 2.1 (P) 章単位 EngagementStore を構築
  - 1 章の engagements サブコレクションを購読し、各ペルソナ履歴を turnId 文字列キーでグループ化した engagementsMap を公開する
  - buildEngagementsMap の純粋関数としての振る舞い（空入力・複数ペルソナのグループ化・文字列キー保持）を維持する
  - stop で当該章の購読を解除する。ChapterStore を内部に保持・生成しない
  - 観測可能な完了状態: 章 id を与えて生成・購読開始すると、スナップショット投入で engagementsMap が turnId キーで埋まり、stop で購読が解除される
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 5.2, 5.4_
  - _Boundary: EngagementStore_

- [x] 2.2 (P) 集約 engagementsStore を構築し setChapterId を廃止
  - start 時に章 id を one-shot 取得し、章ごとの EngagementStore を生成・購読する（章集合は固定のため変化監視・$effect・常設購読を行わない）
  - 全 EngagementStore の map を turnId キーで統合した engagementsMap を公開する
  - setChapterId を提供せず、stop で全 EngagementStore の購読を解除する
  - 観測可能な完了状態: start で全章ぶんの EngagementStore が購読され、統合 engagementsMap が全章のエンゲージメントを横断で引け、stop で全購読が解除される（リーク無し）
  - _Requirements: 2.1, 2.2, 2.4_
  - _Boundary: engagementsStore_
  - _Depends: 2.1_

- [x] 2.3 (P) engagements のユニットテストを新構造へ更新
  - setChapterId ベースの検証を、章単位インスタンス生成・one-shot 全章購読・統合 map・stop での全解除（リーク無し）・setChapterId 不在の検証へ置き換える
  - buildEngagementsMap の既存テストを維持する
  - 観測可能な完了状態: 更新後のエンゲージメントストア系テストがパスする
  - _Requirements: 7.1_
  - _Boundary: EngagementStore, engagementsStore_
  - _Depends: 2.2_

- [x] 3. 集約ストアの結線と消費側の追従
- [x] 3.1 currentTopicStore から $effect.root とシングルトン engagements を除去して新ストア群を結線
  - モジュールレベルの $effect.root を使わず、シングルトン engagementsStore と setChapterId 結線を持たない
  - chaptersStore・currentChapterStore・engagementsStore を生成・start し、stop で全解除する
  - 既存の公開アクセサ（topic・chaptersStore・personasStore 等）の利用契約を維持し、engagements 参照を新構造へ置換する。両ストアは独立した生成関数呼び出しで生成する
  - 観測可能な完了状態: currentTopicStore に $effect.root が存在せず、start で各購読が開始、stop で全解除され、既存アクセサが従来どおり参照できる
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.3_
  - _Depends: 1.2, 2.2_

- [x] 3.2 管理討論画面（Phase5Debate）を新ストア参照へ追従
  - 実行中章の参照を currentChapterStore 経由に変更し、ターンのエンゲージメントを統合 engagementsMap から引く
  - 既存表示（発言・話者・エンゲージメント・信念変化・チャプター進捗）を維持し、実行中章のエンゲージメントを反映する
  - 該当 spec テストの setChapterId モックを除去し、新構造（currentChapterStore・統合 engagementsMap）に対応させる
  - 観測可能な完了状態: Phase5Debate がターンとエンゲージメントを従来どおり表示し、更新後の spec テストがパスする
  - _Requirements: 6.1, 6.5, 7.2_
  - _Depends: 3.1_

- [x] 3.3 公開討論ページを ChapterStore アクセサへ追従
  - チャプター一覧・turns・isLoaded の利用契約を維持したまま ChapterStore インスタンスのアクセサ参照へ更新する
  - マウントで購読を開始し、アンマウントで購読を解除する
  - 観測可能な完了状態: 公開ページがチャプター一覧・ターン・公開コメントを従来どおり表示し、購読がマウント/アンマウントで開始・解除される
  - _Requirements: 6.2, 6.3, 6.4_
  - _Depends: 1.1_

- [x] 3.4 購読ライフサイクルの統合検証
  - 討論画面のマウントで必要な Firestore 購読が開始され、アンマウントで開始した全購読が解除されること（購読リーク無し）を確認する
  - リファクタ後にユニットテストスイート全体がパスすることを確認する
  - 観測可能な完了状態: マウント/アンマウントで購読の開始・全解除が成立し、全テストがグリーンになる
  - _Requirements: 6.3, 6.4, 7.4_
  - _Depends: 3.1, 3.2, 3.3_
