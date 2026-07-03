# Requirements Document

## Project Description (Input)
テーマ討論生成のフェーズ管理を、数値番号（`Phase = 1..6`）から一意キー（slug）方式へリファクタする。`topic-fact-base` spec の前提となる基盤リファクタ。

## 背景・課題
現在フェーズは数値 `Phase = 1|2|3|4|5|6` で管理され、**番号が「順序」と「同一性」を兼ねている**。このため新フェーズを途中に挿入すると、下流フェーズの番号が全てずれ、FE/BE 横断のハードコード更新と既存トピックの `phase` 値移行が挿入のたびに再発する。具体的な番号依存箇所:
- `phaseLogicalState` は数値比較（`target < current.phase`）で順序を判定（src/lib/models/phase/phase.ts:21-22）
- ラベルは `Record<Phase, string>` で全番号を埋める必要（RUNNING/GENERATED/NOT_STARTED/STOPPED_LABEL、phase.constants.ts:12-46）
- `phaseDisplayLabel` が `phase === 6` を「完了」と直書き（phase.ts:36）
- 承認メソッドが `phase: 2` 等のジャンプ先を直書き（createTopic.svelte.ts の approve*、personas.svelte.ts approvePersonas）
- 各フェーズコンポーネントが `const PHASE = N`（Phase*.svelte）
- BE: `GeneratePhase = 1..4`、`confirmPhaseGenerated(topicId, N)`、`data.phase === 5`（debate-lifecycle.ts）

## 解決策：一意キー方式
- `PhaseKey`（slug の文字列ユニオン。現行: `stakeholders | personas | interviews | chapters | debate | editing`）を導入
- 順序は `PHASE_DEFS` 配列の位置のみを唯一の真実とし、`phaseLogicalState` はインデックス比較に変更
- ラベル（running/generated/notStarted/stopped）を各 `PHASE_DEFS` エントリに内包し、番号キーの並行 Record を廃止
- 承認は `nextPhase(currentKey)`（配列の次要素）へ前進させ、`phase:N` のジャンプ先ハードコードを廃止
- Firestore の `phase` を `PhaseKey`（文字列）で永続化。既存トピックの number→slug を一度きり移行
- BE も slug で扱う（`GeneratePhase` を slug ユニオン化、`confirmPhaseGenerated(topicId, 'stakeholders')`、`data.phase === 'debate'`）
- 各フェーズコンポーネントは `const PHASE = 'interviews'` と自己記述

---

## Introduction

本仕様は、フェーズの識別子を数値番号から一意キー（slug）へ移行する**純粋なリファクタ＋一度きりのデータ移行**である。目的は、番号が「順序」と「同一性」を兼ねている現状を解消し、フェーズ挿入コストを「配列に1行追加」へ縮小して将来のフェーズ追加に耐える構造にすること。`topic-fact-base` spec（事実リサーチフェーズの挿入）の前提となる。機能追加・挙動変更は行わない。

## Boundary Context

- **In scope**:
  - フェーズの同一性を slug キーで表現
  - 順序を単一定義配列（`PHASE_DEFS` 相当）の位置から導出
  - 論理状態判定・ラベル・承認遷移・永続化を slug 方式へ移行
  - 既存トピックの number→slug の一度きりデータ移行
  - FE/BE 横断の番号依存箇所の置換
- **Out of scope**:
  - 新しいフェーズの追加（`topic-fact-base` 側で実施）
  - フェーズの生成ロジック・UI 見た目・ゲート条件・ラベル文言の意味的変更
  - 事実基盤その他の機能追加
- **Adjacent expectations**:
  - `topic-fact-base` は本 spec 完了後、`PHASE_DEFS` に `fact-research` を1エントリ追加するだけでフェーズ挿入を実現できることを期待する。

## Requirements

### Requirement 1: フェーズの一意キー識別
**Objective:** As a 開発者, I want 各フェーズを数値ではなく一意キー（slug）で識別すること, so that フェーズ挿入時に既存フェーズの識別子が変わらない

#### Acceptance Criteria
1. The フェーズ管理モジュール shall 各フェーズを一意のキー（slug 文字列）で識別する
2. The フェーズ管理モジュール shall フェーズの同一性判定に数値番号を用いない
3. Where フェーズがコンポーネント・API・永続データから参照される, the システム shall 同一の slug キーで一貫して参照する

### Requirement 2: 順序の単一情報源化
**Objective:** As a 開発者, I want フェーズの順序を単一の定義配列の位置から導出すること, so that 順序が一箇所で管理され挿入が容易になる

#### Acceptance Criteria
1. The フェーズ管理モジュール shall フェーズの順序を単一の定義配列（`PHASE_DEFS` 相当）の位置から導出する
2. When 新しいフェーズを定義配列に追加する, the フェーズ管理モジュール shall 既存フェーズのキー・定義を変更せずに順序へ反映する
3. The フェーズ管理モジュール shall 順序判定に数値番号のハードコード比較を用いない

### Requirement 3: 論理状態判定のキー方式化
**Objective:** As a 開発者, I want フェーズ論理状態の導出をキーと順序から行うこと, so that 数値比較への依存をなくす

#### Acceptance Criteria
1. While 対象フェーズが現在フェーズより前の順序である, the フェーズ管理モジュール shall 論理状態を approved と判定する
2. While 対象フェーズが現在フェーズより後の順序である, the フェーズ管理モジュール shall 論理状態を not_started と判定する
3. While 対象フェーズが現在フェーズと同一である, the フェーズ管理モジュール shall 現在の phaseStatus を論理状態として返す
4. The フェーズ管理モジュール shall 上記の順序判定を定義配列上のインデックス比較で行う

### Requirement 4: ラベルの定義内包化
**Objective:** As a 開発者, I want 各フェーズの状態別ラベルをフェーズ定義に内包すること, so that 全番号を埋める並行 Record が不要になる

#### Acceptance Criteria
1. The フェーズ管理モジュール shall 各フェーズの状態別ラベル（running/generated/not_started/stopped）をそのフェーズ定義に内包して保持する
2. The フェーズ管理モジュール shall 番号をキーとする並行ラベルテーブルを持たない
3. The フェーズ管理モジュール shall 最終フェーズか否かを順序から導出し、特定番号のハードコード判定を用いない

### Requirement 5: 承認遷移の nextPhase 化
**Objective:** As a 管理者, I want フェーズ承認時に順序定義に基づいて次フェーズへ前進すること, so that ジャンプ先番号の直書きをなくす

#### Acceptance Criteria
1. When 管理者がフェーズを承認する, the システム shall 現在フェーズの次フェーズ（定義配列上の次要素）へ前進させる
2. The システム shall 承認遷移先を数値のハードコードで指定しない
3. If 現在フェーズが最終フェーズである, then the システム shall 次フェーズへの前進を行わない

### Requirement 6: slug 永続化と既存データのリセット
**Objective:** As a システム, I want フェーズを slug 文字列で永続化すること, so that 以降のフェーズ追加で移行が不要になる

（方針: 進行中の実データが存在しないため、既存の数値 phase トピックは移行せずリセット（破棄）する。移行スクリプトは設けない。）

#### Acceptance Criteria
1. The システム shall トピックの現在フェーズを slug 文字列として永続化する
2. When 新規トピックを作成する, the システム shall 先頭フェーズの slug を初期値として書き込む
3. The システム shall 永続データの `phase` を数値ではなく slug 文字列として扱う（数値 phase の後方互換読み取りは設けない）
4. If 数値 phase を持つ旧トピックが残存する, then the システム shall それをリセット対象（破棄）として扱い、移行はしない

### Requirement 7: バックエンドのキー方式化
**Objective:** As a 開発者, I want Functions 側のフェーズ確定・状態遷移・判定を slug で扱うこと, so that FE/BE でフェーズ識別子が一致する

#### Acceptance Criteria
1. The フェーズ確定処理（`confirmPhaseGenerated` 相当） shall 対象フェーズを slug で受け取る
2. The 討論ライフサイクル判定 shall 討論フェーズか否かを slug（`debate`）で判定する
3. The Functions shall フェーズ判定に数値番号のハードコード比較を用いない

### Requirement 8: 挙動の不変性（リグレッションなし）
**Objective:** As a 利用者, I want リファクタ前後でフェーズの進行・ゲート・表示が変わらないこと, so that 機能追加なしの安全な移行になる

#### Acceptance Criteria
1. The システム shall リファクタ前と同一のフェーズ進行順序およびゲート条件を維持する
2. The システム shall 各状態でリファクタ前と同一の表示ラベル文言を提示する
3. While 移行後の状態である, the システム shall 取材・章立て・討論など各フェーズの生成挙動を変更しない
4. The システム shall 既存のフェーズ関連テストを通過する（数値→slug の参照更新を除き、テストの意図を変えない）
