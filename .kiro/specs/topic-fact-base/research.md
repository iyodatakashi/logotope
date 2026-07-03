# Research & Design Decisions: topic-fact-base

## Summary
- **Feature**: `topic-fact-base`
- **Discovery Scope**: Extension（既存パイプラインへのフェーズ挿入＋消費者配線）
- **Key Findings**:
  - `phase-key-migration` land 済みにより、フェーズ挿入は「`PHASE_DEFS` 先頭に1行＋`PhaseSlug`/`PhaseKey` に1値」で完結。ナビ・順序・リダイレクトは配列から自動導出。移行不要（本番 topics 0 件）。
  - 事実生成は `fact-check-runner.ts` の2フェーズ grounding（`generateText`＋`google_search` → `extractSources`/`resolveSourceUrls` → `generateObject` で構造化）をそのまま流用できる。
  - `TopicContext`（FE/BE 対称）は現在 `{ description?, sourceContents? }`。`factBase` を足して全消費者へ通すのが分離原則（R3/R9）に最も素直。
  - 消費者のうち **interview だけ topicContext を FE で組み立てて callable に渡す**。他（stakeholders/personas/chapters/debate）は BE 起点。factBase は Firestore が権威のため、BE で組み立てる方式へ寄せる必要がある。

## Research Log

### フェーズ挿入コスト（phase-key-migration 後）
- **Context**: 旧 gap 分析ではフェーズ挿入が最大コスト。migration 完了で前提が変わった。
- **Sources Consulted**: `src/lib/models/phase/phase.constants.ts`, `phase.ts`(`phaseOrder`/`nextPhase`), `src/lib/sharedComponents/StepNav.svelte`, `src/routes/admin/topics/[topicId]/+layout.svelte`, `functions/src/utils/topic-phase.ts`, `functions/src/types/topic.types.ts`（`PhaseKey`）。
- **Findings**:
  - StepNav は `PHASE_DEFS.map(...)`、layout リダイレクトは `phaseOrder` 比較で、配列から自動導出。フェーズ追加で自動追随。
  - 承認前進は `nextPhase(currentKey)`。`fact-research` を先頭に入れると `nextPhase('fact-research')==='stakeholders'`。
  - `phase-key-migration` が正準リスト self-check（FE `phase.test.ts` の `CANONICAL_PHASE_KEYS`／ラベルスナップショット、BE `phase-key.test.ts`）を持つ。`fact-research` 追加で**意図的に失敗**＝ドリフト検出。本 spec タスクで更新する。
- **Implications**: フェーズ挿入は Effort S / Risk Low。

### 事実生成の grounding パターン
- **Context**: R1（現在日付基準・Google Search Grounding・出典付き・構造化）の実装源。
- **Sources Consulted**: `functions/src/pipeline/fact-check/fact-check-runner.ts:186-210`, `functions/src/search/grounding.ts`, `functions/src/llm/models.ts`(`getGoogleProvider`/`getPipelineModel`), `functions/src/constants/ai.constants.ts`(`PIPELINE_MODELS`)。
- **Findings**:
  - 確立パターン: `const google = getGoogleProvider(); const p1 = await generateText({ model: google(PIPELINE_MODELS.<task>), tools: { google_search: google.tools.googleSearch({}) }, messages });` → `p1.providerMetadata['google'].groundingMetadata` → `extractSources(meta, p1.text.slice(0,500))` → `resolveSourceUrls(...)`（リダイレクトURL解決・本文は取らない）→ `generateObject` で構造化。
  - `getGoogleProvider()` は `GEMINI_API_KEY` 未設定時 null（フェイル表現あり）。
- **Implications**: 事実リサーチ用エージェント `runFactResearch(title)` を新規追加し、上記2フェーズを踏襲。モデルは `PIPELINE_MODELS.factResearch` を追加。空 grounding（`groundingChunks` 空）は「事実なし＝空 factBase」に縮退（R1.5/R1.6）。

### TopicContext の配線状況
- **Context**: R4–R8 の消費者が factBase を受け取る経路。
- **Sources Consulted**: `functions/src/types/topic.types.ts:9`(TopicContext), `agents/stakeholder-agent.ts:20`(`generateStakeholders(title)`), `agents/persona-generator-agent.ts:28`(`generatePersonas(title, stakeholders, topicId)`), `agents/chapter-agent.ts:13`(`buildTopicContextSection`), `pipeline/chapters/chapter-generator.ts:9`(`buildTopicContext`), `api/interviews.ts:15`(topicContext を request.data で受領), `agents/interview-agent.ts:48-56`(`runInterview` → `verifyWithGrounding`), `agents/persona-agent.ts:208`(`generateTurn`), `types/turn.types.ts:69`(`TurnGenerationContext`)。
- **Findings**:
  - 配線済み: chapter（`buildTopicContext`→`buildTopicContextSection` で 【】節に整形）。
  - 未配線: stakeholder（`title` のみ）、persona（`title`+stakeholders）、debate（`TurnGenerationContext` に topicContext なし、`persona-agent`/`facilitator-agent` 未使用）。
  - interview は `TopicContext` 受領済みだが **FE 組み立て**（Phase3 `buildTopicContext(topic)` → `personasStore.runInterviews` → callable `runInterview`）。
  - interview の `verifyWithGrounding` は「テーマ事実収集＋信念反証」を兼ねる（R6 で事実収集を外す対象）。
- **Implications**: BE 権威の `getTopicContext(topicId)`（topic doc + factBase/0 を読み `{description, sourceContents, factBase}` を返す）を新設し、全消費者を寄せる。`buildTopicContextSection` に factBase 節を追加。debate は `TurnGenerationContext` に factBase を追加して `generateTurn`/facilitator へ通す。

### 永続化パターン（サブコレクション doc）
- **Context**: R3（factBase を sourceContents と分離して永続、日付・出典・状態）。
- **Sources Consulted**: `api/stakeholders.ts`(`topics/{id}/stakeholders/0` に `.set`), `pipeline/chapters/chapter-generator.ts`(`chapterAnalysis/0` 段階書込), `api/source-contents.ts`, FE `src/lib/stores/chapterAnalysis.svelte.ts`（サブコレクション doc ストア）。
- **Findings**: 単一 doc をサブコレクションに置くパターン（`stakeholders/0`・`chapterAnalysis/0`）が確立。FE も対応するストア（`chapterAnalysisStore` 等）を `currentTopicStore` が集約。
- **Implications**: `topics/{topicId}/factBase/0` に `FactBaseForFirestore { facts, generatedAt }`。FE は `factBase.svelte.ts` ストア（`chapterAnalysis.svelte.ts` を範）＋ `currentTopicStore.factBaseStore`。状態（未実行/生成済/承認済＝R3.4）は phase/phaseStatus で表現（doc 内に status を二重持ちしない）。

### 空承認 UX（R2.5）
- **Context**: 「実行任意・必須フェーズ」。実行せず承認で空確定。
- **Sources Consulted**: `src/lib/sharedComponents/PhasePanel.svelte`（`not_started` は generate ボタンのみ、承認は `generated` のみ）。
- **Findings**: 既存 PhasePanel は `not_started` から承認へ進む導線を持たない。
- **Implications**: PhasePanel に「`not_started` 時の承認（空確定）」を最小プロップで追加するか、事実リサーチ専用の承認導線を画面に持たせる。設計では最小プロップ拡張を推奨（他フェーズは既定 undefined で不変）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| フェーズ挿入=配列1行（採用） | `PHASE_DEFS` 先頭に fact-research、両ユニオンに値 | 追加配線ほぼ不要・移行不要 | 正準 self-check の意図的更新が要る | phase-key-migration の投資回収 |
| BE 権威 TopicContext ビルダー（採用） | `getTopicContext(topicId)` で factBase を Firestore から合成 | 事実の一貫性（R9）を型と経路で担保 | interview の FE 組み立てを BE 寄せに変更 | FE stale を排除 |
| factBase を FE から渡す（不採用） | factBase ストアの値を各 callable に渡す | 既存 interview 経路に同型 | FE stale・R9 不整合リスク | 分離原則に反しない範囲で BE 権威を優先 |
| factBase を topic doc フィールド（不採用寄り） | topic doc に factBase を持つ | 読み取り1回 | 出典配列で肥大化・既存 doc 分割パターンから逸脱 | サブコレクション doc を優先 |

## Design Decisions

### Decision: フェーズ `fact-research` を先頭に挿入（slug 方式で O(1)）
- **Context**: R2（テーマ設定の次・ステークホルダーの前の必須フェーズ）。
- **Alternatives Considered**: 1) 配列先頭に1行（slug）、2) Phase enum 外の独立ゲート。
- **Selected Approach**: `PHASE_DEFS` 先頭に `fact-research`、`PhaseSlug`/`PhaseKey`/`GeneratePhase` に値追加、新規初期フェーズ `fact-research`、画面/ルート/生成API追加。ナビ・順序は自動導出。
- **Rationale**: migration の設計意図どおり最小コスト。特例ゲートを作らず均一パターン維持。
- **Trade-offs**: 正準 self-check/スナップショットの更新が必要（＝ドリフト検出が正しく機能）。
- **Follow-up**: FE `phase.test.ts`・BE `phase-key.test.ts` の正準リストを更新。

### Decision: factBase は BE 権威の `getTopicContext(topicId)` 経由で供給
- **Context**: R4–R9。事実は全ペルソナ共通・一貫（R9.3）。
- **Alternatives Considered**: 1) BE でFirestoreから合成、2) FE が factBase を各 callable に渡す。
- **Selected Approach**: BE に `getTopicContext(topicId)` を新設し `{description, sourceContents, factBase}` を返す。stakeholders/personas/chapters/debate/interview の各生成経路はこれを使う（interview は callable 内で server-side に factBase をマージ）。
- **Rationale**: 事実の権威を Firestore に一元化し、FE stale による不整合を排除。
- **Trade-offs**: interview の context 組み立てを FE→BE に寄せる小改修。過度な共通化は避け、単なるデータ読み込みヘルパーに留める（中央ディスパッチャ化しない）。
- **Follow-up**: `buildTopicContextSection` に「確定した客観的事実（共通前提）」節を追加。

### Decision: 事実リサーチ API は onCall（300s）
- **Context**: R1 の生成は grounding＋構造化の2〜数リクエスト。
- **Alternatives Considered**: 1) onCall、2) onTaskDispatched。
- **Selected Approach**: `generateFactResearch` を `onCall({ timeoutSeconds: 300, secrets })` で実装（stakeholders/personas と同型）。完了確定は `confirmPhaseGenerated(topicId, 'fact-research')`。
- **Rationale**: fact-check phase1/2 と同等の秒〜十数秒。長時間タスク基盤は不要。
- **Trade-offs**: 極端に多クエリ化した場合の余地は将来対応。

### Decision: 空承認（実行せず承認）を PhasePanel 最小拡張で
- **Context**: R2.5（実行任意）。
- **Selected Approach**: PhasePanel に `not_started` 時の承認アクション（任意プロップ）を追加。fact-research のみ利用し、他フェーズは undefined で不変。空承認時は factBase を空（facts: []）で確定し `nextPhase` 前進。
- **Rationale**: 均一パターンを保ちつつ特例を最小化。
- **Trade-offs**: PhasePanel に1分岐増。専用パネル新設よりは共有度が高い。

## Risks & Mitigations
- **取材(R6)の挙動退行** — テーマ事実収集を外すと belief grounding が空になり得る。空 grounding を許容（エラーにしない）に緩め、信念反証は可能な範囲で実施。段階導入し取材記録の質を目視確認。
- **討論(R8)の不自然化** — 事実の羅列・暗唱化。件数ノルマを課さず「共通前提」提示に留め、関与濃淡をプロフィール依存に。プロンプトで知ったかぶり禁止方針と両立を明記。
- **正準 self-check の一時失敗** — fact-research 追加で self-check/スナップショットが落ちる。タスク順序で「フェーズ定義更新→テスト正準リスト更新」を同一タスクに束ねる。
- **factBase の FE/BE 型ドリフト** — `TopicContext.factBase` を FE/BE 対称に定義し、永続型は `*ForFirestore`。

## References
- 既存 grounding 実装: `functions/src/pipeline/fact-check/fact-check-runner.ts`, `functions/src/search/grounding.ts`
- フェーズ基盤: `functions/src/utils/topic-phase.ts`, `src/lib/models/phase/*`
- 消費者: `functions/src/agents/{stakeholder-agent,persona-generator-agent,interview-agent,persona-agent,chapter-agent}.ts`, `functions/src/pipeline/{chapters,debate}/*`
