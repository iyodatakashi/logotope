# Research & Design Decisions

## Summary
- **Feature**: `phase-workflow-consistency`
- **Discovery Scope**: Extension（既存5フェーズ管理フローのリファクタ・統一）
- **Key Findings**:
  - フェーズ判定の中心は [src/lib/utils/phase.ts](../../../src/lib/utils/phase.ts) の `STATUS_PHASE_MAP`（`DebateStatus` → `Phase`）。ただし「どのフェーズか」しか導出できず、フェーズ内の状態（生成中/生成済み）は各コンポーネントが個別ロジック（subcollectionの有無、`stakeholders.approved`、`persona.interview.status`、`session.status`）で判定しており不統一。
  - トピックの `status` は client（承認・ステークホルダー再生成）と Functions（`generateChapters`・`startDebate`・討論完了）の両方が書き込む。討論フェーズのみ Cloud Tasks による非同期実行で、クライアントは完了を await しない。
  - `DebateStatus` の値はフェーズと状態が混線（`generating_personas` は「フェーズ1承認＝フェーズ2入口」で設定され、実際の生成中を表さない）。`interviewing`/`cancelled` などの粒度も不揃いで、到達経路が直感的でない。

## Research Log

### 既存のフェーズ進行・ステータス管理
- **Context**: 5フェーズで共通操作（生成・承認・再生成）の振る舞いがばらつく原因を特定する。
- **Sources Consulted**:
  - [src/lib/utils/phase.ts](../../../src/lib/utils/phase.ts), [src/routes/admin/topics/[topicId]/+layout.svelte](../../../src/routes/admin/topics/%5BtopicId%5D/+layout.svelte)
  - [src/lib/models/topic/topic.svelte.ts](../../../src/lib/models/topic/topic.svelte.ts), [src/lib/stores/personas.svelte.ts](../../../src/lib/stores/personas.svelte.ts)
  - Phase1〜5 コンポーネント（`src/lib/features/admin/**`）
  - [functions/src/api/debates.ts](../../../functions/src/api/debates.ts), [functions/src/pipeline/debate-orchestrator.ts](../../../functions/src/pipeline/debate-orchestrator.ts)
- **Findings**:
  - 状態の真実の源がフェーズごとに異なる（ローカル `generating` フラグ / subcollection 件数 / `session.status`）。
  - トピックステータスの書き込み主体と遷移:
    - client: `approveStakeholders`→`generating_personas`、`approvePersonas`→`interviewing`、`approveInterviews`→`chapters_ready`、`approveChapters`→`chapters_approved`、`generateStakeholders`→`surveying`。`generatePersonas` はトピックステータスを変更しない。
    - Functions: `generateChapters`→`chapters_ready`、`startDebate`→`debating`、討論完了→`completed`。
  - 再生成時の下流データ破棄のタイミングが不統一（ステークホルダーは生成前クリア、ペルソナ・章立ては生成成功後クリア）。
- **Implications**:
  - 「フェーズ」と「フェーズ内状態」を直交した2軸で永続化し、単一の導出規則に集約すべき。
  - Functions の3つの書き込み点を新モデルに合わせて更新する必要がある（討論の非同期完了は Functions が権威を持つ）。

### 討論フェーズの非同期実行モデル
- **Context**: 討論の running→completed をどのレイヤーが権威的に確定するか。
- **Findings**: `startDebate`（onCall, 60s）は `runChapter` タスクをenqueueして即return。各 `runChapter`（onTaskDispatched, 540s）が章ごとに実行し次章をenqueue、最終章完了で `updateTopicStatus('completed')`。クライアントは討論完了を await しない（`onSnapshot` で session を監視）。
- **Implications**: フェーズ1〜4の生成はクライアントが callable を await して結果を書き込む（クライアントが状態遷移の権威）。フェーズ5（討論）のみ Functions が `running`/`generated` 遷移の権威を持つ。ブラウザを閉じても Functions が完了を確定できる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 単一 composite enum を合理化 | `personas_running` のような (phase,state) 合成値1フィールド | 永続フィールド1つ、Functions差分小 | 値が15+で冗長、ユーザー要望「シンプルに」に反する | 既存 `STATUS_PHASE_MAP` の延長 |
| **B. 直交2軸（採用）** | `phase: 1-5` と `phaseStatus: not_started/running/generated` の2フィールド | ユーザーの心的モデルに一致、値が 5+3 で最小、approved は導出 | Functions が2フィールドを書く必要 | `approved` は「前フェーズ」から導出（永続化不要） |
| C. クライアント側のみで session から導出 | topicに状態を持たず都度導出 | Functions変更ほぼ不要 | 真実の源が分散、req 7-2 に反する | 不採用 |

## Design Decisions

### Decision: フェーズ進行を「phase + phaseStatus」の直交2軸で永続化する
- **Context**: 要件1・7。「現在のフェーズ」と「そのフェーズの状態」だけを保持し、サブコレクションの個別フラグに依存せず一意判定したい。
- **Alternatives Considered**:
  1. 合成 enum（Option A）— 1フィールドだが値が冗長。
  2. 直交2軸（Option B）— `phase`＋`phaseStatus`。
- **Selected Approach**: トピックに `phase: Phase`（1-5）と `phaseStatus: 'not_started' | 'running' | 'generated'` を持つ。**永続するのは3状態のみ**。表示用の4論理状態は導出する:
  - フェーズ p < currentPhase → `approved`
  - p == currentPhase → `phaseStatus`
  - p > currentPhase → `not_started`
  - `approved` は永続化せず、承認はポインタ前進（次フェーズ `not_started`）で表現。
- **Rationale**: ユーザーの「どのフェーズ＋その状態」モデルに直接対応。値が最小で到達不能値が生じない（req 7-5）。前フェーズ承認と次フェーズ生成中が自然に区別される（req 7-3）。
- **Trade-offs**: Functions が `status` 単一値の代わりに2フィールドを書く。`DebateStatus`（topic用）を廃し session 用に `SessionStatus` を分離する型リファクタが必要。
- **Follow-up**: 既存トピックの後方互換（移行）。

### Decision: 状態遷移の権威レイヤーを分割する
- **Selected Approach**: フェーズ1〜4の生成・承認・再生成はクライアントが権威（callable を await し、前後で `phase`/`phaseStatus` を書く）。フェーズ5（討論）の `running`/`generated` は Functions が権威（`startDebate`→running、最終 `runChapter`→generated）。
- **Rationale**: 討論は Cloud Tasks で非同期実行されクライアントが完了を待たないため。
- **Trade-offs**: 討論中にブラウザを閉じても Functions が完了を確定できる一方、生成失敗で `running` が残る可能性 → 再調整（reconciliation）が必要（リスク参照）。

### Decision: 共通操作のロジックとUIを共有化する
- **Selected Approach**: 設定駆動の `PhaseController`（モデル層）＋ 共有 `PhasePanel`（UI層）を導入。各 `PhaseNxxx.svelte` は固有のコンテンツ（一覧表示）を snippet として渡すだけにする。生成中インジケータ・エラー表示・アクションバー・再生成確認ダイアログは共有コンポーネントに集約。
- **Rationale**: req 6-4（重複実装の排除）。フェーズ追加時の保守性向上。
- **Trade-offs**: フェーズ3（ペルソナ別リトライ）・フェーズ5（停止/公開）の固有操作は共通トリアド外の拡張として扱う。

### Decision: 既存トピックの後方互換は遅延移行（lazy compat）で行う
- **Selected Approach**: 読み取り時に `topic.phase` が未定義なら、旧 `status` ＋（必要時）subcollection から `(phase, phaseStatus)` を導出する互換関数 `deriveLegacyPhaseState` を用意。以降の書き込みは常に新フィールドを設定する。
- **Rationale**: 本プロジェクトは本番直結・データ量小・管理用ツール。移行スクリプトやデプロイ順序の制約を避けられる。
- **Trade-offs**: 互換関数が一時的に旧ロジックを内包する。新規データが揃えば削除可能。

## Risks & Mitigations
- **討論中断で `phaseStatus='running'` が残る** — 読み取り時に「フェーズ5が `running` かつ session が終端（completed/cancelled/error）」なら `generated`/`stopped` に再調整するルールを共有ローダーに実装（req 7-6）。
- **restart(再開)のターン重複** — ターン単位 resume は `executeChapterTask` 再入で章途中ターンに追記し重複/不整合を招く。優先度が低いため**章単位（現在章の頭から）再開**に統一し、`restartDebate` で当該章のターンと派生変化（信念・エンゲージメント）を巻き戻してから章頭で再実行する専用処理とする。
- **Functions とクライアントの二重書き込み競合** — フェーズ1〜4はクライアント単独、フェーズ5は Functions 単独、と権威を明確化して回避。
- **型リファクタの波及（`DebateStatus` 廃止）** — topic用とsession用の型を分離し、参照箇所をコンパイルエラーで洗い出して段階移行。

## References
- [src/lib/utils/phase.ts](../../../src/lib/utils/phase.ts) — 既存のフェーズ判定中心
- [functions/src/api/debates.ts](../../../functions/src/api/debates.ts) — 討論の非同期起動
- [functions/src/pipeline/debate-orchestrator.ts](../../../functions/src/pipeline/debate-orchestrator.ts) — 討論完了時のステータス確定
- `.kiro/steering/tech.md` / `.kiro/steering/structure.md` — アーキテクチャ規約
