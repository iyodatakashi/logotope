# Gap Analysis: phase-key-migration

要件（requirements.md）と既存コードベースの差分分析。純粋リファクタ＋一度きり移行のため、**番号依存箇所の網羅**が主眼。設計判断の材料であり最終決定はしない。

## Analysis Summary

- **ルーティングは既に slug 化済み**。`phasePath` は `/admin/topics/{id}/{slug}` を返し、feature ディレクトリも slug 名。番号依存は「順序・ゲート・ラベル・永続化」に限定される。
- **FE のフェーズ中核は3ファイル**（`phase.types.ts` / `phase.constants.ts` / `phase.ts`）。番号→slug 化はここが震源で、`phaseLogicalState` の数値比較、`Record<Phase,string>` ×4、`phase === 6` 直書きを置換する。
- **承認遷移のジャンプ先が5箇所**（`createTopic.svelte.ts` の approve* ×4、`personas.svelte.ts` の approvePersonas）。`nextPhase(currentKey)` へ置換。
- **BE は `Phase` 型を持たず** raw `data.phase` と `GeneratePhase = 1|2|3|4` で扱う。`confirmPhaseGenerated` 呼び出し（stakeholders/personas/chapters/interviews）と **`debate-lifecycle.ts`・`editing-lifecycle.ts` の `phase === 5/6`** を slug 化。FE/BE で slug 値を一致させる契約が必要。
- **最大の物量はテスト**。FE/BE 合わせて多数のテストが `phase: N` を直書き（下記一覧）。挙動不変（R8）を担保しつつ参照を slug へ機械置換する。

## 番号依存インベントリ（網羅）

### FE 中核（震源）
| 箇所 | 内容 | 変更 |
|---|---|---|
| `src/lib/models/phase/phase.types.ts:1` | `Phase = 1..6` | `PhaseKey` slug ユニオンへ |
| `phase.types.ts:20` | `PhaseDef.phase: Phase` | `key: PhaseKey`＋状態別ラベルを内包 |
| `phase.constants.ts:3-10` | `PHASE_DEFS`（phase番号＋slug＋label） | 番号を廃し、順序＝配列位置。ラベル内包 |
| `phase.constants.ts:12-46` | `RUNNING/GENERATED/NOT_STARTED/STOPPED_LABEL: Record<Phase,string>` ×4 | 廃止（`PHASE_DEFS` に内包） |
| `phase.ts:10-13` | `phasePath(topicId, phase: Phase)` | 引数を `PhaseKey` に（内部は既に slug 解決） |
| `phase.ts:17-25` | `phaseLogicalState` 数値比較 | 配列インデックス比較へ |
| `phase.ts:36` | `phase === 6 ? 'completed'` 直書き | `isLastPhase(key)` を順序から導出 |

### FE 承認遷移・状態書き込み
| 箇所 | 内容 | 変更 |
|---|---|---|
| `createTopic.svelte.ts:30,38,46,55` | approve* が `phase: 2/4/5/6` ジャンプ | `nextPhase(currentKey)` へ |
| `createTopic.svelte.ts:92` | `setPhaseStatus(phase: 1\|2\|3\|4\|5, ...)` インライン数値型 | `PhaseKey` へ |
| `stores/personas.svelte.ts:57,70,79,88` | approvePersonas/リセットで `phase: 2/3` | slug へ |
| `stores/topics.svelte.ts:50` | addTopic 初期 `phase: 1` | 先頭 slug（`stakeholders`）へ |

### FE 参照（コンポーネント/ルート）
| 箇所 | 内容 | 変更 |
|---|---|---|
| `Phase{1..6}*.svelte` の `const PHASE = N` ×6 | 自己識別番号 | `const PHASE = '<slug>'` |
| approve ハンドラの `goto(phasePath(id, N))` | 遷移 | slug 経由（`nextPhase`）|
| `+layout.svelte` / `+page.svelte` / `StepNav.svelte` / `TopicListPage.svelte` | `phaseLogicalState`/`phaseDisplayLabel`/`PHASE_DEFS` 利用 | 型変更に追随（多くは透過）|
| `topic.types.ts`（models）`TopicForFirestore.phase: Phase` と `topicFromFirestore` | 永続型 | `PhaseKey`＋読み取り時の number→slug 吸収（移行方針次第）|

### BE
| 箇所 | 内容 | 変更 |
|---|---|---|
| `utils/topic-phase.ts:9` | `GeneratePhase = 1..4` | slug ユニオン（生成フェーズの部分集合）へ |
| `topic-phase.ts:22,30,43` | `confirmPhaseGenerated`/`setTopicPhaseStatus` の引数・`data.phase !== phase` | slug 一致比較（等価判定なので透過的に動く）|
| `api/stakeholders.ts:24` `api/personas.ts:42` `api/chapters.ts:19` | `confirmPhaseGenerated(topicId, 1/2/4)` | slug へ |
| `pipeline/interviews/interview-completion.ts:21` | `confirmPhaseGenerated(topicId, 3)` | `'interviews'` へ |
| `pipeline/debate/debate-lifecycle.ts:23,32` | `phase: 5` / `data.phase === 5` | `'debate'` へ |
| `pipeline/editing/editing-lifecycle.ts:19,31,54` | `phase: 6` / `data.phase === 6` | `'editing'` へ（**前回調査で漏れていた箇所**）|

### テスト（物量大・機械置換）
`phase: N` を直書きする既存テスト（要 slug 化、意図は不変）:
- FE: `tests/models/phase/phase.test.ts`（順序判定の網羅）、`tests/models/topic/topic.test.ts`、`tests/stores/{topics,personas}.test.ts`、`tests/features/admin/**/Phase*.svelte.spec.ts` 各種、`tests/features/admin/topic-list/TopicListPage.svelte.spec.ts` 等
- BE: `tests/utils/topic-phase.test.ts`、`tests/api/{stakeholders,personas,chapters}.test.ts`、`tests/pipeline/interviews/interview-completion.test.ts`、`tests/pipeline/debate/*`（`phase:5` 多数）、`tests/pipeline/editing/*`（`phase:6` 多数）

## 主要な設計判断（Options）

### 判断1: PhaseKey 型の共有（FE/BE の値一致）
slug 値は Firestore を介した FE/BE の契約。ステアリングは「型は FE=models / BE=types で分離」。
- **推奨**: 両側にそれぞれ `PhaseKey`（同一の slug リテラルユニオン）を定義し、値の一致を規約で担保（既存の `PhaseStatus` 等と同じ扱い）。slug 定数を1箇所にまとめ、テストで両者の集合一致を検証する案も可。
- 代替: 共通パッケージ化（過剰。既存分離方針に反する）。

### 判断2: 既存データの移行（R6）→ **Option C（リセット）に決定**
本番直結・エミュレータ無し。進行中の実データが存在しないため、**既存の数値 phase トピックは移行せず破棄（リセット）**する。
- 移行スクリプトは作らない。`topicFromFirestore` に number/slug 両対応の後方互換読み取りも入れない（`Phase` 数値型は完全撤廃）。
- 新規トピックは先頭 slug（`stakeholders`）で開始。
- （参考・不採用）Option A: 移行スクリプト backfill / Option B: 読み取り時吸収。いずれも実データ無しでは過剰。

### 判断3: ラベルの内包形と `phaseDisplayLabel`
- **推奨**: `PHASE_DEFS` 各エントリに `labels: { running, generated, notStarted, stopped }` を持たせ、`phaseDisplayLabel` はキーから該当エントリを引く。`completed` 特例は `isLastPhase(key)` で導出。ラベル文言は現行と一字一句同一に保つ（R8.2）。

## Effort / Risk

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| FE 中核3ファイルの slug 化 | S–M | Medium | 型変更が広く波及。ただし範囲は明確 |
| 承認遷移 `nextPhase` 化 | S | Low | 5箇所の置換 |
| BE slug 化（confirm/lifecycle） | S | Low | 等価比較なので透過的 |
| データ移行 | S | Medium | 方針次第。本番直結の実行注意 |
| テスト slug 置換 | M | Low | 物量大だが機械的。回帰の網 |
| **合計** | **M（3–7日）** | **Medium** | 型波及と本番移行が主リスク |

## Research Needed（設計へ持ち越し）

1. ~~既存トピックの実データ量~~ → 解決（実データ無し。Option C リセット、`Phase` 数値型は完全撤廃）。
2. **PhaseKey の正準ソース**: FE/BE それぞれ定義＋一致検証テストにするか、slug 定数の置き場所。
3. **`GeneratePhase`（生成フェーズ部分集合）の slug 表現**: 承認確定を持つフェーズ（stakeholders/personas/interviews/chapters）の型的表現。

## Recommendation

- **判断1: FE/BE 両側に PhaseKey を定義**（既存の型分離方針に沿う）＋集合一致テスト。
- **判断2: Option C（リセット）に決定**。移行スクリプト・後方互換読み取りは作らず、`Phase` 数値型を完全撤廃。既存トピックは破棄。
- **判断3: ラベルを `PHASE_DEFS` に内包**、文言は現行維持。
- 全体は挙動不変が絶対条件（R8）。**既存テストを slug 化しつつ通過させることを完了の判定基準**とし、`phase.test.ts`（順序判定網羅）を移行の安全網に使う。
