# Implementation Plan

- [x] 1. (P) `ProgressTrackerService` クラスを削除し、`debate-orchestrator.ts` から参照を除去する
  - `functions/src/pipeline/progress-tracker.ts` をファイルごと削除する
  - `debate-orchestrator.ts` の `import { ProgressTrackerService }` 行を削除する
  - `DebateOrchestratorService` constructor の `private tracker: ProgressTrackerService = new ProgressTrackerService()` パラメータを削除する
  - `run()` メソッド冒頭の `await this.tracker.updateStatus(topicId, 'debating')` を削除する
  - `resume()` メソッド冒頭の `await this.tracker.updateStatus(topicId, 'debating')` を削除する
  - `debate-orchestrator.ts` に `progress-tracker` への参照が一切残っていないこと
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: debate-orchestrator.ts, progress-tracker.ts_

- [x] 2. (P) `progress-tracker.integration.test.ts` を削除する
  - `functions/src/pipeline/progress-tracker.integration.test.ts` をファイルごと削除する
  - リポジトリ内に `debate_progress` コレクション名を参照するコードが存在しないこと
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: progress-tracker.integration.test.ts_

- [x] 3. (P) `firebase.md` の `debate_progress` 記述を除去する
  - `.kiro/steering/firebase.md` の Firestore スキーマ定義から `debate_progress/{topicId}` の行を削除する
  - `firebase.md` に記載されたコレクション構造と実装コードが一致していること
  - _Requirements: 3.1, 3.2_
  - _Boundary: firebase.md_

- [x] 4. ビルドとテストで変更を検証する
  - `npm --prefix functions run build` を実行してビルドエラーがないことを確認する
  - `pnpm test:unit` を実行してテストスイートが正常に完了することを確認する
  - `progress-tracker` に関連するビルドエラー・テスト失敗が一切ないこと
  - _Requirements: 1.3, 2.3_
  - _Depends: 1, 2, 3_
