# Gap Analysis: chapter-turn-task-decomposition

## 1. 現状把握（既存資産）

### 処理構造（チェーンの実体）
- `startDebate`/`restartDebate`（[debates.ts](../../../functions/src/api/debates.ts)）が `runId` を発行し、`enqueueChapterTask(chapterIndex)` で **章単位**の Cloud Tasks をエンキュー。
- `runChapter`（`onTaskDispatched`, `timeoutSeconds: 540`, `retryConfig.maxAttempts: 3`）が `executeChapterTask` を呼ぶ。完了後 `hasNextChapter` なら**次章**をエンキュー（章チェーンは既存）。
- `executeChapterTask`（[debate-orchestrator.ts](../../../functions/src/pipeline/debate/debate-orchestrator.ts)）が **1章分の `while` ループ**を回す。冒頭で `getDebateState` により状態を1回ロードし、以降は**インメモリ state を進める**。

### 1ターン処理の正準フロー（既に関数分割済み）
`executeTurn` 内で「`getLastTargetPersona` → `expireQueuedIntents` → `evaluateEngagements`（直前話者除外）→ `tryIntervention`（指名なし時）→ `selectSpeaker` → `addQueuedIntents` → `evaluateEngagementWithFallback` → `generatePersonaTurn` → `consumeQueuedIntent` → `updateSpeakerStats` → `applyBeliefChange`」。各ステップは既に小関数化されている。

### 状態の永続/再構築（重要な再利用資産）
- `getDebateState(turns, personas, queuedIntents)`（[debate-state.ts](../../../functions/src/pipeline/debate/debate-state.ts)）は **`speakCount`・`silenceMap`・`lastSpeakerId`・`queuedIntents` を永続データのみから決定論的に再構築**する（「同一入力→同一出力」と明記）。→ **per-turn 化の最大の追い風**。
- `queuedIntents` は `chapters/{id}/engagements/{personaId}` に write-through 永続化（`loadQueuedIntents` で復元）。
- ただし `discussionPoints`（論点ステータス）は `getDebateState` では復元されず（`[]` 返し）、`executeChapterTask` がチャプター冒頭で `chapter.discussionPoints` から初期化し、インメモリで status を更新→`discussionPointStatuses` フィールドへ保存している。

### ターン永続化モデル
- ターンは **chapter ドキュメントの `turns` 配列**に `FieldValue.arrayUnion(turn)` で追記（[turn.ts:74-76](../../../functions/src/pipeline/debate/turn.ts)）。index は **章ローカル**（章 doc 内の配列位置）。
- `addTurn` は `runId` 照合（topic doc を別途 get → `runId !== params.runId` なら null）を行うが、**arrayUnion 自体は無条件**（条件付き追記ではない）。
- `state.turns` は**全章横断**のグローバル列。章ローカル index とのマッピングは `chapterTurnStartInState` で吸収している。

### テスト資産
`functions/src/tests/pipeline/debate/` に orchestrator/turn/intervention/engagement/speaker-selection/lifecycle のユニットテストが既存。行動等価性検証の土台になる。

---

## 2. 要件→資産マップ（ギャップ）

| 要件 | 関連資産 | ギャップ種別 | メモ |
|---|---|---|---|
| R1 ターン単位の再入可能処理 | `executeChapterTask`(while), `executeTurn`, `getDebateState`, `runChapter` | **Constraint / Missing** | `executeTurn` は実質1ターン単位だが、while ループと in-memory state 前提。1タスク=1ターンの再入可能形へ分解が必要。状態再構築の土台(`getDebateState`)は有 |
| R1-2 起動毎の状態再構築 | `getDebateState`, `loadQueuedIntents` | **Constraint** | turns/queue/silence/speakCount は復元可。**discussionPoints の復元は未対応**（`discussionPointStatuses` フィールドはあるが getDebateState が読まない） |
| R2 冪等なターン追記（期待位置の原子照合） | `addTurn`(arrayUnion) | **Missing** | 無条件 arrayUnion。**「`turns.length === 期待index` のときだけ追記」するトランザクションが必要**。条件付きのため read-modify-write（full array write）に変更が要る |
| R2 原子性 + runId 照合 | `addTurn` の runId get | **Constraint** | 現状 runId 照合と追記が非原子（別 get→arrayUnion）。同一トランザクションに畳むのが自然 |
| R3 重複・陳腐タスクの no-op | `isDebateActive`, addTurn null 返し | **Missing** | 「担当 index が既に埋まっている→何もせず正常終了、続きを再 enqueue しない」分岐が必要 |
| R4 章進行・終端の永続状態駆動 | while 後の `chapterEndCount`/早期終了/`+1`応答/`finalize`/`generateChapterTransition` | **Missing（最難所）** | `chapterEndCount` 等は**ループ局所の累積カウンタ**。per-turn では永続化 or 再計算が必要。`shouldContinueChapter` は当時の engagement scores 依存で再構築が非自明 |
| R4 finalize 冪等 | `chapterDoc.status==='completed'` skip, finalize | **Partial** | 章 status による冪等性は一部有。終端(クロージング/事後コメント)の二重実行防止は要強化 |
| R5 行動等価性 | 既存ユニットテスト群 | **Constraint** | 大きめリファクタ。決定論ハーネス（LLM モック）で前後等価を担保する戦略が要る |
| R6 既存世代ガード共存 | `debate-run-isolation`(runId), `isDebateActive` | **Reuse** | runId 照合は維持しトランザクションに内包。責務分離は既存設計と整合 |
| R6 後方互換 | 既存 turns（index メタ無し） | **Constraint** | 章ローカル `turns.length` を期待 index に使えばメタ追加不要で後方互換にしやすい |
| R7 正常系非阻害 | — | **Constraint** | 条件付き追記の誤検知防止（順次実行では常に length 一致）をテストで担保 |

---

## 3. 実装アプローチ案

### Option A: 既存ファイルを拡張（in place 改修）
`executeChapterTask` を「1ターン処理＋次タスク enqueue」の再入可能関数へ作り替え、`runChapter` ハンドラを per-turn 化。`addTurn` を条件付きトランザクション追記に変更。`getDebateState`/`selectSpeaker`/engagement/intervention はほぼそのまま再利用。
- ✅ 新規ファイル最小、既存パターン踏襲、テスト資産を活かせる
- ✅ `executeTurn` は既に1ターン単位なので流用しやすい
- ❌ `debate-orchestrator.ts` の制御フローを大改修（while→状態機械）。差分が大きくレビュー負荷
- ❌ 章進行カウンタの永続化を既存 doc に混ぜ込む設計判断が要る

### Option B: 新規 per-turn オーケストレータ＋新タスク（runTurn）
`runTurn` ハンドラと新モジュールを並設し、段階移行。
- ✅ 責務分離が明確、単体テストが容易、旧経路を残して切替できる
- ❌ オーケストレーションロジックが一時的に二重化、章/ターン両チェーンの整合管理が増える

### Option C: ハイブリッド（段階移行・推奨）
- **Phase 1（正しさ先行・小）**: `addTurn` を**条件付き原子追記（期待 index 一致時のみ＋runId 照合を同一トランザクション）**に変更し、不一致なら null。`generatePersonaTurn`/`persistInterventionTurn`/`generateFacilitatorTurn` は null を受けたら以降を打ち切り正常終了。→ **現行の章ループ構造のままでも二重生成が止まる**（重複実行 B の追記が index 不一致で弾かれる）。R2/R3/R6/R7 を満たす。
- **Phase 2（構造変更・中〜大）**: `executeChapterTask` の while を解体し、1ターン=1タスクへ。`getDebateState` に discussionPoints 復元を追加し、章進行カウンタを永続化。`runChapter`→per-turn チェーン。→ R1/R4/R5 を満たし、30分上限と並走窓を構造的に解消。
- ✅ 正しさ（冪等）を最小変更で即時投入し、構造変更はその上で安全に実施
- ✅ Phase 1 だけでも本番の症状を止血できる
- ❌ 2 フェーズ分の計画・テストが必要

---

## 4. 工数・リスク

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| Phase 1: 条件付き原子追記＋runId 内包 | S〜M | Low〜Med | トランザクションは標準パターン。arrayUnion→read-modify-write 化と全追記経路の null ハンドリング波及がやや広い |
| Phase 2: per-turn 分解 | M〜L | Med | 制御フロー再設計、章進行カウンタ永続化、discussionPoints 復元、行動等価性テストが必要 |
| 全体 | **L** | **Med** | アーキテクチャ変更だが土台(`getDebateState`)と1ターン関数群が既存 |

---

## 5. 設計フェーズへの申し送り

### 推奨
- **Option C（段階移行）**を軸に。Phase 1 の条件付き原子追記を**単一ガードポイント**（`addTurn` 内、runId 照合と同一トランザクション）に集約する。期待 index は**章ローカル `turns.length`** を用い、メタ追加なしで後方互換を確保。

### 主要な設計判断
1. **トランザクション設計**: chapter doc（turns 読取＋条件付き write）と topic doc（runId 読取）を1トランザクションに含めるか、runId は事前 get のままにするか。arrayUnion は条件付き不可のため **full array の read-modify-write** にする前提。doc 1MiB 上限・配列肥大は既存制約（要確認）。
2. **章進行カウンタの扱い（決定済み: 永続化）**: `chapterEndCount`・早期終了判定・`+1` 応答ターン・cap 判定に必要な進捗値は **chapter doc に進捗フィールドとして永続化する**（再計算案は不採用）。**ターン追記と同一トランザクションで更新**し、「ターンと進捗が常に一致」「重複タスクの追記が弾かれた場合は進捗もロールバック（二重カウントなし）」を保証する。永続化フィールドの具体スキーマ（例: `chapterEndCount`、進捗判定に要る最小限の値）は design で定義。後方互換: フィールド未設定時は 0 起点とみなす。
3. **タスクペイロード**: per-turn タスクに `expectedTurnIndex` を載せるか、起動時の reload 長で代替するか。重複配信時の no-op 判定とどう噛み合わせるか。
4. **終端・章遷移の冪等化**: クロージング/事後コメント/`phaseStatus` 更新/次タスク enqueue を `status` ガード＋トランザクションで二重実行不可にする。
5. **行動等価性の担保**: LLM をモックした決定論ハーネスで、リファクタ前後のターン列（話者・モード・指名）が一致することを検証する戦略。
6. **失敗時セマンティクス**: per-turn 化で `markDebateStopped`（最終リトライ失敗）の粒度がターン単位になる。停止条件の再定義が要る。

### Research Needed
- Firestore トランザクションでの「配列 length 条件付き追記」の実装形（read-modify-write の競合再試行挙動）。
- `chapterEndCount` / 早期終了ロジックの永続化 vs 再計算の決定論性。
- per-turn dispatch によるターン間レイテンシ増の許容度（背景生成として実測）。
- `onTaskDispatched` 実質30分上限（[[project-task-timeout-30min-cap]]）下での per-turn 粒度の妥当性（1ターンは十分短く問題なし、の確認）。
