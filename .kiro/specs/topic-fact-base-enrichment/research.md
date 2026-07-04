# Research & Design Decisions: topic-fact-base-enrichment

## Summary
- **Feature**: `topic-fact-base-enrichment`
- **Discovery Scope**: Extension（既存 `topic-fact-base` の生成品質・取材モデルの拡張。gap-analysis.md 参照）
- **Key Findings**:
  - 本仕様はほぼ全面が**既存3エージェントのプロンプト/フロー調整**であり、新規アーキ・API・サブコレクションを要しない。
  - 層②（ペルソナ固有の事実認識）は**信念ドキュメントの markdown 1セクション**として持てる（永続形 `beliefs:[{content}]` は文字列のまま＝Option A）。ただし3フェーズ取材を駆動するため `DraftBelief` に構造化スロットを1つ足すのが扱いやすい。
  - 共有事実基盤（`FactItem`/`FactBase`）・供給経路（`getTopicContext`/`formatFactBaseSection`）は不変。事実の具体化は全消費者へ自動伝播する。
  - 支配的リスクは**挙動品質（LLM 応答依存）**と、着地済み取材パイプラインの「反証起点→実態/立場から見た事実」再定位による**回帰**。

## Research Log

### 既存 fact-research の蒸留構造（R1–3, R7）
- **Context**: 事実の具体性・網羅性・帰属形をどこで担保するか。
- **Sources Consulted**: `functions/src/agents/fact-research-agent.ts`、`utils/prompt-formatters.ts`。
- **Findings**: `structuringSchema = { facts: [{ statement: string, sourceIndices: number[] }] }`。件数下限なし、statement は自由文字列。grounding テキストは `buildStructuringPrompt` で1文へ蒸留され、出典は `sourceIndices`→sources に写像済み。
- **Implications**: 充実・帰属形は**プロンプト強化で実現**（スキーマ変更不要）。件数は zod `min()` で強制すると R2.4（空縮退）と衝突するため、**ハード強制せずプロンプト指示**にとどめる。

### 既存 interview の3フェーズと信念永続（R8）
- **Context**: 層②の器と、grounding 再定位の接続点。
- **Sources Consulted**: `functions/src/agents/interview-agent.ts`、`api/interviews.ts`、`agents/persona-agent.ts`。
- **Findings**: `DraftBelief`（6項目）→ `verifyWithGrounding`（現状「反証起点」）→ `generateFinalBelief`（`initialBelief` は6節 markdown 文字列＋`interviewRecord`）。永続は `beliefs:[{version, content: initialBelief}]`、討論消費は `latestBeliefContent(persona)`（markdown 文字列）を system プロンプトへ注入。`InterviewOutput.draftBelief` も interview トレースとして永続。
- **Implications**: 層②は `initialBelief` に**1セクション追加**（永続形不変）で消費に自動到達。3フェーズを貫通させるため `DraftBelief` に `perceivedFacts` を**加算（optional・非破壊）**するのが自然。

### 層②優先の注入点（R8.8/8.9）
- **Context**: 共有事実と層②が衝突する際の優先を、どこで表現するか。
- **Sources Consulted**: `agents/persona-agent.ts` `generateTurn`（`factBaseNote`＋`system`（belief）を注入）。
- **Findings**: 討論ターン生成は共有事実（`factBaseNote`）とペルソナ信念（`system`）を同一プロンプトに注入している。
- **Implications**: 優先は `generateTurn` の**プロンプト指示**（「共有事実は共通前提。ただし自分の認識と食い違う点は自分の認識を優先し、共有側を自分の立場から再解釈せよ」）で表現。供給値は不変（R9.3 維持）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存エージェントのプロンプト拡張（採用） | fact-research/interview/persona のプロンプト・書式を強化。型/永続/配線不変 | 新規ファイルほぼ無し・下流自動伝播・既存パターン踏襲 | 挙動が LLM 依存で保証しづらい・テスト文言更新の広がり | steering「過度な共通化をしない」に整合 |
| B: 新規コンポーネント化 | 充実/層②を専用モジュール・型で分離 | 責務分離 | 生成調整に独立責務は薄く過剰 | 却下 |
| C: A＋層②の構造化スロット（部分採用） | 永続は markdown 節（A）だが `DraftBelief` に `perceivedFacts` を加算 | 3フェーズ貫通が明示・テスト容易 | 内部ドラフト型の加算（非破壊） | 採用（A の内側で最小の構造化） |

## Design Decisions

### Decision: 層②の保持形＝信念 markdown 節＋ドラフト構造化スロット
- **Context**: 層②（立場から見た事実）を信念文書の一部にするか別フィールドにするか（要件協議で Option A 合意済み）。
- **Alternatives Considered**: 1) 別永続フィールド（`factPerceptions[]`） 2) 信念 markdown 節のみ 3) 節＋内部ドラフトスロット。
- **Selected Approach**: 永続は `initialBelief` markdown に「## 前提としている事実（立場から見た事実）」節を追加（永続形・消費不変）。取材3フェーズを貫くため `DraftBelief` に `perceivedFacts: string` を optional 加算。
- **Rationale**: 層②は本質的に信念であり、討論注入（`latestBeliefContent`）に配線ゼロで乗る。共有 `factBase` と構造を並べないことで「事実として注入」する誤用を避ける（no-over-abstraction / mirror-firestore-shape）。
- **Trade-offs**: ✅ 型/永続/配線最小・下流自動 ／ ❌ markdown 節の抽出は将来の構造化要求時に follow-up が要る。
- **Follow-up**: 立場横断の事実食い違い可視化が要求されたら構造化フィールドへ抽出。

### Decision: grounding の再定位（反証→実態/立場から見た事実、耐性なし）
- **Context**: 取材の反証グラウンディングが「客観的真偽」に滑ると、陰謀論者等の立場が矯正され消える。
- **Alternatives Considered**: 1) 反証耐性を持たせる（当初案・不健全＝仮の信念に抵抗させる循環） 2) grounding の対象を「その立場の当事者が実際にどう認識するか（実態）」へ再定位し耐性なく反映。
- **Selected Approach**: (2)。grounding は**システムのステレオタイプ是正**に使い（実在感向上・維持）、**ペルソナの事実認識を consensus へ矯正しない**。乖離は「推定違いの是正」として耐性なく反映。
- **Rationale**: 「反証」の実体は AI 初期推定への「実態はこう」の是正であり、耐性は不要。全ペルソナ一律・カテゴリ分岐なし（更新/保持の度合いはプロフィールから創発）。
- **Trade-offs**: ✅ 立場を平板化しない・分岐なし ／ ❌ 着地済み取材プロンプトの挙動変更＝回帰リスク、既存テスト文言更新。
- **Follow-up**: 代表テーマ（時事・領土/宗教・陰謀論）で eval。

### Decision: 共有基盤は帰属・観測形／真実として位置づけない
- **Context**: 「係争中」等の評価的特徴づけ・一方の主張の事実化が混入し、人手では検証不能（ユーザーは事実を知らない）。
- **Alternatives Considered**: 1) 人手レビューで是正（不可＝事前知識に依存） 2) 帰属・観測形＋層②優先＋出典＋読者FC で被害最小化。
- **Selected Approach**: (2)。共有基盤は帰属・観測形（誰が主張/実効支配、文書化事象、「コンセンサスによれば」）でのみ記述し、裸の裁定・評価的特徴づけを避ける。正確性を人手/事前知識に依存させず、出典と（別スコープの）読者FCへ委譲。真実として位置づけない。
- **Rationale**: established-but-denied/genuinely-open の分類ミスはゼロにできない前提で、被害半径を構造で最小化する。
- **Trade-offs**: ✅ 人間依存を外し軟着陸 ／ ❌ コードでは強制されず、プロンプト＋UI/製品の言い回しに依存（残余リスクを明示）。

## Risks & Mitigations
- **効果が LLM 挙動依存** — 代表テーマでの eval（`*.eval.test.ts` に倣う）＋プロンプト内包アサーションで最低限の回帰検知。
- **取材再定位の品質回帰**（反証→実態） — 段階導入＋既存フロー統合テストの文言更新＋eval で「立場が平板化しない/実在感が落ちない」を確認。
- **established-but-denied を過度に相対化**（R7.5 との緊張） — 帰属形（「コンセンサスは〜」）で確立事実を保持し、否定の存在で取り下げない指示を明記。
- **コスト/レイテンシ増**（事実の具体化・件数増が全下流へ伝播） — 具体度・件数の方針を設計で定め、過度な冗長化を避ける。
- **真実非保証がコード非強制** — UI 文言・下流の扱いで「検証済み」と誤認させない（追加の"verified"ラベルを設けない）。

## References
- `.kiro/specs/topic-fact-base/`（土台：事実基盤の生成・永続・供給・消費）
- `.kiro/specs/persona-interview-grounding-pipeline/`（取材の3フェーズ信念グラウンディング）
- `.kiro/specs/topic-fact-base-enrichment/gap-analysis.md`（Requirement→Asset マップ、Effort/Risk）
