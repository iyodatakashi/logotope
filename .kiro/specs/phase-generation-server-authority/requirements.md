# Requirements Document

## Project Description (Input)
フェーズ1~4の各生成物について、サーバーサイドが保存/ステータスを更新の責任を負う形で一貫性を持たせる

## Introduction

logotope の管理画面では、フェーズ1（ステークホルダー調査）・2（ペルソナ生成）・3（ペルソナ取材）・4（章立て）の各 AI 生成処理を Cloud Functions に委譲して実行する。しかし現状、生成物の永続化と「生成完了」を示す `phaseStatus = 'generated'` の書き込みがフェーズごとに不揃いで、その多くをクライアント（管理画面 SPA）が担っている。

このため、生成中にブラウザをリロード・離脱したり、`httpsCallable` がタイムアウト・エラーになったりすると、サーバ側で生成が成功していても完了状態が記録されず、「承認して次へ進む」ボタンが表示されない、あるいは成果物自体が保存されない不具合が発生する。フェーズ5（討論）はすでにサーバ側で `phaseStatus` を権威的に確定しており、この問題は起きていない。

本仕様は、フェーズ1〜4の AI 生成について「成果物の永続化」と「生成完了ステータスの確定」をサーバ側（Cloud Functions）の責務に統一し、フェーズ5と同じサーバ権威モデルへ揃えることで、クライアントの生存やネットワーク状態に依存しない一貫した完了処理を実現する。

> 補足: ステアリング `firebase.md` は「Firestore への CRUD 書き込みはフロントエンドで直接行う」を原則とするが、本仕様は長時間 AI 生成の成果物と完了ステータスに限ってサーバ権威へ寄せる意図的な例外であり、承認・公開・リセット等の管理操作の書き込みは従来どおりクライアントに残す。

## Boundary Context

- **In scope**: フェーズ1〜4の AI 生成（ステークホルダー・ペルソナ・取材記録・章立て）について、生成物の Firestore 永続化と生成完了（`phaseStatus = 'generated'`）の確定をサーバ権威に統一する。
- **Out of scope**: フェーズ5（討論）の再設計（すでにサーバ権威であり基準モデルとして参照するのみ）。承認・公開・リセットなどの管理操作のステータス遷移。ファクトチェック機能。生成アルゴリズム・プロンプトの内容変更。フェーズ3（取材）のペルソナ単位呼び出しを単一オーケストレーション関数へ集約すること（並列呼び出しの構造はクライアント側に維持する）。
- **Adjacent expectations**: `persona-interview-grounding-pipeline`（取材パイプライン）、章立て生成系スペック、`functions-consistency-audit` と整合させる。`phaseStatus` の論理状態モデル（`not_started`/`running`/`generated`/`stopped` ＋ 派生 `approved`）は既存定義を維持する。

## Requirements

### Requirement 1: サーバ権威による生成物の永続化
**Objective:** As a 管理者, I want フェーズ1〜4の生成物がサーバ側で確実に保存されること, so that クライアントの中断やネットワーク失敗があっても成果物が失われない

#### Acceptance Criteria
1. When 生成サービスがフェーズ1〜4のいずれかの生成を正常に完了したとき, the 生成サービス shall 当該フェーズの生成物（ステークホルダー／ペルソナ／取材記録／章立て）を Firestore に永続化する。
2. The 生成サービス shall フェーズ1〜4の生成物の Firestore への書き込みをサーバ側（Cloud Functions）で実行し、書き込みをクライアントに委ねない。
3. If 生成処理が成果物の永続化前に失敗したとき, then the 生成サービス shall 不完全な成果物を完了として残さない。
4. Where あるフェーズの生成物が複数アイテム（例: ペルソナ単位の取材）から成る場合, the 生成サービス shall 各アイテムの成果物をサーバ側で永続化する。
5. Where フェーズ3（取材）のように複数アイテムをクライアントから並列に呼び出す場合, the システム shall 各アイテムの呼び出し（ファンアウト）をクライアントで起動しつつ、各呼び出しの成果物の永続化はサーバ側で行う。

### Requirement 2: サーバ権威による生成完了ステータスの確定
**Objective:** As a 管理者, I want 生成完了が `phaseStatus` にサーバ側で確定されること, so that リロードやタイムアウト後も「承認して次へ進む」が表示される

#### Acceptance Criteria
1. When 生成サービスがフェーズの生成物の永続化に成功したとき, the 生成サービス shall 当該トピックの `phaseStatus` を `'generated'` に更新する。
2. The 生成サービス shall 生成物の永続化と `phaseStatus = 'generated'` の確定を、同一のサーバ処理として実行する。
3. While 当該フェーズの成果物が永続化済みかつ `phaseStatus` が `'generated'` であるとき, the 管理画面 shall 当該フェーズに「承認して次へ進む」操作を表示する。
4. The `phaseStatus = 'generated'` の確定 shall 冪等であり、複数回適用しても結果を変えない。

### Requirement 3: クライアントによるサーバ確定状態の上書き防止
**Objective:** As a 管理者, I want クライアントの一時的な失敗がサーバ確定済みの完了を壊さないこと, so that 完了済みなのにボタンが消える不具合が再発しない

#### Acceptance Criteria
1. The 管理画面 shall 生成完了（`phaseStatus = 'generated'`）を自ら書き込まない。
2. If 生成呼び出しがクライアント側でタイムアウトまたはエラーになったとき, then the 管理画面 shall サーバが既に `phaseStatus` を `'generated'` に確定している場合は `'stopped'` で上書きしない。
3. While サーバが成果物を永続化し `'generated'` を確定済みであるとき, the 管理画面 shall リロード後に Firestore の購読状態のみから当該フェーズを完了として表示する。

### Requirement 4: 開始・失敗ステータスの一貫した取り扱い
**Objective:** As a 管理者, I want 全フェーズで実行中・停止状態が一貫した方法で記録されること, so that 進捗表示と再生成導線が全フェーズで同じ挙動になる

#### Acceptance Criteria
1. When フェーズ1〜4の生成が開始されたとき, the システム shall 当該トピックの `phaseStatus` を `'running'` に設定する。
2. If 生成が成果物の永続化前に失敗したとき, then the システム shall 当該トピックの `phaseStatus` を `'stopped'` に設定する。
3. The フェーズ1〜4 shall 共通の状態遷移モデル（`not_started` → `running` → `generated` または `stopped`）に従う。
4. While `phaseStatus` が `'running'` または `'stopped'` であるとき, the 管理画面 shall それぞれ実行中表示または再生成導線を表示する。

### Requirement 5: フェーズ間の一貫性（討論フェーズを基準とする）
**Objective:** As a 開発者, I want フェーズ1〜4の永続化・状態確定がフェーズ5（討論）と同じサーバ権威モデルに揃うこと, so that 保守時にフェーズごとの例外を覚えなくてよい

#### Acceptance Criteria
1. The フェーズ1〜4の生成 shall フェーズ5（討論）と同様に、サーバ側で成果物の永続化と `phaseStatus` の確定を行うモデルに従う。
2. When 複数アイテムから成るフェーズ（取材など）の全アイテムの永続化が完了したとき, the 生成サービス shall フェーズ完了（`'generated'`）をサーバ側で確定する。
3. The 各フェーズの完了判定 shall クライアントの逐次検知ではなく、サーバ側で永続化された成果物の状態から導出する。
4. While フェーズ3（取材）でクライアントがペルソナ単位の呼び出しを並列に起動しているとき, the 生成サービス shall 各呼び出し内で全ペルソナの取材完了をサーバ側で判定し、全件完了時に `'generated'` を冪等に確定する。

### Requirement 6: 再生成・中断・リロードへの耐性
**Objective:** As a 管理者, I want 生成中にリロード・離脱・再生成しても状態が正しく収束すること, so that 成果物の欠落や状態固着が起きない

#### Acceptance Criteria
1. While フェーズの生成がサーバ側で進行中に管理画面がリロードまたは離脱したとき, the システム shall 生成完了時にクライアントの生存に依存せず `phaseStatus` を `'generated'` に確定する。
2. When 管理者が再生成を実行したとき, the システム shall 当該フェーズと下流フェーズの旧成果物を破棄したうえでサーバ権威モデルで再生成し、既存の再生成セマンティクスを維持する。
3. If 部分的に成果物が永続化された状態で生成が再実行されたとき, then the 生成サービス shall 重複・不整合を生じさせずに完了状態へ収束させる。

### Requirement 7: 既存の管理操作の維持（境界）
**Objective:** As a 管理者, I want 承認・公開・リセットなどの管理操作が従来どおりクライアントから行えること, so that 本変更が AI 生成以外のフローに影響しない

#### Acceptance Criteria
1. The 管理画面 shall 承認（approve）・公開（publish）・リセット（reset）操作を従来どおりクライアント側の Firestore 書き込みで実行する。
2. The 本仕様の変更 shall AI 生成物の永続化と生成完了ステータスの確定に限定し、承認時のフェーズ前進（次フェーズ／`not_started` への遷移）など管理操作のステータス遷移には及ばない。
