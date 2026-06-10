# Research & Design Decisions

## Summary
- **Feature**: `engagement-driven-debate-flow`
- **Discovery Scope**: Extension（既存システムの拡張）
- **Key Findings**:
  - `assessEngagement` はスコアのみ返し、mode は自動導出、intentSummary は存在しない。`generateTurn` に意図が渡っていない
  - `pendingItems: Map<string, number[]>` はトリガーインデックスのみ保持し、何を言いたかったかを保持していない
  - `engagements` フィールドが `TurnEmbed` に埋め込まれており、発言ログと制御データが混在している

## Research Log

### 既存の assessEngagement 実装
- **Context**: score/mode の現行の設計を把握するため
- **Findings**:
  - `ASSESS_ENGAGEMENT_TOOL` は `score: integer` フィールドのみ
  - mode は `score >= 4 ? 'full' : score >= 2 ? 'reaction' : 'none'` で自動導出（コード側）
  - 会話履歴は直近8ターンを渡している
  - `currentBelief` は既に渡されている（`buildPersonaSystemPrompt` に含まれる）
- **Implications**: ツールスキーマに `mode` と `intentSummary` を追加するだけで対応可能。自動導出ロジックを削除して LLM の独立評価に変える

### 既存の generateTurn 実装
- **Context**: intentSummary を受け取るための拡張ポイントを確認
- **Findings**:
  - 引数: `persona, currentBelief, interviewRecord, history, chapter?, pendingTrigger?, assessedMode?`
  - `pendingTrigger?: { speakerName: string; content: string }` でキューのトリガー発言を参照
  - `assessedMode` に応じてツールを切り替え（REACTION_TURN_TOOL / buildFullTurnTool）
  - ユーザープロンプトに `pendingNote` として `pendingTrigger` を埋め込んでいる
- **Implications**: `intentSummary?: string` を追加し、`pendingNote` と同様にユーザープロンプトに埋め込む形で対応できる

### 既存の pendingItems 実装
- **Context**: `PendingIntent` への移行コストを確認
- **Findings**:
  - 現在: `Map<string, number[]>` （triggerTurnIndex のみ）
  - `DebateState` の型定義と orchestrator の 6 箇所の操作を変更する必要がある
  - `PendingThought` 型は `functions/src/types/index.ts` にあるが既に未使用（import から削除済み）
- **Implications**: `PendingIntent { triggerTurnIndex, intentSummary }` に変更することで intentSummary を保持できる

### Firestore データ分離の設計
- **Context**: `engagements` を TurnEmbed から分離する方法を検討
- **Findings**:
  - `sessions/0` ドキュメントには `turns[]` と `postDebateComments[]` が埋め込み済み
  - `engagementLog[]` を同一ドキュメントに追加するアプローチが最もシンプル
  - 200ターン × 4ペルソナ × ~150バイト = ~120KB、1MB制限内で問題なし
  - `FieldValue.arrayUnion(...entries)` で複数エントリを一度に追記できる
- **Implications**: サブコレクション化不要。`sessions/0.engagementLog[]` フィールドで分離可能

### chapter end detection の修正
- **Context**: `mode === 'full'` チェックが mode/score 分離後に不整合になる
- **Findings**:
  - 現行: `rawAssessments.some(a => a.mode === 'full') ? 1 : 0`
  - mode が独立評価になると、score が高くても reaction になる可能性がある
  - 章終了の判断基準は「活発な議論の有無」= score >= 4 の人がいるかどうか
- **Implications**: `rawAssessments.some(a => a.score >= 4) ? 1 : 0` に変更

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| TurnEmbed に engagementLog を追加 | sessions/0 の同一ドキュメントに配列追加 | シンプル、既存パターンと一致 | ドキュメントサイズ増加（ペルソナ数増で1MB超の恐れ） |
| engagements サブコレクション（ペルソナ別） | `sessions/0/engagements/{personaId}` | ドキュメントサイズ問題なし、完全分離、ペルソナごとの思考履歴として整合的 | 管理UI用に別途 onSnapshot が必要 |
| インメモリのみ（永続化なし） | Firestore に保存しない | 最小コスト | デバッグ・管理UIに使えない |

→ **engagements サブコレクション** を採用（ドキュメントサイズリスクを回避）

## Design Decisions

### Decision: intentSummary の generateTurn への渡し方
- **Context**: エンゲージメント評価時の意図を発言生成に反映させたい
- **Alternatives**:
  1. `pendingTrigger` と統合する（既存引数を拡張）
  2. `intentSummary` を独立した新引数として追加
- **Selected**: 独立引数として追加（`intentSummary?: string`）
- **Rationale**: `pendingTrigger` はキュー由来のトリガー発言コンテキストであり、性質が異なる。分離することで両方同時に渡せる
- **Trade-offs**: 引数が1つ増えるが、意図が明確になる

### Decision: mode 評価をツールスキーマに含める
- **Context**: score/mode 独立評価を LLM に行わせる
- **Alternatives**:
  1. mode を score から自動導出し続ける（現状維持）
  2. ツールスキーマに mode フィールドを追加し独立評価させる
- **Selected**: ツールスキーマに mode フィールドを追加
- **Rationale**: 「強い意志だが短く済ませたい」ケースを自然に表現できる
- **Trade-offs**: LLM の mode/score の組み合わせにバラツキが出る可能性があるが、プロンプト設計で誘導可能

## Risks & Mitigations
- **LLM の mode/score 組み合わせのバラツキ**: プロンプトに score と mode の関係性の例を示すことで軽減
- **intentSummary の品質**: プロンプトで文字数制限と用途を明確に指示することで軽減
- **既存テストの修正**: `assessEngagement` の返り値型変更により mock の更新が必要。テスト修正コストは低い
