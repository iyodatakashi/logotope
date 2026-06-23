# Implementation Gap Analysis: debate-orchestration-module-restructure

## 1. Current State Investigation

### 対象ファイルと現状の責務（`functions/src/pipeline/debate/`）

| ファイル | 行数 | 現状の責務 | 混在の有無 |
|---|---|---|---|
| `debate-orchestrator.ts` | 288 | チェーン駆動（dispatch・次ステップ決定・enqueue・状態再構築） | 概ね単一責務（step-split で整理済み） |
| `step.ts` | 434 | ステップ実行（`perform*Step`・`executeTurn`） | `performTurnStep`/`executeTurn` に複数責務 |
| `turn.ts` | 451 | ターン生成・追記 + α | **複数の異質な責務が同居** |
| `debate-lifecycle.ts` | 109 | 章/討論ライフサイクル変更 + 章読み取り | 読み取りと変更が混在・`restartChapter` が多段 |
| `debate-state.ts` | 98 | in-memory 状態導出・章進捗読み取り | 概ね単一責務 |

### 既存パターン（踏襲対象）
- **層構成**: orchestrator → step → turn/state/lifecycle の一方向依存（`debate-orchestrator-step-split` で確立）。
- **集約モジュール**: `queued-intents.ts`・`discussion-points.ts` が「状態遷移＋永続化」を 1 モジュールに集約する確立パターン。
- **命名**: kebab-case ファイル、省略しない関数名、アロー関数標準。
- **テスト配置**: `src/tests/pipeline/debate/*.test.ts`（ファイル単位）。

### 統合面（import 依存の実測）
- `isDebateActive`: 利用元は `debate-orchestrator.ts`（行253）と `turn.ts` 内部（`generatePersonaTurn` 行271）。
- `getDebateTurnsByTopicId`: 利用元は `debate-orchestrator.ts`（行140）のみ。
- `applyBeliefChange` / `updateSpeakerStats` / `persistPostDebateComments`: 利用元は `step.ts` のみ。
- **テストの結合**: `turn.test.ts` は `generatePersonaTurn`・`addTurn`（turn.ts に残す関数）のみ import。再配置候補 5 関数を直接 import するテストは無し → import パス更新の影響は最小。
- `debate-lifecycle.test.ts` は `restartChapter`（公開のまま維持）を import → 分割しても import 不変。
- `decide-next-step` / `debate-parity` / `debate-step-idempotency` テストは `debate-orchestrator.js` から import → 不変。

## 2. Requirements Feasibility（要件→資産マップ）

| 要件 | 対象資産 | ギャップ種別 | メモ |
|---|---|---|---|
| R1: turn.ts を生成・追記に限定 | `isDebateActive`・`getDebateTurnsByTopicId`・`applyBeliefChange`・`persistPostDebateComments`・`updateSpeakerStats` | Constraint（循環 import 回避） | 移動先の選定が設計の核 |
| R2: 読み取り/変更の境界整理 | `debate-state.ts`（読み取り）・`debate-lifecycle.ts`（変更） | 既存パターンあり | `getChaptersByTopicId` の所属見直し含む |
| R3: 複数責務メソッド分離 | `performTurnStep`・`executeTurn`・`restartChapter`・(任意)`generatePersonaTurn` | Missing（分離関数は新規） | 純関数抽出で対応可 |
| R4: 挙動・契約保存 | 公開 API・enqueue・Firestore 書き込み | 既存テストで担保 | parity/idempotency テストが回帰検知 |
| R5: 依存方向維持 | 層間 import | Constraint | 移動で循環が生じないこと |

### 複雑性シグナル
- アルゴリズム変更なし（純粋な構造移動・関数抽出）。
- 唯一の技術的論点は **循環 import の回避**（後述）。

## 3. 主要な技術的論点：循環 import リスク

`turn.ts` から関数を退避する際、移動先が `turn.ts` を逆参照すると循環が生じる。各候補の評価：

- **`isDebateActive`**: phase/phaseStatus を読む discussion 稼働判定。`turn.ts` 内部（`generatePersonaTurn`）からも使うため、移動先を `turn.ts` が import する必要あり。移動先候補（`debate-state.ts` または新規ライフサイクル読み取り）は `turn.ts` を import しない → **循環なし**。
- **`getDebateTurnsByTopicId`**: 章からターンを読む純粋な読み取り。`getChaptersByTopicId`（lifecycle）・`getDebateState`（state）と同質 → 読み取り層へ集約可能。利用元は orchestrator のみ → 安全。
- **`updateSpeakerStats`**: `DebateState` の in-memory 変更のみ（I/O なし）。`debate-state.ts` へ自然に移動可。利用元 step.ts のみ。
- **`applyBeliefChange`**: ペルソナ信念を Firestore に永続化。`pipeline/personas/personas.ts` には現状 belief ロジックなし → クロスディレクトリ移動は新たな結合を生む。**移動先は要設計判断**。
- **`persistPostDebateComments`**: 討論終端処理（コメント生成＋phaseStatus 遷移）。turn 生成とは別責務。

## 4. Implementation Approach Options

### Option A: 最小移動（state/lifecycle への寄せのみ）
読み取り系（`isDebateActive`・`getDebateTurnsByTopicId`）と in-memory 系（`updateSpeakerStats`）を `debate-state.ts` / `debate-lifecycle.ts` へ移し、`applyBeliefChange`・`persistPostDebateComments` は turn.ts 近傍に残す。
- ✅ 新規ファイル無し・循環リスク最小・差分小
- ❌ turn.ts に信念・コメントの異質責務が残り R1 を完全には満たさない

### Option B: 責務別に新規モジュール分離（フル）
`belief.ts`（信念永続化）・`post-debate-comments.ts`（終端処理）・読み取り集約（state へ）を新設し、turn.ts を生成・追記に純化。`restartChapter` の各段も独立ヘルパー化。
- ✅ R1 を完全充足・各責務が独立しテスト容易・`queued-intents.ts` パターンと一貫
- ❌ 新規ファイル増・import 更新箇所が増える・命名/境界の設計コスト

### Option C: ハイブリッド（推奨）
- 読み取り（`isDebateActive`・`getDebateTurnsByTopicId`）→ `debate-state.ts` に集約（R2）。
- `updateSpeakerStats` → `debate-state.ts`（in-memory 状態の責務）。
- `applyBeliefChange` → 新規 `belief.ts`（または persona 寄りモジュール）に分離。
- `persistPostDebateComments` → 新規終端処理モジュール、もしくは turn.ts から薄く分離。
- `performTurnStep`/`executeTurn`/`restartChapter` → 同一ファイル内で純関数/ヘルパーに抽出（R3）。
- ✅ R1〜R5 を充足しつつ新規ファイルを必要箇所に限定・循環なし
- ❌ 移動先の最終決定（belief/comments の置き場）に設計判断が必要

## 5. Effort & Risk

- **Effort**: **M（3〜7日）** — 純粋な構造移動だが対象 5 ファイル＋テスト import 更新＋関数抽出が複数。既存 parity/idempotency テストで安全に進められる。
- **Risk**: **Low〜Medium** — アルゴリズム不変でテスト網あり（Low 寄り）。唯一の注意点は移動による循環 import と belief/comments の移動先妥当性（Medium 要因）。

## 6. Recommendations for Design Phase

- **推奨アプローチ**: Option C（ハイブリッド）。読み取り/in-memory は `debate-state.ts` へ寄せ、信念・終端処理は責務別に薄く分離。
- **設計で決める要点**:
  1. `applyBeliefChange` の移動先（新規 `belief.ts` か `pipeline/personas/` か turn 近傍維持か）。
  2. `persistPostDebateComments` を独立モジュール化するか turn.ts に残すか。
  3. `getChaptersByTopicId`（現 lifecycle）を読み取り層へ寄せるか、lifecycle に残すか（読み取り/変更分離の徹底度）。
  4. `restartChapter` の分割粒度（4 操作を 4 ヘルパーにするか、意味単位でまとめるか）。
  5. R3 任意項目 `generatePersonaTurn` 前処理分離を本 spec に含めるか。
- **Research Needed**: なし（外部依存・新技術なし）。回帰は既存テストスイートで担保。

---

## 7. Design Phase Decisions（設計フェーズ確定事項）

Gap 分析で残した 5 論点を、steering（`structure.md`「置き場所と役割を一致させる」「過度な共通化をしない」）に沿って確定した。

| 論点 | 決定 | 根拠 |
|---|---|---|
| 1. `applyBeliefChange` の移動先 | 新規 `belief.ts`（`getLatestBelief` も同居） | `getLatestBelief` が信念ドメインの共通ヘルパーで turn.ts の 3 箇所＋applyBeliefChange から使われる。信念の参照・永続化を 1 モジュールに集約 |
| 2. `persistPostDebateComments` | 新規 `post-debate-comments.ts` | 討論終端処理（コメント生成＋phaseStatus 遷移）は turn 生成と別責務。終端ステップ専用モジュールに分離 |
| 3. `getChaptersByTopicId` の所属 | `debate-state.ts`（読み取り層）へ移動 | R2.3 が `getDebateTurnsByTopicId` との同居を要求。読み取りを 1 ファイルに集約 |
| 4. `restartChapter` の分割 | `debate-lifecycle.ts` 内の private ヘルパーへ分割（新規ファイルは作らない） | 章リセット・コメント初期化・信念巻き戻し・engagement 削除を意味単位のヘルパーに。過度なファイル分割を避ける |
| 5. `generatePersonaTurn` 前処理 | 軽微な内部ヘルパー抽出のみ（`buildQueuedTrigger`）、本 spec に含める | キュー由来トリガ整形は自己完結ブロック。契約不変のまま可読性向上 |

### 循環 import の最終確認
- `turn.ts → debate-state.ts`（`isDebateActive`）/ `turn.ts → belief.ts`（`getLatestBelief`）: 逆方向参照なし。循環なし。
- `debate-lifecycle.ts → debate-state.ts`（`getChaptersByTopicId`）: 逆方向なし。循環なし。
- `post-debate-comments.ts → belief.ts`: 逆方向なし。循環なし。
- 読み取り層（`debate-state.ts`）と `belief.ts` は最下層（types/constants/firebase のみ依存）に保つ。

### `debate-state.ts` の役割再定義
本 spec 後の `debate-state.ts` は「永続データの読み取り＋ in-memory 状態導出層」とする（Firestore 書き込みは持たない）。`updateSpeakerStats` は in-memory 変更のみ（I/O なし）のため同居して問題ない。
