# Research & Design Decisions

---
**Feature**: `facilitator-intervention-engagement-fix`
**Discovery Scope**: Extension（既存モジュールの動作修正）

**Key Findings**:
- `state.pendingIntervention` による遅延保存が「介入前にメンバーターンが先行する」逆転バグの根本原因
- `persistInterventionTurn` はすでに `state.turns` への即時追加とFirestore書き込みを行う実装になっており、即時呼び出しのインフラは整っている
- `state.lastSpeakerId` のクリアは `persistInterventionTurn` への1行追加で完結する

---

## Research Log

### pendingIntervention パターンの挙動分析

- **Context**: debate-turn-loop-refactor スペックで導入されたパターンが意図通りに機能しているか検証
- **Sources Consulted**: `debate-orchestrator.ts` コード精査
- **Findings**:
  - `executeTurn` は介入を検出すると `state.pendingIntervention` にセットするが、`generatePersonaTurn` の呼び出しを中断しない
  - その結果、メンバーターンが Firestore に先に保存され、ファシリテーターターンが次イテレーション冒頭に後から追記される
  - Firestore のターン順序: メンバー → ファシリテーター（逆転）
- **Implications**: `pendingIntervention` パターンは介入の「保存タイミング」を分離しただけで、同一 `executeTurn` 内でのメンバーターン生成は止めていない

### persistInterventionTurn の実装確認

- **Context**: 即時保存への変更が可能かを評価
- **Findings**:
  - `persistInterventionTurn` は `state.turns.push(...)` と Firestore `arrayUnion` を行い、`pairConversationTurns = 0` をセットする
  - `state.lastSpeakerId` の更新は含まれていない
  - 戻り値は `SpeakerSelection | undefined`（現在の呼び出し元では未使用）
- **Implications**: 即時呼び出しに技術的障壁はない。`state.lastSpeakerId = undefined` の追加が必要

### DebateState.pendingIntervention フィールドの依存調査

- **Context**: フィールド削除の影響範囲を確認
- **Findings**:
  - 参照箇所: `debate-orchestrator.ts` の `executeChapterTask` メインループと `executeTurn` のみ
  - `state-restore.ts` では復元対象に含まれていない（= Firestore に永続化されていない）
- **Implications**: フィールド削除は2ファイル（`debate.types.ts`・`debate-orchestrator.ts`）の変更のみで完結

### evaluateEngagement の lastSpeakerId 依存

- **Context**: ファシリテーターターン後に全メンバーを評価対象にするための条件を確認
- **Findings**:
  - `evaluateEngagement` は `personas.filter((p) => p.id !== state.lastSpeakerId)` で除外している
  - `state.lastSpeakerId` が `undefined` であれば全メンバーが評価される
- **Implications**: `persistInterventionTurn` で `state.lastSpeakerId = undefined` にセットするだけで Req 2 の全AC が充足する

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| 即時保存＋早期リターン（採用） | intervention 検出時に `persistInterventionTurn` を直接呼び出し、`generatePersonaTurn` 前にリターン | シンプル、ターン順序を構造的に保証、`pendingIntervention` 不要 | なし |
| pendingIntervention + early return | pendingIntervention はそのままにしつつ、executeTurn だけ早期リターン | 変更量が少ない | メインループ側の保存ブロックと executeTurn の二重管理が残る |

---

## Design Decisions

### Decision: 介入検出時に executeTurn から即時保存・早期リターン

- **Context**: メンバーターン生成前にファシリテーターターンを確定させる
- **Alternatives Considered**:
  1. `executeTurn` 内で pendingIntervention を早期リターンのシグナルとして使い続ける
  2. メインループ側で pendingIntervention を先に処理してから executeTurn を呼ぶ
- **Selected Approach**: `executeTurn` で介入を検出したらその場で `persistInterventionTurn` を呼び出し、`return true` で早期リターン
- **Rationale**: 「介入 = ファシリテーターのターン」という責務を executeTurn 内に閉じ込められる。メインループ側の pendingIntervention ブロックが不要になりシンプル
- **Trade-offs**: `persistInterventionTurn` の呼び出し元が増えるが、同じ関数を呼ぶだけで副作用はない

### Decision: pendingIntervention フィールドの削除

- **Context**: 採用アプローチでは `pendingIntervention` が不要になる
- **Selected Approach**: `DebateState` から `pendingIntervention` フィールドを削除し、関連するメインループのブロックも除去
- **Rationale**: 未使用フィールドを残すと将来の誤用リスクがある
- **Follow-up**: テストファイルの `lastFacilitatorTurnIndex: -1` のようなデフォルト値の確認が必要

---

## Risks & Mitigations

- **chapterTurnCount のカウント**: `persistInterventionTurn` を executeTurn 内で呼ぶと、その時点で `chapterTurnCount()` が増加する。ただし while ループ条件は次イテレーションの入口で再評価されるため問題なし
- **maxTurns 到達時の挙動**: executeTurn 内でファシリテーターターンを保存後に `state.turns.length >= maxTurns` になった場合、while ループは次イテレーション入口で自然に終了する
- **isDebateActive ゲート**: `persistInterventionTurn` の前に `isDebateActive` チェックはないが、executeTurn はすでにそのチェックなしで介入評価を行っている（現状と同じ）

---

## References

- `functions/src/pipeline/debate/debate-orchestrator.ts` — 変更対象メインファイル
- `functions/src/types/debate.types.ts` — `DebateState` 型定義
- `functions/src/pipeline/debate/state-restore.ts` — `pendingIntervention` が復元対象外であることを確認
