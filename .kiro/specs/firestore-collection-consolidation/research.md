# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

---

## Summary
- **Feature**: `firestore-collection-consolidation`
- **Discovery Scope**: Simple Addition（既存コードの不使用リソース削除）
- **Key Findings**:
  - `ProgressTrackerService` は `debate-orchestrator.ts` からのみ呼ばれ、`collection('progress')` に書くが、フロントエンドのどのコードからも読まれていない
  - 統合テスト (`progress-tracker.integration.test.ts`) が参照する `debate_progress` コレクションは実装コードが使用する `progress` コレクションと異なる（テストバグ）
  - `tracker.updateStatus(topicId, 'debating')` の呼び出しは `topics/{topicId}.status` と二重管理であり、フロントエンドが既に `approveInterviews` で `status: 'debating'` を設定している

## Research Log

### `progress` コレクションの読み取り先調査
- **Context**: `progress` コレクションへの書き込みが実際に読まれているか確認
- **Sources Consulted**: `src/lib/stores/*.ts`, `src/routes/**/*.svelte`, `src/lib/components/**/*.svelte`
- **Findings**:
  - `src/lib/stores/` 配下のすべてのファイルに `collection('progress')` への参照なし
  - `topics.status` は `src/lib/stores/topic.svelte.ts` の `onSnapshot` で購読済み
  - フロントエンドの進捗表示（Phase4Debate.svelte）は `sessions/0.totalTurns` と `turns.length` を使用
- **Implications**: `progress` コレクションを削除しても UI に一切影響なし

### `debate-orchestrator.ts` の `tracker.updateStatus` 呼び出し分析
- **Context**: `tracker.updateStatus(topicId, 'debating')` 削除の安全性確認
- **Findings**:
  - `debate-orchestrator.run()` および `resume()` の冒頭で呼ばれる
  - `topics/{topicId}.status = 'debating'` はフロントエンドの `approveInterviews()` が先に設定
  - Cloud Function 呼び出し（`httpsCallable`）は `approveInterviews` 完了後に発火する設計
  - したがって `tracker.updateStatus` は状態変更を行わず、誰も読まない `progress` コレクションに重複書き込みするだけ
- **Implications**: 削除しても動作に変化なし

### テストコードの不整合確認
- **Context**: `progress-tracker.integration.test.ts` がどのコレクションを参照しているか確認
- **Findings**:
  - `beforeEach` および全テストケースが `collection('debate_progress')` を読む
  - `ProgressTrackerService` の実装は `collection('progress')` に書く
  - テスト自体は現状必ず失敗する（書き込み先と読み取り先が異なる）
- **Implications**: `ProgressTrackerService` 削除と合わせてテストファイルも削除

## Architecture Pattern Evaluation

| Option | 説明 | 利点 | リスク |
|--------|------|------|--------|
| A: `progress-tracker.ts` 削除 + `debate-orchestrator.ts` から参照除去 | 本スペックの採用案。ファイルとその呼び出し元を同時に除去 | 最小変更。`topics.status` を唯一の状態管理に統一 | なし（影響範囲が限定的） |
| B: `progress-tracker.ts` を `topics` 書き込みにリダイレクト | `ProgressTrackerService.updateStatus` を `topics/{topicId}.status` の書き込みに変更 | 呼び出しコードを保持できる | `topics.status` はフロントエンドが管理しており、バックエンドからの書き込みが競合する可能性。不要な複雑さ |

→ **Option A を採用**

## Design Decisions

### Decision: `ProgressTrackerService` ごと削除する
- **Context**: `progress` コレクションへの書き込みを廃止するにあたり、`ProgressTrackerService` クラスを残すか削除するかの選択
- **Alternatives Considered**:
  1. クラスを残してメソッドを空実装にする
  2. クラスごとファイルを削除する
- **Selected Approach**: ファイルごと削除し、`debate-orchestrator.ts` の import と constructor 引数も除去する
- **Rationale**: 読まれないデータを書くコードは技術的負債。残すと誤用のリスクがある
- **Trade-offs**: なし（外部から参照されるモジュールではない）

## Risks & Mitigations

- `debate-orchestrator.ts` の constructor が `tracker` を受け取るため、テストでモックしている箇所がある場合は修正が必要 → `functions/src/` 内でモックなし（統合テストのみ存在しファイルごと削除）
- `firebase.md` の `debate_progress/{topicId}` 記述が残ると将来の開発者を混乱させる → ステアリング更新を必須タスクとして含める
