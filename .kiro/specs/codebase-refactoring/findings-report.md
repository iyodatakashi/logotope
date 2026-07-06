# 仕様不備・不整合レポート（codebase-refactoring）

本レポートは、リファクタリング（spec: codebase-refactoring）の通読・構造レビュー過程で検出した仕様面の不備・不整合を「場所 / 事象 / なぜ不備か / 推奨対応」の形式で一覧化したものである。

**重要な方針（Requirement 7.4）**: これらのうち**挙動変更を伴う修正は本 spec では一切行っていない**。本レポートは対応方針の判断材料であり、各項目の対応（別 spec 化 / 個別修正 / 現状維持）はユーザーの判断に委ねる。

**対象外（Requirement 7.5）**: steering・仕様書ドキュメント自体の陳腐化（実装は正しくドキュメントが古いだけの乖離）は仕様不備として扱わず、本レポートに含めない。コードを正とする。

出典: 構造レビュー詳細は [chain-structure-findings.md](chain-structure-findings.md)、通読メモは [read-through-notes.md](read-through-notes.md)。

---

## A. 討論チェーン

### A-2. loadStepContext の Firestore 読み取り重複
- **場所**: `functions/src/pipeline/debate/debate-orchestrator.ts`（loadStepContext）+ `functions/src/pipeline/debate/chapter.ts`
- **事象**: 毎ステップで全章 doc（全ターン込み）取得・同一コレクションへの同一クエリ再実行・章 doc の3回目の単発 get が走る。topic doc も1ターン中に最大4回読まれる。2クエリが別スナップショットのため `chapterTurnStartInState` の引き算が非一貫スナップショット前提。
- **なぜ不備か**: 冗長な読み取りでコスト・レイテンシが増え、非一貫スナップショット前提が将来のバグ源になりうる。
- **推奨対応**: 1クエリからターン連結・進捗をメモリ導出。ただし読み取り削減は R1.4（パフォーマンス目的の書き換え禁止）に抵触しうるため、専用の検証を伴う別 spec で扱う。

### A-4. ターン確定後の副作用が非原子・リトライで再実行されない
- **場所**: `functions/src/pipeline/debate/step.ts`（addTurn 成功後の consumeQueuedIntent・discussionPointStatuses 保存）
- **事象**: addTurn 成功後の副作用が別書き込みで、ここでクラッシュするとリトライは frontier 前進の `advanced` で素通りし、消化済みキュー残留・カバレッジ記録欠落が起きうる。
- **なぜ不備か**: 「ターン確定と付随状態更新」が原子的でなく、部分適用状態が残る。
- **推奨対応**: 副作用を addTurn トランザクションへ同梱。別 spec 化（挙動変更・要検証）。

### A-5. comments ステップ失敗時の復旧経路がない
- **場所**: `functions/src/api/debates.ts`（restartDebate ガード）+ comments ステップ
- **事象**: 全章 completed 後に comments が3回失敗→stopped になると、restartDebate は running/pending 章前提で拒否し、startDebate 再投入もチェーン即死。手動 Firestore 操作でしか復旧できないデッドエンド。
- **なぜ不備か**: 終端ステップの失敗から自動復旧できず運用が詰まる。
- **推奨対応**: 現 frontier から次ステップを再導出する非破壊 resume エンドポイント。別 spec 化。

### A-9. 同一 frontier 並走時の awareness 二重永続
- **場所**: `functions/src/pipeline/debate/engagement.ts`
- **事象**: awareness の評価・永続が frontier トランザクションの前に走り、entry id が nanoid のため arrayUnion の冪等性が無効。並走で二重追記の可能性。
- **なぜ不備か**: 並走時に気づきが重複永続されうる（冪等性の穴）。
- **推奨対応**: 自然キー化（triggeredByTurnId + personaId）で冪等性を回復。別 spec 化（要確認・挙動変更）。

---

## B. 討論前生成チェーン（fact-research → stakeholders → personas → interviews → chapters）

本チェーンの芯は「生成ライフサイクル状態機械の所有権が FE とサーバに分裂している」点。editing フェーズは既にサーバ所有に到達済みで、上流5フェーズが過渡形のまま。B-1/B-2/B-3/B-5 は同根で、サーバ一本化により同時解消しうる。

### B-1. regenerate の「reset 連発 → generate 後勝ち」順序契約
- **場所**: 各フェーズ画面（`Phase1Stakeholders.svelte` ほか5画面）
- **事象**: reset を直列で呼び、最後の generate が phase を書き戻す「後勝ち」に依存。resetEditing 完了〜generate 発火の間に FE が落ちると上流データ全削除済みなのに phase が座礁し、復旧は手動のみ。
- **なぜ不備か**: FE 在席に依存した非原子な状態遷移で、中断時に不整合状態へ落ちる。
- **推奨対応**: サーバの単一 callable が「対象フェーズ+下流の破棄 → running 設定 → 生成実行」を一連実行。別 spec 化。

### B-2. stopped 書込が FE 在席依存（running 宙吊り）
- **場所**: `src/lib/models/topic/createTopic.svelte.ts`、`functions/src/.../topic-phase.ts`
- **事象**: running/stopped は FE 書込、generated だけサーバ権威。callable 実行中のタブクローズ+サーバ失敗で誰も stopped を書かず running が永久宙吊り（全5フェーズ共通）。`setTopicPhaseStatus` は本目的の死に API（本番未使用）で、サーバ所有移行が中途停止した証跡。FE の catch 内 getDoc 再確認パターン（5箇所）はこの分裂の対症療法。
- **なぜ不備か**: 異常系の状態確定が FE 在席に依存し、宙吊りが残る。
- **推奨対応**: サーバ catch で「running のときのみ stopped」の冪等遷移（confirmPhaseStopped）。FE 再確認パターンは削除可能。別 spec 化。

### B-3. 取材 fanout の失敗集約だけ FE 在席依存
- **場所**: `src/lib/stores/personas.svelte.ts`（runInterviews の Promise.allSettled）
- **事象**: ペルソナ数分の callable を FE が発行し、部分失敗時の stopped 確定だけ FE 責務。全件成功はサーバ `confirmInterviewsGeneratedIfAllComplete` で救われるため、成功パスだけ在席非依存という非対称。running 宙吊りの主経路。
- **なぜ不備か**: 失敗集約の責務が FE に残り、非対称で宙吊りを生む。
- **推奨対応**: 最小修正はサーバ interview-completion に失敗集約の対称判定を追加。本格対応は Cloud Tasks fanout 化。別 spec 化。

### B-5. リセット実装の FE/BE 分裂と deleteTopic の削除漏れ
- **場所**: `src/lib/stores/topics.svelte.ts`（deleteTopic）+ 各 reset
- **事象**: resetStakeholders/Personas/Chapters は FE deleteDoc 直叩き（非トランザクション）、resetDebate/resetEditing はサーバ callable。削除対象が deleteTopic / 各 reset / サーバ lifecycle の三重管理で、deleteTopic は stakeholders/0・factBase/0・edited* を削除せず orphan が残る。
- **なぜ不備か**: 削除対象リストの多重管理で漏れ（orphan）が生じ、非原子で部分残骸が残る。
- **推奨対応**: 破棄系をサーバ `resetFromPhase(topicId, phase)` に集約。deleteTopic はサーバ再帰削除へ。別 spec 化。

### B-7. chapters の非原子的永続化（personas と規範不統一）
- **場所**: `functions/src/pipeline/chapters/chapter-generator.ts`
- **事象**: personas は batch で「全件 or 未書込」を規範宣言するが、chapters は `Promise.all` の個別 set で途中失敗の部分残骸が残り得る。
- **なぜ不備か**: 同種の一括生成で原子性規範が不統一。
- **推奨対応**: batch 化。異常時のみ影響のため個別修正でも可。

### B-8. 討論前フェーズにだけ runId（世代識別）が無い
- **場所**: 討論前生成フェーズ全般
- **事象**: editing は runId で旧世代を弾く規範を確立済みだが、上流フェーズは二度押し・二重タブの旧ランが成果を上書きして先に generated 確定しうる。
- **なぜ不備か**: 世代識別の欠如で旧世代の書き込みが新世代を汚染しうる（発生頻度は低い）。
- **推奨対応**: 上流フェーズにも runId 照合規範を展開。別 spec 化（優先度低）。

---

## C. 編集・ファクトチェックチェーン

### C-2. 編集成果物に世代スタンプがなく reset/再実行と競合
- **場所**: `functions/src/pipeline/editing/editing-orchestrator.ts`、`edited-repository.ts`
- **事象**: 世代照合がタスク入口のみで、数分の LLM 後の無条件 set に照合がなく、resetEditing→startEditing 直後に旧世代の書き込みが新世代の clear 後に着地しうる。finalizeEditingRun は runId 無視で全章集計するため全章成功でも stopped と誤確定しうる。
- **なぜ不備か**: 書き込み・finalize に世代照合がなく、旧世代が新世代を上書き／誤確定する。
- **推奨対応**: editedChapter に runId を刻み、書き込み・finalize とも現行 runId と照合。別 spec 化。

### C-3. コメント編集だけ構造検証がない
- **場所**: `functions/src/pipeline/editing/editing-step.ts`（コメント編集）
- **事象**: 章編集には validateEditedChapter があるが、コメント編集は LLM 出力を無検証で永続化。存在しない sourceCommentId は `personaId:''`・`sortOrder:0` に化けて保存され、FE で話者がファシリテーター表示に化ける。コメント脱落も検出されない。
- **なぜ不備か**: 検証欠如で不正な参照が黙って化け、表示不整合・脱落が起きる（明白なバグ寄り）。
- **推奨対応**: sourceCommentId の全単射検証を追加し、不合格は章と同様 failed 扱い。別 spec 化。

### C-5. 編集ステップごとに全章コレクションを2回全読
- **場所**: `functions/src/pipeline/editing/editing-step.ts`、`editing-orchestrator.ts`
- **事象**: 対象1章しか使わないのに全章を、length しか使わないのに全章を、N 章 × 2N 回フル読取。
- **なぜ不備か**: 冗長読み取りでコスト増（A-2 と同種）。
- **推奨対応**: 単章リーダー+メタ取得へ。R1.4 との整理が必要なため別 spec 化。

### C-6. Phase6Editing の表示合成ロジックが肥大
- **場所**: `src/lib/features/admin/topic-detail/editing/Phase6Editing.svelte`
- **事象**: 原本×編集済み×気づきの表示合成ロジックが約120行、コンポーネントに閉じている（公開ページ実装時に複製の構図）。
- **なぜ不備か**: 将来の公開ページ実装で複製が生じやすい（不備というより保守リスク）。
- **推奨対応**: 純関数抽出。個別修正で可（挙動保全内だが公開ページ実装時に合わせて行うのが自然）。

---

## D. 通読で新規発見した不整合・要仕様確認

### D-1. performOpenStep のエラー処理が章位置で非対称
- **場所**: `functions/src/pipeline/debate/step.ts`（performOpenStep）
- **事象**: 第1章（open）は `generateOpening` 失敗時に throw して停止させるが、第2章以降は `generateChapterIntroduction` 失敗を無言スキップし章導入なしで続行する。
- **なぜ不備か**: 同種の「章導入生成失敗」に対する扱いが章位置で異なる。意図的な仕様か、章導入失敗も停止扱いにすべきか未定義。
- **推奨対応**: 仕様意図を確認。停止扱いに統一するなら挙動変更を伴うため別 spec / 個別修正で判断。

---

## E. 挙動保全内だが本 spec で見送った整理（次 spec 推奨）

以下は挙動を変えずに直せるが、影響範囲・テスト面の広さに対し本 spec 内での利得が小さいため見送った。

### E-1. StepContext の別名解消・スナップショット/可変 state の型名分離（chain: A-7 残）
- **場所**: `functions/src/types/step.types.ts`（StepContext）+ step/turn/intervention 各所
- **事象**: `chapter`/`chapterDoc` が同一オブジェクトの別名。ロード時凍結の `chapterDoc.turns` と実行中前進する `state.turns` の鮮度差が型に現れない。
- **推奨対応**: 型名を分離し別名を削除。StepContext 形状が広範囲に波及するため専用の型整理 spec が適切。

### E-2. intervention フォールバックの必須引数化（chain: A-8 残）
- **場所**: `functions/src/pipeline/debate/intervention.ts`（`chapterTurns ?? state.turns`）
- **事象**: 現状未発現の誤った既定値フォールバックが残る。
- **推奨対応**: chapterTurns を必須引数化してフォールバックを削除。tryIntervention のテスト呼び出し面が広いため単独の小改修 spec が適切。
