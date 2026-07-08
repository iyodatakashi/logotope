# Gap Analysis: per-persona-model-selection

## Analysis Summary

- 本変更は**新規実装ではなく撤去・置換・定数更新**が主体。`llmType` 機構は少数の中核ファイルに集中しており、フロントでは型宣言のみで UI 実利用なし（削除は型を消すだけ）。
- OpenAI 呼び出しは `functions/src/llm/models.ts` の2経路（gpt ペルソナ・`personaGenerator`）のみ。両方を Claude に寄せれば `@ai-sdk/openai` 依存と 8 ファイルの `OPENAI_API_KEY` シークレットを完全撤去できる。
- モデル最新化（`claude-sonnet-4-6`→`claude-sonnet-5`）は `AI_MODELS.SONNET` 定数1箇所の変更で全 Sonnet 利用エージェントに波及する（Opus・Gemini は不変）。
- 最大の不確実性は**実行時のモデル ID 解決**。`@ai-sdk/anthropic@3.0.85` の型 union に `claude-sonnet-5` は未掲載だが `(string & {})` で型は通る。API 側が認識するかはエミュレータ無し方針のため**要デプロイ検証**。
- 影響が広いのは**テスト**（ペルソナfixtureの `llmType: 'claude'` が約15ファイル、`getPersonaModel` の gemini/gpt 分岐テスト、gpt/gemini ペルソナのフォールバックテスト）。

## Document Status

gap-analysis.md フレームワークに沿い、Grep/Read で全接点を実地調査。外部依存はローカル `node_modules` の型定義を確認。

---

## Requirement-to-Asset Map

| 要件 | 対象アセット | 種別 |
|---|---|---|
| R1: 全ペルソナを Claude Sonnet 5 に統一 | `persona-agent.ts`（発言 243/311/318-325/407/414-415、所感 478）、`getPersonaModel` | Constraint |
| R2: 使い分け機構の撤去 | `common.types.ts`(LLMType定義)、`persona.types.ts:16`+import、`models.ts`(getPersonaModel/providerForModel/PERSONA_MODELS利用)、`ai.constants.ts`(PERSONA_MODELS)、`persona-generator-agent.ts:25`、`buildPersonaSystem`、フロント`src/lib/models/persona/persona.types.ts:89` | — |
| R3: 単一プロバイダ化後の失敗時挙動 | `persona-agent.ts:318-325`(claude フォールバック=同一モデルで冗長)、`:478`(所感=try/catch無し) | Constraint |
| R4: personaGenerator の Claude 化・OpenAI 撤廃 | `models.ts:getPipelineModel` case `personaGenerator`、`ai.constants.ts:PIPELINE_MODELS.personaGenerator`、`@ai-sdk/openai` import、8ファイルの `OPENAI_API_KEY` SECRETS、`persona-generator-agent.ts` の openai 依存 | — |
| R5: Claude モデル最新化 | `ai.constants.ts:AI_MODELS.SONNET`（→ 全 Sonnet 利用: facilitator/chapter/editor/intro-closing/debate-digest/persona） | Constraint(要実行時検証) |
| R6: Gemini パイプライン現状維持 | `getPipelineModel` の Gemini 系 case（変更しない） | — |

---

## 詳細調査結果

### llmType 機構の全接点（本番コード）

- **型定義**: `common.types.ts` に `LLMType = 'gemini' | 'claude' | 'gpt'`。`persona.types.ts:16`(functions, 必須) と `src/lib/models/persona/persona.types.ts:89`(フロント, `llmType?: string` 任意) がフィールド保持。
- **フロント実利用**: **なし**。`.svelte`・stores・services で `llmType` の読み書きは 0 件。型宣言を消すだけで UI 影響なし。
- **モデル解決**: `models.ts` の `getPersonaModel(llmType)` → `providerForModel(PERSONA_MODELS[llmType])`。`providerForModel` は解決後モデルIDのプレフィックスで anthropic/openai/google を分岐。`getPersonaModel` 撤去なら `providerForModel`・`PERSONA_MODELS` も撤去可能（他利用なし）。
- **ペルソナ生成**: `persona-agent.ts` で発言(`generatePersonaTurn`)・engagement 評価・所感(`generateImpression`)が `persona.llmType ?? 'claude'` を使用。
- **buildPersonaSystem** (`persona-agent.ts:155`): `llmType === 'claude'` のときだけ system を cacheControl 付き `SystemModelMessage` にする（プロンプトキャッシュ）。全 claude 化後は常にキャッシュ経路。`llmType` 引数を落として単純化可能。
- **生成スキーマ**: `persona-generator-agent.ts:25` の `llmType: z.enum([...])` を LLM に生成させている。撤去対象。

### フォールバックの現状（R3 の核心）

- 発言経路 `persona-agent.ts:318-325`: `try { getPersonaModel(llmType) } catch { getPersonaModel('claude') }` + 空出力時も claude 再試行。**単一モデル化後は「claude→claude」で冗長**。
- 所感経路 `persona-agent.ts:478`: try/catch **無し**。これが今回のハード失敗（gpt クォータ超過）の直接原因。統一により根本原因（gpt 依存）は消えるが、所感側の耐性は依然として発言側と非対称。→ **設計判断ポイント**（下記 Option 参照）。

### personaGenerator と OpenAI 依存

- `getPipelineModel` の `personaGenerator` case が唯一の非ペルソナ OpenAI 呼び出し。`anthropic(AI_MODELS.SONNET)` に置換で解消。
- openai() 呼び出しは `models.ts` の①gpt ペルソナ経路(providerForModel) ②personaGenerator の2箇所のみ。両方消えれば `import { openai }` と `@ai-sdk/openai`(package.json)、`OPENAI_API_KEY`(index.ts / debates.ts / stakeholders.ts / interviews.ts / fact-research.ts / chapters.ts / personas.ts / editing.ts の SECRETS 配列)を撤去できる。

### モデル最新化の波及

- `AI_MODELS.SONNET` 定数1箇所を `claude-sonnet-5` に変更 → facilitator(5箇所)・chapter(6)・editor(2)・intro-closing(1)・debate-digest(1) に波及。ペルソナも `getPersonaModel` 撤去後は `anthropic(AI_MODELS.SONNET)` を直接使わせれば同定数に一本化できる。
- `AI_MODELS.OPUS`(`claude-opus-4-8`) と `PIPELINE_MODELS` の Gemini 系は不変。

### Firestore 互換

- 既存ペルソナ docs は `llmType` を保持。型からフィールド削除しても TS は読み込み時に余剰フィールドを無視するだけ。マイグレーション不要で R2.5(既存データにllmType残存でもエラーにしない)を自然に満たす。

---

## Implementation Approach Options

本機能は「撤去・置換」主体のため A/B/C は主に**フォールバックとOpenAI撤去の踏み込み度**で分岐する。機構撤去自体は Option A(既存を直接編集)一択。

### Option A: 最小撤去（機構削除 + 定数更新のみ）
- `llmType` 機構撤去、`personaGenerator`→Claude、`AI_MODELS.SONNET`→sonnet-5。
- フォールバックは冗長な claude→claude 分岐を単純化する程度に留め、所感の try/catch は追加しない。`OPENAI_API_KEY` シークレットは配列に残す（無害）。
- ✅ 変更最小・レビュー容易 / ❌ 所感の耐性非対称が残る・OpenAI 依存表記が残存

### Option B: 完全撤去（A + OpenAI 痕跡ゼロ + 所感耐性統一）
- A に加え、`@ai-sdk/openai` 依存と全 SECRETS の `OPENAI_API_KEY` を撤去。所感経路にも発言と同等の失敗時挙動（リトライ/明示エラー）を持たせ R3.2 の非対称を解消。
- ✅ R3・R4 を完全充足・ペルソナ経路の OpenAI 依存が痕跡ゼロ / ❌ 触るファイルが増える（SECRETS 8ファイル）・デプロイ時の secret 定義変更に注意

### Option C: 段階（B を2フェーズ）
- フェーズ1: 機構撤去 + Sonnet 5 化（動作の主変更）→ デプロイ検証。フェーズ2: OpenAI 依存撤去 + 所感耐性統一。
- ✅ Sonnet 5 実行時解決の検証を先に切り離せる（変数を1つに絞れる） / ❌ 2回デプロイ

**推奨**: **Option B**（要件を完全充足）。ただしモデル最新化の実行時検証リスクを踏まえ、**コミット/デプロイは C 的に「機構撤去+Sonnet5化」と「OpenAI撤去+所感耐性」を分ける**のが安全。

---

## Effort & Risk

- **Effort: M（3〜7日）**。本番コードの撤去・置換自体は S 規模だが、`llmType` fixture を持つテスト約15ファイルと `getPersonaModel`/フォールバックの分岐テスト更新・削除、SECRETS 8ファイルの編集で M に寄る。
- **Risk: Medium**。
  - モデル ID `claude-sonnet-5` の実行時解決（型は通るが AI SDK 型 union 未掲載・エミュレータ無しで要デプロイ検証）— **主リスク**。
  - Sonnet 4.6→5 の挙動変化（新トークナイザでトークン増・コスト特性変化・adaptive thinking 既定変化の可能性）。AI SDK 抽象化により API パラメータ影響は限定的だが、生成品質/コストの再ベースライン確認が必要。
  - それ以外（機構撤去・定数変更）は Low。

---

## Research Needed（設計フェーズへ持ち越し）

1. **`claude-sonnet-5` の実行時解決確認**: `@ai-sdk/anthropic@3.0.85` で `anthropic('claude-sonnet-5')` が正しく Anthropic API に到達し生成できるか。必要なら `@ai-sdk/anthropic` のバージョン更新可否。エミュレータ無し方針のため本番デプロイでのスモーク検証手順を設計に含める。
2. **所感経路の失敗時挙動の目標形**: 単一モデル化後、所感に発言と同等のリトライを持たせるか、AI SDK の `generateText` リトライに委ねるか。冗長 claude→claude 分岐の削除範囲。
3. **`OPENAI_API_KEY` シークレット撤去の範囲**: ペルソナ経路以外に OpenAI 利用が無いことの最終確認と、Cloud Functions の secret 定義変更に伴うデプロイ影響。
4. **Sonnet 5 コスト/トークンの再ベースライン**: 移行後の入力トークン増を許容するか、監視をどうするか（要件外だが運用判断として記録）。

---

## Next Steps

設計フェーズへ:

```
/kiro:spec-design per-persona-model-selection
```

上記 Research Needed 4点を設計で解決し、Option B（コミット分割は C 的）の具体手順・テスト更新方針・デプロイ検証手順を確定する。
