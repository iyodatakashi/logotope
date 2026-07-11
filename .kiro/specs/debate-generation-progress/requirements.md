# Requirements Document

## Project Description (Input)
討論の生成処理中の各段階を、各ターン（turn）の `status` として Firestore に明示する。これにより外部（FE 等）が「いまどのターンがどの生成段階か」を参照できるようにする。FE 側の描画（Skeleton 等）は本 spec のスコープ外とし、status を書くところまでを対象とする。

現状、1発言（turn）は Cloud Task 内で完成後に一度だけ Firestore へ追記されるため、生成途中の状態を外部から把握できない。また engagement/awareness は直前の確定ターンID（engagement.ts:116）に紐づく「前ターンへの傾聴反応」であり、後続ターンの処理先頭で生成される。この構造を踏まえ、評価タイミングを再構成した上で（下記「追加スコープ」）、各ターンに生成 status を書き込む。

把握したい情報（各 turn に status として持たせる）:
- 生成ステータス（status）: 本文生成中 (`generating`) / ファクトチェック中 (`fact-checking`) / 反応（engagement/awareness）評価中 (`evaluating`) / 終了
- `evaluating` は評価対象のそのターン自身の status に書く（そのターンの後処理のため）
- 次の発言者は、生成中ターン（プレースホルダ）自身の personaId として自然に表現される（専用フィールド nextSpeakerId は設けない）

データ形状の方針（decision 済み・詳細は design で確定）:
- status は各ターン記録に持たせる（別 `generationProgress` ドキュメントは作らない）
- generating/fact-checking を turn に書くため、完成前の**プレースホルダターンを先行作成**する（「3段階すべて turn に書く」方針で決定）
- プレースホルダターンが停止・失敗・frontier 敗者・最終ターンで残留しない対策が必須

スコープ外:
- FE 側の Skeleton 描画・表示（各ターンに status を書くところまでが本 spec）

設計上の要注意点（design で詰める）:
- 残留防止: 生成中（generating/fact-checking/evaluating）のターン status が、停止・失敗・章末・最終ターンで生成中のまま残らないこと
- プレースホルダ turn の整合: 未確定本文のプレースホルダを、状態再構築・LLM コンテキスト・frontier 計上で確定ターンと区別すること
- リトライ／並走敗者: 同一 frontier の再処理・敗者タスクがプレースホルダを重複作成せず、確定 status を古い値で上書きしないこと
- 再入可能性: 毎ステップ Firestore から状態を再構築する既存パイプライン設計と矛盾しない書き込み

## 追加スコープ: engagement/awareness 評価タイミングの再構成

進捗表示の前提として、engagement/awareness の評価タイミングを見直す。この論点は本 spec に含める（大きくなるようなら design 時に別 spec へ切り出す）。

### 動機（帰属と実行位置のズレ）
- 現状 `evaluateEngagements`（engagement.ts）は各ターンステップの**先頭**（step.ts:212）で走り、**直前の確定ターン**への反応を評価し、その直前ターンID（engagement.ts:116 の `chapterTurns[last].id`）に紐づけて永続する。
- つまり評価データの**帰属先は「前のターン」**なのに、**実行位置は「次のターン」**になっている。このズレが原因で、章の最後のターンに engagement/awareness が付かないことがある。
- あるべき姿: 評価は「そのターンで生まれた発言への反応」＝そのターンに属する。よって**そのターンの末尾で評価し、結果を次ターンへ渡して話者選択に使う**方が自然。通常ターンでは「N の末尾で評価」≒「N+1 の先頭で評価」で意味・キー（turnId=N）・source（直前発言）は不変。差分は「最後のターンもカバーされる」ことだけ。

### 現状の事実整理（コード確認済み）
- 評価をスキップするのは **freeze（章末+1 最終応答）ステップだけ**（step.ts:386 `freeze = !!payload.finalResponse`）。通常ターンは**指名（targetPersona）があっても** step.ts:212 で必ず全ペルソナ評価する。指名は評価スキップ条件ではなく、評価後の話者選択（speaker-selection）で優先されるだけ。
- よって「指名なら評価は無駄→スキップ」はコード全体の原則ではなく、freeze 1経路の例外。
- 最後のターンに awareness が付かない原因は2つ:
  - (A) freeze の**意図的スキップ**（debate-llm-cost-reduction の決定）
  - (B) 通常の章末（decideNextStep が chapter-end を返す経路）で、最後の確定ターンに続く turn ステップが来ず評価機会が構造的に無い**副作用**
- 末尾評価に移せば (A)(B) 両方が解消し、最後のターンも他ターンと同じ扱いになる。

### 既存決定の改訂（明示）
- debate-llm-cost-reduction が「freeze で非指名者の最終ターン awareness 捕捉を諦める（許容済み）」とした決定を、**awareness 完全性のため撤回**する。
- コスト差は**章あたり約 +1 sweep**（≒(P−2) 件/章）。ただしこれは通常ターンが毎回払っているのと同単価で、新種の重い処理ではない。

### 保持すべき不変条件（design で確認）
- belief-awareness-remodel: 気づきは**傾聴段階（engagement 評価）で検出**、話者選択の前に永続、選ばれた話者の生成に反映。
- awareness-last-utterance-only: 反応の**source＝`turns` 末尾（直前発言）**、`triggeredByTurnId`＝「聞いて気づいた元ターン」の意味を保つ。**追加の awareness 専用 LLM 呼び出しは設けない**（1回の engagement 評価に相乗り＝二重評価にしない）。
- 末尾移動なら上記は自然に保たれる想定だが、明示的に検証する。

### design で詰める点
- 先頭境界: 「オープニングへの反応」評価をどこで行うか（open ステップ末尾 or 最初のペルソナターン先頭）。
- 冪等性・再利用キー: readReusableEngagement / `history.<turnId>` の再利用を、末尾評価・リトライ・並走敗者と整合させる。
- freeze パス（executeFinalResponseTurn）の扱い: 末尾評価導入後の位置づけ（特例撤回の具体化）。
- プレースホルダターンの表現: 確定ターンとの区別方法（status による区別・turns 配列内の扱い）。

## Introduction

本機能は、討論生成の途中状態を各ターン（turn）の `status` として Firestore に明示し、外部（FE 等）が生成段階を参照できるようにする。あわせて、その前提として engagement/awareness の評価タイミングを「次ターンの先頭で前ターンを評価する」現状から「発言ターンの末尾で当該ターンへの反応を評価し、結果を次ターンへ渡す」へ再構成する。これにより、章の最後のターンを含む全ての確定ターンに反応が付き、`evaluating` を評価対象のそのターン自身に帰属させられる。

対象システムは討論生成のサーバー処理を担う「討論生成パイプライン」（`functions/src/pipeline/debate/`）。FE 側の描画（Skeleton 等）は本 spec のスコープ外で、各ターンに status を書くところまでを対象とする。

## Boundary Context

- **In scope**:
  - engagement/awareness 評価タイミングの再構成（発言ターン末尾で評価し次ターンへ渡す）
  - 章末最終応答（freeze）ターンでの評価スキップ特例の撤回
  - 各ターンへの生成ステータス（`generating` / `fact-checking` / `evaluating` / 終了）の付与
  - generating/fact-checking を表現するための、完成前のプレースホルダターンの先行作成
  - 生成中ターンの残留防止と状態整合
- **Out of scope**:
  - FE 側の Skeleton 描画・表示（各ターンに status を書くところまでが本 spec）
  - 話者選択規則・発言生成プロンプト・ファクトチェック判定内容など、討論の生成ロジックそのものの変更
  - engagement スコア計算式・awareness の内容/文言モデルの変更（belief-awareness-remodel の範囲）
  - 公開閲覧ページ（`/debate/[id]`）
- **Adjacent expectations**:
  - belief-awareness-remodel: 気づきは傾聴段階（engagement 評価）で検出し、話者選択の前に永続、選ばれた話者の生成に反映する不変条件を保持する
  - awareness-last-utterance-only: 反応の source は `turns` 末尾（直前発言）に限定し、awareness 専用の追加 LLM 呼び出しを設けない不変条件を保持する
  - debate-llm-cost-reduction: 「freeze で最終ターン awareness 捕捉を諦める」決定を、本 spec が所有権を引き取り改訂する（撤回する）

## Requirements

### Requirement 1: engagement/awareness 評価タイミングの再構成

**Objective:** 討論生成パイプラインの保守者として、engagement/awareness の評価を「発言ターンの末尾で当該ターンへの反応として実行し、次ターンへ渡す」構造にしたい。それにより、章の最後のターンを含む全ての確定ターンに反応が付き、評価データの帰属（どのターンへの反応か）と実行位置が一致する。

#### Acceptance Criteria

1. When ペルソナ発言ターンが確定（コミット）したとき, the 討論生成パイプライン shall そのターンに対する評価対象ペルソナ全員の engagement/awareness を評価し、当該ターン（`turns` 末尾）の ID に紐づけて永続する。
2. The 討論生成パイプライン shall awareness の `triggeredByTurnId` を、その反応が対象とした発言ターン（`turns` 末尾）の ID とする。
3. The 討論生成パイプライン shall 気づきの検出を engagement 評価の一部として行い、awareness 専用の追加 LLM 呼び出しを設けない。
4. When 次のペルソナ発言ターンの話者を選択するとき, the 討論生成パイプライン shall 直前ターンの末尾で永続された engagement 評価を話者選択の入力として使用する。
5. Where 章の最初のペルソナ発言（オープニング直後）である場合, the 討論生成パイプライン shall オープニングを対象とした反応評価が話者選択時に利用可能な状態を保証する。
6. The 討論生成パイプライン shall 章末最終応答（freeze）ターンを含む全ての確定ターンに対して engagement/awareness 評価を行う。
7. While 同一ターン ID に対してステップが再実行・リトライされる場合, the 討論生成パイプライン shall 既存の永続評価を再利用し、重複した LLM 評価および重複永続を行わない。
8. The 討論生成パイプライン shall 本再構成の前後で、確定ターンの出力（発言内容・話者選択結果・awareness 内容）を変更しない（生成 status の付与と最終ターンへの awareness 付与を除く）。

### Requirement 2: 各ターンへの生成ステータス付与

**Objective:** 討論生成の途中状態を参照する側（FE 等）として、各ターンが自身の生成段階を `status` として持ってほしい。そうすれば、どのターンがどの生成段階にあるかを、追加の仕組みなしに把握できる。

#### Acceptance Criteria

1. When 次の発言者を確定し発言本文の生成を開始したとき, the 討論生成パイプライン shall その発言のためのターン記録を、話者（personaId）を設定した上で status「本文生成中（`generating`）」で作成する。
2. When ファクトチェックを開始したとき, the 討論生成パイプライン shall 当該ターンの status を「ファクトチェック中（`fact-checking`）」に更新する。
3. When 発言本文が確定（コミット）したとき, the 討論生成パイプライン shall 当該ターンに確定本文を書き込み、status を「反応評価中（`evaluating`）」に更新する。
4. The 討論生成パイプライン shall `evaluating` を、反応（engagement/awareness）評価の対象である当該ターン自身の status に書き、他のターンには書かない。
5. When 当該ターンへの反応評価が完了したとき, the 討論生成パイプライン shall 当該ターンの status を終了状態にし、生成中でないことを示す。
6. The 討論生成パイプライン shall 各ターンの status を、討論生成画面が既に購読しているデータ（章ドキュメントの `turns`）から追加のリスナーなしで観測できる形にする。
7. The 討論生成パイプライン shall 次の発言者を、生成中ターン（プレースホルダ）自身の personaId として表現し、専用フィールド（nextSpeakerId 等）を設けない。
8. The 討論生成パイプライン shall status の書き込み・更新を、既存のターン追記トランザクションおよび frontier・世代（runId）ガードと整合させる。

### Requirement 3: 生成中ターンの残留防止と状態整合

**Objective:** 討論生成パイプラインの保守者として、未完（生成中）のプレースホルダターンが残留せず、状態再構築や討論内容を汚さないようにしたい。そうすれば、生成 status を導入しても討論の正しさと再入可能性が保たれる。

#### Acceptance Criteria

1. The 討論生成パイプライン shall 生成中（`generating` / `fact-checking` / `evaluating`）のターンを、状態再構築・話者コンテキスト・frontier 計上において確定ターンと区別し、確定ターンとして扱わない。
2. The 討論生成パイプライン shall 生成中ターンの未確定本文を、他ペルソナが聞く発言（討論の LLM コンテキスト）として使用しない。
3. When 章が完了（chapter-end）したとき, the 討論生成パイプライン shall 生成中ステータスのターンを残さない。
4. When 討論が停止（`phaseStatus === 'stopped'`）したとき, the 討論生成パイプライン shall 未確定本文のプレースホルダを含む生成中のターンを残さない。
5. If 本文生成・ファクトチェック・反応評価が失敗した、あるいはステップが中断したとき, then the 討論生成パイプライン shall 生成中のターンが恒久的に残留しない状態を保つ（後続ステップまたはクリーンアップで解消される）。
6. If 世代不一致または frontier 敗者のステップである場合, then the 討論生成パイプライン shall プレースホルダターンを重複作成せず、確定済みターンの status を古い値で上書きしない。
7. The 討論生成パイプライン shall 後続ターンが発生しない章の最終ターンにおいても、当該ターンの status を終了状態にし、生成中のまま残さない。
