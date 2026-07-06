# チェーン構造レベルの問題 詳細所見

調査日: 2026-07-06
調査方法: 3系統の構造レビュー（討論チェーン / 討論前生成チェーン / 編集・ファクトチェックチェーン）。制御フローを実測マップ化した上で、間接層・状態受け渡し・工程冗長性・チェーンの脆さ・責務のねじれを監査。

各所見の分類:
- **[改修=挙動変更]** 修正には挙動変更を伴う → 本 spec では報告のみ（Requirement 7）。対応は別 spec / 個別修正で判断
- **[改修=リファクタ]** 挙動を変えずに修正可能 → 本 spec の実装タスク候補

---

## A. 討論チェーン（orchestrator → step → turn → エンキュー連鎖）

冪等・再入設計の骨格（毎ステップ永続から全再構築、frontier トランザクション、deterministic task id）は健全。orchestrator→step の一方向依存も守られている。その上で:

### A-1.【対応決定・本 spec で修正】旧世代ゾンビチェーンが resume し続ける（→ requirements.md Requirement 9）
- `turn.ts:66-74`（addTurn は `generation_mismatch`（旧 runId・チェーンを殺すべき）と `index_mismatch`（並走敗者・resume すべき）を区別して返す）→ `turn.ts:276` で両方 null に潰される → `step.ts:424` で一律 'conflict' → `debate-orchestrator.ts:214-229` で resumeFromFresh。
- restart 中に飛行していた旧世代タスクが「フル LLM 実行（全員傾聴評価+発言生成+ファクトチェック）→ rejected → 旧 runId のまま再エンキュー」を章完了まで繰り返し、LLM コストを浪費。advanceDebate 入口に payload.runId と topic.runId の照合がなく（debate-orchestrator.ts:248）、summary/closing/comments はターン追記を経由しないため旧世代タスクが新世代の章状態へ副作用を与えうる。
- 改善方向: advanceDebate 冒頭で runId 照合して即 return。AppendResult の reason を伝播し generation_mismatch は resume しない。

### A-2.【中】loadStepContext が同じデータを3系統で読み直す [改修=リファクタ寄り・要判断]
- `debate-orchestrator.ts:127-155` + `chapter.ts:48-115`: 全章 doc（全ターン込み）取得と、同一コレクションへの同一クエリ再実行（ターン抽出用）、章 doc の3回目の単発 get が毎ステップ発生。2クエリが別スナップショットのため `chapterTurnStartInState` の引き算が非一貫スナップショット前提。topic doc も1ターン中に最大4回読まれる。
- 改善方向: 1クエリからターン連結・進捗をメモリ導出。※読み取り削減は R1.4（パフォーマンス目的の書き換え禁止）との整理が必要 → 設計フェーズで扱いを決定。

### A-3.【中】早期終了判定式の二重実装 + quietStreak の書き込み経路2本 [改修=リファクタ]
- 同一の複合判定が `debate-orchestrator.ts:90-92` と `step.ts:357-360` に複製。quietStreak は addTurn トランザクション内 progressPatch（`turn.ts:79-81`）と reconcile のトランザクション外 update（`step.ts:383`）の2経路。
- 改善方向: `isEarlyEndCandidate()` 純関数へ一本化。リセット経路の統一。

### A-4.【中】ターン確定後の副作用が非原子・リトライで再実行されない [改修=挙動変更]
- `step.ts:79-104`: addTurn 成功後の consumeQueuedIntent・discussionPointStatuses 保存は別書き込み。ここでクラッシュすると リトライは 'advanced' で素通り（step.ts:408-410）し、消化済みキューが残留・カバレッジ記録欠落。
- 改善方向: addTurn トランザクションへ同梱。

### A-5.【中】comments ステップ失敗時の復旧経路がない [改修=挙動変更]
- 全章 completed 後に comments が3回失敗 → stopped。restartDebate は running/pending 章前提で拒否（`api/debates.ts:63-95`）、startDebate 再投入もチェーン即死。手動 Firestore 操作でしか復旧できないデッドエンド。
- 改善方向: 現 frontier から次ステップを再導出する非破壊 resume エンドポイント。

### A-6.【中】finalResponse の概念が4箇所に分散、freeze パスが通常パスと並走 [改修=リファクタ]
- 決定（orchestrator:101-103）→ payload → freeze 分岐（step.ts:151-182）→ enqueueChapterEnd（orchestrator:232）。summary/closing 選択も2箇所（orchestrator:105-107, 207）。
- 改善方向: executeFinalResponseTurn の切り出しと選択ロジックの一本化。

### A-7.【中】StepContext/DebateState の組成分裂・鮮度の異なる真実の同居 [改修=リファクタ]
- `debate-state.ts:59-66` が discussionPoints を空で返し `debate-orchestrator.ts:138-141` が後付けミューテート。`chapterDoc`/`chapter` の同一オブジェクト別名エイリアス。実行中に前進する `state.turns` とロード時凍結の `ctx.chapterDoc.turns` の意図的鮮度差が型に現れない。
- 改善方向: 組成を loadStepContext で完結、エイリアス削除、スナップショットと可変 state の型名分離。

### A-8.【低】その他 [改修=リファクタ]
- performOpenStep の2分岐がほぼ同一コードでエラー処理だけ非対称（`step.ts:288-327`、第2章以降は失敗を無言スキップ — 仕様か要確認）
- 死んだ分岐: decideNextStep の未使用 `chapterIndex`、到達しない `next.kind === 'none'` ガード等（orchestrator:61-76, 195-198）
- 同名別物 `getTopicContext` が2つ（orchestrator:111 と topics/topic-context.ts）。後者は毎ペルソナターンで topic+factBase を再読
- `intervention.ts:142` の `chapterTurns ?? state.turns` フォールバックは誤った既定値（現状未発現）。必須引数化を推奨

### A-9.【低・要確認】同一 frontier 並走時の awareness 二重永続 [改修=挙動変更]
- `engagement.ts:120-141`: 評価・永続が frontier トランザクションの前に走り、entry id が nanoid のため arrayUnion の冪等性が無効。並走で二重追記の可能性。自然キー化（triggeredByTurnId+personaId）で閉じる。

---

## B. 討論前生成チェーン（topic → fact-research → stakeholders → personas → interviews → chapters）

構造の芯は1つ: **生成ライフサイクル状態機械の所有権が FE とサーバに分裂している**。editing フェーズは既にサーバ所有（破棄→実行中化→投入をサーバで一連実行）に到達しており、上流フェーズが過渡形のまま。B-1・B-2・B-3 は同根で、サーバ一本化により同時解消する。

### B-1.【高】regenerate の「reset 連発 → generate 後勝ち」順序契約 [改修=挙動変更]
- 各フェーズ画面（`Phase1Stakeholders.svelte:45-59` ほか5画面）が reset を直列で呼び、最後の generate が phase を書き戻す「後勝ち」に依存。resetEditing 完了〜generate 発火の間に FE が落ちると、上流データ全削除済みなのに phase='editing'/not_started で座礁。復旧は手動のみ。
- 改善方向: サーバの単一 callable が「対象フェーズ+下流の破棄 → running 設定 → 生成実行」を一連で実行。

### B-2.【高】stopped 書込が FE 在席依存（running 宙吊り） [改修=挙動変更]
- running/stopped は FE 書込、generated だけサーバ権威（`createTopic.svelte.ts:135-215`、`topic-phase.ts:28-40`）。callable 実行中のタブクローズ+サーバ失敗で誰も stopped を書かず running が永久宙吊り。全5フェーズ共通。`setTopicPhaseStatus`（topic-phase.ts:47-53）はこの目的の死にAPI（本番未使用）で、サーバ所有への移行が中途で停止した証跡。
- 派生: FE の catch 内 getDoc 再確認パターン（5箇所）はこの分裂の対症療法。
- 改善方向: サーバ catch で「running のときのみ stopped」の冪等遷移（confirmPhaseStopped）。FE の再確認パターンは丸ごと削除可能。

### B-3.【高】取材 fanout の失敗集約だけ FE 在席依存 [改修=挙動変更]
- `personas.svelte.ts:98-117`: ペルソナ数分の callable を FE が Promise.allSettled で発行し、部分失敗時の stopped 確定だけ FE 責務。全件成功時は `confirmInterviewsGeneratedIfAllComplete`（サーバ）で救われるため、成功パスだけ在席非依存という非対称。running 宙吊りの主経路。
- 改善方向: 最小修正はサーバ側 interview-completion に失敗集約の対称判定を追加。本格対応は Cloud Tasks fanout 化。

### B-4.【中】interviews だけデータ供給の向きが逆 + 死にパラメータ [改修=一部リファクタ]
- FE が persona 7フィールド+topicTitle を payload で送り返す（`personas.svelte.ts:146-160`）。他フェーズはサーバが Firestore から読む。
- **死にパラメータ**: FE が合成・送信する `topicContext` はサーバで完全無視（`api/interviews.ts` は destructure すらしない）。`Phase3Interviews.svelte:42-50` の buildTopicContext は無用 → 削除は挙動保全内で可能 [改修=リファクタ]。payload 縮小（`{topicId, personaId}` 化）はサーバ変更を伴う [改修=挙動変更]。

### B-5.【中】リセット実装の FE/BE 分裂と deleteTopic の削除漏れ [改修=挙動変更]
- resetStakeholders/Personas/Chapters は FE deleteDoc 直叩き（非トランザクション・途中失敗で部分残骸）、resetDebate/resetEditing はサーバ callable。削除対象リストが deleteTopic / 各 reset / サーバ lifecycle の三重管理で、`topics.svelte.ts:58-81` の deleteTopic は stakeholders/0・factBase/0・edited* を削除せず orphan が残る。
- 改善方向: 破棄系をサーバ `resetFromPhase(topicId, phase)` に集約。deleteTopic はサーバ再帰削除へ。

### B-6.【中】生成ライフサイクルの5重コピペ [改修=リファクタ（B-2 対応後は自然消滅）]
- 「running 書込 → callable → catch で getDoc 再確認 → stopped」がほぼ同文で4回複製 + interviews の変種1つ。fact-research だけサーバ側エラーハンドリング形式が異なる等、既に微妙な分岐が発生。

### B-7.【中】chapters の非原子的永続化（personas と規範不統一） [改修=挙動変更（異常時のみ）]
- personas は batch で「全件 or 未書込」を規範宣言、chapters は `Promise.all` の個別 set（`chapter-generator.ts:37-50`）で途中失敗の部分残骸が残り得る。batch 化推奨。

### B-8.【中・要確認】討論前フェーズにだけ runId（世代識別）が無い
- editing は runId で旧世代を弾く規範を確立済み。上流フェーズは二度押し・二重タブの旧ランが成果を上書きして先に generated 確定しうる。発生頻度は低く優先度低。

### B-9.【低】エージェント層で Result 型と throw の二流儀が併存 [改修=リファクタ]
- fact-research/interview/chapter は `Result<T, PipelineError>`、stakeholder/persona-generator は素の throw。API 層に2種類の変換が併存。Result 側が多数派。

---

## C. 編集・ファクトチェックチェーン

編集 orchestrator の工程構造・原本再生成時の失効処理（discardChaptersWithSideData での章FC削除+clearEditedArtifact）・インライン/章FC の突合ロジック自体は健全。

### C-1.【解決済み・ユーザー決定】章FCの指摘が編集の保護判定に合流しない
**→ 章FC機能自体を削除する（requirements.md Requirement 8）。インラインFCで正確性は十分担保されるため、二系統の真実源分裂は機能削除で解消。C-4（多重起動ガード欠如）・C-6 の factCheck ストア購読問題も同時に消滅する。**

<details>
<summary>元の所見（記録として保持）</summary>

- FC 成果物が2形に分裂: インライン検証は `turn.factCheck` 埋め込み、章FCは `chapters/{id}/factCheck/result` 別ドキュメントで turn への書き戻しなし。編集の保護判定（`editing-step.ts:71-92`）は前者のみ参照。
- post-debate-editorial-pass の design.md:304「ファクトチェック指摘を持つターンは除外禁止」に対し、章FCで指摘が付いたターンは保護されず編集で発言ごと削除されうる。FE（`Phase6Editing.svelte:186`）では削除ターンの findings が空固定のため、指摘付き発言が表示から黙って消える。
- 改善方向: runChapterEditStep で readFactCheckResult を合算参照、または章FC完了時に turn.factCheck へ書き戻して単一の真実源化。※「章FCは管理者向け診断のみ」という意図なら仕様どおり — 要ユーザー判断。

</details>

### C-2.【中】編集成果物に世代スタンプがなく reset/再実行と競合 [改修=挙動変更]
- 世代照合はタスク入口のみ（`editing-orchestrator.ts:22`）。数分の LLM 後の書き込み（`edited-repository.ts` の無条件 set）に照合がなく、resetEditing→startEditing 直後に旧世代の書き込みが新世代の clear 後に着地しうる。finalizeEditingRun は runId 無視で全章集計するため全章成功でも stopped と誤確定しうる。
- 改善方向: editedChapter に runId を刻み、書き込み・finalize とも現行 runId と照合。

### C-3.【中】コメント編集だけ構造検証がない [改修=挙動変更]
- 章編集には validateEditedChapter があるが、コメント編集（`editing-step.ts:249-260`）は LLM 出力を無検証で永続化。存在しない sourceCommentId は `personaId:''`・`sortOrder:0` に化けて保存され、FE で話者がファシリテーター表示に化ける。コメント脱落も検出されない。
- 改善方向: sourceCommentId の全単射検証を追加し、不合格は章と同様 failed 扱い。

### C-4.【解決済み】章FCタスクに多重起動ガードがない
- `api/fact-check.ts:54-57` は deterministic task id なしで enqueue。二度押しで2タスク並走し arrayUnion 追記が二重化。**→ 章FC削除（Requirement 8）により消滅。**

### C-5.【低〜中】編集ステップごとに全章コレクションを2回全読 [改修=リファクタ寄り・要判断]
- `editing-step.ts:175`（対象1章しか使わない）+ `editing-orchestrator.ts:26`（length しか使わない）で N 章 × 2N 回のフル読取。単章リーダー+メタ取得へ。※A-2 と同じく R1.4 との整理が必要。

### C-6.【低】その他
- 原本×編集済み×FC×気づきの約120行の表示合成ロジックが `Phase6Editing.svelte:137-254` に閉じている（公開ページ実装時に複製の構図）。着手時に純関数抽出で足りる
- ~~`factCheck.svelte.ts:37`: 章一覧を getDocs 一回取得で固定するため、討論 restart 後は購読が古い章集合のまま~~ → 章FC削除により消滅

---

## 総括

| テーマ | 該当 | 本質 |
|---|---|---|
| 生成ライフサイクル状態機械の FE/サーバ分裂 | B-1, B-2, B-3, B-5, B-6（高3件を含む） | editing で確立済みの「サーバ所有」規範に上流5フェーズが未到達の過渡形。サーバ一本化で同時解消 |
| 世代（runId）照合の不徹底 | A-1, B-8, C-2, C-4 | 世代概念の有無・照合位置がチェーンごとにバラバラ。入口ゲート+書込時照合の規範統一 |
| 成果物の真実源分裂 | ~~C-1~~（章FC削除で解決）, A-3 | 同一概念（FC指摘・quietStreak）が2形/2経路で存在し、消費側が片方しか見ない |
| 非原子な複数書込 | A-4, B-7 | トランザクション/batch へ同梱すべき副作用が裸のまま |
| 純粋な整理対象（挙動保全内） | A-3, A-6, A-7, A-8, B-4の死にパラメータ, B-9 | 本 spec のリファクタリングタスク候補 |
