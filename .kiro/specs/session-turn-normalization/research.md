# Research & Design Decisions

## Summary
- **Feature**: `session-turn-normalization`
- **Discovery Scope**: Extension（既存パイプライン・フロントエンドの改修）
- **Key Findings**:
  - `addTurn()` は `speakerName`/`speakerRole` を Firestore に書き込んでいるが、公開ページ（`+page.svelte`）はすでに `personaId → personas` で名前・役割を解決しており、Firestore のフィールドを読んでいない
  - `formatTurns()` は AI プロンプト構築に使われており、`DebateTurn.speakerName` から名前を取得している。正規化後は `personas` 配列を受け取って解決する必要がある
  - `DebateViewer.svelte` は `PublishedTurn.speakerName`（文字列）でペルソナフィルタリングを行っており、名前比較という脆弱な実装になっている。`personaId` による比較に切り替えることで堅牢化できる

## Research Log

### formatTurns() の呼び出し箇所
- **Context**: `formatTurns()` を変更する際の影響範囲確認
- **Findings**:
  - `persona-agent.ts` が `recentTurns` と `ownTurns` の2箇所で呼び出している
  - どちらの呼び出し元も `personas` 配列を既に保有している（関数引数として受け取っている）
  - `facilitator-agent.ts` も `formatTurns()` を呼び出している（ファシリテーター評価用）
- **Implications**: 全呼び出し元が `personas` を渡せる状況にあるため、シグネチャ変更のコストは低い

### state.turns へのインメモリ書き込み
- **Context**: `addTurn()` だけでなく `state.turns.push()` も `speakerName`/`speakerRole` を含んでいる
- **Findings**:
  - `turn.ts` の `generateFacilitatorTurn`・`generatePersonaTurn` と `intervention.ts` の `persistInterventionTurn` が `state.turns.push()` で speakerName/speakerRole を設定している
  - `state.turns` は in-memory の `DebateState.turns: DebateTurn[]` であり、型変更と合わせて除去できる
- **Implications**: Firestore 書き込みと同時に in-memory 状態も更新が必要

### PublishedTurn への personaId 追加
- **Context**: `DebateViewer.svelte` のフィルタリング改善
- **Findings**:
  - `PublishedTurn` 型は現在 `personaId` を持たない
  - ファシリテータータンは `personaId` がないため `personaId?: string | null` として追加するのが適切
  - `+page.svelte` ですでに `t.personaId` を参照できる（`TurnDoc` に存在する）
- **Implications**: `PublishedTurn` に optional の `personaId` を追加し、+page.svelte で設定するだけで対応可能

## Design Decisions

### Decision: formatTurns() のシグネチャ変更方針
- **Context**: 名前解決の責務をどこに置くか
- **Alternatives Considered**:
  1. `formatTurns(turns)` のまま維持し、呼び出し元がターンに名前を注入してから渡す
  2. `formatTurns(turns, personas)` として名前解決を内部で行う
- **Selected Approach**: Option 2（`personas` を引数として渡す）
- **Rationale**: 呼び出し元はすべて `personas` を保有しているため追加コストが低い。名前解決ロジックを一箇所に集約できる。
- **Trade-offs**: シグネチャ変更により全呼び出し元の修正が必要だが、修正箇所は限定的（persona-agent.ts, facilitator-agent.ts）

### Decision: PublishedTurn.speakerName/speakerRole の扱い
- **Context**: 表示用に解決済みの名前・役割が必要か
- **Alternatives Considered**:
  1. `PublishedTurn` から `speakerName`/`speakerRole` を除去し、コンポーネント側で解決
  2. `PublishedTurn` に `speakerName`/`speakerRole` を保持し、ページレベルで解決済みの値をセット
- **Selected Approach**: Option 2（保持する）
- **Rationale**: `TurnDisplay.svelte` は `PublishedTurn` を直接受け取るシンプルな表示コンポーネントであり、persona 解決ロジックを持ち込まない設計を維持する。解決は `+page.svelte` ページレベルで完結させる。
- **Trade-offs**: `PublishedTurn` が「解決済み値の入れ物」として機能するが、それは元々の設計意図通り

## Risks & Mitigations
- Firestore の既存ターンドキュメントに `speakerName`/`speakerRole` が残る — 読み取り側がフィールドを参照しなくなれば実害なし。古いフィールドは Firestore 上に残るが Firestore の課金はドキュメント読み込み数ベースのため許容範囲内
- `formatTurns()` のシグネチャ変更でコンパイルエラーが発生する — TypeScript strict mode により未修正の呼び出し元はビルドエラーになるため漏れを防止できる
