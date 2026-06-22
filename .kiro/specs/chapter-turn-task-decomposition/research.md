# Research & Design Decisions: chapter-turn-task-decomposition

## Summary
- **Feature**: `chapter-turn-task-decomposition`
- **Discovery Scope**: Extension（既存討論パイプラインの構造変更）
- **Key Findings**:
  - `getDebateState` が永続データから状態を決定論的に再構築できるため、per-turn 化の土台は既存。残る非自明な状態は「章終了カウンタ」のみ → 永続化で解決（gap-analysis で確定）。
  - ターンは chapter doc の `turns` 配列に `arrayUnion` で無条件追記されており、冪等性がない。**章ローカル `turns.length` を sequence number とする条件付きトランザクション追記**で、重複・並走実行を1件に収束できる。
  - 二重生成の止血（冪等追記）と構造変更（per-turn 分解）は分離可能。Phase 1 で前者だけ入れれば現行ループのままでも症状が止まる（移行リスク低減）。

## Research Log

### Firestore トランザクションによる条件付き配列追記
- **Context**: R2「期待位置の原子照合」を実現する手段。現状の `FieldValue.arrayUnion` は条件付きにできない。
- **Sources Consulted**: Firestore Admin SDK トランザクション仕様（`runTransaction`：全 read を write より先に実行、コミット時の競合で自動リトライ、最大500 write/tx、複数ドキュメント read/write 可）。
- **Findings**:
  - `arrayUnion` は「存在しなければ追加」のセマンティクスで、配列長条件を表現できない。条件付きにするには **read-modify-write（配列全体を読み、`turns.length === expectedIndex` を確認して `[...turns, newTurn]` を write）** が必要。
  - トランザクション本体内で「長さ不一致」を検出した場合、**例外を投げず sentinel（rejected 結果）を返して正常コミット**すれば、敗者の実行は no-op になりリトライ地獄に陥らない。Firestore の自動リトライは「コミット時競合」で再実行されるが、再実行時の read で `turns.length` が進んでいれば本体が rejected を返すため二重追記しない。
  - runId 照合（topic doc）と turns 追記（chapter doc）を**同一トランザクションに含めれば**、世代ガードと冪等追記が原子的に成立する。
- **Implications**: `addTurn` を「expectedIndex を取り、トランザクションで条件付き追記し、`committed | rejected` を返す」関数に変更。chapterEndCount 等の進捗更新も同一 tx に同梱。

### Cloud Tasks の配信保証とディスパッチ上限
- **Context**: 並走の根本原因（at-least-once 配信＋タイムアウト後の旧インスタンス残存）と、per-turn 化が上限制約に与える影響。
- **Findings**:
  - `onTaskDispatched` は実質30分（Cloud Tasks dispatch deadline）が上限（[[project-task-timeout-30min-cap]]）。1章を1実行で回す現構造はこの上限に達してリトライ→並走を誘発しうる。
  - per-turn 化すると1タスク=数十秒に収まり、上限に達しないため**タイムアウト由来の並走窓がほぼ消える**。残る at-least-once 重複配信は冪等追記が吸収する。
- **Implications**: per-turn 分解＋冪等追記の二層で、タイムアウト・重複配信の双方に対処。タイムアウト延長は不要（構造で解消）。

### ステップチェーンの liveness と Cloud Tasks 名前ベース dedup
- **Context**: per-turn 化で「追記（tx）→ 次ステップ enqueue（別呼出）」が非原子になり、追記コミット後・enqueue 前のクラッシュでチェーンが永久停止しうる（design レビュー Issue 1）。
- **Sources Consulted**: `firebase-admin` `TaskOptions.id`（`functions/node_modules/firebase-admin/lib/functions/functions-api.d.ts`）。
- **Findings**:
  - `enqueue(data, { id })` で明示 id を与えるとタスクが dedup される。既存/最近実行済みの同 id は `functions/task-already-exists` を投げる。id は実行/削除後 **約1時間予約**される。
  - 連番 id はレイテンシ/エラー率を悪化させるため **hash 化推奨**（reversed/hashed）。
  - 早期 no-op を「pure return」ではなく **resume（最新状態から `decideNextStep` を再計算して同 id で enqueue）** にすれば、(1) 勝者が enqueue 前に死んでもチェーン復活、(2) 同 id dedup で多重投入は1本に収束。
  - id に `runId` を含めると、`restartChapter`（新 runId）が約1時間の予約と衝突しない。
- **Implications**: `advanceDebate` の frontier 不一致/rejected を resume 化。`enqueueTurnStep` は `hash(runId:chapterId:frontierIndex)` を id にし `task-already-exists` を成功扱い。`decideNextStep` は純関数（同 frontier の enqueuer が同 id・同 payload を計算する前提）。

### 章進行ロジックの状態依存性（行動等価性リスク）
- **Context**: R5 行動等価性。while ループ局所の `chapterEndCount`・早期終了・`+1` 応答ターンを per-turn で再現する必要。
- **Findings**:
  - `chapterEndCount` は `shouldContinueChapter`（`engagements.some(score>=CONTINUE_CHAPTER_THRESHOLD)`）で 0 リセット/加算される連続カウンタ。値の計算に必要な engagements は**当該ターンを生成するタスク内で評価される**ため、追記トランザクションで前進更新できる。
  - cap・早期終了進捗（`EARLY_END_PROGRESS_RATIO`）は `turns.length` から導出可能。よって**追加で永続化が要るのは `chapterEndCount` のみ**。
  - 章末の「未応答指名への +1 応答ターン」は、per-turn では「章終了判定時に `getLastTargetPersona` が残っていれば最終 TURN を1回挟む」で等価化できる。
- **Implications**: 進捗フィールドは `chapterEndCount` 最小限。章終了判定・コーバレッジ評価・+1 応答は「追記の唯一勝者タスク」内で実行し重複を防ぐ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A 既存ファイル拡張 | `executeChapterTask` を per-turn 再入関数へ改修、`addTurn` をトランザクション化 | 新規ファイル最小、`executeTurn`/`getDebateState` 流用 | orchestrator 大改修、差分大 | 採用（中核） |
| B 新規 per-turn モジュール並設 | 新ハンドラ・新モジュールで段階移行 | 責務分離、旧経路を残せる | ロジック二重化、整合管理増 | 不採用（二重化コスト） |
| C ハイブリッド段階移行 | Phase1 冪等追記→Phase2 per-turn 分解 | 止血を最小変更で先行、移行リスク低 | 2フェーズ分の計画/テスト | **採用（移行戦略として A に内包）** |

## Design Decisions

### Decision: ターン列の sequence number を「章ローカル turns.length」とする
- **Context**: R2 の期待位置照合に一意な順序キーが必要。
- **Alternatives Considered**:
  1. 専用の連番フィールドを別管理 — 追加状態と整合負担。
  2. 章ローカル `turns.length` を index とする — 既存データから自明、追加状態ゼロ。
- **Selected Approach**: 各ステップは「`expectedTurnIndex = 再構築時の章ローカル turns.length`」を持ち、トランザクション内で `turns.length === expectedTurnIndex` のときだけ1件追記。
- **Rationale**: 後方互換（既存ターンにメタ不要）。重複配信・並走を index 競合として自然に収束。
- **Trade-offs**: 追記が `arrayUnion` から full array write になり、章 doc 全体を読む。章 doc は元々全ターンを1 doc に持つ既存設計のため新規制約ではない（1MiB 上限は要監視）。
- **Follow-up**: 章 doc サイズの監視。長期的にはターンのサブコレクション化を別 spec で検討。

### Decision: 1タスク=1ステップ（≤1ターン追記）。判定ロジックは追記の唯一勝者が実行
- **Context**: R1.1（1タスク≤1ターン）と R3（重複の no-op）、R4（終端の冪等）。
- **Selected Approach**: ステップ種別（OPEN / TURN / SUMMARY / CLOSING / COMMENTS）を1タスクに対応させ、各ステップは高々1件のターン追記。章継続/終了/finalize の判定は、**追記に成功した唯一の実行**の中で行い、次ステップを enqueue する。敗者（重複/陳腐）は追記が rejected されるため判定も enqueue もしない。
- **Rationale**: 「唯一勝者だけが前進・分岐・再 enqueue する」ことで、判定や次タスク投入の二重化を構造的に排除。
- **Trade-offs**: ステップ間に Cloud Tasks dispatch レイテンシが挟まる（背景生成のため許容）。
- **Follow-up**: ターン間レイテンシの実測。

### Decision: liveness を resume + deterministic task id（dedup）で保証
- **Context**: 「追記成功後・次 enqueue 前のクラッシュ」でチェーンが永久停止するリスク（Issue 1）と、resume による多重 enqueue の fan-out 懸念。
- **Alternatives Considered**:
  1. 早期 no-op（pure return）— 重複は止まるが liveness が破綻。
  2. 専用 watchdog ステップでチェーン健全性を監視 — タスク管理が増え利点が薄い。
  3. 全タスクが resume + 同 id dedup — 重複検出と liveness を同一機構で両立。
- **Selected Approach**: frontier 不一致/rejected のタスクは pure return せず、最新状態から `decideNextStep` を計算して `hash(runId:chapterId:frontierIndex)` を id に enqueue。`task-already-exists` は成功扱い。
- **Rationale**: 同一 frontier を見た勝者・敗者・リトライが同 id を作るため、(1) 通常前進では id が単調増加で衝突せず、(2) 並走/クラッシュ時のみ dedup が発火し1本に収束、(3) 勝者死亡時は敗者/リトライがチェーンを復活。
- **Trade-offs**: id 指定で enqueue レイテンシ増（hash 化で緩和）。約1時間の id 予約を runId 込みで回避。
- **Follow-up**: `decideNextStep` の純粋性をテストで担保（同 state→同 NextStep）。

### Decision: ステップの全状態変更を単一トランザクションに畳む
- **Context**: `chapterEndCount` リセットや `discussionPointStatuses` 更新が追記 tx 外だと部分失敗で desync（Issue 2）。
- **Selected Approach**: LLM 生成（発言・coverage）は tx 前の純計算で行い、tx 内で index/runId 照合のうえ「ターン追記 + chapterEndCount + discussionPointStatuses」をまとめて write。rejected なら全破棄。
- **Rationale**: ステップの状態遷移が all-or-nothing になり、resume 時も整合した state から再計算できる。
- **Trade-offs**: rejected 時に LLM 生成が無駄になる（正しさ優先で許容）。

### Decision: 進捗カウンタ `chapterEndCount` を chapter doc に永続化（追記 tx に同梱）
- **Context**: per-turn で唯一復元できない章終了カウンタ（gap-analysis で永続化に確定）。
- **Selected Approach**: chapter doc に `chapterEndCount` を持ち、TURN ステップの追記トランザクション内で `shouldContinue ? 0 : prev+1` に更新。未設定時は 0 起点（後方互換）。
- **Rationale**: 追記と同一 tx により「ターンと進捗が常に一致」「敗者はロールバックで二重カウントなし」。
- **Trade-offs**: chapter doc に可変フィールドが1つ増える。
- **Follow-up**: restartChapter 時のリセット（`turns: []` と併せて `chapterEndCount` 削除）。

## Risks & Mitigations
- 行動等価性の崩れ（リファクタ起因） — LLM をモックした決定論ハーネスで旧ループ／新チェーンのターン列一致をテスト（R5）。
- ステップチェーン断絶（追記後・enqueue 前のクラッシュ） — frontier 不一致/rejected の resume ＋ deterministic id dedup でチェーン復活と多重防止を両立（Issue 1 解決）。
- 進捗の部分失敗 desync — ステップの全状態変更を単一 tx に同梱（Issue 2 解決）。
- 章 doc の肥大・書込増幅（arrayUnion→全配列 RMW） — 1章のターンは有界（≈最大37）で 1MiB・書込量とも当面安全。許容と判断、サイズ監視を follow-up（Issue 3）。
- dedup id のレイテンシ／約1時間予約 — id を hash 化、runId を鍵に含め restart 衝突を回避。
- 移行中の旧 `runChapter` と新ステップの混在 — Phase 制御（旧ハンドラ撤去 or 無効化）で単一経路に収束させる。

## References
- Firestore Transactions（Admin SDK）— 条件付き read-modify-write、競合自動リトライ、複数 doc。
- 既存 spec `debate-run-isolation` — runId 世代ガード（別世代ブロック）。本 spec はこれと独立した同一世代内ガードを追加。
- メモリ [[project-task-timeout-30min-cap]] — onTaskDispatched 実質30分上限。
