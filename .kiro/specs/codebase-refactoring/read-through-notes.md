# 通読トラック（Track 3）作業メモ

タスク 6.1〜6.4 の通読で確認・是正した事項と、タスク7（仕様不備レポート）へ引き継ぐ発見事項の構造化メモ。

## 6.1 配置基準・テスト配置の確認結果

| 観点 | 結果 |
|---|---|
| FE 型は models 配下 | 準拠（`src/lib` 内の `*.types.ts` は全て models 配下） |
| Functions 型は types 配下 | 準拠 |
| UI 操作オーケストレーション（goto/$app/navigation）が models/stores に無い | 準拠（0件） |
| テストが tests ミラー配置・命名規約・`$lib` エイリアス | 準拠（相対 lib import 0件） |
| Firestore/Cloud Functions 呼び出しが状態管理層にあり UI 直呼びでない | **1件是正**: `routes/admin/topics/new/+page.svelte` が `httpsCallable('fetchSourceContents')` を直呼びしていた → `topicsStore.fetchSourceContents(topicId)` へ移設（挙動不変・テスト追加） |

## 6.2 関数順序・過度な共通化の判定結論

### 過度な共通化・重複（AC 4.1 / 4.3）
- **分解が必要な過度共通化はなし**。`PhasePanel.svelte`（7フェーズ画面が使用）はラベル・操作を呼び出し側が渡す制御された設計で、structure.md 基準（「変えると意図しない他画面に影響するか？」）に照らして分解不要。backend orchestrator の stepKind 分岐は各機能内に閉じたステートマシンで問題なし。
- **重複ロジックの一本化は完了**: 日付整形 `currentDateString`/`formatDate` の重複はタスク4.3で `formatJapaneseDate` に統合済み。早期終了判定式の二重実装（orchestrator/step）はタスク6.3（A-3）で `isEarlyEndCandidate` に一本化。summary/closing 選択の2箇所は `chapterEndStepKind` に一本化。

### 関数のトップダウン順（AC 3.4）
- 各モジュールを通読。当コードベースは「小さなヘルパを先に定義し、公開関数を後に置く」局所スタイルで一貫しており、可読性を損なう並び順の逸脱は見当たらなかった。const アロー主体のため「呼び出し元を先」への機械的な全面並べ替えは TDZ/参照順の実害リスクに対し利得が小さく、既存の一貫スタイルを尊重して大規模並べ替えは行わない方針とした（挙動保全・差分ノイズ回避）。6.3 で触れた debate チェーン各ファイルは整理後もこの局所スタイルを維持。

## 6.3 で実施した挙動保全リファクタ（完了）
- A-3: `isEarlyEndCandidate` 純関数化（utils.ts）。orchestrator/step の重複式を一本化。
- A-6: `chapterEndStepKind` で summary/closing 選択を一本化。`executeFinalResponseTurn` を切り出し freeze パスを独立化。
- A-7（一部）: `getDebateState` に discussionPoints を渡して「空返し→後付けミューテート」を解消し、状態組成を loadStepContext に集約。
- A-8（一部）: `decideNextStep` の死にパラメータ `chapterIndex` 削除・戻り値型を `turn/summary/closing` に絞り到達しない `'none'` ガード削除。orchestrator ローカルの同名 `getTopicContext` を `loadTopicParticipants` に改名（topic-context.ts の同名関数と区別）。
- B-4: FE の死にパラメータ `topicContext`（サーバが無視）を Phase3Interviews / InterviewItem / personas ストアの取材チェーンから除去。
- B-9: `stakeholder-agent` / `persona-generator-agent` を `Result<T, PipelineError>` へ統一し API 層のエラー処理を一本化。

## タスク7（仕様不備レポート）へ引き継ぐ発見事項

### 挙動保全内だが本 spec では見送った整理（低リスク化のため次 spec 推奨）
- **A-7 残**: `StepContext` の `chapter`/`chapterDoc` 同一オブジェクト別名の解消と、ロード時凍結スナップショット（`chapterDoc.turns`）と実行中前進する `state.turns` の型名分離。StepContext 形状が step/turn/intervention の広範囲に波及するため、専用の型整理 spec が適切。
- **A-8 残**: `intervention.ts` の `chapterTurns ?? state.turns` フォールバック（現状未発現の誤った既定値）の必須引数化。tryIntervention のテスト呼び出し面が広く、単独の小改修 spec が適切。

### 実装間の不整合・要仕様確認（新規記録。挙動変更を伴うため本 spec では未対応）
- **performOpenStep のエラー処理非対称**: 第1章（open）は `generateOpening` 失敗時に throw するが、第2章以降は `generateChapterIntroduction` 失敗を無言スキップして章導入なしで続行する（`step.ts`）。仕様として意図的か、章導入生成失敗も停止扱いにすべきか要確認。

### 既知のチェーン構造所見（chain-structure-findings.md）のうち未対応＝挙動変更を伴うもの
タスク7のレポートに「場所 / 事象 / なぜ不備か / 推奨対応」で載せる対象:
- 討論チェーン: A-2（loadStepContext の読み取り重複・R1.4 との整理要）、A-4（ターン確定後副作用の非原子・リトライ非再実行）、A-5（comments 失敗のデッドエンド）、A-9（同一 frontier 並走時の awareness 二重永続）
- 生成前チェーン: B-1/B-2/B-3/B-5（生成ライフサイクルの FE/サーバ分裂・running 宙吊り・reset の FE/BE 分裂と deleteTopic の orphan）、B-7（chapters の非原子永続化）、B-8（討論前フェーズに runId が無い）
- 編集チェーン: C-2（編集成果物に世代スタンプ無し）、C-3（コメント編集の構造検証欠如）、C-5（編集ステップの全章2回全読・R1.4 整理要）、C-6（Phase6Editing の表示合成ロジックの純関数抽出余地）
