# Research & Design Decisions: chapter-agenda-progression

## Summary
- **Feature**: `chapter-agenda-progression`
- **Discovery Scope**: Extension（既存の討論オーケストレーションへの統合的変更）
- **Key Findings**:
  - `addressed` は現状 `reconcileEarlyEndCoverage`（早期終了間際のみ）でしか付かず、盛り上がり中はアジェンダ完了を検知できない。前進の根拠である「出尽くし判断」は addressed に反映されていない（二段構え）。
  - 論点前進・消化・終了は既存の純粋関数（`agenda.ts` / `decideNextStep`）に集約済みで、拡張点は明確。`markAddressed(state, point)` と `getActiveAgendaItem(state)` は既存・再利用可能。
  - stall 介入（`evaluateStallIntervention`）だけが「章の趣旨で新論点を発明」を許し、未提示リストへの忠実性・発明禁止が抜けている。drift 介入（`evaluateTopicDrift`）は既に忠実縛りあり。

## Research Log

### 論点ステータスの遷移と唯一の addressed 経路
- **Context**: 「消化済み」をいつ・どこで確定しているかの把握。
- **Sources Consulted**: `functions/src/pipeline/debate/agenda.ts`, `functions/src/pipeline/debate/step.ts`（`reconcileEarlyEndCoverage`）, `functions/src/agents/facilitator-agent.ts`（`evaluateAgendaItemCoverage`）。
- **Findings**:
  - untouched →（`markIntroduced`）→ introduced →（`markAddressed`）→ addressed。
  - `markAddressed` の呼び出し元は `reconcileEarlyEndCoverage` の1箇所のみ。同関数は `isEarlyEndCandidate` 不成立なら即 return するため、盛り上がり中は addressed が更新されない。
- **Implications**: addressed を「出尽くし判断（前進の根拠）」から逐次記録に切り替えれば、盛り上がり中でも完了検知でき、一括カバレッジ LLM 評価は不要化できる。

### 介入カスケードと前進の判別
- **Context**: 「前進」「引き戻し」「介入なし」をコードでどう区別するか。
- **Sources Consulted**: `functions/src/pipeline/debate/intervention.ts`（`tryIntervention`）。
- **Findings**:
  - 前進＝`selectedAgendaItemIndex` が確定して `markIntroduced` が走るケース（:226）。引き戻し＝index 無しで content/target のみ。介入なし＝intervention undefined。
  - `unheardActive`（立場カバレッジ未充足）の間は index を無効化（:219）して前進を封じる。
- **Implications**: 「前進時に前進元アクティブ論点を addressed 化」を `markIntroduced` の直前に置けば、R3.3（カバレッジ未充足なら記録しない）を追加コードなしで満たす。

### 章終了判定の入力
- **Context**: 終了条件に addressed を組み込めるか。
- **Sources Consulted**: `functions/src/pipeline/debate/debate-orchestrator.ts`（`decideNextStep`）。
- **Findings**: `decideNextStep` は既に `agenda: AgendaItemState[]` を受領。終了は hitCap / earlyEnd のみで addressed 数は未使用。finalResponse(+1) は既存。
- **Implications**: `allAddressed` 分岐を hitCap の後段・earlyEnd と並列で追加すれば、cap 優先と最終応答 +1 を維持したまま R4 を満たせる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存フロー拡張 | 介入プロンプト・`tryIntervention`・`decideNextStep`・`reconcileEarlyEndCoverage` を最小拡張 | 既存純粋関数・パターンに沿う、新規ファイルなし | 複数箇所に触れる、一括評価の帰結判断を伴う | **採用** |
| B: 進捗トラッカー新設 | addressed 遷移を専用モジュールへ | 分離・単体テスト容易 | 状態遷移は既に agenda に集約済みで過剰 | 却下 |
| C: ハイブリッド | 最終論点の出尽くし専用パスのみ小ヘルパに隔離 | 見通し | 分岐増 | A で十分なら不要 |

## Design Decisions

### Decision: addressed を「出尽くし判断」から逐次記録する（案B）
- **Context**: 盛り上がり中でもアジェンダ完了を検知したい（R3/R4）。一括カバレッジ LLM 評価はコスト・遅延の元（R5）。
- **Alternatives Considered**:
  1. 案A: 一括カバレッジ評価を章末に前倒し（追加 LLM コスト）。
  2. 案B: 司会が前進（出尽くし）した時点で前進元を addressed 化。最終論点はリスト空時の出尽くし判断で addressed 化。
- **Selected Approach**: 案B。中間論点は前進イベントで addressed 化（既存介入 LLM のみ、追加呼び出しなし）。最終論点は stall を「発明なしの出尽くし判定」に縮退させ、出尽くしなら active を addressed 化。
- **Rationale**: 前進の根拠（出尽くし）は既に判断済み。それを記録に反映するだけで、追加の消化判定 LLM を発生させずに完了検知できる。
- **Trade-offs**: 「出尽くし＝消化」とみなすため、順不同の"ついで消化"や厳密な再チェックは手放す。忠実進行（R1/R2）が効けば各論点は自分の出尽くしで addressed 化されるため実害は小さい。
- **Follow-up**: `reconcileEarlyEndCoverage` の LLM 評価除去後も「未消化が残る間は早期終了しない」保護を非 LLM の状態チェックとして残す。

### Decision: 出尽くし判定を介入行動から分離する（判定/行動の分離）
- **Context**: 現状は「判定＋content 生成＋項目選択」が1つの LLM 呼び出しに融合している。この融合が原因で、最終項目（投入する次項目が無い）で「出尽くし→addressed」が自然に表現できず、`activePointExhausted` や tri-state の特別扱いが必要になっていた。
- **Alternatives Considered**:
  1. 融合のまま stall に `activePointExhausted` を足す（最終項目を特別扱い・半端）。
  2. 判定（assess）と行動（act）を分離する。
- **Selected Approach**: 2。`assessActiveAgendaItem`（出尽くし/論点ずれ/継続の判定のみ・content なし）と `generateInterventionUtterance`（投入 or 引き戻しの発言生成）に分割。`tryIntervention` が「判定→exhausted なら markAddressed(active)→未提示があれば投入・なければ発言なし」を編成する。
- **Rationale**: 「出尽くし → active を addressed」が前進の有無に関わらず一律化し、最終項目の特別分岐（tri-state / 専用フィールド）が消える。忠実性・発明禁止も行動側（投入は未提示リスト内限定）に自然に収まる。
- **Trade-offs**: 判定と行動を分けるため、行動が要る回のみ +1 LLM 呼び出し（非行動ターンは判定のみで実質同数）。介入層（融合関数）の分割という中規模の refactor を伴う。
- **Follow-up**: 最終項目で「発言なしで addressed だけ立てる」際の永続・非ターン生成の配線は tasks で確定。
