# Requirements Document

## Project Description (Input)
フェーズ管理、ステータス管理が、topic, session, ローカルで重複している。topicによる管理に一元化し、session, ローカルのステータス管理を廃止する。

## Introduction

管理画面の討論生成ワークフロー（フェーズ1〜5）の進行状態が、現状は3つの場所に分散・重複して保持されている。

- **トピック**: 新2軸モデル `(phase, phaseStatus)` と、互換用の旧 `status`（`DebateStatus` enum）が併存する
- **討論セッション**: フェーズ5専用の `SessionStatus`（`debating` / `completed` / `cancelled` / `error` など）を独立して保持し、フェーズ5の終端状態（完了・停止・エラー）の権威として参照される
- **クライアントローカル**: コンポーネント側の実行中フラグ（`inFlight` → `clientPhaseInFlight`）が、フェーズ1〜4の「実行中」か「中断」かを判別するヒントとして論理状態の導出に使われている

この分散により、状態の真実の源がフェーズや読み込み経路によって異なり、リロード時や非同期完了時に不整合が起きやすい。本仕様は、ワークフロー進行状態の真実の源（single source of truth）をトピックの `(phase, phaseStatus)` に一元化し、セッションおよびクライアントローカルによるステータス管理を廃止することで、状態の一貫性と保守性を高めることを目的とする。

加えて本仕様では、互換性のために残されている旧実装（旧 `status` enum、セッションの `status` フィールド、クライアントローカルの実行中フラグ、およびそれらに依存する導出・移行コード）を**完全に除去**する。互換目的の旧コードパスは一切残さず、トピックの2軸モデルだけで完結するクリーンな実装に統一する。既存データの取り扱いが必要な場合は、ランタイムの互換レイヤーではなく一度きりのデータ移行として扱う。

## Boundary Context

- **In scope**:
  - ワークフロー進行状態の真実の源をトピックの `(phase, phaseStatus)` に一元化する
  - セッションの進行ステータス（`SessionStatus`）をワークフロー状態の権威として用いることを廃止する
  - クライアントローカルの実行中フラグをフェーズ論理状態の導出から廃止する
  - 状態導出ロジック（`phaseLogicalState` 等）をトピック入力のみに依存する純粋関数へ一元化する
  - フェーズ5（討論）の終端状態（完了・停止・エラー）をトピックの状態のみから導出できるようにする
  - 旧 `status` enum・セッション `status` フィールド・クライアント実行中フラグ、およびそれらに依存する導出・移行コードの完全除去
- **Out of scope**:
  - 各フェーズのAI生成ロジック（プロンプト・生成品質）の変更
  - 公開ページ（閲覧側）の表示や討論コンテンツのデータ構造そのものの変更
  - 新しいフェーズの追加や、フェーズ共通操作のUI文言・配置の再設計（[phase-workflow-consistency](../phase-workflow-consistency/requirements.md) が担当）
  - 互換性維持のためのランタイム旧コードパスの保持（本仕様では明示的に除去する）
  - 公開（publish）機能そのもの。当面オミットし、まともなコンテンツ生成（フェーズ1〜5）を固めることに集中する。本仕様では `DebateStatus` を完全削除する過程で publish 状態（`status: 'published'`）も除去対象とする。公開ページ（`/`・`/debate/[id]`）や `publishDebate` フローの存続・撤去範囲は本仕様の対象外とし、ビルドが通る最小処置（例: 公開判定を `publishedAt` ベースに退避、または当該UIの一時停止）のみ設計フェーズで決める。publish の再設計は将来の「debate 完了後の編集工程」の導入時に行う
- **Adjacent expectations**:
  - 本仕様は [phase-workflow-consistency](../phase-workflow-consistency/requirements.md) と同じ2軸フェーズ状態モデルを前提とし、その「統一されたフェーズ状態モデル」を真実の源の一元化という観点から具体化する
  - Firebase Functions の各生成エンドポイント（`generateStakeholders` / `startDebate` / `restartDebate` 等）の入出力契約は変更しない。ただし討論の進行・終端状態の書き込み先をセッションからトピックへ移す
  - 討論セッションは引き続きターン・章立て・コメント等の討論固有データを保持する（廃止対象は進行ステータスの権威性のみ）

## Requirements

### Requirement 1: トピックを唯一の真実の源とする
**Objective:** 開発者として、ワークフローの進行状態がトピックの `(phase, phaseStatus)` ひとつに集約されていてほしい。そうすれば、状態の不整合を防ぎ、フェーズ追加・変更時にも一貫した挙動を保てる。

#### Acceptance Criteria
1. The Phaseワークフロー shall ワークフロー進行状態の唯一の真実の源として、トピックの「現在のフェーズ」と「フェーズ状態」の組のみを使用する。
2. The Phaseワークフロー shall いずれのフェーズの論理状態（`not_started` / `running` / `generated` / `approved` / `stopped`）も、トピックの状態のみから導出する。
3. The Phaseワークフロー shall セッションおよびクライアントローカルのいずれにも、ワークフロー進行状態の権威的な複製を保持しない。
4. When 管理者がいずれかのフェーズで状態を変化させる操作（生成・承認・再生成・停止・再開）を実行した, the Phaseワークフロー shall その結果をトピックの `(phase, phaseStatus)` に反映する。
5. The Phaseワークフロー shall トピックの `(phase, phaseStatus)` を必須の状態フィールドとして扱い、旧 `status`（`DebateStatus`）を状態の書き込み・読み取り・論理状態の導出のいずれにも使用しない。

### Requirement 2: セッションのステータス管理の廃止
**Objective:** 開発者として、討論セッションがワークフロー進行のための独立したステータスを持たず、進行状態がトピックに一元化されていてほしい。そうすれば、フェーズ5の状態が二重管理されない。

#### Acceptance Criteria
1. The 討論セッション shall ワークフロー進行を表すステータスフィールド（`SessionStatus`）を持たず、ターン・章立て・コメント等の討論固有データの保持に責務を限定する。
2. The Phaseワークフロー shall セッションの `status` を参照する読み取り・導出・型定義をコードベースから除去し、`SessionStatus` 型そのものを廃止する。
3. When 討論（フェーズ5）の処理状態が変化した（開始・完了・停止・異常終了）, the Functions shall その状態をトピックの `(phase, phaseStatus)` として書き込む。

### Requirement 3: クライアント（ローカル）ステータス管理の廃止とリアルタイム同期
**Objective:** 開発者として、クライアントが独自の状態を一切持たず、リアルタイム同期されたトピックの状態をそのまま参照してほしい。そうすれば、状態が二重管理されず、リロード・別タブ・非同期完了のいずれでも常に同一の状態が表示される。

#### Acceptance Criteria
1. The 管理画面 shall トピックの `(phase, phaseStatus)` をリアルタイム同期（`onSnapshot`）で購読し、その同期された値を表示・操作可否の唯一の根拠としてそのまま参照する。
2. The 管理画面 shall クライアントローカルの実行中フラグ（`inFlight` / `clientPhaseInFlight` 等）を保持せず、ボタンの無効化・進行表示を含むすべての状態をトピックの `phaseStatus` から導出する。
3. When 管理者が生成・承認・再生成等の操作を実行した, the Phaseワークフロー shall トピックの `phaseStatus` を `running` 等へ更新し、そのリアルタイム同期の反映によってボタン無効化・進行表示を行う（クライアント側に別途の処理中状態を持たない）。
4. When ページが再読み込みされた、または別タブで開かれた, the 管理画面 shall クライアントローカルの状態に依存せず、リアルタイム同期されたトピックの状態のみから表示を復元する。
5. The Phaseワークフロー shall フェーズ1〜4の「実行中（`running`）」か「中断」かの判別を、トピックの状態のみから行う。
6. While あるフェーズが `running` 状態である間, the 管理画面 shall 全フェーズ（1〜4を含む）で当該処理をやり直す操作を提示し、生成途中の離脱等で `running` が固着した場合でも、クライアントローカルの状態に頼らずトピックの状態のみから再実行して回復できるようにする。

### Requirement 4: フェーズ5（討論）のライフサイクルと停止制御
**Objective:** 管理者として、討論がクライアントの在席と無関係に Functions 側で完走し、画面の表示有無にかかわらずいつでも停止でき、その状態がトピックだけから判別されてほしい。そうすれば、別画面に切り替えても討論は止まらず、必要なときには確実に停止できる。

#### Acceptance Criteria
1. The Functions shall 討論をクライアントの在席（画面の表示・接続状態）に依存せずに実行し、討論開始時にトピックを `(phase=5, phaseStatus=running)` に更新する。
2. While 討論が `running` である間, the Functions shall 各ターン／章の生成前に `topic.phaseStatus` を確認し、`running` でなくなっていれば討論を停止して、それ以上の生成および状態の上書きを行わない。
3. The 管理画面 shall 討論画面の表示有無にかかわらずいつでも停止操作を提示し、停止操作時に `topic.phaseStatus` を `stopped` に書き込む。
4. When 討論が最後まで完走した, the Functions shall トピックが `running` のままである場合に限り `topic.phaseStatus` を `generated` に更新する。
5. When 停止された討論が再度開かれた, the Phaseワークフロー shall `currentChapterIndex` から討論を再開できるようにする。
6. The Phaseワークフロー shall フェーズ5の状態（`running` / `generated` / `stopped`）を、セッションを参照せずトピックの状態のみから判別する。
7. If 討論処理が `generated` も `stopped` も書けずに異常終了した, then the 管理画面 shall 停止操作によってトピックを `stopped` に遷移させ、再実行可能な状態に戻せるようにする。

### Requirement 5: 状態の単独保持と画面側でのリアクティブ導出
**Objective:** 開発者として、進行状態はトピックが単独で保持し、各フェーズ画面はそれを購読して自身の表示状態をリアクティブに導出するだけにしてほしい。そうすれば、状態の置き場所がトピックだけに保たれ、フェーズごとに状態を保持・注入する抽象が不要になる。

#### Acceptance Criteria
1. The トピック shall ワークフロー進行状態 `(currentPhase, phaseStatus)` を単独で保持し、これが進行状態の唯一の保持点となる。
2. The 各フェーズ画面 shall 自身が担当するフェーズ番号（その画面固有の定数）と、購読しているトピックの `(currentPhase, phaseStatus)` のみから、自身の論理状態をリアクティブに導出する。
3. The 各フェーズ画面 shall 自身のフェーズ番号と `currentPhase` の大小比較のみで `approved`（過去）／`not_started`（未来）を導出し、一致する場合は `phaseStatus` をそのまま論理状態として用いる。
4. The Phaseワークフロー shall フェーズごとに進行状態を保持・注入する構造（`targetPhase` を引数に取る共有コントローラ等）を設けず、画面ごとのリアクティブ導出のみで状態表示を成立させる。
5. The 状態導出 shall セッションステータスやクライアント実行中フラグなどのヒントを参照せず、トピックの状態のみで完結する純粋な導出とする。
6. While 同一のトピック状態が与えられている間, the Phaseワークフロー shall ダッシュボード一覧と各フェーズ画面で同一の論理状態および表示ラベルを導出する。
7. The Phaseワークフロー shall 過去フェーズの `approved` 等を表す追加の永続フラグをどこにも保存しない。

### Requirement 6: 旧実装の完全除去
**Objective:** 開発者として、互換目的で残された旧ステータス実装が一切残らず、トピックの2軸モデルだけで完結したクリーンなコードベースにしてほしい。そうすれば、二重管理の余地と保守コストを根絶できる。

#### Acceptance Criteria
1. The Phaseワークフロー shall 旧 `status` enum（`DebateStatus`）、セッションの `status`（`SessionStatus`）、およびクライアントローカルの実行中フラグを、型定義・データ書き込み・読み取りのすべてからコードベース上で除去する。
2. The Phaseワークフロー shall 旧 status からの導出・移行ヘルパー（`statusToPhase` / `resolveCurrentPhase` / `deriveLegacyPhaseState` および関連マッピング等）を、互換コードパスとして残さず削除する。
3. The Phaseワークフロー shall 状態導出・表示に関わる関数のシグネチャから、互換用のヒント引数（`sessionStatus` / `clientPhaseInFlight` / `debateComplete` 等）を除去する。
4. The Phaseワークフロー shall 既存データの移行を行わず、デプロイ前に既存 `topics` コレクションを全削除して新規作成から開始する。移行スクリプトも互換ランタイムコードも作らず、トピックの `(phase, phaseStatus)` のみで動作する。
