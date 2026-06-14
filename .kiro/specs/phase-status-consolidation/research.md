# 実装ギャップ分析: phase-status-consolidation

## 1. 概要

- **スコープ**: 進行状態の真実の源を topic の `(phase, phaseStatus)` に一元化し、session の `SessionStatus` とクライアントローカルの実行中フラグ（`clientPhaseInFlight`）、および旧 `DebateStatus` enum を完全除去する。
- **好材料**: 2軸モデルは既に導入済みで、フェーズ1〜4の生成・取材・章立ては既にクライアントが topic に `(phase, phaseStatus)` を書いている。討論オーケストレータも**ターン境界でセッション status をポーリングして停止する仕組みを既に持つ**（参照先を topic に替えるだけ）。
- **主な作業**: ①`PhaseStatus` への `stopped` 追加、②停止フラグ・終端書き込みを session → topic へ付け替え、③`SessionStatus`/`DebateStatus`/`clientPhaseInFlight` と派生・移行ヘルパーの削除、④`published` 状態の新しい置き場所、⑤`phaseController(targetPhase)` の解体と各画面の `$derived` 化、⑥既存データの一度きり移行。
- **主要リスク**: フェーズ1〜4でクライアントが生成途中に離脱した場合の「running 固着」の扱い（topic だけで中断を判別する方式の決定）と、`published` の表現変更が公開ページのフィルタに波及する点。

## 2. 現状調査: 状態が分散している3つの場所

### (1) topic（`topics/{topicId}`）
- 旧 `status: DebateStatus`（必須・互換読み取り専用）+ 新 `phase?`, `phaseStatus?`（任意）が併存。
- `status: 'published'` は**公開状態**を表し、ワークフロー進行とは別概念（[+page.svelte:9](../../../src/routes/+page.svelte#L9) が `status === 'published'` でフィルタ）。
- 書き込み元:
  - クライアント: [topic.svelte.ts](../../../src/lib/models/topic/topic.svelte.ts)（generate/approve各種で `phase`,`phaseStatus` を直接 update）、[personas.svelte.ts:53-66](../../../src/lib/stores/personas.svelte.ts#L53)（フェーズ3 取材の running/generated）
  - Functions: [repository.updateTopicPhase](../../../functions/src/db/repository.ts#L172)（`startDebate`/`restartDebate`/`finalizeDebate` から）

### (2) session（`topics/{topicId}/sessions/0`）
- `SessionStatus = 'chapters_ready' | 'debating' | 'completed' | 'cancelled' | 'error'`。
- **二役を担っている**:
  - **終端の権威**: フェーズ5の completed/cancelled/error を保持し、クライアントの状態導出（`phaseLogicalState` の `sessionStatus` ヒント）に使われる。
  - **停止フラグ（ループゲート）**: オーケストレータが各章・各ターンの冒頭で `session.status === 'cancelled'` を読んで停止する（[debate-orchestrator.ts:86,192-193](../../../functions/src/pipeline/debate-orchestrator.ts#L191)）。
- 書き込み: [updateDebateSessionStatus](../../../functions/src/db/repository.ts#L276) / [completeDebateSession](../../../functions/src/db/repository.ts#L345) / [markSessionError](../../../functions/src/db/repository.ts#L443) / クライアント [cancelRunningDebate](../../../src/lib/models/topic/topic.svelte.ts#L134)。

### (3) ローカル（クライアント）
- [phaseController.svelte.ts](../../../src/lib/models/topic/phaseController.svelte.ts) の `inFlight = $state(false)` → `clientPhaseInFlight` ヒント。
- 用途は**フェーズ1〜4で topic.phaseStatus が `running` のとき「自分の処理が実行中」か「離脱で固着した running」かを見分ける**こと（[phase.ts:148-149](../../../src/lib/utils/phase.ts#L148)）だけ。

### 状態導出と画面構造
- [phaseLogicalState](../../../src/lib/utils/phase.ts#L132): `(current, target, hints)` の3入力で5値（not_started/running/stopped/generated/approved）を返す。`hints` が session/ローカルの合流点。
- [createPhaseController(targetPhase)](../../../src/lib/models/topic/phaseController.svelte.ts#L21): 各フェーズ画面（[Phase1〜5*.svelte](../../../src/lib/features/admin/)）が `createPhaseController(n)` を生成し、[PhasePanel.svelte](../../../src/lib/sharedComponents/PhasePanel.svelte) が `controller.logicalState` で表示分岐。
- ルーティング [+layout.svelte](../../../src/routes/admin/topics/[topicId]/+layout.svelte): `resolveCurrentPhase`（旧status互換）で currentPhase を出し、未到達フェーズのみリダイレクト。到達済みフェーズは閲覧可（過去フェーズ approved 表示の前提）。

## 3. 要件→資産マップ（ギャップ種別: Missing / Unknown / Constraint）

| 要件 | 関係する既存資産 | ギャップ | 種別 |
|---|---|---|---|
| R1 topic を唯一の源 / phase・phaseStatus を必須化 | `TopicDoc`（phase,phaseStatus が optional）、`resolveCurrentPhase` | 必須化＋optional/互換分岐の除去。既存ドキュメントの移行が前提 | Constraint |
| R2 SessionStatus 廃止 | `SessionStatus`型（src/functions 両方）、`updateDebateSessionStatus`/`markSessionError`/`completeDebateSession`、orchestrator のポーリング、`session.status` 読み取り | 型ごと削除。ループゲートと終端書き込みを topic へ付け替え | Constraint |
| R3 ローカル状態廃止 / リアルタイム同期 | `phaseController.inFlight`、`clientPhaseInFlight` ヒント。topic は既に `topicsStore`/`currentTopicStore` で onSnapshot 同期済み | inFlight 撤廃。**フェーズ1〜4の running 固着の判別方式が未定** | Unknown |
| R4 フェーズ5ライフサイクル・停止制御 | orchestrator のポーリング（既存）、`cancelRunningDebate`、`finalizeDebate`→`updateTopicPhase(5,generated)`（既存）、`restartDebate`（currentChapterIndex 再開・既存） | ゲート参照を `topic.phaseStatus !== 'running'` に変更。停止ボタンは `phaseStatus='stopped'` 書き込みに変更。完走時の上書き保護 | Constraint |
| R5 状態の単独保持・画面側 $derived 導出 | `phaseLogicalState(hints)`、`createPhaseController(targetPhase)`、`PhasePanel` | hints 撤廃、targetPhase 注入コントローラ解体、各画面で `$derived` 導出へ再構成 | Constraint |
| R6 旧実装完全除去 | `DebateStatus`、`statusToPhase`/`resolveCurrentPhase`/`deriveLegacyPhaseState`/`LEGACY_*`/`STATUS_PHASE_MAP`、`updateTopicStatus` | 全削除。`published` 状態の新しい置き場所が必要 | Missing |

## 4. 設計で必ず判断すべき論点（Research/Decision Needed）

1. **フェーズ5の `stopped`/エラーの topic 表現【決定】** — `PhaseStatus` を `not_started | running | generated | stopped` に拡張する。エラーは独立値にせず `stopped` に集約（停止・異常終了とも同じ `stopped`、次操作は再開/やり直し）。src（[phase.ts](../../../src/lib/utils/phase.ts)）と `functions/src/types/index.ts` の両方を更新。`phaseLogicalState` の stopped 導出も session 非依存に。

2. **フェーズ1〜4の「running 固着」判別（最重要）** — フェーズ1〜4は現状クライアントが running→generated を書くため、生成途中の離脱で running が残る。`clientPhaseInFlight` 撤廃後の対応として:
   - **(a) 終端書き込みを Functions に寄せる**（generateStakeholders/Personas/Chapters が Functions 内で generated まで書く）。クリーンだが書き込み責務の移動が必要。
   - **(b) running からの「やり直す」操作を全フェーズで許可**（フェーズ5の停止ボタンと同じ発想で、固着を手動回収）。変更は小さい。PhasePanel の running 分岐に再実行アクションを追加。
   - **(c) `startedAt` 併記＋stale running を読み取り時に再操作可能扱い**。ヒューリスティック。
   → **【決定】(b) を採用**。全フェーズで `running` から「やり直す」操作を提示し、固着を手動回収する。[PhasePanel.svelte](../../../src/lib/sharedComponents/PhasePanel.svelte) の `running` 分岐に、現状フェーズ5のみの停止/再開に加え、全フェーズ共通の再実行アクションを追加する。討論（R4）は「いつでも停止ボタン」で同等に解決済み。

3. **`published` の扱い（公開機能ごとオミット）** — publish 機能は当面オミットし、コンテンツ生成に集中する。`DebateStatus` 完全削除に伴い `status: 'published'` も除去する。`status === 'published'` に依存する箇所は [+page.svelte:9](../../../src/routes/+page.svelte#L9)（公開トップの一覧フィルタ）と [topic.svelte.ts publishDebate](../../../src/lib/models/topic/topic.svelte.ts#L47)。ビルドを通す最小処置として、公開判定を既存 `publishedAt != null` に退避するか、公開UI（publish ボタン・公開ページ）を一時停止する。撤去範囲の確定は本仕様の主目的（状態一元化）から切り離して設計フェーズで判断する。`phaseStatus` とは直交。

4. **停止フラグと完走の競合** — `finalizeDebate` が `generated` を書く直前に停止が入った場合の上書き防止（R4-AC4 の「running のままなら」をトランザクション/条件付き更新でどう担保するか）。

5. **既存データ移行** — 本番 Firestore 直結（エミュレータ未使用）。`phase/phaseStatus` 未設定や `status` のみの既存 topic、`session.status` を持つ既存 session の一度きり移行スクリプト（または初回読み取り時バックフィル）。`deriveLegacyPhaseState` のロジックは移行スクリプトに移植して本体からは削除する。

## 5. 実装アプローチ

### Option A: 既存資産を最小改変で付け替え（推奨）
- `PhaseStatus` に `stopped` 追加、orchestrator のゲートと停止/終端書き込みを session→topic へ付け替え、`phaseLogicalState` から hints 除去、`phaseController` 解体、旧型・ヘルパー削除、`published`→`publishedAt`。
- **トレードオフ**: ✅ 既存のゲート機構・topic 書き込み経路をそのまま活かせる ✅ 変更が局所的 ❌ フェーズ1〜4の固着対応（論点2）を別途決める必要

### Option B: フェーズ1〜4の生成も Functions に全面移管
- 全フェーズの running→終端書き込みを Functions が所有し、クライアントはトリガーのみ。
- **トレードオフ**: ✅ running の権威が完全にサーバ側 ✅ 固着が原理的に減る ❌ 取材の `Promise.all` 等の移管で変更が大きい ❌ 今回スコープ（状態一元化）を超える

### Option C: ハイブリッド（A をベースに、討論のみ堅牢化）
- A を本線とし、討論（R4）だけ「停止ボタン常時 + ゲート + `startedAt` バックストップ」を追加。フェーズ1〜4は (b) の手動やり直しで対応。
- **トレードオフ**: ✅ コストの高い討論の暴走を確実に止める ✅ 変更量を抑える ❌ フェーズ間で固着回収の手段がわずかに非対称

## 6. 工数・リスク

| 区分 | 評価 | 根拠 |
|---|---|---|
| 工数 | **M（3〜7日）** | 既存パターンの付け替えが中心だが、src/functions 両方の型・stores・orchestrator・UI・移行に跨る |
| リスク | **Medium** | ゲート機構は既存で再利用可。ただし本番データ移行（エミュレータ未使用）と `published` の波及、固着判別の設計判断が残る |

## 7. 設計フェーズへの申し送り

- **推奨アプローチ**: Option A を本線、討論の堅牢化は Option C の要素を取り込む。
- **先に決める鍵**: ①`PhaseStatus` の値集合（stopped 追加・error 集約）、②フェーズ1〜4の固着回収方式（(b) 手動やり直しを推す）。③publish は機能ごとオミット。`DebateStatus` 削除に伴う `status === 'published'` 依存箇所のみ最小処置（`publishedAt` 退避 or 公開UI一時停止）。フロー再設計は将来の編集工程で。
- **持ち越す調査項目**: 本番データ移行手順（バックフィル vs スクリプト）、停止と完走の競合に対する条件付き更新の実装方式、`functions/src/types/index.ts` と `src/lib/utils/phase.ts` の型重複の解消方針（steering の「共通型は Functions 側で定義」方針との整合）。
- **影響ファイル（除去・改変の主対象）**: `src/lib/utils/phase.ts`, `src/lib/models/topic/phaseController.svelte.ts`, `src/lib/models/topic/topic.svelte.ts`, `src/lib/models/topic/topic.types.ts`, `src/lib/models/session/session.types.ts`, `src/lib/stores/personas.svelte.ts`, `src/lib/sharedComponents/PhasePanel.svelte`, 各 `Phase1〜5*.svelte`, `src/routes/admin/topics/[topicId]/+layout.svelte`, `src/routes/+page.svelte`, `functions/src/types/index.ts`, `functions/src/db/repository.ts`, `functions/src/api/debates.ts`, `functions/src/pipeline/debate-orchestrator.ts`。

## 8. 設計フェーズの確定事項（design.md に反映済み）

- **アーキテクチャパターン**: Single Source of Truth + リアクティブ導出。topic が状態を単独保持し、UI は onSnapshot 同期値から `$derived`、Functions は同じ topic をゲート・書き込みに使う。新規コンポーネントは無し（責務移動と削除が中心）。
- **停止ゲート条件**: `isDebateActive = topic.phase===5 && topic.phaseStatus==='running'`。`session.status==='cancelled'` ポーリングを置換。上流再生成（phase を 1〜4 に戻す）も同条件で討論を止められる（session の cancel フラグ不要）。
- **完走と停止の競合**: `finalizeTopicIfRunning`（runTransaction）で「running のときのみ generated」を保証し停止を上書きしない。
- **`phaseController` 解体**: 状態保持（inFlight/error/logicalState）を持つコントローラを廃止。操作は薄い action 群、状態は各画面の `$derived`。`phaseLogicalState` は `(current, target)` のみの純粋関数化（hints 全廃）。
- **移行なし（全削除・再作成）**: 既存 topic/session はバックフィルせず破棄。デプロイ前に `topics` コレクションを削除する運用のみ。`deriveLegacyPhaseState` 等は移植せず単純削除。新規 topic は `addTopic` が既に2軸初期化済み。
- **`stopped` は全フェーズ共通**（誤記訂正）: 「phase===5 のみ」は誤り。エラー集約と「running からやり直す」決定により、`stopped` は1〜5すべてで有効。回復は全フェーズ「やり直す」に一本化（1〜4は再実行、5は再開/最初から）。
- **エラー方針**: クライアント権威フェーズ(1〜4)は失敗時 topic を `stopped`、離脱固着は running の「やり直す」で回復。Functions 権威(5)は最終リトライ失敗で `markTopicStopped`、プロセス死亡時も停止ボタンで `stopped` 回復。
