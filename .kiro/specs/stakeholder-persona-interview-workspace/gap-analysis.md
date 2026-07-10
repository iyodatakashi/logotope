# 実装ギャップ分析: stakeholder-persona-interview-workspace

## 1. 現状調査（Current State）

### 対象ドメインの主要資産

| 層 | ファイル | 役割 |
| --- | --- | --- |
| ルート | `src/routes/admin/topics/[topicId]/{stakeholders,personas,interviews}/+page.svelte` | 各フェーズ画面の薄いラッパー（feature コンポーネントを描画するのみ） |
| ルートレイアウト | `src/routes/admin/topics/[topicId]/+layout.svelte` | `StepNav` 表示・`currentTopicStore.start()`・**未到達フェーズへのアクセスを現在フェーズへリダイレクト** |
| feature 画面 | `.../topic-detail/stakeholders/GenerateStakeholdersPage.svelte` 他2つ | `PhasePanel` を使い、生成 / 再生成 / 承認ボタンと結果リストを描画 |
| 表示部品 | `StakeholderItem.svelte` / `PersonaItem.svelte` / `InterviewItem.svelte` | 各アイテム1件の表示 |
| 共有部品 | `sharedComponents/PhasePanel.svelte` / `StepNav.svelte` | フェーズUIの骨組み（`logicalState` で表示分岐）・タブナビ |
| フェーズモデル | `models/phase/phase.ts` / `phase.constants.ts`（`PHASE_DEFS`） | フェーズ進行順・`phaseLogicalState` 導出・`nextPhase`/`phasePath` |
| ドメインモデル | `models/topic/createTopic.svelte.ts` | `generateStakeholders` / `generatePersonas` / `resetStakeholders` / `resetPersonas` 等 |
| ストア | `stores/stakeholders.svelte.ts` / `stores/personas.svelte.ts` | `topics/{id}/stakeholders/0`・`topics/{id}/personas/*` の onSnapshot、`runInterviews`/`approvePersonas`/`resetPersonas` |
| バックエンド | `functions/src/api/personas.ts` / `agents/persona-generator-agent.ts` | 全ステークホルダーを読み、**立場ごとに1体ずつ**ペルソナ生成（`.length(count)`, `sortOrder=i`） |

### 支配的なアーキテクチャ／規約

- **フェーズは線形・承認ゲート型**。トピックの `phase` / `phaseStatus` が唯一の真実で、`phaseLogicalState(target)` が「approved / running / generated / …」を導出する。各画面は自フェーズ slug 固定で `PhasePanel` に状態を渡す。
- **サーバ権威**：生成完了（`phaseStatus='generated'`）とペルソナ文書の永続化はサーバが確定。FE は running を書いて楽観表示し、onSnapshot で反映する。
- **再生成は「自フェーズ＋下流」を各画面が合成**して reset→generate を呼ぶ（例: personas 再生成は `resetPersonas→resetChapters→resetDebate→resetEditing→generatePersonas`）。
- ステークホルダーの `id` は**配列インデックス（`String(i)`）**。採用フラグ等の永続項目は持たない。
- ペルソナは**立場ごとに1体**。由来ステークホルダーとの紐づけは `stakeholderRole`（総称文字列）**のみ**で、安定した ID／インデックス参照は持たない。生成は入力配列順＝`sortOrder` 順で並ぶ。

## 2. 要件と資産の対応マップ（Requirement-to-Asset Map）

| 要件 | 既存資産 | ギャップ | タグ |
| --- | --- | --- | --- |
| R1 行単位の左右セット・縦並び | `StakeholderItem`/`PersonaItem`（表示は再利用可）。`PhasePanel` は縦1列前提 | 行＝`[ステークホルダー｜対応ペルソナ]` の新レイアウト部品が無い | **Missing** |
| R1-3 / R4-3 由来対応づけ | ペルソナは `stakeholderRole` のみ保持 | ステークホルダー↔ペルソナの**安定した対応キー**が無い（順序整合はサブセット生成で崩れる） | **Constraint / Missing** |
| R2 ステークホルダー生成 | `generateStakeholders`・`stakeholdersStore`・`resetStakeholders` | ほぼ再利用可。行レイアウトへの接続のみ | 小 |
| R3 採用チェックボックス（既定ON） | 該当なし | 採用選択の状態管理・UI・既定ON が無い | **Missing** |
| R3-4 / R6-1,2 実行ガード | `PhasePanel` のボタン活性は `logicalState` 依存 | 「採用0件で生成不可」「未生成で次操作不可」の明示ガードが無い | **Missing** |
| R4-1,2 選択的ペルソナ生成 | `generatePersonas`（onCall）→ `persona-generator-agent`（配列を反復） | API/エージェントが**全ステークホルダー固定**。サブセット指定の入口が無い | **Missing** |
| R4-6 選択変更→再生成＋下流破棄 | `resetPersonas`/`resetChapters`/… の合成パターン | パターン流用可。選択反映が追加要件 | 小〜中 |
| R5 取材実行・進捗・部分再実行 | `personasStore.runInterviews`/`runInterview`・`InterviewItem`・進捗集計（GenerateInterviewsPage 内） | ほぼ再利用可。統合画面へ移設 | 小 |
| R6-3 取材後に章立てへ前進 | `approveInterviews`→`advancePhase` | 統合画面からの前進導線が必要 | 中 |
| R6-4,5 / R1-5 状態表示のフェーズ整合 | `phaseLogicalState`・`StepNav`・レイアウトのリダイレクト | **3フェーズを1画面に集約**する際のフェーズモデル整合が最大の論点 | **Constraint** |
| R7 既存3画面の置き換え・データ互換 | 既存ルート3つ・`PHASE_DEFS` | ルート再編と StepNav/リダイレクトの整合。既存データは互換（構造は据え置ける） | **Constraint** |

## 3. 中核的な設計論点（2つ）

### 論点A: フェーズモデルと1画面集約の整合
現状は `stakeholders / personas / interviews` が**3つの独立フェーズ**（各承認・各ルート・StepNav の3タブ・レイアウトの未到達リダイレクト）。1画面集約は必ずこのモデルに触れる。

- **A-1 3フェーズ据え置き＋1画面を3ルートで共有**：`PHASE_DEFS` は変えず、3つの `+page.svelte` が同じ統合コンポーネントを描画。承認/前進は画面内で内部的に進める。StepNav は3タブのまま。
  - ✅ フェーズモデル・下流（章立て以降）・既存データ無変更で影響最小　❌ 「1画面なのに内部で3フェーズ遷移」が残り、StepNav 3タブと画面の一体感が乖離。リダイレクト条件との噛み合わせが複雑。
- **A-2 3フェーズを1フェーズへ畳む**：`PHASE_DEFS` の3つを `personas`（または新 slug）1つに統合し、StepNav も1タブ化。統合画面は1ルート。
  - ✅ 「1画面＝1フェーズ」で概念が一致、StepNav も素直　❌ `PHASE_DEFS` は BE の `PhaseKey` と値・順序を一致させる契約。**FE/BE 両方**の phase 値・遷移・承認関数（`approveStakeholders`/`approvePersonas`/`approveInterviews`）とダッシュボードのバッジ導出に広く波及。移行時の既存トピック（途中フェーズ）の値マッピングが要検討。

### 論点B: ステークホルダー↔ペルソナの対応キー
行レイアウト（R1-3）と選択的生成（R4）には、サブセット生成後も崩れない安定した対応が要る。現状は `stakeholderRole` 文字列のみ。

- **B-1 生成時にペルソナへ由来ステークホルダー識別子を持たせる**（例: `stakeholderIndex` か安定 id）。`generatePersonas`（onCall）で選択インデックス配列を受け、`persona-generator-agent` の出力へ紐づけて永続化。
  - ✅ 行の対応が確実、サブセット・再生成でも安定　❌ `PersonaForFirestore` に項目追加（永続型の変更）。BE の API・エージェント・型に波及。
- **B-2 `stakeholderRole` 文字列で突き合わせ**：追加永続なし。役割名で join。
  - ✅ データ変更なし　❌ 役割名の重複・表記揺れで対応が壊れうる。堅牢性が低い（B-1 推奨）。

## 4. 実装アプローチ（A/B/C）

### Option A: 既存フェーズ画面を拡張
3つの feature 画面を1つに寄せず、各 `PhasePanel` を横並びに置く程度の最小変更。
- ✅ 変更最小　❌ R1 の「行単位の左右セット」は `PhasePanel`（縦1列前提）では表現できず、要件の中核を満たせない。**非推奨**。

### Option B: 統合ワークスペースを新規コンポーネントとして作る（推奨の骨格）
`topic-detail/` に新 feature（例: `workspace/PersonaWorkspacePage.svelte` ＋ 行部品 `StakeholderPersonaRow.svelte`）を新設。表示は `StakeholderItem`/`PersonaItem`/`InterviewItem` を**再利用**し、生成・取材はモデル/ストアの既存メソッドを叩く。採用選択はクライアント状態で保持。
- ✅ 行レイアウト・採用選択という新責務をクリーンに分離。既存表示部品と生成ロジックを再利用　❌ 3操作の状態機械（どのボタンを活性化するか）を画面に自前で持つ必要（`PhasePanel` の恩恵を一部手放す）。ステアリング方針「画面の処理は画面に直接書く／過度な共通化をしない」と整合。

### Option C: ハイブリッド（推奨）
- **UI**：Option B（新規ワークスペース＋行部品）。
- **対応キー**：論点B-1（ペルソナへ由来ステークホルダー識別子を付与）。
- **選択的生成**：`generatePersonas` onCall とエージェントに「選択ステークホルダー配列」を渡す入口を追加（既存の全件経路は選択＝全件で吸収）。
- **フェーズ整合**：論点A-1（据え置き）で初期実装 → 必要なら A-2（畳み込み）を別段階。段階導入で BE 波及リスクを制御。
- ✅ 要件を満たしつつ影響範囲を段階化　❌ 計画とインターフェース設計をやや要する。

## 5. 工数・リスク

| 対象 | 工数 | リスク | 根拠 |
| --- | --- | --- | --- |
| 統合ワークスペースUI・行レイアウト（R1,R2,R5 表示） | M | Low | 既存表示部品・ストアを再利用。新規は行部品と状態機械 |
| 採用選択（R3, 既定ON, ガード） | S | Low | クライアント状態のみで完結見込み |
| 選択的ペルソナ生成＋対応キー（R4, 論点B-1） | M | Medium | `PersonaForFirestore`・onCall・エージェントの型/引数変更が BE に波及 |
| フェーズモデル整合（R6,R7, 論点A） | M〜L | Medium〜High | A-1 なら Medium。A-2（畳み込み）を選ぶと FE/BE 両側の phase 値・StepNav・承認・ダッシュボードに広く波及し High |
| **全体** | **M〜L** | **Medium** | UI は堅い。リスクの主因はフェーズモデルと BE 契約変更の選択 |

## 6. 設計フェーズへの申し送り

### 推奨アプローチ
Option C。UI は新規ワークスペース（Option B）、対応キーは B-1、フェーズ整合は A-1（据え置き）から着手し、A-2 は分離検討。

### 決めるべき主要事項
1. **フェーズモデル**：【決定済み】A-1（3フェーズ据え置き）を採用。ただし**明示的な approve 操作は廃止**し、承認（次フェーズへの前進）を次操作に暗黙的に畳み込む方針とする（ペルソナ生成→ステークホルダー承認、取材→ペルソナ承認、章立てへ進む→取材承認）。残課題は、統合画面を単一ルートに集約するか既存3ルートで同一画面を共有するか（下記5と連動）と、`generatePersonas`/`runInterviews` に承認（`advancePhase`）を前置きする際の順序・冪等性の詰め。
2. **対応キーの持ち方**：`PersonaForFirestore` に由来ステークホルダー識別子を追加するか（B-1）、`stakeholderRole` join で済ませるか（B-2）。永続型変更の可否が分岐点。
3. **採用選択の永続性**：クライアント一時状態で十分か、リロード跨ぎで保持が要るか（要る場合は永続先の設計）。
4. **選択変更×再生成の下流破棄範囲**：既存 `resetPersonas→…→resetEditing` 合成の踏襲でよいか。
5. **統合後のルーティング**：単一 slug に集約するか、既存3 slug を残して同一画面を描画するか（R7 の「置き換え」の実体）。

### Research Needed（設計で確認）
- `PHASE_DEFS` を変更した場合の BE `PhaseKey`（`functions/src/types` 等）との同期範囲と、ダッシュボードのバッジ導出（`phaseDisplayLabel`）への影響の全量。
- 選択ステークホルダーを部分指定してペルソナ生成する際、`persona-generator-agent` のプロンプト（立場リスト番号・`.length(count)`）が選択件数で破綻しないかの確認。
- 既存の途中フェーズトピックを統合画面へ移行する際の互換（フェーズ値・データ）検証。
