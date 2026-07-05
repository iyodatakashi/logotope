# Research & Design Decisions: debate-llm-cost-reduction

## Summary
- **Feature**: `debate-llm-cost-reduction`
- **Discovery Scope**: Extension（既存討論パイプラインの内部改修）
- **Key Findings**:
  - ai SDK v6 では `system` を**文字列**で渡すとキャッシュのブレークポイントが付かない。キャッシュには `messages` 内の `role:'system'` メッセージに `providerOptions.anthropic.cacheControl` を付ける必要がある。
  - ペルソナ系3呼び出し（`evaluateEngagement` / `generateTurn` / `generatePostDebateComment`）は共通の `buildPersonaSystemPrompt`（初期信念含む・上流適用済みで不変）を `system` 文字列として渡している。新規ファイルなしで載せ替え可能。
  - engagement は毎ターン全（非直前話者）評価が必要で、削れる冗長は「同一 turnId の再処理（リトライ・再実行）」に限られる。毎ターンの一括評価自体は話者選択・awareness 捕捉に必要。

## Research Log

### ai SDK v6 / @ai-sdk/anthropic のプロンプトキャッシュAPI
- **Context**: 安定コンテキストを system に置いたままキャッシュを効かせられるか、正確なAPI形を確定する。
- **Sources Consulted**:
  - [AI SDK Providers: Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
  - [Node: Dynamic Prompt Caching (AI SDK cookbook)](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching)
  - [vercel/ai #13308 array-based system prompts with per-block cache control](https://github.com/vercel/ai/issues/13308)
  - [Anthropic Prompt caching (platform docs)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Findings**:
  - v6 以降は `system` パラメータが構造化メッセージを受け付け、system ブロックにキャッシュを効かせられる。v5 では `system` は文字列のみでブレークポイントが付かない。
  - キャッシュ指定は `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }`。メッセージ単位／パート単位で付与でき、パート単位が優先。
  - TTL は既定 `5m`。`{ type:'ephemeral', ttl:'1h' }` で 1時間（書込コスト増）。
  - Anthropic は最小トークン数を満たさないとキャッシュが作動しない（短い文脈は非対象＝no-op）。
  - 非anthropicプロバイダは `providerOptions.anthropic` を無視する（gemini/gpt で無害）。
- **Implications**: `system` 文字列を `messages:[{role:'system', content, providerOptions:{anthropic:{cacheControl:{type:'ephemeral'}}}}, {role:'user', ...}]` に載せ替える。usage 計測は本仕様では行わない（計測は Out of scope）。

### 現行コードの呼び出し構造
- **Context**: どの呼び出しに、どの安定コンテキストが渡っているかを確認。
- **Sources Consulted**: `functions/src/agents/persona-agent.ts`, `functions/src/pipeline/debate/engagement.ts`, `functions/src/pipeline/debate/step.ts`, `functions/src/llm/models.ts`
- **Findings**:
  - `buildPersonaSystemPrompt(persona, interviewRecord, getInitialBelief(persona))` を、`generateTurn`（draft/regen）・`evaluateEngagement`・`generatePostDebateComment` が `system` 文字列として使用。可変文脈（直近ターン・factBase・awareness・指示）は `user` 側。上流適用済みで system は討論中に不変。
  - `evaluateEngagements`（engagement.ts）が毎ターン非直前話者を一括評価し `engagements/<personaId>.history.<turnId>` に score/mode を永続。`evaluateEngagementWithFallback` は一括結果を再利用済み。
- **Implications**: キャッシュ載せ替えは persona-agent 内の3箇所に閉じる。冗長削減は engagement.ts 内で `history.<turnId>` を読み再利用する形に閉じる。新規ファイル不要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 内部改修（採用） | persona-agent と engagement を直接改修、新規ファイルなし | 最小差分・steering整合（過度な共通化回避） | 各呼び出しで messages 構成を触る | 採用 |
| 設定レイヤ＋instrumentation＋トグル | feature-flags/instrumentation を新設し計測・切替 | 効果を実測・A/B可能 | 出力不変のキャッシュに対し過剰。ユーザ方針（計測・トグル不要）に反する | 不採用 |

## Design Decisions

### Decision: 安定コンテキストのキャッシュ配置は system メッセージへの載せ替えで行う
- **Context**: v6 では `system` 文字列にキャッシュブレークポイントが付かない。
- **Alternatives Considered**:
  1. `system` 文字列のまま providerOptions を付ける — v6 仕様上ブレークポイントが付かず無効。
  2. 安定文脈を最初の `user` パートに移す — 会話意味論を歪める。
- **Selected Approach**: `messages` 先頭に `role:'system'` メッセージを置き `providerOptions.anthropic.cacheControl` を付与。`buildPersonaSystemPrompt` はそのまま利用。
- **Rationale**: プレフィックス一致でヒットし、出力は不変。既存の system 内容・順序を保てる。
- **Trade-offs**: 3呼び出しの messages 構成を変更するが、責務は persona-agent 内に閉じる。
- **Follow-up**: 安定コンテキストが最小キャッシュサイズを満たすか（満たさなければ no-op）。

### Decision: engagement 冗長削減は「freeze 指名者のみ評価」＋「同一 turnId 再利用」の2点
- **Context**: 通常ターンの一括 engagement 評価は話者選択・キュー・quietStreak・awareness 捕捉に全消費されており冗長ではない。捨てられている計算は限られる。
- **調査で特定した冗長**: 章末+1（freeze, step.ts:156-192）は話者が指名で確定済みにもかかわらず全非話者をフル評価し、その結果は addQueuedIntents・decideQuietStreak・介入のいずれにも使われず捨てられている（指名者の engagement を引くためだけに使用）。
- **Alternatives Considered**:
  1. 「状況が実質変わっていない」を推測して非話者評価を間引く — 判定が曖昧で話者選択・awareness を変えうる（振る舞い変更）。不採用。
  2. 通常ターンの一括評価を relevant 参加者に絞る — 自発発言できる範囲が変わる（振る舞い変更）。不採用。
- **Selected Approach**: (1) freeze ブランチは指名者のみ評価しフル sweep を廃止（非指名者の最終ターン awareness 捕捉は諦める＝ユーザ許容）。(2) `history.<turnId>` 既存のペルソナは再評価せず永続値を再利用（リトライ・再実行時に発火）。
- **Rationale**: (1) は捨てられていた計算の除去、(2) は同一状態＝同一結果で出力保存的。通常ターンの振る舞いは不変。
- **Trade-offs**: (1) freeze で非指名者 awareness を最終ターンで捕捉しない（許容済み）。(2) 削減はリトライ時のみ。通常ターンの一括評価は削らない。
- **Follow-up**: 再利用は永続済みフィールド（score/mode/intentSummary）に限り、不足時は従来評価にフォールバック。

## Risks & Mitigations
- TTL(5m) を跨ぐターン間隔でキャッシュ失効 — 失効してもフルプライスで完遂（機能リスクなし）。ヒット率が低ければ `ttl:'1h'` へ定数変更。
- 安定コンテキストが最小キャッシュサイズ未満 — no-op で従来課金。機能影響なし。
- engagement 再利用時の永続値不足 — 当該ペルソナのみ従来評価にフォールバック。

## References
- [AI SDK Providers: Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) — cacheControl/providerOptions の仕様
- [Node: Dynamic Prompt Caching](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching) — system キャッシュの実装例
- [Anthropic Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 最小サイズ・TTL・ブレークポイント
- [vercel/ai #13308](https://github.com/vercel/ai/issues/13308) — v5/v6 の system 文字列とブロックの差
