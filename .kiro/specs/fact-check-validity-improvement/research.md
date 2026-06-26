# Research & Design Decisions: fact-check-validity-improvement

## Summary
- **Feature**: `fact-check-validity-improvement`
- **Discovery Scope**: Extension（既存 `chapter-fact-check` の判定ロジック改良）／**design 再設計（要件回帰）**
- **Key Findings**:
  - 変更の中心は [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts)。**断定ゲート（Phase0）を Phase1 検索の前に新設**し、非断定を grounding 検証に到達させない。実行制御（onCall→Cloud Task）・永続（repository）・逐次追記フロー・`FactCheckFinding` 契約は不変。
  - 入力シグナルは既存資産で充足：`DebateTurn.speechMode`（`opinion/fact/question`）はターンに保持済みだが runner 未使用。現在日時は `currentDateString()`（[prompt-formatters.ts](functions/src/utils/prompt-formatters.ts#L4)）を `FactCheckContext` に足すだけで時間軸検証に使える。
  - 非断定の主張は**検証せず（grounding 検索にも掛けず）finding も生成しない**。検証しない以上ファクトチェック判断を含む指摘は残せないため、別種の指摘（`contextual` 等）は設けない。結果として `FactCheckVerdict` / `FactCheckFinding` の契約は不変。

## 設計やり直しの経緯（requirements ⇔ design ズレの是正）

- **発見されたズレ**: 旧 design.md:168 は「Phase1 で前提部分まで検索しても実コスト不変／Phase2 で非断定を落とす」とし、判定ゲートを Phase2（指摘段階）に置いていた。これは requirements **2.1/2.2/2.3「非断定は検証も指摘もしない」**を実装しておらず、「検証はするが指摘しない」へ実質ダウングレードしていた。
- **実害**: Phase1 が問いの前提（loaded question の偽の前提、例「FSBがウクライナ市民を処罰する」）まで検索検証し、「それは誤り」という検証テキストを生成。これが Phase2／後段の修正適否ジャッジをすり抜ける**過検出の燃料**になっていた（運用ログで確認: 同一 claim がジャッジ実行ごとに skip/非skip でブレた）。
- **是正方針**: 断定ゲートを **Phase1 検索の前（Phase0）** に置き、非断定は検索検証にも掛けない。requirements は正しいので据え置き、design のみ要件に整合させ直す。
- **下流への波及**: 上流で非断定を断つため、後段 `fact-check-correction-worthiness`（修正適否ジャッジ）が拾うべき過検出が縮小する。当該ジャッジの要否・スコープは correction-worthiness スペックで別途再評価する（本スペックの Revalidation Trigger に明記）。

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
| A: Phase2 抑制（旧採用→**棄却**） | Phase1 で全文検索し Phase2 で非断定を落とす | 1ファイル集中・呼び出し数最小（×2） | **req 2.1「検証しない」を満たさない**／前提の検証テキストが過検出の燃料に | design.md:168 の旧方針。要件違反のため棄却 |
| B→**D: Phase0 断定ゲート前置（採用）** | Phase1 検索の前に断定分類（Flash・grounding なし）を1段置き、非断定は検索に渡さない | **req 2.1/2.2/2.3 を文字通り満たす**・過検出の燃料を断つ・純粋な問いは Pro grounding を丸ごと省ける | 混在発言で呼び出し×2→×3（断定ゼロ発言は×1で早期 return） | 旧 research は「×3 でコスト過剰」と B を棄却したが、(1) 要件が「検証しない」を要求、(2) 非断定発言は重い grounding(Pro) を省けて純減もあり得る、で再評価し採用 |
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

### Decision（再設計・採用）: 断定ゲート（Phase0）を Phase1 検索の前に置き、非断定は検証しない
- **Context**: 旧設計（Phase2 抑制）は req 2.1「非断定は検証しない」を満たさず、Phase1 が問いの前提まで検索検証して過検出の燃料を生んでいた。判定ゲートを検索の前へ移す。
- **Selected Approach**: `checkTurn` の先頭に Phase0（`generateObject`・Flash・**grounding なし**）を新設し、発言から「検証すべき断定された事実主張」のみを抽出。抽出ゼロなら **Phase1/Phase2 を実行せず空配列を返す**。混在発言は断定主張のみを Phase1 へ渡す。質問内の確定事実は抽出して検証（3.3）。不確実なら断定として抽出（3.6・保守的デフォルト）。`speechMode` は手掛かりに留める（1.5）。
- **Rationale**: 断定/非断定は発言テキストだけで判断でき grounding 不要。検索の前に落とせば (a) req 2.1/2.2/2.3 を文字通り満たし、(b) 過検出の燃料（前提の検証テキスト）が生まれず、(c) 純粋な問い・意見の発言では重い Pro grounding を丸ごと省ける。
- **Trade-offs**: ✅ 要件準拠・過検出を根本で抑制・非断定発言はコスト純減 / ❌ 混在・断定発言は LLM 呼び出しが×2→×3、判定精度は Phase0 プロンプト依存。
- **Failure Handling**: Phase0 が失敗したら見逃し回避を優先し全文を Phase1 にフォールバック（フェイルオープン）。
- **Follow-up**: 提示済み4例（停戦前提・国連/赤十字の仮定・W杯試合数・時間軸）＋ loaded question（問いの中の偽前提）を評価ケースに。上流抑制の効果を踏まえ correction-worthiness（修正適否ジャッジ）の要否を再評価。

## Risks & Mitigations
- 断定/非断定の LLM 判定精度がファジー — 3.6（不確実なら検証）を保守的デフォルトにし、4例で回帰確認。
- 抑制により本来の誤りまで取りこぼす（過剰抑制） — 3.6 を保守的デフォルトにし、質問内の確定事実（3.3）・制度変更（3.4）・時間軸（3.5）の検証維持を明示。
- 既存 runner テストへの影響 — 非断定で finding が出ないこと等のケース追加を tasks に含める（型・契約は不変）。

## References
- [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) — 判定ロジックの中心
- [turn.types.ts](functions/src/types/turn.types.ts) — `DebateTurn.speechMode`
- [prompt-formatters.ts](functions/src/utils/prompt-formatters.ts) — `currentDateString()`
- `.kiro/specs/chapter-fact-check/design.md` — 既存ファクトチェックの設計と Revalidation Triggers
