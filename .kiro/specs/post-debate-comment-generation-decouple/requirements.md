# Requirements Document

## Introduction

本フィーチャーは、討論パイプライン（`functions/src/pipeline/debate/`）の stepKind チェーン末尾を整理し、討論後コメント（原本 `postDebateComments`）の生成を討論ライフサイクルから切り離す。

現状の討論チェーンは `open → turn(×N) → summary|closing → comments` であり、末尾3ステップに以下の問題が集中している。

1. `summary`（非最終章）/`closing`（最終章）は `debate-summary-closing-removal` spec で発話生成を削除済みで、実体は `completeChapterStep`（章を `completed` に確定＋論点状態クリーンアップ）を呼ぶ「章完了トランジション」になっている。しかし stepKind 名が要約/締めの名残のままで実態と乖離している。
2. `closing` が `comments` を enqueue しており、章完了と討論後コメント生成が数珠つなぎになっている。
3. `comments` ステップ（`persistPostDebateComments`）が討論ループ終端に埋め込まれ、討論の `phaseStatus: running→generated` 遷移とコメント生成が不可分になっている（`post-debate-comments.ts` が終端フェーズを所有すると自称）。

本フィーチャーのゴールは、(a) 名残となった `summary`/`closing` を実態に合わせた単一の章完了ステップへ整理し、(b) 討論の `generated` 完了をターン生成＋章完了のみで成立させ、(c) 討論後コメント生成を討論とは別のトリガー／ライフサイクルへ移すことである。原本コメントの保存先とスキーマ（`topics/{topicId}/postDebateComments/0`）は変更しない。

## Boundary Context

- **In scope**:
  - 討論チェーン末尾の stepKind 構造・命名の是正（`summary`/`closing` の統合・リネーム）
  - 討論の `generated` 到達条件を「最終章の章完了」に変更（コメント生成を含めない）
  - 討論後コメント生成を討論チェーンから外し、**編集工程（Phase 6）の先頭ステージへ移設**する（原本コメント生成 → 編集パスの順次実行）
  - 順次実行に伴うステージ順序・冪等性・進捗の維持
- **Out of scope**:
  - 原本コメント `postDebateComments/0` のスキーマ・内容・保存パスの変更
  - 討論後コメントの生成ロジック（`generatePostDebateComment`）そのものの変更
  - 編集パスの**リライト処理ロジック**（`editedChapters` / `editedPostDebateComments` の編集内容）の変更
  - 章立て生成（前フェーズ）および `debate-digest` の `summarizeChapter`（文脈圧縮用の別物）
- **Adjacent expectations**:
  - 編集工程は原本コメント生成を先頭ステージとして所有するようになる。編集パイプライン（`editing-orchestrator` / `editing-step`）にステージが1つ増える
  - コメント編集ステージ（`editedPostDebateComments` 生成）は、直前に生成された原本コメント `postDebateComments/0` を入力とする
  - reset/restart 時の付随データ破棄（`discardChaptersWithSideData` → `clearPostDebateComments`）は引き続き原本コメントを消去する必要がある
  - 討論の稼働判定・完了判定（`isDebateActive` / `isDebateCompleted`）は編集開始ゲートに使われており、終端条件の変更後も正しく機能する必要がある

## Requirements

### Requirement 1: 章末ステップの統合と命名是正

**Objective:** 開発者として、発話生成を持たなくなった `summary`/`closing` を実態に合った単一の章完了ステップへ整理したい。それにより名残の命名による誤解を排除し、末尾チェーンを理解可能に保つため。

#### Acceptance Criteria
1. The 討論オーケストレーター shall 章末の処理を、実態（章完了トランジション）を表す単一の stepKind として表現する。
2. When 非最終章の章末に到達した場合, the 討論オーケストレーター shall 当該章を `completed` に確定し論点状態をクリーンアップした上で、次章の `open` ステップを投入する。
3. When 最終章の章末に到達した場合, the 討論オーケストレーター shall 当該章を `completed` に確定し論点状態をクリーンアップする。
4. The 討論パイプライン shall 章末ステップにおいて発話（ターン）を一切生成しない。
5. The 討論パイプライン shall `summary`/`closing` という要約・締めを含意する stepKind 名を使用しない。
6. While 同一章に対する章完了処理が重複適用された場合, the 討論パイプライン shall 冪等に振る舞い状態を破壊しない。

### Requirement 2: 討論の完了（generated）をターン生成のみで確定する

**Objective:** 管理者として、討論の完了をターン生成と章進行のみで判定したい。討論の「討論としての完了」と、後続コンテンツ生成を分離するため。

#### Acceptance Criteria
1. When 最終章の章完了処理が完了した場合, the 討論パイプライン shall 討論後コメントを生成することなく `phaseStatus` を `running → generated` へ遷移させる。
2. The 討論パイプライン shall `phaseStatus: running → generated` 遷移を、討論後コメント生成の成否に依存させない。
3. While `phaseStatus` が `running` または `stopped` 以外の場合, the 討論パイプライン shall `generated` への遷移を行わない（冪等・二重遷移防止）。
4. When 討論が `generated` に到達した場合, the `isDebateCompleted` 判定 shall コメント生成の有無に関わらず `true` を返す。
5. The 討論パイプライン shall 新しい世代 `runId` による世代識別を維持し、旧世代タスクによる終端遷移を弾く。

### Requirement 3: 討論後コメント生成の編集工程への移設

**Objective:** 管理者として、討論後コメント生成を討論チェーンから外し、編集工程の一部として実行したい。討論の完了とコンテンツ生成を分離しつつ、生成の起動点を編集工程に一本化するため。

#### Acceptance Criteria
1. The 討論パイプライン shall 討論後コメント生成を、討論の stepKind チェーン（`open`/`turn`/章完了）の一部として実行しない。
2. The 編集パイプライン shall 討論後コメント（原本 `postDebateComments/0`）の生成を編集工程の一ステージとして所有する。
3. When 編集工程が開始された場合, the 編集パイプライン shall 原本コメント生成ステージを、編集パス（`editedChapters` / `editedPostDebateComments`）より前に実行する。
4. While 原本コメント `postDebateComments/0` が未生成（不在または空）の場合, the 編集パイプライン shall 各ペルソナの見解を生成し `topics/{topicId}/postDebateComments/0` へ保存する。
5. If 原本コメント `postDebateComments/0` が既に存在（非空）する場合, then the 編集パイプライン shall 原本コメントを再生成せずスキップして編集パスへ進む。
6. While 討論が `generated` に到達していない場合, the システム shall 編集工程（およびその先頭のコメント生成ステージ）を開始可能にしない。
7. If 原本コメント生成ステージが同一トピックに対して重複起動された場合, then the 編集パイプライン shall 冪等に振る舞い結果の重複・破壊を生じさせない。
8. If 原本コメント生成ステージが失敗した場合, then the システム shall 討論の `generated` 状態を後退させず、編集工程を再実行可能な状態に保つ。

### Requirement 4: 生成→編集の順次実行と依存関係

**Objective:** 管理者として、原本コメントが生成された後に編集処理が走ることを保証したい。編集パスが未生成の原本を参照して破綻するのを防ぐため。

#### Acceptance Criteria
1. The 編集パイプライン shall コメント編集ステージ（`editedPostDebateComments` 生成）を、原本コメント生成ステージの完了後に実行する。
2. When コメント編集ステージが実行された場合, the 編集パイプライン shall 原本コメント生成ステージ完了時点で存在する原本コメント `postDebateComments/0` を入力とする。
3. When 編集工程が再実行され原本コメントが既に存在する場合, the 編集パイプライン shall 原本を再生成せず、既存の原本を用いて編集パスを実行する。
4. When 討論の restart/reset により原本コメントが消去された後に編集を実行した場合, the 編集パイプライン shall 原本コメントを生成した上で編集パスを実行する。
5. While 原本コメント生成ステージが完了していない場合, the 編集パイプライン shall コメント編集ステージを開始しない。

### Requirement 5: 原本データとリセット挙動の保全

**Objective:** 開発者として、分離に伴い原本コメントのスキーマとリセット時の後始末を壊さないことを保証したい。既存の再開・再生成フローとの整合を保つため。

#### Acceptance Criteria
1. The 討論後コメント生成 shall `topics/{topicId}/postDebateComments/0` のスキーマ・保存パスを変更しない。
2. When 討論が指定章以降で再開（restart）またはリセット（reset）された場合, the 討論パイプライン shall 原本コメント `postDebateComments/0` を消去する。
3. The 討論パイプライン shall 生ディベート（章・ターン・原本コメント）を編集成果物とは別に保持し、編集成果物のリライト内容を本フィーチャーで変更しない。
