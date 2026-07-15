# Gap Analysis: persona-generation-consolidation

## 1. 現状調査（Current State）

### フェーズ定義（FE / BE の二重管理）

`PhaseSlug` は FE・BE で別々に定義され、**値集合と順序を一致させる制約**がある。一致は BE のテスト `functions/src/tests/types/phase-slug.test.ts` が「正準リスト」で機械的に検証している。

| 場所 | 内容 |
|---|---|
| `src/lib/models/phase/phase.types.ts` | FE `PhaseSlug`（8値） |
| `src/lib/models/phase/phase.constants.ts` | `PHASE_DEFS`（順序＋`statusLabels`）。stakeholders/personas/interviews の3エントリ |
| `functions/src/types/phase.types.ts` | BE `PhaseSlug`（8値・FE と一致） |
| `functions/src/utils/topic-phase.ts` | `GeneratePhase = Extract<PhaseSlug, 'fact-research'|'stakeholders'|'personas'|'interviews'|'chapters'>` |
| `functions/src/tests/types/phase-slug.test.ts` | 正準リストと `Record<PhaseSlug, true>` / `Record<GeneratePhase, true>` の網羅チェック |
| `src/lib/sharedComponents/StepNav.svelte` | `STEP_GROUPS` が `['stakeholders','personas','interviews']` を「ペルソナ生成」1ステップに束ねている |

### 生成パイプライン（現状: 3つの独立した onCall + FE オーケストレーション）

| 段階 | BE onCall | 完了確定 | FE 起動元 |
|---|---|---|---|
| ステークホルダー | `generateStakeholders`（`api/stakeholders.ts`） | `confirmPhaseGenerated(topicId,'stakeholders')` | `createTopic.generateStakeholders` |
| ペルソナ | `generatePersonas`（`api/personas.ts`）— `selectedStakeholderIds` を受け、採用集合のみ生成 | `confirmPhaseGenerated(topicId,'personas')` | `createTopic.generatePersonas(ids)` |
| 取材 | `runInterview`（`api/interviews.ts`）— **ペルソナ1人単位** | `confirmInterviewsGeneratedIfAllComplete`（全件 completed で generated） | `personasStore.runInterviews`（FE が未完了ペルソナへ fanout） |

現状、段階間の連鎖は **FE（`GeneratePersonaPage`）が担う**。「ステークホルダー生成」「ペルソナ生成」「取材開始」を管理者が順に押す。取材の per-persona 起動と完了集約だけがサーバ権威。

### Cloud Tasks チェーンの既存資産（討論・編集）

- `enqueueStep` / `taskKey` / `hashTaskId`（`pipeline/debate/enqueue-step.ts`）— **決定的 task id（sha256 hash）で二重実行を1本へ収束**。`isTaskAlreadyExists` で ALREADY_EXISTS を握る
- `runStep`（`api/debates.ts`）/ `runEditingStep`（`api/editing.ts`）= `onTaskDispatched`。`retryConfig` / `rateLimits` / 終端失敗で `stopped` 書き込み
- `startDebate`（onCall・60s）が runId 発行 → 最初のステップを enqueue → 以降サーバ内で自己連鎖。**ペルソナ連鎖が乗るべき正確な型がここにある**

### `selected`（採用）の現状

- 型: `stakeholder.types.ts` `StakeholderForFirestore.selected?: boolean` / アプリ層 `Stakeholder.selected: boolean`
- 既定: `stakeholders.svelte.ts` が `selected ?? true`（opt-out）
- 永続: `stakeholdersStore.setSelected(id, bool)` が `stakeholders/0` の配列を更新
- 消費: FE `GeneratePersonaPage.selectedStakeholderIds` → `generatePersonas` の引数 → BE が採用集合のみ生成
- UI: `StakeholderItem`（チェックボックス）

### `approved`（承認）の現状

- 型: `persona.types.ts` `PersonaForFirestore.approved: boolean`
- 付与: **`personasStore.approvePersonas()` が全件 `approved:true`**（取材開始時に1回）。手動の個別選択は無い
- 消費（下流フィルタ）: `filter(p => p.approved)` が **5箇所** —
  `functions/src/pipeline/chapters/chapter-generator.ts:14` /
  `debate/debate-orchestrator.ts:113` / `debate/debate-digest.ts:31` /
  `editing/regenerate-element.ts:19` / `editing/editing-lifecycle.ts:80` / `editing/editing-step.ts:72,214`
- FE 消費: `EditingPage.svelte:183` `personas.filter(p => p.approved)`（所感の対象）

> **重要**: `approved` は現状「取材開始時に全件 true」なので実質フィルタとして機能していない。要件はこれを廃し、**手動チェックの `selected`（ペルソナ側）へ置換**する。下流5+箇所のフィルタ条件を `approved` → `selected` に読み替える必要がある。

### 承認・前進・リセットのメソッド群（`createTopic.svelte.ts`）

- `approveStakeholders`（→ advancePhase('stakeholders')）/ `approveInterviews`（→ advancePhase('interviews')）→ **不要化**
- `generateStakeholders` / `generatePersonas` → 統合され、単一の起動 onCall へ
- `resetStakeholders` / `resetPersonas` → 再生成で使う（残す。ただし呼び出し側が変わる）
- `personasStore`: `approvePersonas` / `runInterviews`（`all` 引数）→ 撤去。`runInterview`（単一）は再取材で活用

### ルーティング

`src/routes/admin/topics/[topicId]/` 配下に `stakeholders/` `personas/` `interviews/` の3ディレクトリ。3つとも同じ `GeneratePersonaPage` を描画（+page.svelte が import しているだけ）。レイアウトのリダイレクトガードは `pagePhase` を URL 末尾 slug から解決する。

### PersonaItem の現状

`PersonaItem.svelte` は取材ステータスのバッジ（完了/取材中/エラー/待機中）を表示し、クリックで `InterviewDialog` を開く。**再取材ボタンは無い**（要件5.2 で追加）。採用チェックボックスも無い（要件4.3 で追加）。

## 2. 要件別ギャップマップ

| 要件 | 既存アセット | ギャップ | 分類 |
|---|---|---|---|
| R1 フェーズ統合（8→6値） | FE/BE `PhaseSlug`・`PHASE_DEFS`・`GeneratePhase`・phase-slug.test | `stakeholders`/`interviews` を全定義から削除し、両者の一致を保つ。正準リストとテストも更新。`GeneratePhase` から2値除去 | **Missing（機械的だが広範）** |
| R2 一気通貫（サーバ連鎖） | 討論・編集の enqueue パターン、3つの生成 onCall、`confirmInterviewsGeneratedIfAllComplete` | 連鎖の起動 onCall と、段階を跨ぐ enqueue オーケストレーションが無い。3つの onCall を pipeline 関数へ割り、Cloud Tasks で繋ぐ | **Missing（中核）** |
| R3 ステークホルダー中間生成物化 | `StakeholderItem`（チェックボックス）、`selected` | チェックボックス撤去、`selected` 撤去、表示は残す | Extend |
| R4 ペルソナ採用（selected 新設・approved 廃止） | `persona.types`、下流5+箇所の `filter(approved)`、`EditingPage` | ペルソナに `selected` 追加、チェックボックス UI（`PersonaItem`）、下流フィルタを `approved`→`selected` 置換、`approvePersonas` 撤去 | **Missing＋広範な置換** |
| R5 ペルソナ単位再取材 | `runInterview`（単一 onCall 既存）、`InterviewDialog` | `PersonaItem` に再取材ボタン。`runInterviews`（バッチ）と `regenerateInterviewsDialog` 撤去。完了で generated 復帰は既存の `confirmInterviews...` が担う | Extend＋撤去 |
| R6 画面構成（中央1スロット） | `GeneratePersonaPage`（WIP・列ヘッダー・コメントアウト多数） | 中央スロット＝実行/再生成のみ。列ヘッダーの生成ボタン群を撤去。コメントアウト除去 | Rewrite |
| R7 非退行 | 各生成ロジック、`stakeholderId` 対応、beliefs 構造 | 生成の中身は不変。呼び出し経路のみ変更 | Constraint |
| R8 構造制約（Cloud Tasks・決定的 id） | enqueue-step の型 | 討論・編集と同型で実装。`selected`/`approved` 撤去の後始末 | Constraint |

## 3. 主要な設計決定

### 3-1. サーバ連鎖の起動と段階遷移（R2 の中核）

現状の3 onCall（stakeholders/personas/interviews）をどう1本の連鎖にするか。討論・編集の型に照らして **Option C 相当（Cloud Tasks で段階を繋ぐ）** が本命。詳細な分岐は設計で詰める:

- **起動**: `startPersonaGeneration`（onCall・短時間）が `personas` フェーズを `running` にし、最初のステップ（ステークホルダー生成）を enqueue する。討論の `startDebate` と同型
- **段階遷移**: 各ステップが `onTaskDispatched` で走り、完了したら次段を enqueue する（stakeholders 完了 → personas 生成を enqueue → personas 完了 → ペルソナごとに interview ステップを N 件 enqueue）
- **完了確定**: 取材は per-persona ステップ。最後の1人が終わったとき `confirmInterviewsGeneratedIfAllComplete` 相当で `personas` フェーズを `generated`（既存資産がほぼ流用可。ただし確定先フェーズ名が `interviews` → `personas` に変わる）
- **決定的 task id**: `topicId:stakeholders` / `topicId:personas` / `topicId:interview:personaId`。R5 のペルソナ単位再取材も同じ id 体系に自然に乗る（同一ペルソナの二重取材を Cloud Tasks が弾く）

**検討が要る点（設計へ）**:
- ペルソナ生成の onCall は現状 `selectedStakeholderIds` を引数に取る。統合後は「全ステークホルダー対象」（R3.5）なので、この引数を廃し、サーバが `stakeholders/0` を直接読む
- ステークホルダー生成・ペルソナ生成は現状 onCall（300s）。Cloud Tasks ステップ（`onTaskDispatched`・540s）へ移すと、既存の onCall を pipeline 関数へ抽出する必要がある（`runInterview` の中身抽出と同じ作業）
- 途中失敗時の `stopped` 書き込み先が `personas` フェーズに一本化される

### 3-2. `approved` → `selected`（ペルソナ）への置換（R4）

- **型**: `PersonaForFirestore.approved` を削除し `selected` を追加（`selected?: boolean`、既定 ON は FE 境界で `?? true`。ステークホルダーの現行規範と同じ）
- **下流フィルタ**: `filter(p => p.approved)` を `filter(p => p.selected)` へ（BE 5+箇所・FE 1箇所）。既定 ON なので、選択を触らなければ現状（全件対象）と同じ挙動
- **付与経路の消滅**: `approvePersonas`（全件 true 書き込み）を撤去。代わりに `PersonaItem` のチェックボックス → `personasStore.setSelected(personaId, bool)`（`stakeholdersStore.setSelected` と同型の新規メソッド）
- **注意**: memory `feedback-stable-id-not-array-index` — 採用選択のキーは配列 index でなくペルソナの安定 id（`persona.id`）で行う。既存の `stakeholder.id` 突合と同じ

### 3-3. `selected` の意味の移動（stakeholder → persona）

現状 `selected` はステークホルダーにあり「どのステークホルダーからペルソナを生成するか」を絞る。統合後:
- ステークホルダーの `selected` は**撤去**（全ステークホルダーからペルソナ生成）
- ペルソナに `selected` を**新設**（どのペルソナを討論に出すか）

絞り込みの位置が1段下がる。ステークホルダー段階のフィルタ（`selectedStakeholderIds`）が消え、ペルソナ段階のフィルタ（下流の `filter(selected)`）が生まれる。

## 4. 実装アプローチ

### FE

- **Option 1（推奨）**: `GeneratePersonaPage` を書き直し、中央スロット1つ（実行/再生成）＋ `StakeholderPersonaRow` の表示（チェックボックス無しのステークホルダー＋ `selected` チェックボックス付きペルソナ）。`phase-page-ui-unification` の中央スロット規則に最初から合わせる
- `personasStore`: `approvePersonas`/`runInterviews`（バッチ）を撤去、`setSelected(personaId,bool)` と `reinterview(personaId)`（単一 `runInterview` ラッパ）を追加
- `createTopic`: `approveStakeholders`/`approveInterviews`/個別 `generateStakeholders`・`generatePersonas` を、単一の起動 `startPersonaGeneration` ＋再生成用 reset に整理

### BE

- **Option C（推奨・討論編集と同型）**: 起動 onCall＋`onTaskDispatched` ステップ連鎖。既存3 onCall のロジックを pipeline 関数へ抽出して段階ステップから呼ぶ
- 完了集約は `confirmInterviewsGeneratedIfAllComplete` を `personas` フェーズ確定へ改名・転用
- `index.ts` のエクスポート・`firestore.rules`（新規パス増減があれば）を更新

### 過度な共通化を避ける（structure.md）

段階連鎖は「ペルソナ生成」固有のオーケストレーションであり、討論・編集と**同じ型に倣うが共有はしない**（各ドメインが自分の enqueue-step を持つ現状の慣習に合わせる。`enqueue-editing-step.ts` が `hashTaskId` だけ討論から import しているのと同程度の再利用に留める）。

## 5. Research Needed（設計フェーズへ持ち越し）

1. **ステークホルダー/ペルソナ生成の onCall → Cloud Tasks ステップ移設の粒度** — 300s onCall を 540s の `onTaskDispatched` に移すか、生成そのものは onCall のまま残し「連鎖の起動だけ」をタスク化するか。取材は元々 per-persona で重いのでタスク化必須だが、上流2段は onCall のままでも連鎖は組める（起動 onCall がステークホルダー生成を await → ペルソナ生成 enqueue、等）。タイムアウトと実装コストのトレードオフ
2. **`stopped` からの表示回復** — R6.1 は「ペルソナ生成済みなら停止でも中央スロットは再生成」。停止中にペルソナ単位再取材で全件 completed になったら `generated` へ復帰する経路（サーバ権威）の確認
3. **一気通貫の途中段階の可視化（R6.3）** — 現状 `phaseStatus` は running/generated/stopped のみ。「ステークホルダー生成中/ペルソナ生成中/取材中」を FE がどう出すか（各サブコレクションの存在有無から導出 or 補助フィールド）。`phaseStatus` に段階を持たせない方針（R1.4）との両立
4. **`selected` 既定 ON の永続タイミング** — 生成直後は未設定（FE で `?? true`）。下流 BE が読むときの既定はどう保証するか（BE 側も `?? true` で読むか、生成時に `selected:true` を書くか）
5. **移行なしの前提での型の後方互換** — 既存トピック削除前提（要件で確定）なので、`approved`/`stakeholder.selected` は型から即削除してよい。Firestore に残る古いフィールドは読まれないだけ

## 6. 工数とリスク

| 範囲 | 工数 | リスク | 根拠 |
|---|---|---|---|
| フェーズ統合（型・定数・テスト） | S–M | Low | 機械的だが FE/BE 両側・テスト・StepNav・ルート削除と広範。型エラーが漏れを教えてくれる |
| サーバ連鎖（Cloud Tasks） | M | Medium | 討論・編集の同型資産があり設計リスクは低いが、Functions 改修＝**本番デプロイ必須**（エミュレータ未使用）。取材の per-persona ステップ化・完了確定の転用を本番で検証 |
| `approved`→`selected` 置換＋採用UI | M | Medium | 下流フィルタ5+箇所の置換は漏れると「不採用ペルソナが討論に出る/出ない」の実害。既定 ON で現状挙動は保たれるが、フィルタ箇所の網羅が要 |
| FE 画面書き直し | S–M | Low | WIP を捨てて中央スロット規則で作り直す。`phase-page-ui-unification` の方針に最初から合わせられる |

**全体: M（1週間前後）/ Medium。** 最大のリスクは「Functions 改修の本番デプロイ検証」と「下流フィルタ置換の網羅」。

## 7. 設計フェーズへの推奨

1. **BE 連鎖は討論・編集と同型の Cloud Tasks（Option C）。** ただし §5-1（上流2段を onCall のまま残すか、全段タスク化するか）を最初に決める。取材のみタスク化でも要件は満たせる可能性があり、実装コストを大きく下げうる
2. **`selected` はペルソナの安定 id をキーに。** 下流フィルタの置換箇所を design.md に列挙し、tasks で1箇所ずつ潰す（網羅性の担保）
3. **フェーズ統合は「正準リスト」を単一の変更起点にする。** FE `PHASE_DEFS` と BE 正準リスト・テストを同時に変え、型エラーが消えるまでを1タスクにまとめる
4. **`phase-page-ui-unification` との順序**: 本仕様を先に完了させる。完了後、あちらの Requirement 5（ペルソナ画面の例外）と取材連鎖の後続 spec 案は破棄し、ペルソナ画面を他の単一対象画面と同じ扱いに統一する
5. **移行なし**を design.md に明記（既存トピック削除前提。互換コードを書かない）
