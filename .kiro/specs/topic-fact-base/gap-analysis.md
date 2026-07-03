# Gap Analysis: topic-fact-base

要件（requirements.md）と既存コードベースの差分分析。設計判断の材料であり、最終決定はしない。

> **前提 spec の状態（更新）**: フェーズ挿入の前提だった `phase-key-migration`（数値→slug 方式リファクタ）は **完了・本番デプロイ済み**。フェーズ識別子は `PhaseSlug`（FE）/`PhaseKey`（BE）に一本化され、順序は `PHASE_DEFS` 配列位置から導出される。旧数値 phase を持つ本番トピックは削除済み（`topics` 件数 0＝slug 前提の空状態）。
> **この更新の含意**: 旧 gap 分析で最大コスト・最大リスクとしていた「フェーズ挿入＋全面リナンバリング＋データ移行」は**解消済み**。本 spec のフェーズ挿入は設計どおり「`PHASE_DEFS` に1行追加」で足り、支配的コストは**消費者への配線**と**取材(R6)・討論(R8)の挙動設計**へ移った。

## Analysis Summary

- **フェーズ挿入は O(1) に低下**。`fact-research` を `PHASE_DEFS` 先頭に追加し、`PhaseSlug`/`PhaseKey` 両ユニオンに値を足すだけ。順序判定（`phaseLogicalState`/`phaseOrder`）・StepNav・layout リダイレクトは配列から自動導出のため**追加配線ほぼ不要**。承認は `nextPhase('fact-research')→'stakeholders'` で自動前進。リナンバリング・データ移行は不要。
- **事実生成そのものは低コスト**。`search/grounding.ts`（`extractSources`/`resolveSourceUrls`）に加え、`pipeline/fact-check/fact-check-runner.ts` が **Google Search Grounding＋出典付き構造化** の完成形テンプレを提供（`getGoogleProvider()` + `PIPELINE_MODELS.factCheckGrounding`）。事実リサーチはこれを流用できる。
- **消費者配線は半分済み**。取材（`interview-agent`）・章立て（`chapter-agent`/`chapter-generator`）は既に `TopicContext` を受領。**ステークホルダー抽出**（`generateStakeholders(title)`）・**ペルソナ生成**（`generatePersonas(title, stakeholders, topicId)`）・**討論**（persona/facilitator は topicContext 未使用）は新規配線が必要。
- **事実/信念の分離（R3/R9）は型で担保**。`TopicContext` は現在 `{ description?, sourceContents? }`。専用フィールド `factBase` を足し、全消費者へ通す。`sourceContents`（ユーザー提供資料）に混ぜるのは分離原則違反。
- **R2「必須だが実行任意（空承認）」は既存 PhasePanel から逸脱**。承認ボタン（`approveLabel`+`onApprove`）は `logicalState === 'generated'` のときだけ描画される。`not_started` から「実行せず承認＝空確定」へ進む導線が無く、ここだけ新規 UX が要る。

## Requirement → Asset Map

| 要件 | 既存資産 | ギャップ | タグ |
|---|---|---|---|
| R1 事実基盤生成（grounding/出典/日付基準） | `pipeline/fact-check/fact-check-runner.ts`(getGoogleProvider+grounding+出典構造化), `search/grounding.ts`(extractSources/resolveSourceUrls), `interview-agent.ts:127 verifyWithGrounding`, `constants/ai.constants.ts PIPELINE_MODELS`, `llm/models.ts` | 事実リサーチ用エージェント関数＋モデル定義（`PIPELINE_MODELS.factResearch`）を新規作成 | Missing（流用可） |
| R2 独立ユーザー承認フェーズ（必須・実行任意） | `phase.constants.ts PHASE_DEFS`(slug化済), `phase.ts nextPhase/phaseOrder`, `PhasePanel.svelte`, `confirmPhaseGenerated`(slug) | `PHASE_DEFS` 先頭に1行＋両ユニオンに `fact-research`。**空承認 UX**（not_started からの承認導線）を追加 | Small（挿入）＋ Missing（空承認UX） |
| R3 永続化（sourceContentsと分離・日付・出典・状態） | サブコレクション doc パターン（`stakeholders/0`, `chapterAnalysis/0`）, `source-contents.ts` | `topics/{id}/factBase/0` doc を新設（`facts`＋`generatedAt`＋出典）。永続型は `*ForFirestore` 命名 | Missing |
| R4 ステークホルダー参照 | `agents/stakeholder-agent.ts:20 generateStakeholders(title)`, `api/stakeholders.ts` | シグネチャに `topicContext?` 追加＋プロンプト埋込 | Missing（配線） |
| R5 ペルソナ生成参照 | `agents/persona-generator-agent.ts:28 generatePersonas(title, stakeholders, topicId)`, `api/personas.ts` | 同上（topicContext 追加） | Missing（配線） |
| R6 取材が共有基盤を参照（各自検索の置換） | `interview-agent.ts` 3フェーズ（topicContext 受領済）, `verifyWithGrounding` | テーマ事実収集を `verifyWithGrounding` から外し信念反証へ純化。事実基盤を Phase1/3 に注入。関連事実を薄めず反映 | Modify（挙動変更） |
| R7 章立て参照 | `chapter-generator.ts buildTopicContext`, `chapter-agent.ts:13 buildTopicContextSection` | `TopicContext.factBase` を渡すだけ（配線済） | Small |
| R8 討論で共通前提化・件数ノルマなし | `debate-orchestrator.ts`(topic取得済), `step.ts`, `persona-agent.ts`(topicContext未使用), `facilitator-agent.ts` | turn 生成に事実基盤を通し、persona/facilitator へ「共通前提」として注入。関与濃淡はプロフィール依存・件数ノルマなし | Missing（挙動設計） |
| R9 事実/信念の分離の一貫性 | `TopicContext`, `persona.beliefs`, `interview.*` | `factBase` を信念とは別データとして型・保存・プロンプトで区別 | Design原則 |

## 主要な設計判断（Options）

### 判断1: フェーズのモデリング — **解決済み（phase-key-migration で確定）**

旧分析の Option D（一意キー slug 方式）が既に land 済み。現状 `PhaseSlug = 'stakeholders' | 'personas' | 'interviews' | 'chapters' | 'debate' | 'editing'`、順序は `PHASE_DEFS` 配列位置が真実、`phaseLogicalState` はインデックス比較、承認は `nextPhase(currentKey)` 前進、Firestore は `phase: PhaseSlug`、BE は `confirmPhaseGenerated(topicId, '<slug>')`・`data.phase === '<slug>'`。したがって本 spec に残る作業は「挿入の実施」のみで、判断ではなく手順:

- **fact-research 挿入の具体手順（設計フェーズで確定）**:
  1. FE `PhaseSlug` と BE `PhaseKey` の両ユニオンに `'fact-research'` を追加。
  2. FE `PHASE_DEFS` の**先頭**に `{ key: 'fact-research', label, statusLabels }` を1行追加（順序＝配列位置なので以降フェーズは自動で1つ後ろへ）。
  3. 新規トピックの初期フェーズを `'stakeholders'`（`topics.svelte.ts:50`）から `'fact-research'` に変更。
  4. 新フェーズ画面 `PhaseFactResearch.svelte`（`const PHASE = 'fact-research'`、承認は `nextPhase(PHASE)` 経由で `stakeholders` へ）とルート `/admin/topics/[topicId]/fact-research` を追加。
  5. BE 生成 API `generateFactResearch` を追加し、完了確定は `confirmPhaseGenerated(topicId, 'fact-research')`。`GeneratePhase`（BE の生成確定部分集合）に `'fact-research'` を追加。
  6. **StepNav / layout リダイレクト / `phaseOrder` 比較は変更不要**（すべて `PHASE_DEFS` から自動導出）＝ slug 化の投資回収ポイント。
- **移行・リナンバリングは不要**（`phase-key-migration` で完了、本番 topics は空）。
- **自己チェックテストの意図的失敗に注意**: `phase-key-migration` で追加した正準リスト self-check（`src/tests/models/phase/phase.test.ts` の `CANONICAL_PHASE_KEYS`／ラベル・スナップショット、`functions/src/tests/types/phase-key.test.ts` の `PhaseKey`/`GeneratePhase` 網羅）は、`fact-research` 追加で**意図的に落ちる**（＝ドリフト検出が機能）。本 spec のタスクでこれら正準リストとスナップショットを更新する。

### 判断2: 事実基盤の下流への通し方

- **推奨: `TopicContext` に専用フィールド `factBase` 追加**（構造化事実＋出典、または整形済みテキスト）。全消費者は `TopicContext` 経由で受領し、プロンプトで「確定した客観的事実（共通前提）」として `sourceContents`（参考資料）と明確に区別してラベリング。R3/R9 の分離を型で担保。FE/BE 双方の `TopicContext`（`src/lib/models/topic/topic.types.ts:16`／`functions/src/types/topic.types.ts:9`）を対称に拡張。
- 却下: `sourceContents` に事実文を混ぜる（分離原則違反・出典/日付が曖昧化）。

### 判断3: 事実基盤の保存先

- **推奨: サブコレクション doc `topics/{topicId}/factBase/0`**（`stakeholders/0`・`chapterAnalysis/0` と同パターン）。`facts`（各事実＋出典）、`generatedAt`（日付基準）、`status`（generated/approved）を保持。命名は Firestore 永続型に合わせ `*ForFirestore`。
- 代替: topic doc のフィールド。小さければ可だが、出典配列を含むと肥大化しがち。

### 判断4: R2「実行せず承認（空確定）」の UX（新規・要設計）

- `PhasePanel` は `generated` でのみ承認ボタンを出す。事実リサーチは「実行任意」なので `not_started` からの承認（空 factBase を confirmed 扱い）が要る。
- **候補a: PhasePanel 拡張**（`not_started` 時に「実行せず承認」ボタンを条件付き表示）。均一パターンに小さな分岐が入る。
- **候補b: 事実リサーチ専用パネル**（PhaseFactResearch が独自に承認導線を持つ）。他フェーズを汚さないが特例化。
- 空承認時の BE 表現（`status: approved` を factBase 空で確定 or factBase doc 不在＝空とみなす）も設計で確定。

## Effort / Risk（全体・更新）

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| フェーズ挿入（fact-research） | **S** | **Low** | slug 化済みで「配列1行＋ユニオン1値＋画面/ルート」。ナビ・順序は自動導出、移行不要 |
| 事実リサーチ生成（API＋エージェント） | S–M | Low | fact-check-runner/grounding パターン流用 |
| 永続化（factBase doc＋型） | S | Low | 既存サブコレクション doc パターン |
| 消費者配線（stakeholder/persona/chapter） | S–M | Low | topicContext 拡張のみ（chapter は配線済） |
| 取材の挙動変更（R6） | M | Medium | 事実収集の責務移管・空 grounding 時の扱い・関連事実の反映度 |
| 討論への注入（R8） | M | Medium | persona/facilitator へ新規配線＋自然さ（件数ノルマなし）調整 |
| 空承認 UX（R2） | S | Low–Medium | PhasePanel 拡張 or 専用パネルの選択 |
| **合計** | **M（数日〜1週）** | **Low–Medium** | 旧分析の L→M へ低下。支配要因は取材・討論の挙動チューニングのみ |

## Research Needed（設計フェーズへ持ち越し）

1. **事実基盤のデータ形状**: 事実の構造化スキーマ（`claim`＋`sources` のみか、種別/時点/重要度を持つか）。confidence は要件外＝入れない方針でよいか。
2. **取材の belief grounding の必須性**: 現状 `verifyWithGrounding` は groundingChunks 空でエラー扱い（`interview-agent.ts:191`）。テーマ事実収集を外した後、信念反証検索を必須のままにするか、空許容にするか。
3. **討論への配線経路**: `debate-orchestrator`→`step.ts`→`generateTurn` の `TurnGenerationContext` に factBase を通す具体経路と、persona-agent／facilitator プロンプトでの「共通前提」提示・関与濃淡（件数ノルマなし）の指示設計。
4. **事実リサーチ API の実行形態**: `onCall`（source-contents 同様、秒〜十数秒）で足りるか、複数クエリで長引く場合 `onTaskDispatched`（実質 30 分上限）か。timeout 設定。
5. **R2「実行せず承認（空確定）」UX と BE 表現**: PhasePanel 拡張 or 専用パネル。空 factBase の確定表現（status か doc 不在か）。
6. **正準リスト/スナップショット更新の段取り**: `fact-research` 追加で意図的に落ちる FE/BE の self-check・スナップショットテストを、本 spec タスクのどこで更新するか（順序・ラベル文言の確定と同時）。

## Recommendation

- フェーズは **slug 化（判断1）が既に land 済み**。本 spec は「`PHASE_DEFS` 先頭に `fact-research` を1行追加＋両ユニオンに値追加＋画面/ルート/生成API」で挿入でき、ナビ・順序・リダイレクトは自動追随。**リナンバリング・データ移行は不要**。
- 事実基盤は **`TopicContext.factBase` 追加（判断2）＋サブコレクション doc 保存（判断3）** で、事実/信念の分離を型で担保。
- 生成は **fact-check-runner の grounding＋出典構造化パターンを流用**（判断1の R1）。
- 挙動リスクの高い **取材(R6)・討論(R8)** はプロンプト設計を設計フェーズで具体化し、件数ノルマを設けない自然な関与を明文化する。
- **空承認 UX（判断4）** の方式（PhasePanel 拡張 or 専用パネル）を設計で決める。
