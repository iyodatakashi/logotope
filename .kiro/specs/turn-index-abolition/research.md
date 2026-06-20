# Research & Design Decisions

## Summary
- **Feature**: `turn-index-abolition`
- **Discovery Scope**: Extension（既存システムのリファクタリング）
- **Key Findings**:
  - `DebateState.lastFacilitatorTurnIndex` は `debate-state.ts` で計算されるが、コードベース全体で参照箇所が存在しない（デッドコード）。`intervention.ts` は `countPersonaTurnsSinceFacilitator()` でチャプターターン配列を直接走査するため、このフィールドを必要としない。
  - QueuedIntent の有効期限判定は `state.turns.length - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS` だが、`triggerTurnIndex` を `triggerTurnId` に変えると `findIndex` で O(n) 走査になる。n ≦ 200（MAX_TURNS）のため性能上の問題はない。
  - Engagement History は `history.${turnIndex}` キーで Firestore に保存されるが、Pipeline コードでは `restartChapter()` のクリーンアップ時にしか読み込まれない（評価スコアの読み戻しは存在しない）。そのため、キーを `turnId` に変えても動作上の影響は最小限。

## Research Log

### `lastFacilitatorTurnIndex` の参照調査

- **Context**: `DebateState` で `lastFacilitatorTurnIndex: number` が定義されており、介入クールダウン判定に使われると想定したが、実際の参照先を確認する必要があった。
- **Findings**:
  - `debate-state.ts` でのみ計算・代入される（`turns[i].turnIndex` からの値セット）
  - `debate-orchestrator.ts`・`intervention.ts`・`turn.ts`・`engagement.ts` のいずれにも参照なし
  - `intervention.ts` の介入クールダウン判定は `countPersonaTurnsSinceFacilitator(currentChapterTurns)` がチャプターターン配列を逆走査して導出しており、`lastFacilitatorTurnIndex` 不要
- **Implications**: デッドコードとして削除可能。代替フィールドへの移行不要。

### QueuedIntent 有効期限計算の変更影響

- **Context**: `triggerTurnIndex` → `triggerTurnId` への切り替えで有効期限計算ロジックが変わる。
- **Findings**:
  - 現在の計算: `state.turns.length - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS`
  - `turnIndex` はグローバル連番なので `state.turns.length` と差分が一致していた
  - 変更後: `turns.findIndex(t => t.id === item.triggerTurnId)` で O(n) 検索（n ≦ 200）
  - `findIndex` の結果が `-1`（triggerTurnId 未発見）の場合は期限切れ扱いとすることで安全性を保てる
  - 同ロジックが `debate-state.ts`（初期化時）と `queued-intents.ts`（ランタイム）の 2 箇所に存在する
- **Implications**: 計算コストは無視できる（n 小）。`-1` のフォールバック処理を両箇所に追加する必要がある。

### Engagement History キーの用途確認

- **Context**: `history.${turnIndex}` キーが変わることで既存データとの互換性を失うため、実際の読み取り用途を確認した。
- **Findings**:
  - `saveEngagements()` で書き込み（`engagement.ts`）
  - `loadQueuedIntents()` では `queuedIntents` フィールドのみ読み取り、`history` は読まない
  - `restartChapter()` でチャプターやり直し時にキー削除（`history.${turnIndex}`）
  - 評価スコアの遡り参照は存在しない（Firestore の `history` オブジェクトはクリーンアップ専用）
- **Implications**: キーを `turnId` に変えても機能影響なし。既存データの `history` キーは `restartChapter()` 実行タイミングで整合性を保てば良い（クリーン切替で問題なし）。

### `ChapterDoc.startTurnIndex` のデッドコード確認

- **Context**: `src/lib/models/session/session.types.ts` の `ChapterDoc` に `startTurnIndex?: number` が残存している。
- **Findings**: `session-document-restructure` spec でチャプター境界の表現が配列化されたが、この型フィールドが削除されていなかった。コードベース内での参照は確認されない。
- **Implications**: 本 spec のクリーンアップ範囲に含める（`TurnDoc.turnIndex` 削除と同一ファイル）。

### `PublishedTurn.turnIndex` の使用確認

- **Context**: `session.types.ts` の `PublishedTurn` に `turnIndex: number` が残っている。公開ページでの使用状況を確認する必要があった。
- **Findings**: `TurnDoc.turnIndex` を廃止することで `PublishedTurn` に `turnIndex` を設定する手段がなくなる。SSR ページで `PublishedTurn` を構築する際に `turnIndex` を参照するコードがあれば修正が必要。
- **Implications**: `PublishedTurn.turnIndex` も削除対象に含める。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| turnId への全面移行 | `turnIndex` を除去し全参照を `turnId` に切り替え | 一貫性が高い、デッドコードも排除できる | 変更ファイル数が多い | 本 spec の採用方針 |
| チャプターローカルインデックス | `turnIndex` をチャプター内連番（0始まり）に変更 | 後方互換が作りやすい | 依然として「番号」管理が残る | 採用しない — `turnId` が既に存在しており不要な中間形式 |

## Design Decisions

### Decision: lastFacilitatorTurnIndex の削除（代替なし）

- **Context**: 介入クールダウン判定用として設計されたが実際には使われていない
- **Alternatives Considered**:
  1. `lastFacilitatorTurnId: string | undefined` に変換して保持
  2. デッドコードとして削除
- **Selected Approach**: 削除（代替フィールドを作らない）
- **Rationale**: 介入判定は `countPersonaTurnsSinceFacilitator()` が配列走査で算出しており、State フィールドを介する必要がない。代替を作ると将来の混乱を招く。
- **Trade-offs**: `DebateState` が軽量になる。介入クールダウンロジックの変更が必要な場合は `intervention.ts` を単独で修正すれば済む。

### Decision: 有効期限計算を findIndex ベースに変更

- **Context**: `triggerTurnIndex` が廃止されるため、配列内のターン位置を ID で検索する必要がある
- **Alternatives Considered**:
  1. `triggerTurnId` を使って `findIndex` で O(n) 検索
  2. `triggerTurnCreatedAt` を使って順序を特定
- **Selected Approach**: `findIndex` による `triggerTurnId` 検索
- **Rationale**: `id` はすでに `DebateTurn` の必須フィールドであり、追加フィールド不要。`createdAt` はソート基準として使わない方針（firebase.md ではなく配列順を信頼）。
- **Trade-offs**: O(n) だが n ≦ 200 のため無視可能。未発見（-1）は期限切れとして扱うことで安全に失敗する。

## Risks & Mitigations

- 既存 Firestore データの engagement `history` キーが番号形式のまま残存する — `restartChapter()` 呼び出し時に古いキーが残るが、クリーンアップ関数が通らなければ放置されるだけで機能に影響しない（クリーン切替・再生成で運用回避）
- `QueuedIntent` の Firestore データが旧 `triggerTurnIndex` 形式のまま残存する — `loadQueuedIntents()` でロード後に `triggerTurnId` フィールドがないため有効期限判定が `-1` → 期限切れ扱いになり、再生成後に整合する
- `DebateTurn` 型変更により TypeScript コンパイルエラーが多数発生する — これは意図的であり、エラー箇所が変更すべき参照箇所を明示してくれる（1.1 の完了状態として活用）
