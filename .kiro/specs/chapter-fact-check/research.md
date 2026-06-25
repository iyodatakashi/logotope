# Research & Design Decisions: chapter-fact-check

## Summary
- **Feature**: `chapter-fact-check`
- **Discovery Scope**: Extension（既存の討論パイプライン・取材グラウンディング・管理画面への追加）
- **Key Findings**:
  - 検証の中核は取材パイプラインの `interview-agent.ts` の grounding 検証と同型で、グラウンディング処理・出典抽出ヘルパー（`extractSources` / `resolveSourceUrls`）を再利用できる。
  - **`@ai-sdk/google` は Google検索グラウンディングと構造化出力（`generateObject`）を単一呼び出しで併用できない**（vercel/ai #11599）。ネイティブ Gemini 3+ API は併用可だが Vercel AI SDK 経由では未対応。→ **2段構成**（Phase1: grounding で検証テキスト生成 → Phase2: 構造化）で実装する。
  - 起動は手動ボタン → `httpsCallable` → `onCall`。`runInterview`（onCall, grounding, `timeoutSeconds: 300`, FE timeout 310000）が完全に同型の前例。

## Research Log

### Gemini グラウンディング × 構造化出力の併用可否（Vercel AI SDK）
- **Context**: Req3 は「機械可読な指摘」を要求。検証（grounding）と構造化（schema）を1呼び出しで実現できるか確認が必要。
- **Sources Consulted**:
  - [Support Google Search Grounding with Structured Outputs - vercel/ai #11599](https://github.com/vercel/ai/issues/11599)
  - [Structured output does not work with Grounding - googleapis/python-genai #665](https://github.com/googleapis/python-genai/issues/665)
  - [Improving Structured Outputs in the Gemini API](https://blog.google/technology/developers/gemini-api-structured-outputs/)
  - [Grounding with Google Search | Gemini API](https://ai.google.dev/gemini-api/docs/google-search)
- **Findings**:
  - ネイティブ Gemini 3+ API は grounding と structured outputs の併用をサポート。
  - しかし `@ai-sdk/google`（本プロジェクトが使用）では併用不可。`google_search` ツールと controlled generation は同時指定でエラー。
  - 既存 `interview-agent.ts` も grounding は `generateText`（マークダウン出力）で行い、構造化はしていない。
- **Implications**: ファクトチェックは **Phase1（grounding 検証 / `generateText`）→ Phase2（構造化 / `generateObject`, grounding なし）** の2段で実装。レイテンシ・コストは増えるが、Vercel AI SDK 構成では必須。

### 既存グラウンディング実装の再利用範囲
- **Context**: 検証ロジックをどこまで流用できるか。
- **Sources Consulted**: `functions/src/agents/interview-agent.ts`（`verifyWithGrounding` L127, `extractSources` L219, `resolveSourceUrls` L246）、`functions/src/search/search-service.ts`。
- **Findings**:
  - `extractSources`（groundingMetadata → `SearchSource`）と `resolveSourceUrls`（vertexaisearch リダイレクトURL→実URL、HEADのみで本文非取得＝OOM回避）は本機能でもそのまま必要。
  - `SearchSource` / `SearchResult` 型と `GroundingMetadata` 型は現状 `interview-agent.ts` 内に定義（exportあり）。
- **Implications**: これらは2つ目の消費者（fact-check）が現れる「真に共通な処理」。`functions/src/search/grounding.ts` へ抽出し、型は共通型へ移すのが妥当（後述の決定）。

### 起動・永続・表示の統合点
- **Context**: 手動実行・章単位独立・管理画面表示・再生成追従の配線先を確認。
- **Sources Consulted**: `api/interviews.ts`・`api/debates.ts`、`pipeline/debate/chapter.ts`（`discardChaptersFrom` L114）、`stores/engagements.svelte.ts`・`chapters.svelte.ts`、`features/admin/debate/Phase5Debate.svelte`、`features/admin/research/Phase3Interviews.svelte`、`models/topic/createTopic.svelte.ts`（callable 群 L187-221）、`stores/personas.svelte.ts`（runInterview callable L152）。
- **Findings**:
  - 章は `topics/{topicId}/chapters/{chapterId}` doc（turns 埋め込み、最大 ~300KB）。`status: 'pending'|'running'|'completed'`。
  - 章単位サブコレクションの前例: `chapters/{id}/engagements`（engagements ストアが章ごとに onSnapshot）。章単位シングルトンの前例: `chapterAnalysis/0`。
  - 再生成は `discardChaptersFrom` が turns/進捗/status をリセット（beliefs/engagements/comments も破棄）。
  - FE の onCall 呼び出しは store/model に colocate（`runInterview` は personas ストア、`generateChapters`/`startDebate` は topic モデル）。
- **Implications**: ファクトチェック結果は章 doc を肥大させないよう**別 doc**（`chapters/{id}/factCheck/result`）に保存。再生成無効化は `discardChaptersFrom` に1行追加。FE は engagements 同様の章単位 onSnapshot ストア＋実行ボタンを debate 画面に colocate。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 同期 onCall（採用） | `runFactCheck` onCall 内で grounding→構造化→永続まで完結 | runInterview と同型・最小新規要素・冪等が自明 | 章の主張数次第で onCall タイムアウト懸念 | timeoutSeconds 540 で開始、超過なら B へ |
| B: onCall→Cloud Task | onCall は running を立て task 投入、onSnapshot で完了待ち | タイムアウト無し・リトライ活用 | 2段構成で部品増 | A が破綻した場合の退避先 |
| 不採用: Firestore トリガ | 章 status→completed で自動起動 | — | 手動ボタンと二重起動・再生成での誤発火 | 手動化により不要 |

## Design Decisions

### Decision: 検証は2段（grounding → 構造化）
- **Context**: Req3 の機械可読な指摘を `@ai-sdk/google` で実現。
- **Alternatives Considered**: 1) grounding＋schema 単一呼び出し（SDK未対応で不可）、2) grounding のマークダウンを正規表現パース（壊れやすい）、3) 2段（grounding→generateObject）。
- **Selected Approach**: Phase1 `generateText`＋`googleSearch` で誤り指摘テキスト＋出典を生成 → Phase2 `generateObject`＋Zod schema で `FactCheckFinding[]` に構造化。
- **Rationale**: SDK 制約を満たしつつ、構造の堅牢性をスキーマ検証で担保。Phase1 は interview の検証プロンプト方針（反証起点・本文にURL書かない）を踏襲。
- **Trade-offs**: LLM 2回でレイテンシ・コスト増。許容範囲（手動・章単位）。
- **Follow-up**: 章あたりの実行時間を実測し onCall タイムアウト内か確認。

### Decision: 結果は章配下の別 doc に保存
- **Context**: 章 doc は turns 埋め込みで肥大。1MB 上限と再生成時の分離が必要。
- **Selected Approach**: `topics/{topicId}/chapters/{chapterId}/factCheck/result`（固定id）。`status` と `findings[]` を保持。章 doc には手を入れない。
- **Rationale**: 章ステータスと独立した failed 管理（Req6.1）、章単位独立（Req1.3）、再生成時の単純削除（Req6.2）に適合。engagements の章単位購読パターンを踏襲。
- **Trade-offs**: 章ごとに onSnapshot リスナが増える（既存 engagements と同等で許容）。

### Decision: グラウンディング共通処理を `search/grounding.ts` へ抽出
- **Context**: `extractSources`/`resolveSourceUrls`/`SearchSource` の2つ目の消費者が出現。
- **Selected Approach**: ヘルパーを `functions/src/search/grounding.ts`、型を共通型へ移し、`interview-agent.ts` の import を直接書き換える（re-export しない）。
- **Rationale**: 真に共通な処理の集約（steering の「真に共通な処理はヘルパーに」）。re-export 回避は feedback に準拠。
- **Trade-offs**: interview-agent の import 変更が必要（小さな修正）。抽出を避けるなら複製も可だが2消費者で重複は不利。

## Design Decisions（追補）

### Decision: 検証は発言単位（per-turn）で行う
- **Context**: 章一括だと Phase2（LLM）が `turnId` を出力する必要があり、ハルシネーション（誤った発言参照）のリスクが残る。指摘→発言の紐づけは編集工程の入力契約の核（2.3, 3.5, 4.2）。
- **Alternatives Considered**: 1) 章一括 2段＋runner で turnId 実在照合（照合で弾けるが LLM 依存が残る）、2) 発言単位処理（runner が turnId を固定）。
- **Selected Approach**: 発言を1件ずつ Phase1（grounding）→Phase2（構造化）で処理し、`turnId`/`speakerType` は runner が付与。発言は独立のため同時実行数を制限して並行実行。
- **Rationale**: turnId のハルシネーションが構造的に不可能になり、`claim` 照合も1発言 content に閉じて単純。手動・低頻度のためコスト増は許容。
- **Trade-offs**: LLM 呼び出しが「発言数 × 2」に増える。並行実行で壁時計を抑え、onCall 540s 超過時は Option B（非同期タスク）へ。横断文脈は弱まる。

### Decision: Phase2（構造化）は軽量モデルを使う
- **Context**: Phase2 は grounding 済みの検証テキストを所定の JSON 構造に整えるだけの平易なタスク。かつ発言数ぶん実行されるため、コスト・レイテンシへの寄与が大きい。
- **Selected Approach**: Phase1（grounding 検証）は `gemini-2.5-pro`、Phase2（構造化 `generateObject`）は軽量の `gemini-2.5-flash`。いずれも同一 Google プロバイダで追加シークレット不要。
- **Rationale**: 構造化は推論難度が低くスキーマ検証で品質を担保できるため、軽量モデルで十分。発言数 × 2 呼び出しの総コストを抑えられる。
- **Trade-offs**: Phase2 の自由記述品質はやや劣るが、構造抽出が主目的のため影響は小さい。崩れる場合は Phase2 を pro に引き上げる余地を残す。

## Risks & Mitigations
- onCall タイムアウト（発言数 × 2 呼び出し）— 同時実行数を制限した並行実行で「最遅発言 × ceil(発言数/並行数)」に抑える。timeoutSeconds 540 超過時は Option B（非同期タスク）へ移行。
- 指摘→発言の紐づけ — 発言単位処理で `turnId` は runner 付与（LLM 非依存）。`claim` は当該発言 `content` の部分文字列であることを照合し、不一致は破棄。
- 指摘ごとの出典対応 — title 突合をやめ、Phase2 入力に番号付き解決済み出典を渡して `sourceIndices` で参照、runner が index→`SearchResult` に写像。
- 検索プロバイダ利用不可（Req3.6）— 実行前に可用性を確認し章全体を `completed`（検証不能注記）で終える。「主張単位の出典0件」は `unverifiable` として区別。
- 共通化リファクタの波及 — 抽出は import 直書き換えのみに留め、振る舞いは変えない。

## References
- [vercel/ai #11599 — Google Search Grounding with Structured Outputs](https://github.com/vercel/ai/issues/11599) — SDK で grounding×構造化が併用不可である根拠
- [Gemini API — Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search) — grounding 仕様
- [Gemini API — Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) — 構造化出力仕様
- 既存実装: `functions/src/agents/interview-agent.ts`（grounding 検証パターン）
