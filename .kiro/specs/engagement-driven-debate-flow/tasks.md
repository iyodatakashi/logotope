# 実装計画

- [ ] 1. Foundation: 型定義の更新
- [x] 1.1 Functions の型定義に `EngagementAssessment`・`PendingIntent` を追加
  - `functions/src/types/index.ts` に `EngagementAssessment { score: number; mode: 'full' | 'reaction' | 'none'; intentSummary?: string }` インターフェースを追加する
  - `PendingIntent { triggerTurnIndex: number; intentSummary: string }` インターフェースを追加する
  - `DebateState.pendingItems` の型を `Map<string, PendingIntent[]>` に変更する（現在の `Map<string, number[]>` から変更）
  - 未使用の `PendingThought` 型を削除する
  - `functions/src/types/index.ts` が型エラーなくコンパイルを通ること（参照先の orchestrator でのエラーは Task 4.1 で解消）
  - _Requirements: 1.2, 2.2_

- [x] 1.2 (P) フロントエンドの型定義更新（`TurnDoc` から `engagements` を削除）
  - `src/lib/types/index.ts` に `EngagementHistoryEntry { turnIndex, score, mode, intentSummary? }`・`PendingIntentEntry { triggerTurnIndex, intentSummary }`・`EngagementDoc { history, pendingIntents }` インターフェースを追加する
  - `TurnDoc` インターフェースから `engagements?` フィールドを削除する
  - `src/lib/types/index.ts` がコンパイルエラーなく通ること（`Phase4Debate.svelte` の `turn.engagements` 参照エラーは Task 5.2 で解消）
  - _Requirements: 5.1, 5.5_
  - _Boundary: Frontend Type Definitions_

- [ ] 2. Persona Agent の拡張
- [x] 2.1 `ASSESS_ENGAGEMENT_TOOL` スキーマ拡張とエンゲージメント評価ロジック更新
  - `ASSESS_ENGAGEMENT_TOOL` スキーマに `mode`（'full' | 'reaction' | 'none'）フィールドと `intentSummary?: string` フィールドを追加する
  - score ラベル（1=パス、2=少し気になる、3=言いたいことがある、4=ぜひ言いたい、5=今すぐ言わなければ）を `score` フィールドの description に全文記載する
  - `score` と `mode` は独立して評価すること・`score` が高くても `reaction` を選んでよい旨を description に明示する
  - `reaction` の場合 `intentSummary` は25文字以内、`full` の場合は80文字以内の旨を description に記載する
  - `assessEngagement` の返り値型を `EngagementAssessment` に変更し、`mode` の自動導出コード（`score >= 4 ? 'full' : ...`）を削除する
  - `score === 1` の場合に `mode` を強制的に `'none'` にクランプするガードを追加する
  - `mode === 'none'` の場合に `intentSummary` を `undefined` に設定するガードを追加する
  - `assessEngagement` が `EngagementAssessment { score, mode, intentSummary? }` 型の値を返すこと
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2.2 `generateTurn` に `intentSummary` 引数を追加してプロンプトへ埋め込む
  - `generateTurn` のシグネチャ末尾に `intentSummary?: string` 引数を追加する
  - `intentSummary` が存在する場合、ユーザープロンプトに `【今回伝えたいこと】${intentSummary}` を追記する（`pendingNote` と同様の形式）
  - `intentSummary` が `undefined` の場合はプロンプトに何も追記しないこと
  - 既存の `assessedMode` によるツール切り替えロジック（`REACTION_TURN_TOOL` / `buildFullTurnTool`）は変更しない
  - `intentSummary` 付きで呼ばれたとき、構築されるプロンプトに当該テキストが含まれること
  - _Requirements: 4.2, 4.4, 4.5, 4.6_

- [ ] 3. (P) Repository 関数の追加
- [x] 3.1 (P) `saveEngagements` 関数の実装
  - `repository.ts` に `EngagementHistoryEntry`・`PendingIntentEntry`・`EngagementDoc`・`SaveEngagementsParams` 型を追加する
  - `saveEngagements(params: SaveEngagementsParams): Promise<void>` を実装する
    - 各ペルソナのドキュメント（`topics/{sessionId}/sessions/0/engagements/{personaId}`）に `FieldValue.arrayUnion` で `history` エントリを追記する
    - `addToPending === true` のペルソナは `pendingIntents` にも `FieldValue.arrayUnion` で追記する
  - `saveEngagements` を呼び出すと、対象ペルソナのドキュメント `history` と `pendingIntents` が Firestore 上で正しく更新されること
  - _Requirements: 5.2, 5.3_
  - _Boundary: Repository.saveEngagements_
  - _Depends: 1.1_

- [x] 3.2 `consumePendingIntent` と `loadPendingIntents` の実装
  - `consumePendingIntent(sessionId: string, personaId: string): Promise<void>` を実装する: Firestore の `pendingIntents` から先頭（最古）エントリを除いた配列で `update` する
  - `loadPendingIntents(sessionId: string): Promise<Map<string, PendingIntentEntry[]>>` を実装する: 全ペルソナの `engagements/*` ドキュメントを一括取得し Map を返す（ドキュメントが存在しないペルソナは空配列）
  - `consumePendingIntent` を呼び出した後、Firestore の `pendingIntents` の先頭エントリが削除されていること
  - `loadPendingIntents` が全ペルソナ分のキューを正しく含む Map を返すこと
  - _Requirements: 2.5, 5.3_

- [x] 3.3 `CreateDebateTurnParams` から `engagements` フィールドを削除
  - `CreateDebateTurnParams` インターフェースから `engagements?` フィールドを削除する
  - `createDebateTurn` 関数内で `engagements` を Firestore に書き込む処理を削除する
  - `createDebateTurn` の既存の呼び出し元から `engagements` 引数の受け渡しを削除する
  - `createDebateTurn` を呼び出した後、Firestore の `turns[]` エントリに `engagements` フィールドが保存されないこと
  - _Requirements: 5.1, 5.5_

- [x] 4. Orchestrator の更新
- [x] 4.1 `pendingItems` の操作を `PendingIntent[]` 型に合わせて更新
  - `DebateState.pendingItems` の型が `Map<string, PendingIntent[]>` になったことに合わせ、orchestrator 内の 6 箇所の操作を更新する
  - 登録処理: `push(lastTurnIndex)` を `push({ triggerTurnIndex: lastTurnIndex, intentSummary })` に変更する
  - 剪定処理: `triggerTurnIndex` フィールドで経過ターン数（8ターン超）を判定するよう変更する
  - キュー候補選出処理: `entry.triggerTurnIndex` で全エントリ中の最古を特定するよう変更する
  - 消費後の先頭除去処理: `pItems.slice(1)` は変更なし（型は `PendingIntent` になる）
  - コンパイルエラーが解消され、`pendingItems` の全操作が `PendingIntent[]` 型として機能すること
  - _Requirements: 2.2, 2.3, 2.4_
  - _Depends: 1.1_

- [x] 4.2 話者選択ロジックの更新
  - エンゲージメント評価後、スコア降順でソートし同率なら沈黙ターン数が長いペルソナを優先する選択ロジックを実装する
  - 全員スコア ≤3 かつ `pendingItems.size > 0` の場合: 最古の `triggerTurnIndex` を持つエントリのペルソナをキューから選択する
  - 全員スコア ≤3 かつキューが空の場合: 沈黙ターン数が最も長いペルソナを選択する
  - 直前話者（`lastSpeakerId`）が唯一の最高スコアでない限り連続発言を回避する
  - キュー参照で選ばれた場合、発言モードを `'full'` に固定する
  - スコア高・スコア低＋キューあり・スコア低＋キューなし・連続発言回避の4パターンで正しい話者が選ばれること
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4.3 assessEngagement 後処理の更新（キュー追加・saveEngagements・chapter detection）
  - `score >= 4 && personaId !== nextPersonaId` のペルソナのエントリを `pendingItems` に `{ triggerTurnIndex, intentSummary }` 形式で追加する処理を実装する
  - `generateTurn` の前に `saveEngagements()` を呼び出してエンゲージメント評価を Firestore に保存する
  - chapter end detection を `rawAssessments.some(a => a.score >= 4) ? 1 : 0` に変更する（`mode === 'full'` チェックを廃止）
  - 各ターン後に `saveEngagements` が呼ばれ、Firestore の `sessions/0/engagements/{personaId}` が更新されること
  - _Requirements: 1.1, 2.1, 3.1_
  - _Depends: 3.1_

- [x] 4.4 `generateTurn` 呼び出しに `assessedMode` と `intentSummary` を渡す
  - 通常選択（スコアベース）: `assessedMode`（LLM の評価値）と当該ペルソナの `intentSummary` を `generateTurn` に渡す
  - キュー選択: キューエントリの `intentSummary` を渡し、`pendingTrigger` に `triggerTurnIndex` の発言内容（トリガー発言）を設定する
  - 発言後にキューから選ばれたペルソナの場合は `consumePendingIntent()` を呼び出す
  - キュー選択で発言後、そのペルソナの `pendingItems` エントリが1件減っていること
  - _Requirements: 4.1, 4.2, 4.3, 2.5_
  - _Depends: 2.2, 3.2_

- [x] 4.5 `resume()` に `loadPendingIntents()` を追加
  - `resume()` の初期化処理で `loadPendingIntents(sessionId)` を呼び出す
  - 返り値を `state.pendingItems` にセットしてインメモリキューを復元する
  - Functions 再起動後に `resume()` を呼び出した場合、Firestore の `pendingIntents` がメモリ上の `pendingItems` に正しく復元されること
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.2_

- [x] 5. (P) Admin UI の更新
- [x] 5.1 (P) `engagements` サブコレクション購読ストアの追加
  - `src/lib/stores/` に `topics/{topicId}/sessions/0/engagements` コレクションを `onSnapshot`（コレクションクエリ）で購読するストアを追加する
  - ストアの型は `Map<number, EngagementHistoryEntry[]>`（turnIndex → 全ペルソナ分のエントリ配列）とする
  - 各ペルソナドキュメントの `history` 配列を `turnIndex` でグループ化してマップを構築する処理を実装する
  - ストアが正しく初期化され、Firestore の更新がリアルタイムで `Map` に反映されること
  - _Requirements: 5.4_
  - _Boundary: Admin UI Store_
  - _Depends: 1.2_

- [x] 5.2 `Phase4Debate.svelte` のエンゲージメント表示データソース変更
  - `turn.engagements` への参照を削除し、Task 5.1 のストアから `engagementsMap.get(turn.turnIndex) ?? []` で取得するよう変更する
  - 表示形式（`{name}: {mode}({score})`）は変更しない
  - `TurnDoc` に `engagements` フィールドがなくても、エンゲージメント情報が正しく表示されること
  - _Requirements: 5.4, 5.5_

- [x] 6. テストの更新と追加
- [x] 6.1 `assessEngagement` テスト更新
  - `ASSESS_ENGAGEMENT_TOOL` の新スキーマ（`mode`・`intentSummary` フィールド）を含むモックレスポンスを使うようテストを更新する
  - `score === 1` のとき `mode` が強制的に `'none'` になることを検証するテストを追加する
  - `mode === 'none'` のとき `intentSummary` が `undefined` であることを検証するテストを追加する
  - 更新後のテスト群がすべてパスすること
  - _Requirements: 1.2, 1.3, 1.4, 1.7_

- [x] 6.2 `generateTurn` のテスト追加
  - `intentSummary` が渡された場合、ユーザープロンプトに `【今回伝えたいこと】` が含まれることを検証するテストを追加する
  - `intentSummary` が `undefined` の場合、プロンプトに追記されないことを検証するテストを追加する
  - 追加したテストがパスすること
  - _Requirements: 4.2_

- [x] 6.3 (P) Orchestrator テスト更新
  - `pendingItems` に `PendingIntent { triggerTurnIndex, intentSummary }` 型で追加されること（`score >= 4` のエントリのみ）を検証するテストを追加・更新する
  - `topScore <= 3` かつキューあり の場合にキュー参照選択が正しく動作することを検証するテストを追加する
  - chapter end detection が `score >= 4` の人がいれば 1、いなければ 0 を返すことを検証するテストを追加する
  - `generateTurn` に `assessedMode` と `intentSummary` が正しく渡されることをスパイで確認するテストを追加する
  - テストがすべてパスすること
  - _Requirements: 2.1, 3.3, 3.5, 4.1_
  - _Boundary: DebateOrchestrator test_

- [x] 6.4 (P) Repository テスト追加
  - `saveEngagements` が `sessions/0/engagements/{personaId}` の `history` と `pendingIntents` を正しく更新することを検証するテストを追加する
  - `consumePendingIntent` が先頭エントリを削除することを検証するテストを追加する
  - `loadPendingIntents` が全ペルソナ分のキューを正しく含む Map を返すことを検証するテストを追加する
  - `createDebateTurn` の保存後に `turns[]` エントリに `engagements` フィールドが含まれないことを検証するテストを追加する
  - テストがすべてパスすること
  - _Requirements: 2.5, 5.1, 5.2, 5.3, 5.5_
  - _Boundary: Repository test_
