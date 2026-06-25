# Gap Analysis: chapter-fact-check

## 分析サマリー

- **ファクトチェックの中核処理（検索グラウンディングによる事実検証）は既存実装がほぼそのまま使える**。取材パイプラインの [interview-agent.ts](../../../functions/src/agents/interview-agent.ts) の `verifyWithGrounding` / `extractSources` / `resolveSourceUrls` が、反証起点でWeb検証し出典付き結果を返すという、本機能と同型の処理を既に実装済み（Gemini Google検索グラウンディング、`gemini-2.5-pro`）。
- **主な欠落は「起動の配線」「データモデル」「管理画面表示」の3つ**。検証ロジックそのものより、章完了→ファクトチェック起動の連携と、編集工程が読める形の指摘データ構造の設計が要点。
- **起動は手動（章ごとの実行ボタン）。既存の管理操作パターンにそのまま乗る**。フロントの実行ボタン → `httpsCallable` → 専用 `onCall` 関数、という形は [interviews.ts](../../../functions/src/api/interviews.ts#L9) `runInterview`（`onCall`, `timeoutSeconds: 300`, grounding 実行）と完全に同型。パイプライン（`runStep` / Cloud Tasks）からの自動起動は不要になった。
- **再生成時の無効化は既存フックを拡張できる**。[debate-lifecycle.ts](../../../functions/src/pipeline/debate/debate-lifecycle.ts#L33) `restartDebateFromChapter` → [chapter.ts](../../../functions/src/pipeline/debate/chapter.ts#L114) `discardChaptersFrom` が章リセット時に beliefs/engagements/comments を破棄しており、同じ場所にファクトチェック結果の破棄を追加すれば Req 6.2 を満たせる（再実行はせず無効化のみ＝手動再実行に委ねる）。
- **表示は管理画面の既存パターンに乗せられる**。[Phase5Debate.svelte](../../../src/lib/features/admin/debate/Phase5Debate.svelte) が章・発言をバッジ付きで描画。AIサブ結果の永続＋表示の前例として persona の `interview` 埋め込み＋ [Phase3Interviews.svelte](../../../src/lib/features/admin/research/Phase3Interviews.svelte)（マークダウン節＋出典）がある。

## Requirement → Asset マップ

| 要件 | 既存資産 | 状態 |
|---|---|---|
| Req1 手動実行（完了章にボタン・押下で実行・章単位・実行中は重複防止・旧結果削除して再実行） | 管理操作の `onCall` 前例（`runInterview`・`generateChapters`・`startDebate`）／FEは `src/lib/api/*` の `httpsCallable`。完了判定は章 docの `status === 'completed'` | **Missing**: ファクトチェック専用の `onCall` 関数とFE実行ボタン／実行中状態の制御 |
| Req2 事実主張の抽出（ペルソナ＋ファシリテーター） | 章ターンは `topics/{topicId}/chapters/{id}.turns` に埋め込み（[chapter.ts](../../../functions/src/pipeline/debate/chapter.ts#L13)）。`speakerType: 'persona'\|'facilitator'`・`speechMode: 'opinion'\|'fact'\|'question'`（[turn.types.ts](../../../functions/src/types/turn.types.ts)） | **Missing**: 主張抽出ロジック。両 speakerType を対象にできる（データ上の制約なし） |
| Req3 検証と指摘（誤り箇所・正しい事実・理由・出典、編集工程が参照可能、検証不能フォールバック） | `verifyWithGrounding`＋`extractSources`＋`resolveSourceUrls`（interview-agent.ts）。`SearchSource` 型。検索無効時フォールバックの前例あり（[search-service.ts](../../../functions/src/search/search-service.ts) `isSearchAvailable`） | **Reuse/Missing**: グラウンディング検証は再利用可。ただし**構造化された機械可読の指摘**（マークダウンレポートではなく）への出力変換が未実装＝Research Needed |
| Req4 永続化（指摘・出典・対象発言/箇所参照・進捗status） | persona `interview` 埋め込み（`status: queued\|in_progress\|completed\|error`）／章単位シングルトン `chapterAnalysis/0`／サブコレクション `chapters/{id}/engagements` の3前例 | **Missing**: ファクトチェック用スキーマと保存先（埋め込み vs サブコレクション）未決 |
| Req5 管理画面表示（指摘詳細・処理中/失敗表示） | Phase5Debate.svelte（発言バッジ）／Phase3Interviews.svelte（節＋出典）／stores（onSnapshot）／types は `src/lib/models/{domain}/`、`*ForFirestore` 命名 | **Missing**: ファクトチェック用 store・コンポーネント・FE型 |
| Req6 エラー/再生成追従（failed記録・本体非干渉・再生成で無効化／再実行は手動） | `discardChaptersFrom`（章リセット）／`restartDebateFromChapter` | **Constraint/Missing**: 破棄フックは存在。ファクトチェックの failed 状態は討論本体の phaseStatus とは独立に持つ必要。再生成時は無効化のみ（自動再走しない） |

## 既存の検索/グラウンディング選択肢（このコードベース内）

3方式が実装済み。design で1つに確定する。

- **Gemini Google検索グラウンディング**（interview-agent.ts、検証用途）— 出典が `groundingMetadata.groundingChunks` で構造化され、検証フローの実績あり。**本機能に最も近い前例**。
- Anthropic `web_search` ツール（[persona-agent.ts](../../../functions/src/agents/persona-agent.ts#L192)、討論ターン）— 動くが検証用途の実績なし、出典↔判定の構造化は自前。
- Tavily（search-service.ts）— 生テキストを別LLMに渡す2段構成、claim↔出典の対応を自前再構築。

## 実装アプローチ

手動ボタンに変更したことで、**起動経路は「FE実行ボタン → `httpsCallable` → 専用 `onCall` 関数」で確定**（Firestore トリガもパイプライン投入も不要）。残る設計上の選択は「実行を同期 `onCall` 内で完結させるか、`onCall` がタスクへ委譲する非同期にするか」の実行サーフェスのみ。いずれの案でも実行本体は新規 `functions/src/pipeline/fact-check/` モジュールに置き、interview-agent のグラウンディング処理を流用する。

### Option A（推奨）: 同期 `onCall`（runInterview と同型）
`runFactCheck(topicId, chapterId)` を `onCall`（`timeoutSeconds` を長めに）で実装し、グラウンディング検証→結果書き込みまでを同期実行。実行中の進捗（pending/running/completed/failed）は章/結果ドキュメントに書き、FEは `onSnapshot` で反映。
- ✅ `runInterview`（onCall・grounding・300s）と実装パターンが一致、最小の新規要素
- ✅ トリガの冪等性・多重発火を気にしなくてよい（押下＝1実行、実行中はボタン無効化＝Req1.4）
- ✅ 起動点が明示的（画面を見れば何が起きるか分かる＝structure.md 方針）
- ❌ 章内の主張数が多いと onCall タイムアウトに当たる可能性（要負荷見積もり）

### Option B: `onCall` がタスク投入（非同期）
`onCall` は 'running' を立てて `runFactCheck` タスク（onTaskDispatched）を enqueue し即時返却。実行は別タスクで、FEは `onSnapshot` で完了を待つ。
- ✅ タイムアウト圧力がない（長時間の章でも安全）。討論パイプラインの進捗UXと揃う
- ✅ Cloud Tasks のリトライ（runStep と同様）を活用できる
- ❌ 2段構成で部品が増える。状態管理（running/failed）の設計がやや重い

### 不採用: Firestore `onDocumentUpdated` トリガ
当初案（自動実行）では章 docの status→completed を契機にトリガする案があったが、**手動ボタンに変更したため不要**。トリガにすると「ボタン押下」という明示操作と二重の起動経路になり、再生成での status 往復による誤発火も招く。手動実行では採用しない。

## 工数・リスク

- **Effort: M（3〜7日）** — 検証ロジックは流用可だが、(1) 機械可読な指摘への出力構造化、(2) `onCall` 実行関数＋FE実行ボタン＋再生成での無効化フック、(3) FE型＋store＋管理画面コンポーネント、(4) functions型/永続スキーマ、と縦断的に新規要素がある。手動化により起動トリガの不確実性は下がった。
- **Risk: Medium** — グラウンディングと構造化出力の両立可否、指摘の「該当箇所」表現、章あたりの実行時間（onCall タイムアウト）が未確定。いずれも既存パターンの延長で解決見込みだが裏取りが必要。

## Research Needed（design へ持ち越し）

1. **グラウンディング × 構造化出力の両立**: Vercel AI SDK で `google.tools.googleSearch` と `generateObject`（response schema）を同時に使えるか。両立不可なら「グラウンディングで検証→別呼び出しで構造化」の2段、またはマークダウン＋パースのいずれか。interview-agent は現状マークダウンレポート＋集約1件の `SearchSource` を返す点に注意。
2. **指摘の粒度と「該当箇所」表現**: 発言内の主張位置を char offset で持つか、引用テキストで持つか。編集工程が参照しやすい形（引用テキスト＋turnId）を軸に検討。
3. **永続化先**: 章ドキュメント埋め込み（turns と同居、1MB上限に注意）か、サブコレクション `chapters/{id}/factCheckFindings`（engagements の前例あり）か。進捗 status の持ち方も含めて決定。
4. **実行サーフェスの決定**: Option A（同期 `onCall`）か Option B（`onCall`→タスク非同期）か。判断材料は「章あたりの主張数と検証時間が onCall タイムアウトに収まるか」。`runInterview` の実測（300s で grounding 完了）を基準に見積もる。
5. **グラウンディングヘルパーの扱い**: `extractSources` / `resolveSourceUrls` を共通ユーティリティとして抽出するか、no-over-abstraction 方針に従い複製するか（真に共通な処理に限り抽出可）。
6. **使用モデル定数**: `PIPELINE_MODELS`（[ai.constants.ts](../../../functions/src/constants/ai.constants.ts#L6)）に `factCheck` を追加する想定。`getPipelineModel` の switch 分岐拡張要否を確認。

## design への推奨

- **推奨アプローチ: Option A**（同期 `onCall` `runFactCheck`、runInterview と同型）。負荷見積もりでタイムアウト懸念があれば Option B（非同期タスク）へ。
- **起動: FE実行ボタン → `httpsCallable` → `onCall`**。Firestore トリガ／パイプライン自動起動は採用しない。
- **検証基盤: Gemini グラウンディング（`gemini-2.5-pro`）**、interview-agent の検証パターンを踏襲。
- **主要決定事項**: (a) 指摘スキーマ（編集工程が消費する機械可読形）、(b) 永続化先、(c) 実行サーフェス（同期/非同期）、(d) 構造化出力の実現方式 — の4点を design で確定する。
