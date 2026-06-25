# Research & Design Decisions: fact-check-validity-improvement

## Summary
- **Feature**: `fact-check-validity-improvement`
- **Discovery Scope**: Extension（既存 `chapter-fact-check` の判定ロジック改良）
- **Key Findings**:
  - 変更の中心は [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) のプロンプト2種・Phase2 Zod スキーマ・post-processing の3点。実行制御（onCall→Cloud Task）・永続（repository）・逐次追記フローは不変。
  - 入力シグナルは既存資産で充足：`DebateTurn.speechMode`（`opinion/fact/question`）はターンに保持済みだが runner 未使用。現在日時は `currentDateString()`（[prompt-formatters.ts](functions/src/utils/prompt-formatters.ts#L4)）を `FactCheckContext` に足すだけで時間軸検証に使える。
  - 非断定の主張は**検証せず finding も生成しない**（軽量版＋抑制）。検証しない以上ファクトチェック判断を含む指摘は残せないため、別種の指摘（`contextual` 等）は設けない。結果として `FactCheckVerdict` / `FactCheckFinding` の契約は不変、変更は runner のプロンプトと `FactCheckContext` への現在日時追加に閉じる。

## Research Log

### 実行アーキテクチャの実体確認
- **Context**: chapter-fact-check の design.md は同期 onCall（540秒）想定だったが、実装が乖離していないか確認。
- **Sources Consulted**: [api/fact-check.ts](functions/src/api/fact-check.ts), [fact-check-repository.ts](functions/src/pipeline/fact-check/fact-check-repository.ts), [factCheck.svelte.ts](src/lib/stores/factCheck.svelte.ts)
- **Findings**:
  - `runFactCheck`(onCall) は前提検証＋`startFactCheckResult`(running) のみ行い、検証本体は `runFactCheckTask`(onTaskDispatched, `timeoutSeconds: 1800`, `memory: '1GiB'`) へ enqueue。
  - `checkChapter` は発言を1件ずつ処理し、`onTurnFindings` で `appendFactCheckFindings` を呼び逐次追記。出典は `aggregateSources` で URL 重複排除。
  - FE は `factCheck/result` を onSnapshot 購読し `FactCheckResult` を表示。
- **Implications**: 本スペックは検証ロジック（runner）内で完結し、実行制御・永続・store・逐次表示の仕組みには波及しない。`contextual` finding も既存経路で運ばれる。

### 入力シグナルの所在
- **Context**: 断定性判定（1.x）・時間軸検証（3.5）に必要な入力が既存にあるか。
- **Sources Consulted**: [turn.types.ts](functions/src/types/turn.types.ts#L10), [prompt-formatters.ts](functions/src/utils/prompt-formatters.ts), [persona-agent.ts](functions/src/agents/persona-agent.ts#L114)
- **Findings**:
  - `DebateTurn.speechMode?: 'opinion' | 'fact' | 'question'` がターンに保持済み。`checkTurn` は `turn.content` のみ使用し speechMode 未参照。
  - `currentDateString()` が「本日は YYYY年M月D日」を生成し、persona/facilitator のプロンプトに既に注入されている。fact-check 側でも流用可能。
- **Implications**: 1.4 は `turn.speechMode` を Phase1 プロンプトへ渡すだけ。3.5 は `FactCheckContext` に現在日時を加えるだけで、新規の永続・配管は不要。

### 既存 post-processing ガードとの整合
- **Context**: 抑制方式が既存の verdict 後処理に影響しないか。
- **Sources Consulted**: [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts#L131-L149)
- **Findings**:
  - runner は (a) `turn.content.includes(f.claim)` で引用照合、(b) `sourceIndices` を解決済み出典へ写像、(c) `sources.length === 0 ? 'unverifiable' : f.verdict` で出典なしを検証不能へ降格。
  - 非断定主張は Phase2 で finding を生成しないため、後処理に到達しない。後処理（a)(b)(c) はそのまま不変でよい。
- **Implications**: 後処理は無改修。verdict 値も `incorrect | unverifiable` のまま。変更は Phase1/Phase2 プロンプトと `FactCheckContext` に閉じる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: runner 拡張（採用） | プロンプト・スキーマ・後処理に断定性判定を追加 | 1ファイル集中・既存ガード/フロー再利用・回帰範囲が狭い | プロンプトが長くなる | structure.md「過度な共通化をしない」に合致 |
| B: 判定を独立 LLM ステップ化 | Phase1 前に断定性分類を別呼び出し | 判定責務の分離・テスト容易 | 発言×2→×3 で コスト/レイテンシ増・現状規模に過剰 | 不採用 |
| C: verdict リラベル（不採用） | 非断定を `contextual` で残す | 除外根拠が見える | 検証しない軽量版では判断を含まずノイズ・契約変更が増える | ユーザー判断で不採用 |

## Design Decisions

### Decision: 非断定の主張は検証せず finding も生成しない（軽量版＋抑制）
- **Context**: 要件2（非断定は誤りとして指摘しない）。当初は要件4（除外の分類・根拠を保持）との両立のため verdict リラベル（`contextual`）を検討したが、軽量版（非断定は検証しない）が確定したため再検討。
- **Alternatives Considered**:
  1. 案1 単純抑制（採用） — 非断定は検証せず finding を生成しない。型変更ゼロ。
  2. 案2 verdict リラベル — `verdict` に `'contextual'` を追加し残す。
  3. 案3 分類フィールド追加 — `assertionType` を全 finding に付与。
- **Selected Approach**: 案1。非断定の主張は Phase1/Phase2 で検証対象外とし、finding を生成しない。事実として正しい断定主張が今も finding を生成しないのと同じ扱い。
- **Rationale**: 検証しない以上、その主張についてファクトチェック判断（正誤・正しい事実・出典）を一切持てない。「断定でない」とだけ記した指摘は判断を含まずノイズになる、というユーザー判断により、別種の指摘は残さない。これに伴い要件4（分類・根拠の保持）と要件1の保持系 AC を要件から除外した。`FactCheckVerdict` / `FactCheckFinding` の契約は不変、変更は runner プロンプトと `FactCheckContext` に閉じる。
- **Trade-offs**: ✅ 最小変更・契約不変・回帰範囲が最小 / ❌ 非断定として除外した根拠は永続的には残らない（必要なら実行時ログで観察）。
- **Follow-up**: 提示済み4例で回帰確認。判定精度の調整はプロンプトで行う。

### Decision: 断定性は Phase1/Phase2 プロンプトで判定し、不確実なら検証側へ倒す
- **Context**: 断定/非断定の判定はファジー。過剰抑制（見逃し）と過小抑制（誤検出）のバランス。
- **Selected Approach**: Phase1 で「事実として断定された主張のみ検証、問い・前提・仮定・代弁は検証から除外」、Phase2 で incorrect/unverifiable/contextual に構造化。質問文中でも確定事実（過去の出来事・既成の状態）として述べた部分は検証する（3.3）。判定が不確実なら事実主張として検証（3.6）。`speechMode === 'question'` は手掛かりに留め、単独で一律除外しない（1.5）。
- **Rationale**: 見逃し回避を優先しつつ、明確な非断定のみ contextual にすることで誤検出を抑える。
- **Trade-offs**: ✅ 保守的で安全 / ❌ 判定精度がプロンプト品質依存。
- **Follow-up**: 提示済み4例（停戦前提・国連/赤十字の仮定・W杯試合数・時間軸）を評価ケースに。

## Risks & Mitigations
- 断定/非断定の LLM 判定精度がファジー — 3.6（不確実なら検証）を保守的デフォルトにし、4例で回帰確認。
- 抑制により本来の誤りまで取りこぼす（過剰抑制） — 3.6 を保守的デフォルトにし、質問内の確定事実（3.3）・制度変更（3.4）・時間軸（3.5）の検証維持を明示。
- 既存 runner テストへの影響 — 非断定で finding が出ないこと等のケース追加を tasks に含める（型・契約は不変）。

## References
- [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) — 判定ロジックの中心
- [turn.types.ts](functions/src/types/turn.types.ts) — `DebateTurn.speechMode`
- [prompt-formatters.ts](functions/src/utils/prompt-formatters.ts) — `currentDateString()`
- `.kiro/specs/chapter-fact-check/design.md` — 既存ファクトチェックの設計と Revalidation Triggers
