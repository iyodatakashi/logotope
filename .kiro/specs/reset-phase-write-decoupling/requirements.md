# Requirements Document

## Introduction

リセット（reset）操作が「今いるフェーズ」を別のフェーズへ書き換えてしまうことによる、フェーズ表示の不整合を解消する。

現状、`resetEditingRun`（サーバの編集リセット）は現在フェーズを一切見ずに定数 `phase='editing', phaseStatus='not_started'` を書き込む。この書き込みは、standalone の編集やり直し（現在フェーズ = editing）では「その場維持」で正しいが、ペルソナ再生成（現在フェーズ = personas）から呼ばれると personas より**前方の editing へフェーズを押し上げてしまう**。結果、下流フェーズ（章立て・討論）が「完了済み」、編集が「討論完了」ラベルで表示される。ユーザーが観測した「ペルソナ生成中に討論が完了済みになる」現象の正体はこれである。

問題の本質は「リセットが phase を書くこと」自体ではなく、**リセットが今いるフェーズを考慮せず、別フェーズの定数を焼き込んで現在フェーズを書き換えていること**にある。

フェーズは順序付きの単一ポインタであり、その遷移は起動処理（`start*` / `generate*`）・前進処理（`advance*`）・明示的な停止操作だけが所有すべきものである。実際 `startEditingRun` は既に `phase='editing', phaseStatus='running'` を書くため、`resetEditingRun` が重ねて phase を書く必要はない。リセットは自層のデータ破棄だけを行い、**現在のフェーズには触れない**——これが本仕様の原則である。他のリセット操作（`resetStakeholders` / `resetPersonas`(createTopic版) / `resetChapters` / `resetDebate`）は既にこの原則に従っており、`resetEditingRun` だけが逸脱している。

## Boundary Context

- **In scope**:
  - `resetEditingRun` が現在フェーズを書き換える挙動の除去（phase / phaseStatus を書かない）
  - FE `personasStore.resetPersonas`（現在フェーズを書き換える・かつ createTopic 版 `resetPersonas` と挙動が矛盾する重複）の整理
  - 各再生成画面が持つ「起動処理を最後に呼んで後勝ちさせる」順序依存の回避策の解消
  - **全再生成カスケード（fact-research / personas / chapters / debate）の下流フェーズ完了表示フラッシュの堅牢な根絶**。クライアント側で reset を順番に呼ぶオーケストレーションをやめ、各再生成を単一のサーバ操作にして「対象フェーズ running 確定 → 下流破棄 → 生成/投入」を原子的順序でサーバが所有する。起点が対象フェーズでも approved（下流）でも下流を完了表示にしない。runId 世代の窓・途中失敗による滞留も生じさせない
  - **命名と責任範囲の乖離の全件処置**。phase/phaseStatus を書くメソッドの命名を責務に一致させる（`reset*` が遷移を書かない／`set*Status` が単一状態名で phase まで書かない 等）。監査で列挙した各乖離は「是正」または「現状維持＋根拠明記」を明示し、未処置で放置しない
- **Out of scope**:
  - 各リセット操作が破棄するデータの範囲・種類の変更（破棄対象は現状維持。破棄の実行場所がクライアント→サーバへ移るのは可）
  - AI 生成パイプライン本体の生成アルゴリズムの変更
  - フェーズ由来 UI のレイアウト・ラベル文言の変更
- **Adjacent expectations**:
  - `phase-generation-server-authority`: 生成の running / generated はサーバが権威的に書く前提を踏襲する
  - `phase-page-ui-unification`: 各フェーズ画面は `(phase, phaseStatus)` から表示状態を純粋導出する前提（`phaseLogicalState`）を崩さない

## Requirements

### Requirement 1: リセット操作は現在のフェーズを書き換えない
**Objective:** 開発者として、リセット操作が今いるフェーズを別フェーズへ書き換えないようにしたい。そうすればリセットが意図せずフェーズを前進させることがなくなる。

#### Acceptance Criteria
1. When 編集リセット処理（`resetEditingRun`）が呼ばれたとき, the 編集リセット処理 shall 編集成果物の破棄のみを行い、`phase` および `phaseStatus` を書き換えない。
2. When 編集リセット処理が完了したとき, the トピック shall 呼び出し前の `phase` / `phaseStatus` をそのまま保持する。
3. The すべてのリセット操作（stakeholders / personas / chapters / debate / editing） shall 自層のデータ破棄のみを行い、`phase` / `phaseStatus` を書き換えないという点で一貫した振る舞いを持つ。

### Requirement 2: フェーズ遷移の所有権を起動・前進処理へ集約
**Objective:** 開発者として、フェーズ遷移の書き込み主体を起動・前進・明示的停止の処理だけに限定したい。そうすれば「誰がフェーズを動かすか」が一意になる。

#### Acceptance Criteria
1. The トピックの `phase` / `phaseStatus` を遷移させる書き込み shall 起動処理（`startPersonaGeneration` / `generateFactResearch` / `generateChapters` / `startDebate` / `startEditing` 等）、前進処理（`advancePhase`）、または明示的な停止・確定操作（`stopDebate` / 生成完了確定 等）のみが行う。
2. When 編集をやり直したとき（`resetEditing → startEditing`）, the トピック shall `startEditing`（`startEditingRun`）の書き込みによって `phase='editing', phaseStatus='running'` へ到達する（`resetEditing` による phase 書き込みに依存しない）。

### Requirement 3: 再生成中に下流フェーズが完了表示にならないこと（全カスケード・堅牢）
**Objective:** 管理者として、どのフェーズを・どの起点から再生成しても、下流フェーズが「完了済み」表示にならないようにしたい。中途半端な緩和ではなく、構造的に発生しない状態にしたい。

#### Acceptance Criteria
1. When 再生成（fact-research / personas / chapters / debate のいずれか）を開始したとき（起点が対象フェーズ・approved のいずれでも）, the サーバ操作 shall 単一の呼び出しで「対象フェーズを `running` に確定 → 下流データを破棄 → 生成/投入」をこの順序で実行する。フェーズ確定は単一ドキュメントの `update` 1回とし、トランザクションは使わない（重い削除・キュー投入をトランザクションに含めない）。
2. The 再生成 shall クライアント側で複数の reset を順番に呼ぶオーケストレーションに依存しない（下流破棄の責務はサーバが所有する）。
3. While 任意の再生成カスケードが実行中（起点を問わず）, the フェーズ由来の表示 shall 対象フェーズより下流のフェーズを完了・通過済みとして表示しない。
4. When 再生成のサーバ操作が対象フェーズを確定した後に失敗したとき, the トピック shall 対象フェーズ（`running` または `stopped`）に留まり、下流（approved）へ戻らない。
5. The 再生成 shall フェーズ確定と旧世代の破棄が未確定に交差する「窓」（対象フェーズ running だが旧 runId の下流タスクが有効なままの状態）を生じさせない。
6. When personas から再生成したとき, the フェーズ shall 途中で personas より前方（editing 等）へ書き換えられない（Req 1 の帰結）。
7. Where 対象が editing（最終フェーズ）の場合, the 下流破棄・先行確定 shall 不要とする（下流フェーズが存在しないため）。

### Requirement 4: 順序依存の回避策の解消
**Objective:** 開発者として、再生成カスケードが「起動処理を最後に呼んで後勝ちさせる」という暗黙の順序ルールに依存しない状態にしたい。そうすれば呼び出し側が並び順を気にせず安全に組める。

#### Acceptance Criteria
1. Where リセット操作が現在フェーズを書き換えなくなったこと, the 各再生成カスケード（fact-research / chapters / debate / persona / editing） shall リセット操作と起動処理の呼び出し順序に依存せず、最終的なフェーズ状態が正しくなる。
2. When 整理後にコードを確認したとき, the 各再生成画面 shall 「起動処理を最後に呼ぶことで phase が戻る（reset の phase 書込より後勝ち）」旨の回避策コメント・前提を残さない。

### Requirement 5: 重複した resetPersonas の整理
**Objective:** 開発者として、`resetPersonas` が2箇所に存在し挙動が矛盾している状態を解消したい。そうすれば「リセットは現在フェーズを書き換えない」原則が全リセットで一貫する。

#### Acceptance Criteria
1. The FE の `personasStore.resetPersonas` shall 現在フェーズを書き換えない挙動（`phase` / `phaseStatus` を書かない）に揃える、または createTopic 版 `resetPersonas` へ一本化して重複を解消する。
2. When ペルソナのリセットが行われたとき, the トピック shall どの経路から呼ばれても `phase` / `phaseStatus` を書き換えられない。

### Requirement 6: 既存の最終状態・破棄範囲の保存（回帰防止）
**Objective:** 開発者として、整理の前後で各フローの最終結果が変わらないことを保証したい。そうすれば退行を防げる。

#### Acceptance Criteria
1. When 編集画面から編集をやり直したとき, the トピック shall 最終的に `phase='editing', phaseStatus='running'` へ到達し、旧編集成果物が破棄された状態になる。
2. When 各再生成カスケード（fact-research / chapters / debate / persona）が完了したとき, the トピック shall それぞれの対象フェーズが `running` の状態へ到達する。
3. The 整理後の再生成 shall 整理前と同じ範囲のデータ（自層＋各フローが破棄すべき下流成果物）を破棄する（破棄の実行場所がサーバへ移っても範囲は不変）。

### Requirement 7: 命名と責任範囲の一致（phase/phaseStatus を書くメソッドの全件処置）
**Objective:** 開発者として、メソッド名が示す責務と実際の責務の乖離（特に phase を書く操作）を残さず処置したい。そうすれば「誰が何を書くか」がコードから読めて、同種の混線が再発しない。

#### Acceptance Criteria
1. The phase/phaseStatus を書き込むメソッドの名前 shall その責務（フェーズ遷移を書くこと）を表す。`reset*`/`discard*`/`clear*` は遷移を書かない。`set*Status` は単一状態名で phase まで書かない。
2. When 監査で列挙した乖離メソッドを確認したとき, the 各メソッド shall 明示的な処置を持つ。是正（改名・分割・副作用除去）または現状維持（＋その根拠を design/research に明記）のいずれかとし、未処置で放置しない。
3. The 対象の乖離メソッド shall 次を含む: `resetEditingRun`（reset が phase を書く）、`personasStore.resetPersonas`（reset が phase を書く・重複）、`setPhaseStatus`（単一状態名で phase を書く）、`updateDebatePhaseStatus`（状態名で phase＋新 runId 発行）、`markInterviewsStarted`/`markInterviewsStopped`（interviews 名で topic phase を書く）。
4. Where 監査で挙がった非 phase 系の名前・副作用の乖離（`fetchSourceContents` の書き込み、`runIntroOutroStep`/`regenerateChapter` のラン全体確定、`discardChaptersFrom` の status 遷移、`clearEditorial` の再初期化、`publishDebate` の personaCount 再計算、`save` の削除・巻き戻し 等）, the 各項目 shall design/research にて「本仕様で是正 / 別仕様へ切り出し / 現状維持＋根拠」の処置区分を明示する。
