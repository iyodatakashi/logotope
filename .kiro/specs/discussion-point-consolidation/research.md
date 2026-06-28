# Research & Design Decisions: discussion-point-consolidation

## Summary
- **Feature**: `discussion-point-consolidation`
- **Discovery Scope**: Extension（既存討論パイプラインの改修）
- **Key Findings**:
  - `focusQuestion` は型4定義・生成・永続・読み出し・プロンプト6箇所・管理UI1箇所に分散。公開閲覧側と Data Connect には無い。
  - drift/stall は `runInterventionCheck`（`facilitator-agent.ts:38-67`）の単一地点で `focusQuestion` を「章のミッション」として注入している。ここを active 論点基準へ書き換えれば両介入に効く。
  - **既存欠陥**: 介入経路（`intervention.ts:182-190`）は `markIntroduced` を経由せず `status='introduced'` を直接書くため、`introducedOrder` が付与されない。介入で投入された論点がアクティブ論点追跡（最新 introduced）から漏れる。本仕様で全 introduced 遷移を `markIntroduced` に統一して是正する。

## Research Log

### `focusQuestion` のタッチポイント網羅
- **Context**: 完全廃止のため参照箇所を漏れなく洗う必要。
- **Sources Consulted**: `grep -rn focusQuestion`（functions / src / dataconnect）、gap-analysis.md の対応表。
- **Findings**: 型（`functions/src/types/chapter.types.ts:6,42,63`、`fact-check.types.ts:23`、`pipeline/debate/chapter.ts:15,34`、`src/lib/models/chapter/chapter.types.ts:15`）、生成（`agents/chapter-agent.ts:53,237,256-267`）、永続（`pipeline/chapters/chapter-generator.ts:53`）、消費（`persona-agent.ts:219`、`facilitator-agent.ts:46,76,231`、fact-check `runner:63,309`/`judge:37`/`turn.ts:239`）、UI（`Phase5Debate.svelte:158`）。
- **Implications**: 公開閲覧は無影響。Firestore 旧データの残存フィールドは読み出しから外せば無視されるため、バックフィル不要で後方互換が成立。

### drift/stall の判定基準の単一注入点
- **Context**: drift と stall で別々に focusQuestion を扱うと変更が散る。
- **Findings**: `evaluateTopicDrift`/`evaluateStallIntervention` はいずれも `runInterventionCheck(turns, personas, currentChapter, criteria)` を呼び、章ミッション文言は `runInterventionCheck` 内（L45-47）で一元生成。`unaddressedDiscussionPoints` は各 evaluator 側で criteria に展開（`facilitator-agent.ts:120-122,151-153`）。
- **Implications**: 「章の軸」を active 論点へ替えるのは `runInterventionCheck` の引数追加1点で済む。criteria 内の「フォーカス問いから逸脱」文言（L122,127）は active 論点基準へ書き換える。

### 投入候補の index 整合（最大の論点）
- **Context**: R4-2「投入候補から introduced を除外」。
- **Findings**: `intervention.ts:133` の候補 `unaddressedDiscussionPoints = filter(status !== 'addressed')`（introduced+untouched 混在）が、(a) evaluator への候補表示、(b) `selectedDiscussionPointIndex` の index 空間、(c) `intervention.ts:182-190` の再導出、で共有される。一方 `markIntroduced(state, index)`（`discussion-points.ts:19-34`）は内部で `filter(status !== 'addressed')` を使い、step の opening/intro（`step.ts:301,316`）からのみ呼ばれる。
- **Implications**: 候補を `status === 'untouched'` に統一し、`markIntroduced` の内部フィルタも `untouched` 基準に合わせ、介入経路も `markIntroduced` 経由に一本化すれば、index 整合と introducedOrder 付与の両方が同時に解決する。

### fact-check の文脈経路は2つ
- **Context**: focusQuestion をファクトチェックの話題スコープから外すため。
- **Findings**: インライン検証（`turn.ts:236-241`）は generationContext に active 論点を持つ。章バッチ検証（`fact-check-runner.ts:306-311` `checkChapter`）は読み戻し `ChapterEntry`（status なし）から組み立て、active 論点を持たない。
- **Implications**: `FactCheckContext` の `focusQuestion` を単一フィールド `discussionScope` に置換。インラインは `active 論点 ?? chapterTitle`、章バッチは `chapterTitle` を入れる。consumer（focus 括弧）は `discussionScope` を見るだけ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 全インプレース | 各所で focusQuestion 削除＋active 論点解決をインライン | 新規抽象ゼロ | active+title フォールバック解決が4-5箇所重複、整合ミス | `turn.ts` の reduce と同型コードが散る |
| B. 小ヘルパー1つ＋インプレース（採用） | `getActiveDiscussionPoint(state)` を1つ新設し共通利用 | フォールバック規則を集約、既存重複も解消、steering 合致 | ヘルパー責務境界の明確化が必要 | 純関数・Firestore非依存 |
| C. 段階導入（順序戦略） | 判定付け替え→focusQuestion 物理削除を2段で | テスト緑維持・デプロイ分割 | 一時併存 | B と併用しタスク順序に反映 |

## Design Decisions

### Decision: アクティブ論点解決を純関数1つに集約（Option B）
- **Context**: persona / facilitator(誘導・drift・stall) / fact-check / 章導入 が「最新 introduced 論点、無ければ title」を必要とする。
- **Alternatives Considered**:
  1. 各所インライン（A）— 重複と整合崩れ。
  2. 共通ヘルパー（B）— 1関数に集約。
- **Selected Approach**: `discussion-points.ts` に `getActiveDiscussionPoint(state): string | undefined`（最新 `introducedOrder` の introduced 論点）を新設。フォールバック（title）は呼び出し側で `getActiveDiscussionPoint(state) ?? chapter.title` と組み立てる（title はヘルパーに含めない＝state とドメイン文言の責務分離）。`turn.ts:199-212` の既存インラインもこのヘルパーへ置換。
- **Rationale**: steering「真に共通な純関数はヘルパー化可」。状態（state）依存と章ドメイン文言（title）依存を混ぜない。
- **Trade-offs**: ✅ 整合の単一化 / ❌ 呼び出し側にフォールバック1行が残る（許容）。
- **Follow-up**: 既存 `turn.ts` のアクティブ論点算出をヘルパーに差し替えて回帰がないことを確認。

### Decision: 全 introduced 遷移を markIntroduced に一本化（index 整合＋introducedOrder 是正）
- **Context**: 介入経路が introducedOrder を付けず、候補 index 空間が混在。
- **Selected Approach**: 投入候補を `status === 'untouched'` のリストに統一。介入で論点を投入する際は `intervention.ts:182-190` の直接代入を廃し、`markIntroduced(state, selectedDiscussionPointIndex)` を呼ぶ。`markIntroduced` の内部フィルタを `untouched` 基準に変更し、候補リスト・selectedDiscussionPointIndex・markIntroduced が同一 index 空間を共有する。
- **Rationale**: R4-2 と「介入投入論点が active 論点として追跡される（R3 正しさ）」を同時に満たす。
- **Trade-offs**: ✅ 二重ロジック解消・欠陥是正 / ❌ `markIntroduced` のフィルタ変更は opening/intro 経路にも効くため回帰確認が要る（新章は全 untouched なので挙動不変）。
- **Follow-up**: opening/intro 時の index=0 が「最初の untouched」を指すことをテストで固定。

### Decision: 段階的タスク順序（Option C を順序戦略として採用）
- **Context**: 本番直結・エミュレータ未使用で挙動はデプロイ後観測。
- **Selected Approach**: タスクを「①active 論点解決ヘルパー＋introduced 一本化 → ②判定/誘導/章導入/fact-check の付け替え → ③型・生成・永続・読み出し・UI から focusQuestion 物理削除」の順に並べ、各段でテスト緑を保つ。
- **Trade-offs**: ✅ リスク分割・ロールバック容易 / ❌ 中間状態で focusQuestion と active 論点が併存。

## Risks & Mitigations
- drift 基準を傘（focusQuestion）→具体論点へ変更 → 介入頻度・引き戻し挙動が変化。→ デプロイ後に介入ログを観測。`facilitator-intervention-timing` のチューニング知見と整合させる。
- discussionPoints を「問いの形」で生成 → 章導入・閲覧の入口品質が変わる。→ 生成サンプルで確認（eval）。フォールバック（issue text）は従来どおり。
- `markIntroduced` フィルタ変更が opening/intro に波及 → 新章は全 untouched で挙動不変だが、ユニットテストで index 固定。
- 旧 Firestore データの focusQuestion 表示消失 → バックフィルしない方針はユーザー合意済み（title + discussionPoints 表示へ統一）。

## References
- `.kiro/specs/discussion-point-consolidation/requirements.md` — 要件 R1-R7
- `.kiro/specs/discussion-point-consolidation/gap-analysis.md` — 現状調査と対応表
- `.kiro/specs/facilitator-intervention-timing/` — 介入タイミングの既存設計・チューニング知見
