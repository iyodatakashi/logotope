# Research & Design Decisions

## Summary

- **Feature**: `per-chapter-engagements`
- **Discovery Scope**: Extension（既存の討論パイプラインへの保存パス変更と引数追加）
- **Key Findings**:
  - `queued-intents.ts` は `engagement.ts` とは独立した役割を持つが、現状は同じ Firestore ドキュメント（`topics/{topicId}/engagements/{personaId}`）を共有している
  - HEAD の `engagement.ts` は `turnIndex`（数値）をキーとして使用しているが、`turn-index-abolition` の作業中ブランチでは `turnId`（nanoid 文字列）に移行済み。本仕様の実装は後者の状態を前提とする
  - フロントエンドの `buildEngagementsMap` は現状 `parseInt(key, 10)` でキーを数値変換しており、`turn-index-abolition` 完了後は文字列キーに変更が必要。本仕様の frontend 変更と合わせて修正する
  - `topics.svelte.ts` の `deleteTopic` はトピックレベルの `engagements` コレクションを削除しているが、Firestore はサブコレクションを親ドキュメント削除時に自動削除しないため、章サブコレクションの明示的削除を追加する必要がある

## Research Log

### engagement.ts のターン入力スコープ

- **Context**: `evaluateEngagement`（persona-agent.ts）は `turns` を受け取り、`turns.slice(-8)` と `turns.filter(persona).slice(-5)` を使用する。全ターンを渡すと前章の文脈が混入する
- **Findings**:
  - `evaluateEngagements` は `state.turns`（全章の全ターン）を渡している（HEAD）
  - `debate-orchestrator.ts` の `executeTurn` は `getChapterTurns()` で現章ターンを取得できる状態にある
- **Implications**: `evaluateEngagements` に `chapterTurns` パラメータを追加し、`state.turns` の代わりに渡す変更が最小限

### queued-intents のドキュメント構造

- **Context**: 現行は `topics/{topicId}/engagements/{personaId}` に `queuedIntents: QueuedIntent[]` を保存。ペルソナ数（4〜6）分のドキュメント読み書きが発生
- **Findings**:
  - `loadQueuedIntents` は `collection().get()` でコレクション全体を取得（ペルソナ数分の読み取りコスト）
  - `addQueuedIntents` / `expireQueuedIntents` / `consumeQueuedIntent` は各ペルソナのドキュメントを個別に更新
  - queued intents は実際には高意欲ペルソナ（score >= QUEUE_THRESHOLD_SCORE）が選ばれなかった場合のみ生成される。多くのターンでは空か少数エントリ
- **Implications**: 単一ドキュメント `queued-intents/0` に `{ [personaId]: QueuedIntent[] }` として集約する設計が合理的。読み取りコストを 1 件に削減

### 章間持ち越し防止の実現方法

- **Context**: 「持ち越しなし」の実現に、`getDebateState` の期限フィルタリングが補助的に機能するか確認
- **Findings**:
  - `getDebateState` は `persistedQueuedIntents` から `turns.findIndex(t => t.id === item.triggerTurnId)` でフィルタリングする
  - 新チャプターの開始時、`existingTurns` には前章ターンも含まれる。そのため `triggerTurnId` が前章ターンを指す場合、`getDebateState` のフィルタリングでは除去されない（INTENT_EXPIRY_TURNS 以内であれば alive と判定）
  - → **`getDebateState` だけでは前章キューを確実に除去できない**。チャプタースコープの保存パスを使うことで構造的に持ち越しを防ぐことが必要
- **Implications**: チャプタースコープの `queued-intents/0` で自然に持ち越しがなくなる（新チャプターは別ドキュメントを読む）

### フロントエンドのエンゲージメント表示スコープ

- **Context**: `Phase5Debate.svelte` は全チャプターのターンを表示し、各ターンのエンゲージメントを表示する。チャプター単位保存に移行するとアーカイブ章のエンゲージメントが読めなくなる
- **Findings**:
  - 管理画面のエンゲージメント表示は主に「現在進行中の議論の発言意欲モニタリング」に使用される
  - 完了済み章のエンゲージメントは変化しない履歴データ。リアルタイム購読の優先度が低い
  - `chaptersStore` がすでに `runningChapter` を提供しており、`engagementsStore` が参照しやすい
- **Implications**: 実行中チャプター（`runningChapter`）のエンゲージメントのみをリアルタイム購読する。過去章のエンゲージメントは非表示（将来のオンデマンドロード機能への拡張余地を残す）

### topics.svelte.ts の deleteTopic とサブコレクション

- **Context**: Firestore はドキュメント削除時にサブコレクションを自動削除しない。フロントエンドクライアント SDK からサブコレクション削除が必要
- **Findings**:
  - 現行 `deleteTopic` は `topics/{topicId}/engagements` コレクションを明示的に取得・削除している
  - 新構造では `topics/{topicId}/chapters/{chapterId}/engagements` と `topics/{topicId}/chapters/{chapterId}/queued-intents` が追加されるサブコレクション
  - `chaptersSnap.docs` が取得できているため、各チャプター ID からサブコレクションを追加取得できる
- **Implications**: `deleteTopic` で章サブコレクションを追加取得してバッチ削除に含める。500件上限は既存のバッチループで対応済み

## Architecture Pattern Evaluation

| オプション | 説明 | メリット | リスク |
|-----------|------|---------|-------|
| A: チャプタースコープ保存（採用） | 保存パスを `chapters/{chapterId}/engagements/` と `chapters/{chapterId}/queued-intents/0` に変更 | 構造的に持ち越しなし; チャプター削除と連動; 単一ドキュメントでコスト削減 | `restartChapter` のサブコレクション削除が必要 |
| B: トピックレベル維持 + チャプターIDフィールド | 既存パスに `chapterId` フィールドを追加してフィルタリング | 変更が小さい | クリーンアップが複雑; 持ち越しがフィルタ漏れで発生しうる |
| C: チャプタードキュメントに埋め込み | エンゲージメントをチャプターの `turns` 配列内に埋め込む | パス変更なし | チャプタードキュメントが肥大化; ターン単位での原子的更新が困難 |

## Design Decisions

### Decision: queued-intents を engagement と同一 per-persona ドキュメントに共存

- **Context**: queued-intents の保存先として「独立した単一ドキュメント」「engagement と同一 per-persona ドキュメント」を検討
- **Alternatives Considered**:
  1. `queued-intents/0` — 全ペルソナを1ドキュメントに集約（分離）
  2. `engagements/{personaId}` に同居 — 現行構造をチャプタースコープ移行のみ
- **Selected Approach**: `chapters/{chapterId}/engagements/{personaId}` に `history` と `queuedIntents` を共存
- **Rationale**: 両方とも「次の発言者になるかどうかの判定のための中間データ」。役割の同一性から同居が自然。現行の構造をそのまま継承でき、変更最小化にもなる
- **Trade-offs**: engagement 評価と queued intents という異なる関心事が同居するが、ユースケース（話者選択）は共通なので許容

### Decision: フロントエンドは実行中チャプターのみ購読

- **Context**: 過去章のエンゲージメントも表示するか、実行中章のみにするか
- **Alternatives Considered**:
  1. 全チャプターのエンゲージメントをサブコレクションごとに購読
  2. 実行中チャプターのみ購読
- **Selected Approach**: `runningChapter?.id` のエンゲージメントのみを `onSnapshot` で購読
- **Rationale**: 過去章のエンゲージメントは変化しない履歴データ。管理者が主に必要とするのは現在進行中の議論の発言意欲情報
- **Trade-offs**: 完了済み章のエンゲージメントが管理画面に表示されなくなる。必要であれば将来的にオンデマンドロード機能を追加できる

## Risks & Mitigations

- **turn-index-abolition との競合**: 両スペックが `engagement.ts`・`engagements.svelte.ts` を変更する。`turn-index-abolition` を先にマージしてから本スペックを実装することでコンフリクトを回避する
- **旧 `topics/{topicId}/engagements` の残留データ**: 新実装への移行後も旧コレクションにデータが残る。`deleteTopic` 経由での削除は維持するが、ストアの購読対象からは外れるため管理画面には表示されない。実質的に孤立したデータとなり、自然消滅（またはスクリプトによる一括削除）に任せる
- **restartChapter のサブコレクション削除**: Admin SDK でサブコレクションを列挙して削除する処理を追加する。ペルソナ数は有限（最大10前後）なので削除処理のコストは問題なし
