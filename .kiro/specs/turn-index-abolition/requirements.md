# Requirements Document

## Project Description (Input)
turnIndexグローバル連番廃止。discussionの背景: chaptersコレクション基盤への移行(session-document-restructure)完了後、turnIndexはチャプター境界をまたぐグローバル連番(0〜200)として残っているが、chapterIndex+配列順で順序は自明になったため不要。主な依存: (1) engagement historyのFirestoreキーがhistory.${turnIndex}形式、(2) QueuedIntent.triggerTurnIndexがグローバル連番参照、(3) DebateState.currentTurnIndex/lastFacilitatorTurnIndexがグローバル連番。廃止方針: TurnDocからturnIndexを削除し、engagementのhistoryキーをturnIdに変更、QueuedIntentをtriggerTurnIdに切替、DebateStateの内部状態変数を整理。既存データとの後方互換フォールバックなし(クリーン切替)。スコープ外: 討論アルゴリズム変更・UIデザイン変更・chapterIssuesやpostDebateComments構造(既に別specで対処済み)。

## Introduction

`session-document-restructure` によって `sessions/0` が廃止され `chapters/{chapterId}` コレクションがプライマリとなった結果、`turnIndex`（チャプター境界をまたぐグローバル連番 0〜200）はターン順序の決定という本来の役割を失った。ターンの順序は `chapterIndex` 順に並んだチャプタードキュメント内の `turns` 配列位置から自明に得られる。

このフィーチャーでは `turnIndex` グローバル連番を廃止し、Firestore への書き込み・Engagement History キー・QueuedIntent 参照・DebateState 内部状態変数を `turnId`（文字列 ID）に統一する。

## Boundary Context

- **In scope**: `TurnDoc.turnIndex` / `DebateTurn.turnIndex` の型と Firestore 書き込みの除去、Engagement History キーを `turnId` に変更、`QueuedIntent.triggerTurnIndex` を `triggerTurnId` に切り替え、`DebateState.currentTurnIndex` / `lastFacilitatorTurnIndex` の整理、フロントエンドの TurnDoc 型とソートロジックの更新
- **Out of scope**: 討論アルゴリズム・ファシリテーター/ペルソナエージェントのロジック変更、UIデザインの変更、`chapterAnalysis/0`・`postDebateComments/0` 構造（別 spec で対処済み）、既存本番データの後方互換フォールバック（クリーン切替・再生成で移行）
- **Adjacent expectations**: `debate.constants.ts` の `MAX_TURNS` は討論の最大ターン数として引き続き有効（グローバル連番とは独立して機能する）。`engagements/{personaId}` の Firestore ドキュメントキー変更は `firestore.rules` のパス規則と互換を維持する

## Requirements

### Requirement 1: TurnDoc からturnIndexを除去する

**Objective:** As a 開発者, I want ターンドキュメントにグローバル連番を保存しない, so that ターンの順序がチャプター配列の位置によって自明に決まり、不整合なインデックス値が発生しなくなる。

#### Acceptance Criteria

1. The `DebateTurn` TypeScript型（`functions/src/types/debate.types.ts`）から `turnIndex` フィールドを削除する。
2. The `addTurn()` 関数のパラメータから `turnIndex` を除去し、Firestore 書き込みオブジェクトに `turnIndex` フィールドを含めない。
3. When 討論実行中に新しいターンが `chapters/{chapterId}.turns[]` に追記される, the Turn Pipeline shall `turnIndex` を含まず `id`, `speakerType`, `personaId?`, `content`, `createdAt` 等のフィールドのみを書き込む。
4. The Turn Pipeline shall `turnIndex` の計算（`state.turns.length`）を `addTurn()` 呼び出し前に行わない。

---

### Requirement 2: Engagement History キーを turnId に移行する

**Objective:** As a 開発者, I want Engagement History の Firestore キーをグローバル連番から `turnId` に変更する, so that 特定ターンの Engagement 記録を文字列 ID で一意に参照でき、番号管理が不要になる。

#### Acceptance Criteria

1. When Engagement History を保存する, the Engagement Pipeline shall `{ history: { [turnId]: entry } }` の形式で `topics/{topicId}/engagements/{personaId}` ドキュメントを更新する（キーは文字列型の `turnId`）。
2. The `saveEngagementHistory()` 関数のシグネチャの `turnIndex: number` を `turnId: string` に変更する。
3. When チャプターのやり直しが実行される, the Debate Pipeline shall 削除対象チャプターに含まれるターンの `id` を使い `history.${turnId}` キーを削除する。
4. The Engagement Pipeline shall 旧形式の `history.${turnIndex}` キーへの読み書きを行わない（クリーン切替）。

---

### Requirement 3: QueuedIntent の参照を triggerTurnId に切り替える

**Objective:** As a 開発者, I want `QueuedIntent` が参照するターンをグローバル連番ではなく `turnId` で特定する, so that ターン参照がドキュメント構造に依存しない安定した文字列 ID になる。

#### Acceptance Criteria

1. The `QueuedIntent` TypeScript型の `triggerTurnIndex: number` を `triggerTurnId: string` に変更する。
2. When QueuedIntent が作成される, the Queued Intents Pipeline shall `triggerTurnId` に直前ターンの `turn.id` をセットする。
3. When QueuedIntent の有効期限を判定する, the Queued Intents Pipeline shall `state.turns` 内で `triggerTurnId` に一致するターンの配列インデックスを検索し、そこからの経過ターン数が `INTENT_EXPIRY_TURNS` を超えたものを期限切れと判断する。
4. When トリガーターンの発言者名を解決する, the Turn Pipeline shall `state.turns.find(t => t.id === triggerTurnId)` でトリガーターンを参照する。
5. If `triggerTurnId` に一致するターンが `state.turns` に存在しない, the Queued Intents Pipeline shall その QueuedIntent を期限切れとして扱う。

---

### Requirement 4: DebateState の内部状態変数を整理する

**Objective:** As a 開発者, I want `DebateState` からグローバル連番ベースの状態変数を除去する, so that 討論状態がターンの配列と ID のみで管理され、連番との乖離バグが発生しなくなる。

#### Acceptance Criteria

1. The `DebateState` TypeScript型から `currentTurnIndex: number` を除去する（`state.turns.length` が次ターンのインデックスとして自明なため）。
2. The `DebateState` TypeScript型の `lastFacilitatorTurnIndex: number` を `lastFacilitatorTurnId: string | undefined` に変更する。
3. When ファシリテーターターンが保存される, the Debate Orchestrator shall `state.lastFacilitatorTurnId` に保存されたターンの `id` をセットする。
4. When ファシリテーター介入間隔を判定する, the Debate Orchestrator shall `state.turns` 内で `lastFacilitatorTurnId` に一致するターンの配列インデックスを検索し、そこからの経過ターン数で判定する。
5. If `lastFacilitatorTurnId` が `undefined` の場合, the Debate Orchestrator shall 介入間隔カウントを `state.turns.length`（チャプター開始からの全ターン数）として扱う。
6. The `debate-state.ts` の初期化ロジックから `currentTurnIndex` の計算（`turns[turns.length-1].turnIndex + 1`）を除去する。

---

### Requirement 5: フロントエンドの型とターンソートを更新する

**Objective:** As a 開発者, I want フロントエンドの `TurnDoc` 型と表示ロジックが `turnIndex` なしで正しく動作する, so that ターン順序がチャプター配列の位置から確実に保証される。

#### Acceptance Criteria

1. The `TurnDoc` TypeScript型（`src/lib/models/session/session.types.ts`）から `turnIndex` フィールドを削除する。
2. When チャプターコレクションを購読する, the Chapters Store shall `turns` 配列を `turnIndex` によるソートではなくチャプターの `chapterIndex` 順・各チャプター内の配列順（`arrayUnion` で追記された順序）で結合してフラット化する。
3. When 討論閲覧ページ・管理画面がターン一覧を表示する, the Frontend shall チャプター順 → ターン配列順 の結合順でターンを表示する。
4. The Chapters Store shall ターン結合に `createdAt` ソートを使用しない（Firestore `arrayUnion` による追記順を信頼する）。
