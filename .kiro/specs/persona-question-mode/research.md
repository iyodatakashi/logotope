# Research & Design Decisions

## Summary
- **Feature**: `persona-question-mode`
- **Discovery Scope**: Extension（既存の debate pipeline への型・プロンプト拡張）
- **Key Findings**:
  - `Engagement` 型は発言形式の意図を表すため `question` モードの追加は概念的に一貫している
  - `targetPersonaId` は `Engagement` ではなくターン生成フェーズで確定させる（責務分離）
  - 話者選択ロジック（`speaker-selection.ts`）は変更不要。`DebateTurn.targetPersonaId` → `getLastTargetPersona` の既存パスが機能する
  - `TurnGenerationContext` に `otherPersonas` を追加し、questionモード時に参加者ID→名前マップを提供する

## Research Log

### engagement評価でのtargetPersonaId設計

- **Context**: questionモードで「誰に聞くか」をどこで決めるか
- **Findings**:
  - `Engagement` に `targetPersonaId` を持たせると、発言意欲の記録（reaction）に指名情報（direction）が混在し責務違反
  - `intentSummary` に「○○さんの発言について聞きたい」と自然言語で記述すれば、ターン生成時にLLMが適切な相手を選べる
  - `otherPersonas: { id, name }[]` をターン生成コンテキストで渡せば、LLMが名前→IDマッピングできる
- **Implications**: `Engagement` 型に `targetPersonaId` を追加しない。`TurnGenerationContext` に `otherPersonas` を追加する

### 話者選択への影響

- **Context**: questionモードの参加者が必ずしも次に発言するとは限らない（スコアや指名順）
- **Findings**:
  - questionモードは「このペルソナが発言するとき質問形式にする」というフラグであり、話者選択順には影響しない
  - 生成されたターンに `targetPersonaId` がセットされれば、次ターンで `getLastTargetPersona` が読み取り指名優先になる（既存動作）
  - `speaker-selection.ts` の変更は不要
- **Implications**: speaker-selectionは変更不要

### questionモードのキュー動作

- **Context**: questionモードの意図がキューに積まれた場合の振る舞い
- **Findings**:
  - `addQueuedIntents` は `intentSummary` をキューに保存する
  - キュー消化時、`speakerSelection.intentSummary` が `engagement.intentSummary` を上書きする（既存動作）
  - モード（`question/opinion`）はキューに保存されないが、`intentSummary` が質問文脈を含むため再評価時も `question` モードが選ばれやすい
- **Implications**: キュー周りの変更不要

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | 採用 |
|--------|-------------|-----------|-------|------|
| Engagement に targetPersonaId を追加 | 評価フェーズで指名先を確定 | 明示的 | 責務混在（reaction に direction を混ぜる） | ✗ |
| intentSummary に自然言語で記述 | ターン生成LLMが文脈から読み取る | 責務分離を維持 | LLMの解釈に依存するが、名前→IDマップ提供で補完可能 | ✓ |

## Design Decisions

### Decision: `otherPersonas` を `TurnGenerationContext` に追加

- **Context**: questionモードのターン生成時、LLMが `targetPersonaId` をセットするには参加者ID一覧が必要
- **Alternatives Considered**:
  1. システムプロンプトに固定で参加者リストを含める → 全モードで余分なトークンを消費
  2. `TurnGenerationContext` に追加し、questionモード時のみ使用 → 必要なときだけ有効化
- **Selected Approach**: `TurnGenerationContext.otherPersonas: ReadonlyArray<{ id: string; name: string }>` を追加。`generateTurn` 内でquestionモード時のみ参加者マップを指示文に含める
- **Rationale**: スコープを絞り、既存モードの動作に影響しない
- **Trade-offs**: `generatePersonaTurn` 呼び出し時に `personas` から `otherPersonas` を構築する軽微な追加処理が発生

### Decision: フォールバック (`question` → `opinion`)

- **Context**: questionモードでターンを生成したが、LLMが `targetPersonaId` をセットしなかった場合
- **Selected Approach**: `generatePersonaTurn` 内で `speechMode === 'question' && !targetPersonaId` のとき `speechMode` を `'opinion'` に差し替えてFirestoreに保存
- **Rationale**: `targetPersonaId` のないquestionターンは指名質問として機能しないため、opinionとして記録する方が整合性が高い

## Risks & Mitigations

- LLMがquestionモードで `targetPersonaId` を設定しない頻度が高い → フォールバックで `opinion` に降格。プロンプト調整で対応
- `question` モードが過剰に選ばれ討論が質問ループになる → engagementの優先順位説明で「質問できる具体的な事項がある場合のみ」と明示
- `intentSummary` の質問対象名がターン生成LLMに正確に伝わらない → `otherPersonas` の名前→IDマップを指示文で明示
