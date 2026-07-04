# Gap Analysis — debate-llm-cost-reduction

要件（requirements.md）と既存コードベースの差分分析。設計フェーズの入力とする。決定は行わず、選択肢とトレードオフ、研究課題を提示する。

## 1. 現状調査サマリ

- **プロンプトキャッシュ**: `ai@^6.0.0` + `@ai-sdk/anthropic@^3.0.0` を使用。AI SDK は Anthropic の `cacheControl`（ephemeral）に対応しているが、**現状コードでは一切未使用**（`providerOptions`/`cacheControl` の参照ゼロ）。ライブラリ的には利用可能＝enabler は存在。
- **トークン/コスト計測**: `generateText`/`generateObject` の戻り値 `usage` を**どこでも記録していない**（`.usage` 参照ゼロ）。要件4はほぼ完全なグリーンフィールド。
- **信念モデル（要件7の主対象）**:
  - Firestore: `topics/{topicId}/personas/{personaId}` に `beliefs: Belief[]` を埋め込み（バージョン管理）。`Belief` = `{ id, version, content, createdAt, changeType?, changeSummary?, triggeredByTurnId? }`（[persona.types.ts:25-33](functions/src/types/persona.types.ts#L25-L33)）。
  - 更新経路: [step.ts:110-115](functions/src/pipeline/debate/step.ts#L110-L115) → [applyBeliefChange](functions/src/pipeline/debate/belief.ts#L22-L60) が `arrayUnion` で新versionを追記（上書きでなく追記だが「最新版が現在の信念」＝実質上書き挙動）。
  - 読み出し: [getLatestBelief](functions/src/pipeline/debate/belief.ts#L12-L16)（最大version）を post-debate-comments（`finalBelief`）・turn.ts closing（`finalBeliefs`）・persona-agent（system埋め込み `latestBeliefContent`）が使用。
  - 生成: [persona-agent.ts generateTurn](functions/src/agents/persona-agent.ts#L212) が `beliefChange`（`opinion_change`/`partial_acceptance`）を出力。system内 [:144-146](functions/src/agents/persona-agent.ts#L144-L146) に最新信念を埋め込む＝**キャッシュ無効化の直接原因**。
  - リスタート巻き戻し: [rollbackBeliefsForRemovedTurns](functions/src/pipeline/debate/belief.ts#L63-L78) が `triggeredByTurnId` で信念をフィルタ。
- **信念の可視化**: **管理画面のみ**（公開ページには信念変化の描画なし）。
  - Phase5Debate [:120-126,251-254](src/lib/features/admin/topic-detail/debate/Phase5Debate.svelte#L251-L254): ターンごとに「🔄 {personaName}: {changeSummary}」。
  - Phase6Editing [:80-88,271-274](src/lib/features/admin/topic-detail/editing/Phase6Editing.svelte#L80-L88): 原本ターン→信念変化を `triggeredByTurnId` で紐付け表示。
  - InterviewItem [:26,138-140](src/lib/features/admin/topic-detail/research/InterviewItem.svelte#L138-L140): `beliefs[0].content` を「最終信念」として表示（＝初期信念）。
  - FE型ミラー: [persona.types.ts](src/lib/models/persona/persona.types.ts) の `BeliefForFirestore` / `BeliefChangeType = 'opinion_change' | 'partial_acceptance'`。
- **engagement構造**: [engagement.ts runEngagement](functions/src/pipeline/debate/engagement.ts#L52-L60) が `personas.filter(p != lastSpeaker)` を `Promise.all` で個別 `evaluateEngagement` 呼び出し（各呼び出しがフルの persona system プロンプト）。除外話者の個別フォールバックあり。`saveEngagements` で永続化、スコアは speaker-selection / intervention が閾値解釈。

## 2. Requirement → Asset マップ（ギャップタグ: Missing / Unknown / Constraint）

| 要件 | 既存資産 | ギャップ |
|---|---|---|
| **R1 コスト目標/ベースライン比較** | なし | **Missing**: 計測基盤（R4依存）。ベースライン取得の仕組みもゼロ。 |
| **R2 安定コンテキストの重複課金排除** | AI SDK が `cacheControl` 対応、`buildPersonaSystemPrompt`（[persona-agent.ts:109](functions/src/agents/persona-agent.ts#L109)） | **Constraint**: system内に信念埋め込み（可変）。**Unknown**: AI SDK v6 での system/messages への cache breakpoint 指定の正確なAPI。**Unknown**: Cloud Tasksチェーンでのターン間隔 vs TTL(5min/1h)のヒット率。 |
| **R3 engagement効率化** | `engagement.ts` / `evaluateEngagement` / `getPersonaModel` | **Constraint**: 各評価が persona system に接地。格下げ/バッチ/頻度削減いずれも品質検証必要。 |
| **R4 計測** | `generateText`/`generateObject` の `usage` は取得可（未使用） | **Missing**: 呼び出し種別・モデル別のトークン記録、フェーズ集計、キャッシュヒット率算出。保存先未定（ログ/Firestore）。 |
| **R5 品質非退行** | なし | **Missing**: 前後比較のeval手段。**Unknown**: 判定基準（何を持って非退行とするか）。 |
| **R6 段階導入/変数隔離** | なし | **Missing**: パイプラインの施策トグル（feature flag）機構。環境変数 or Firestore設定。 |
| **R7 信念固定＋awareness** | `belief.ts` / `persona.types.ts`(FE/BE) / `step.ts` / `persona-agent.ts` / Phase5/6・InterviewItem | **Constraint（最広範）**: データモデル・生成・永続・可視化・移行に横断。詳細は §3。 |

## 3. 要件7（信念固定＋awareness）の影響範囲

新モデル: 初期信念を不変とし、`Awareness`（受容/自己発の気づき）を別配列で追記。見解は「初期信念＋全awareness」から都度導出（最終信念フィールドは持たない＝方針(a)）。

**変更が波及するファイル:**
- **型（BE）**: [persona.types.ts](functions/src/types/persona.types.ts) — `Belief` を初期信念1本に、`Awareness` 型を追加。メモリ規約: 永続型は `*ForFirestore` サフィックス（現状BEは `Belief` 命名で未統一。要検討）、型ファイルは型と型ガードのみ・変換関数を書かない、re-exportで誤魔化さない。
- **型（FE）**: [persona.types.ts](src/lib/models/persona/persona.types.ts) — `BeliefForFirestore`/`BeliefChangeType` を awareness モデルへ。FE型はFirestore永続形と一致（乖離形を作らない）。
- **永続/更新**: [belief.ts](functions/src/pipeline/debate/belief.ts) — `applyBeliefChange`→awareness追記、`getLatestBelief`→`getInitialBelief`、`rollbackBeliefsForRemovedTurns`→awareness も `triggeredByTurnId` で巻き戻し。
- **生成/プロンプト**: [persona-agent.ts](functions/src/agents/persona-agent.ts) — system=固定persona前置き（初期信念含む・キャッシュ対象）、awareness は user メッセージ（揮発部）へ注入。`turnOutputSchema.beliefChange`→awareness獲得イベントへ。`opinion_change` を廃し受容系のみ。
- **オーケストレーション**: [step.ts:110](functions/src/pipeline/debate/step.ts#L110)（適用経路）、[turn.ts:344](functions/src/pipeline/debate/turn.ts#L344)（closingのfinalBeliefs導出）、[post-debate-comments.ts:27](functions/src/pipeline/debate/post-debate-comments.ts#L27)（finalBelief）、[facilitator-agent.ts:218](functions/src/agents/facilitator-agent.ts#L218)（beliefsSummary）。
- **可視化（管理画面）**: Phase5Debate / Phase6Editing / InterviewItem の信念変化描画を awareness ベースへ。
- **移行（R7-7）**: **決定済み — 移行しない**。既存トピックの旧信念データはクリアし新モデルで再生成する（前方互換のみ）。後方互換・変換ロジックは不要。

## 4. 実装アプローチ（A/B/C）

本仕様は独立性の異なる複数の関心（計測・キャッシュ・engagement・信念モデル）を含むため、単一アプローチでなく**関心ごとに選ぶ**。

### 4-1. 信念モデル（要件7） — 最も重い
- **Option A（既存拡張）**: `Belief` 型に awareness 概念を相乗り（例: `changeType='awareness'`）。✅変更小 ❌意味が曖昧・上書き挙動が残りキャッシュ目的を果たしにくい。**非推奨**。
- **Option B（新規分離）**: `Awareness` を独立型・独立配列（`awarenesses: Awareness[]`）として新設し、`beliefs` は初期信念1本に固定。✅意味明確・キャッシュ思想と一致・メモリ規約（過度な共通化回避）と整合 ❌FE/BE型・可視化・移行の同時変更が必要。**推奨**。
- **Option C（ハイブリッド/段階）**: まず「信念を固定化（上書き停止）＋ awareness を最小の追記構造で導入」し、可視化・移行は後続。✅R6の段階導入と整合・リスク分散 ❌一時的に旧表示との併存。

### 4-2. キャッシュ（要件2）
- **Option A（既存拡張・推奨）**: `buildPersonaSystemPrompt` の出力を「固定前置き（初期信念含む）＝cache breakpoint」と「揮発部（awareness/直近ターン/factBase/指示）」に再構成し、Anthropic呼び出しに `cacheControl` を付与。✅呼び出し箇所が局所（persona-agent） ❌AI SDK v6 のbreakpoint API確認が必要（Unknown）。
- **追加レバー**: topicレベルの `factBase` を全ペルソナ共有の先頭ブロックとして別breakpointにすると、engagement/draft横断で共有ヒットしうる（要design検討）。

### 4-3. engagement（要件3）
- **Option A（モデル格下げ・低リスク推奨・第一候補）**: engagement評価のみ安価モデル（Haiku 4.5 等）に切替。✅回数はそのまま単価3倍減・変更最小 ❌スコア妥当性のA/B必要。
- **Option B（バッチ化）**: 非話者を1コールでまとめて採点。✅回数を1/5に ❌複数人格の分離が崩れる（メモリ「過度な共通化回避」と緊張）・設計変更大。
- **Option C（頻度削減）**: Nターン毎/ヒューリスティック足切り。✅線形削減 ❌発話タイミングの質低下。

### 4-4. 計測（要件4）・トグル（要件6）
- **Option B（新規）**: LLM呼び出しをラップする薄い計測ユーティリティ（`usage`＋種別/モデルを記録）と、施策ごとの環境変数/設定フラグを新設。✅関心分離・R6の変数隔離を担保 ❌新規配線。中央ディスパッチャ化は避ける（メモリ規約）。

## 5. Effort / Risk

| 関心 | Effort | Risk | 理由 |
|---|---|---|---|
| 計測基盤（R4） | S | Low | `usage` を記録するだけ。既存パターン内。 |
| 施策トグル（R6） | S | Low | 環境変数/設定の追加。 |
| キャッシュ（R2） | M | Medium | 局所だがAI SDK v6のbreakpoint API・TTLヒット率が未知。実測依存。 |
| engagement格下げ（R3-A） | S | Medium | 変更小だがスコア品質の非退行検証が要る。 |
| 信念固定＋awareness（R7） | L | Medium〜High | FE/BE型・生成・永続・可視化・移行に横断。データ移行方針が未定。 |
| 品質非退行検証（R5） | M | Medium | eval手段と判定基準の設計が必要。 |

**全体感**: XL寄りの L。R7が支配的。R2/R3/R4/R6は個別には S〜M。

## 6. 設計フェーズへの申し送り

**推奨の骨子:**
- 信念モデルは **Option B（Awareness独立）**、導入は **Option C（段階）** — まず固定化＋awareness最小構造、可視化/移行は後続タスク。
- キャッシュは **persona-agent局所での再構成＋cacheControl**、factBase共有ブロックは第2段の検討。
- ~~engagementは格下げ（R3-A）を第一~~ → **§7-2で撤回**。効率化（品質維持）方針に基づき engagement は格下げせず、キャッシュ再利用＋（任意）冗長評価削減とする。§4-3 Option A（格下げ）は不採用。
- 計測・トグルを**最初に**入れる（変数を1つずつ入れて相殺を避ける＝メモリ規約に直結）。

**重要な決定事項（design で確定）:**
1. `Awareness` の永続形（`awarenesses: AwarenessForFirestore[]` か。`triggeredByTurnId`・`sourcePersonaId`（誰の発言からの受容か）・自己発フラグを持つか）。BE永続型の `*ForFirestore` 命名統一の可否。
2. awareness を発言生成でどう効かせるか（system固定＋user揮発への注入位置、統合規則: 初期信念主軸・awarenessは反転させない）。
3. ~~既存データの移行方針~~ → **決定済み: 移行不要・クリアして再生成**（後方互換コードを書かない）。
4. 計測の**保存先**（構造化ログ or Firestore集計ドキュメント）とヒット率算出の定義。
5. トグルの**粒度と機構**（環境変数 or Firestore設定、施策単位）。

**Research Needed（design 前半で裏取り）:**
- AI SDK v6 + `@ai-sdk/anthropic` の cache breakpoint 指定方法（system文字列 vs messages parts、breakpoint数上限、`cachedInputTokens` の取得可否）。Svelte MCP同様、記憶でなく実物で裏取り。
- Cloud Tasks チェーン下でのターン間隔の実測（TTL 5min に収まるか→ephemeral既定 vs 1h指定の判断）。
- 安価モデル（Haiku等）での engagement スコア妥当性の小規模A/B。
- gpt/geminiタイプ・ペルソナ（Anthropic以外）でのキャッシュ非対応時の扱い（対象外として明示 or 各プロバイダの自動キャッシュに委ねる）。

---

## 7. Discovery（design フェーズ・実物裏取り）

### 7-1. AI SDK のキャッシュ／usage API（node_modules 実測）
- `@ai-sdk/anthropic@3.0.85`: プロバイダオプションに `cacheControl: { type: 'ephemeral', ttl?: '5m' | '1h' }` を持つ（`dist/index.d.ts:208-211`）。**breakpoint はメッセージ／コンテンツパート単位**で `providerOptions: { anthropic: { cacheControl: {...} } }` として付与する。TTL は `5m`（既定）と `1h` の2択。
- `ai@6.0.208`: `LanguageModelUsage` に `inputTokens` / `outputTokens` / `totalTokens` / `cachedInputTokens`（`dist/index.d.ts:271-317`）。→ **キャッシュ読み取りトークンが取得可能＝要件4のヒット率算出が可能**。
- `generateText` は `allowSystemInMessages` を持ち、`messages[]` 内に `role:'system'` を置ける。→ 安定コンテキストを system パートとして messages 先頭に置き cacheControl を付与する構成が可能（cacheControl は文字列 `system` プロパティでなくパートに付く）。
- **含意**: 要件2・4は追加ライブラリ不要。既存呼び出しの「プロンプト再構成＋providerOptions付与」と「usage記録」で実装できる。gpt/openai・gemini/google 呼び出しは anthropic の providerOptions を無視するため安全（no-op）。

### 7-2. 設計決定（このspecで確定）
- **方針の訂正（重要）**: ゴールは「コスト削減」ではなく「**効率化**」＝品質を落とさずムダ（重複課金・冗長計算）を無くす。→ **安価モデルへの格下げは採らない**。
- **信念モデル**: `Belief` を初期信念のみ（`{ id, version=0, content, createdAt }`）に**スリム化**し、変化追跡フィールド（changeType/changeSummary/triggeredByTurnId）は新設 `AwarenessForFirestore` へ移す。持ち回りは各ペルソナドキュメントの新フィールド `awarenesses: AwarenessForFirestore[]`（`beliefs` は初期信念の保持に据え置き＝interviewパイプラインの変更最小）。
- **命名**: 新規永続型は `AwarenessForFirestore`（メモリ規約 `*ForFirestore`）。BE 既存 `Belief` 命名の *ForFirestore 統一は chapter-type-unification spec の範疇として本specでは触らない。
- **キャッシュ配置**: system＝安定ペルソナ文脈（固定導入・スタイル・プロフィール・取材レコード・**初期信念**）に cacheControl。user＝揮発部（awareness・直近ターン・factBase・指示）。factBase 共有ブロック化（第2 breakpoint）は draft のみ効くため副次最適化として後回し。
- **気づき（awareness）の流れ**: 「**聞く→気づく→話す**」。検出（出力）は傾聴段階の `evaluateEngagement`（`Engagement.awareness?` を追加、score/mode の意味は不変）、消費（入力）は engagement/draft/comment 全て。`generateTurn` は awareness を出力しない。永続は engagement フローが話者選択の前に行う。非話者も気づける。
- **engagement**: **モデルは据え置き（`getPersonaModel`、格下げしない）**。効率化はキャッシュ再利用（R3.1）＋（任意・既定OFF）冗長評価の削減（R3.5）。バッチ化はペルソナ人格分離と衝突するため不採用。
- **計測**: 構造化ログ（Cloud Logging）を一次ソースとし、呼び出し種別・モデル・usage を1行で記録。集計はログベース（フェーズ集計・ヒット率算出）。Firestore への集計書き込みは行わない（課金・複雑化回避）。
- **トグル**: 環境変数で施策単位に ON/OFF（`ENABLE_PROMPT_CACHE` / `CACHE_TTL` / `ENABLE_ENGAGEMENT_SKIP_REDUNDANT`）。中央ディスパッチャ化はしない。
- **移行**: 行わない（既存データはクリア・再生成）。

### 7-3. 残研究（実装初期に確定）
- Cloud Tasks チェーンでのターン間隔の実測 → TTL `5m` 既定で十分か、`1h` 指定が要るか。主レバーのため実装初手で `cachedInputTokens>0` の疎通スパイクを置く。
- 冗長評価削減（R3.5）の妥当性と適用機会の有無（毎ターン新発言が加わるため機会が少ない可能性）。既定OFFで要件5のA/B後に判断。
- 品質非退行（要件5）の最小A/B手段の定義（同一入力での前後出力比較）。
