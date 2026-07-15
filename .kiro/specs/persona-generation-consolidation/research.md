# Research & Design Decisions: persona-generation-consolidation

## Summary
- **Feature**: `persona-generation-consolidation`
- **Discovery Scope**: Extension（既存の生成パイプライン・フェーズ定義への統合的変更）
- **Key Findings**:
  - 取材の完了集約はすでにサーバ権威（`confirmInterviewsGeneratedIfAllComplete`）。確定先フェーズ名を `interviews` → `personas` に変えるだけで流用できる。
  - 討論・編集に「起動 onCall ＋ `onTaskDispatched` 自己連鎖 ＋ 決定的 task id」の完成した型がある。ペルソナ連鎖はこれに倣う。
  - `approved` は現状「取材開始時に全件 true」で死んだフラグ。要件は手動チェックの `selected`（ペルソナ側）へ置換。下流フィルタ `filter(p => p.approved)` が BE 5+箇所・FE 1箇所にある。

## Research Log

### 既存 Cloud Tasks チェーンの型（討論・編集）
- **Sources**: `functions/src/pipeline/debate/enqueue-step.ts`, `api/debates.ts`, `pipeline/editing/enqueue-editing-step.ts`, `api/editing.ts`
- **Findings**:
  - 起動: `startDebate` / `startEditing`（onCall・60s）が runId を発行し、最初のステップを1件 enqueue。以降はステップが `onTaskDispatched` 内で次段を enqueue して自己連鎖する。
  - 決定的 task id: `hashTaskId(sha256(key))`。`isTaskAlreadyExists`（ALREADY_EXISTS/409/code 6）を握って二重投入を1本へ収束。runId を鍵に含め、再実行時の旧 task id 衝突を回避。
  - 終端失敗: `runEditingStep` は最終リトライ（`retryCount >= MAX_ATTEMPTS-1`）で `stopped` を書く。`retryConfig` / `rateLimits` を onTaskDispatched に付与。
  - `enqueueEditingStep` は討論の `hashTaskId` だけ import して再利用。**チェーン本体は各ドメインが自前**（共有しない）。
- **Implications**: ペルソナ連鎖も「起動 onCall＋単一 `onTaskDispatched`（stepKind 判別）＋自前 enqueue」で組む。`hashTaskId` / `isTaskAlreadyExists` の再利用に留め、ステップ定義は persona 専用に置く。

### 取材の完了集約（サーバ権威）
- **Sources**: `functions/src/api/interviews.ts`, `pipeline/interviews/interview-completion.ts`, `utils/topic-phase.ts`
- **Findings**:
  - `runInterview`（onCall・300s・per persona）が結果を永続後 `confirmInterviewsGeneratedIfAllComplete(topicId)` を呼ぶ。全 persona が `interview.status==='completed'` のときだけ `confirmPhaseGenerated(topicId,'interviews')`。冪等・多重呼び出し安全。
  - `confirmPhaseGenerated` は running/stopped から generated へ遷移（対象フェーズから前進済みなら触らない）。
- **Implications**: 確定先を `personas` に変えれば、初期チェーンの取材ステップ完了時にもペルソナ単位の再取材完了時にも、そのまま「全件完了 → personas generated」が成立する。

### `approved` → `selected` の下流参照
- **Sources**: grep `filter.*approved`
- **Findings**: BE `chapter-generator.ts:14` / `debate-orchestrator.ts:113` / `debate-digest.ts:31` / `editing/regenerate-element.ts:19` / `editing-lifecycle.ts:80` / `editing-step.ts:72,214`。FE `EditingPage.svelte:183`。
- **Implications**: 全箇所を `filter(p => p.selected)` へ。生成時に `selected: true` を書けば既定 ON が保たれ、選択未操作なら現状（全件対象）と同一挙動。

### フェーズ定義の二重管理と一致検証
- **Sources**: `phase.types.ts`(FE), `phase.constants.ts`, `functions/.../phase.types.ts`, `topic-phase.ts`(`GeneratePhase`), `functions/src/tests/types/phase-slug.test.ts`, `StepNav.svelte`
- **Findings**: FE/BE の `PhaseSlug` は「正準リスト」で機械検証。`GeneratePhase` は生成確定を持つ部分集合。`STEP_GROUPS` が3フェーズを1ステップに束ねている。
- **Implications**: `stakeholders`/`interviews` を全定義・正準リスト・テスト・`GeneratePhase`・`STEP_GROUPS`・ルートから同時に除去。型エラーが漏れを検出する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 上流 onCall のまま＋起動時に取材のみ enqueue | ステークホルダー・ペルソナ生成は起動 onCall 内で同期実行し、取材だけ Cloud Tasks | 実装量が小さい | **R2.2 違反**: 上流実行中にクライアントが離脱すると連鎖が切れる（サーバ書き込みの onCall は在席依存） | 却下 |
| B（採用）: 全段を Cloud Tasks 自己連鎖 | 起動 onCall は runId 発行＋最初のステップ enqueue のみ。stakeholders→personas→interviews をステップが自己連鎖 | R2.2 を厳密に満たす（サーバ完結）。討論・編集と同型。取材の per-persona 並列・リトライを自然に得る | ステークホルダー・ペルソナ生成ロジックを pipeline 関数へ抽出する作業 | 討論 `runStep` の stepKind 判別と同型 |
| C: Firestore トリガー | personas 文書作成をトリガーに取材 | 起動が疎結合 | 再取材が作成でなく発火せず別経路。batch commit で N トリガー並列＝決定的 id の重複排除が効かない | gap で既に却下 |

## Design Decisions

### Decision: 初期チェーンは Cloud Tasks 自己連鎖、ペルソナ単位再取材は既存 onCall
- **Context**: R2.2（サーバ完結）と R5（ペルソナ単位再取材）を両立する。
- **Alternatives Considered**:
  1. 全操作を Cloud Tasks に寄せる — 再取材のたびに runId/nonce 管理が要る。
  2. 全操作を onCall に寄せる — R2.2 を満たせない。
- **Selected Approach**:
  - 初期チェーン: `startPersonaGeneration`(onCall・60s) が runId 発行＋`personas` を running にし、最初のステップ（stakeholders）を enqueue。単一 `runPersonaStep`(onTaskDispatched) が `stepKind: 'stakeholders' | 'personas' | 'interview'` を判別し、各段完了で次段を enqueue（personas 完了時はペルソナごとに interview ステップを N 件 enqueue）。
  - ペルソナ単位再取材: 既存 `runInterview`(onCall・per persona) をそのまま使う。クライアント起点の単一処理で在席してよい。完了時 `confirmInterviewsGeneratedIfAllComplete`（確定先 `personas`）が停止からの回復も担う。
  - 生成ロジック本体（`runStakeholderGeneration` / `runPersonaGeneration` / `runInterviewAgent`）は不変。呼び出し場所を onCall から step へ移すのみ。
- **Rationale**: 完了集約が既にサーバ権威なので、初期チェーンとオンデマンド再取材が同じ確定経路に収束する。再取材を onCall に残すことで runId 管理を初期チェーンだけに閉じ込められる。
- **Trade-offs**: `runPersonaStep` に3種の stepKind が同居するが、討論 `runStep`・編集 `runEditingStep` と同じ密度で許容範囲。
- **Follow-up**: interview ステップの task id は `${runId}:interview:${personaId}`。再取材（onCall）はタスクを使わないので dedup 衝突しない。

### Decision: 採用選択は生成時に `selected: true` を焼き込み、下流は `filter(selected)`
- **Context**: 既定 ON を保ちつつ、`approved` を廃し手動 `selected` へ置換（R4）。
- **Selected Approach**: ペルソナ生成の永続時に `approved:false` の代わりに `selected: true` を書く。下流フィルタ6+箇所を `p.selected` へ置換。FE は `PersonaItem` のチェックボックス → `personasStore.setSelected(personaId, bool)`（`stakeholdersStore.setSelected` と同型）。
- **Rationale**: 生成時に真値を焼くので BE 下流に `?? true` 補正が不要。安定 id（`persona.id`）をキーにするため配列 index 依存を避けられる（memory: stable-id-not-array-index）。
- **Trade-offs**: 既存 Firestore の `approved` は残置されるが読まれない（移行なし・既存トピック削除前提）。
- **Follow-up**: `EditingPage` の所感対象フィルタも `selected` へ。

### Decision: 途中段階の可視化は sub-collection の存在から導出
- **Context**: R6.3（ステークホルダー生成中/ペルソナ生成中/取材中の表示）と R1.4（phaseStatus に段階を持たせない）の両立。
- **Selected Approach**: `phaseStatus==='running'` の内訳を、FE が `stakeholders/0` の有無・`personas` の件数・各 persona の `interview.status` から導出する（補助フィールドを増やさない）。
- **Rationale**: 段階は既存データから決定的に読める。phaseStatus は全体の1軸に保てる。
- **Trade-offs**: 導出ロジックが FE に載るが、既存の楽観的 `isStarting` と同程度。

## Risks & Mitigations
- **Functions 改修の本番デプロイ検証**（エミュレータ未使用）— ステークホルダー→ペルソナ→取材の連鎖と、途中失敗→stopped→再取材→generated 回復を本番トピックで確認する。段階ごとにログ（討論・編集と同じ `console.error` 規範）を残す。
- **下流 `approved`→`selected` 置換の網羅漏れ** — 置換箇所を design に列挙し tasks で1つずつ潰す。漏れると不採用ペルソナが討論に出る/採用が反映されない。
- **Cloud Tasks キューの新規登録**（`runPersonaStep`）— 討論・編集と同じくデプロイで自動登録されるが、初回デプロイ後に疎通確認。
- **runId の伝搬** — 全ステップ payload に runId を通し、決定的 task id の鍵に含める（討論の踏襲）。

## References
- 既存実装: `functions/src/pipeline/debate/enqueue-step.ts`, `functions/src/api/editing.ts`（`runEditingStep`）, `functions/src/pipeline/interviews/interview-completion.ts`
- steering: `.kiro/steering/structure.md`（過度な共通化をしない）, `.kiro/steering/firebase.md`（Cloud Functions 役割分担・onSnapshot）
- memory: `feedback-stable-id-not-array-index`, `project-no-emulator`, `project-task-timeout-30min-cap`
