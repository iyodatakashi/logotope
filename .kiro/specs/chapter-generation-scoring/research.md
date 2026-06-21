# Research & Design Decisions

## Summary
- **Feature**: `chapter-generation-scoring`
- **Discovery Scope**: Extension（既存 `functions/src/agents/chapter-agent.ts` の改修）
- **Key Findings**:
  - 現状は「issue生成（general/persona 並列2回）→ chapter生成1回」の計3回AI呼び出し。章数は chapter生成プロンプトの「3〜4章」指示で固定誘導されている。
  - `generateChapters` の戻り値 `{ chapters, generalIssues, personaIssues }` は `chapter-generator.ts` が直接 Firestore 書き込みに使う。シグネチャ・戻り値を変えない方針が呼び出し側無改修の条件。
  - 章の discussionPoints は最終的に issue がぶら下がる構造。スコアリング単位を issue にすると、最終構造（章の中身）と評価単位が一致し品質を直接制御できる。

## Research Log

### スコアリング単位の選択（issue vs group）
- **Context**: 章数を可変にするためスコアリングを導入する際、評価対象を「グループ」にするか「個別issue」にするか。
- **Sources Consulted**: 既存 `chapter-agent.ts`、`chapter.types.ts`（Chapter 型の discussionPoints: string[]）、ユーザーとの設計議論。
- **Findings**:
  - グループ単位スコアでは、強い論点と弱い論点が混在したグループが一括採用され、弱い論点が discussionPoints に残る。
  - issue単位スコアなら、生き残った論点だけがグループ化され discussionPoints になるため、章の中身の品質を直接制御できる。
  - 章数は「採用論点のクラスタ数」として内容に応じて自然に決まる。
- **Implications**: パイプラインを「issue生成 → issueスコアリング・選別 → 採用issueのグループ化・章化」の順に構成する（スコア→選別→グループ化の順）。

### スコア分布の偏り対策
- **Context**: LLMにスコアを出させると全項目を高得点に寄せる傾向がある。
- **Findings**: 全issueを1プロンプトに同時提示して相対評価させ、「全部を高得点にしない」「低スコア（5以下）を必ず含める（全issueが高品質な場合を除く）」を明示制約として与える。
- **Implications**: スコアリングは個別孤立評価ではなく1回のAI呼び出しで全issueを比較評価する。

### AI呼び出し回数とトークン
- **Context**: ステップ追加による呼び出し回数増。
- **Findings**: 既存3回（issue生成2並列 + 章化1）に対し、スコアリング1回を追加して計4回。スコアリング・章化とも `MAX_TOKENS.FACILITATOR_CHAPTER_*`（4096）で足りる規模。新規定数は不要だが、可読性のためスコアリング用トークン定数を追加してもよい。
- **Implications**: 既存 `AI_MODELS.SONNET` / `generateObject`（Vercel AI SDK）パターンを踏襲。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| グループ→スコア（旧案） | issue をグループ化してからグループをスコアリング | ステップが直感的 | 弱いissueが章内に残る、グループ化が未選別issueに影響される | 不採用 |
| issue→スコア→グループ（採用） | issue個別スコア→選別→採用issueをグループ化して章に | 評価単位と最終構造が一致、章数が自然に決まる | issue孤立評価のリスク（全体提示で緩和） | 採用 |

## Design Decisions

### Decision: スコアリングを issue 単位・選別後グループ化に
- **Context**: Requirement 1〜3。可変章数と discussionPoints 品質の両立。
- **Alternatives Considered**:
  1. グループ→スコア — グループ単位採否。弱いissueが残る。
  2. issue→スコア→グループ — issue単位採否後にグループ化。
- **Selected Approach**: 全issueを1回のAI呼び出しでスコアリング（general/persona区別を保持）→ 閾値7で選別（不足時はスコア上位補充、general最低1件保証）→ 採用issueをグループ化して各グループを章化。
- **Rationale**: 章にぶら下がる discussionPoints の品質を直接制御でき、章数が論点クラスタ数として自然に決まる。
- **Trade-offs**: AI呼び出しが3→4回に増える。issue孤立評価のリスクは全体一括提示で緩和。
- **Follow-up**: 閾値7・最大5章・最低2章の妥当性は実データで観察。

### Decision: 章ごとの論点再構成ステップを追加
- **Context**: Requirement 4。採用issueは別々のスコアで選ばれるため、同一章に集まると意味的に重複しうる。また採用issueが少ない章では論点が不足する。
- **Alternatives Considered**:
  1. 章化ステップ内で discussionPoints も同時生成（補完含む） — 1ステップで完結するが、重複統合と件数調整が章メタ生成に混ざり制御しづらい。
  2. 章化（グループ化＋メタ生成＋論点割り当て）と、章ごとの論点再構成を分離 — 採用issueを章の核として確定させてから、章単位で discussionPoints を作り直す。
- **Selected Approach**: 2。ChapterComposer が「グループ化・title/focusQuestion・issue割り当て」を担い、ChapterPointAuthor が「章ごとに割り当てissueを素材に discussionPoints を作り直し、重複統合して3〜5件に整える」。
- **Rationale**: 採用issueを章に確定させた後で論点を作り直すことで、別々に選ばれた採用issueの意味的重複を章単位で解消でき、discussionPoints の品質を直接制御できる。
- **Trade-offs**: AI呼び出しが1回増える（計: issue生成2並列 + スコア1 + 章化1 + 論点再構成1）。章間の論点重複は対象外（章内に限定）。
- **Follow-up**: 章間重複が問題になる場合の調整は将来拡張。

### Decision: インターフェース互換性の維持
- **Context**: Requirement 5。`chapter-generator.ts` を無改修にする。
- **Selected Approach**: `generateChapters(topicTitle, personas, topicContext)` の引数・戻り値型を変更せず、内部ステップのみ追加・差し替え。
- **Rationale**: 呼び出し側・Firestore書き込み・型への波及をゼロにする。
- **Trade-offs**: なし（内部実装の差し替えに閉じる）。

## Risks & Mitigations
- スコア全体が高得点に偏る — 全issue一括提示＋低スコア強制制約で緩和。
- 採用issueが少なく章が作れない — スコア上位補充で最低2章分を確保、general最低1件保証。
- グループ数が過多 — 上限5、超過時は意味的近接グループを統合。
- issue孤立評価による良issue脱落 — 1プロンプトで全体比較評価。

## References
- 既存実装: `functions/src/agents/chapter-agent.ts`
- 呼び出し側: `functions/src/pipeline/chapters/chapter-generator.ts`
- 型: `functions/src/types/chapter.types.ts`
