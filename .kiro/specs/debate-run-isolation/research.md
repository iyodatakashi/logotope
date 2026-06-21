# Research & Design Decisions

---

## Summary

- **Feature**: `debate-run-isolation`
- **Discovery Scope**: Extension（既存の討論パイプラインへの追加）
- **Key Findings**:
  - 競合状態は「LLM呼び出し待ち中に世代交代が起きる」という狭いウィンドウでのみ発生する
  - Cloud Function invocation を外部から強制終了する手段は Firebase Functions v2 に存在しない。書き込みをブロックする防衛的アプローチのみが現実的
  - Firestore の `topics/{topicId}` ドキュメントが既に討論の正（phase, phaseStatus）として機能しており、`runId` フィールドを追加するのが自然

---

## Research Log

### 競合状態の発生ウィンドウ分析

- **Context**: `isDebateActive` だけでは 「A停止→B開始」の場合に旧実行をブロックできない理由を特定する
- **Findings**:
  - `generatePersonaTurn` は「LLM呼び出し（5〜30秒）→レスポンス受信→`addTurn`」の順で実行される
  - LLM呼び出し前の `isDebateActive` チェックは A実行中のため pass する
  - LLM待ち中に `restartDebate` が呼ばれると Firestore の `phaseStatus` は `'running'`（B実行中）のまま維持される
  - その結果、Aのレスポンス返却後の `isDebateActive` も pass し、Aのターンが Firestore に混入する
- **Implications**: チェックポイントは「LLM呼び出し後・`addTurn` 直前」に置く必要がある

### runId の保存場所

- **Context**: runId を「どこに保持するか」（Firestore vs インメモリ vs Cloud Tasks ペイロード）
- **Findings**:
  - Cloud Function invocations はメモリを共有しない → インメモリでの共有は不可
  - Firestore の `topics/{topicId}` は既に討論の正の状態を持つ → `runId` フィールドの追加が自然
  - Cloud Tasks ペイロードはタスク作成時に確定し不変 → 「自分の runId」の保持に適している
- **Implications**: 「自分の runId」は Cloud Tasks ペイロード経由で受け取り `DebateState` に保持。「現在の世代の runId」は Firestore から読み取って照合する

### Cloud Tasks キャンセルの可否

- **Context**: 旧タスク invocation を積極的にキャンセルできるか
- **Findings**:
  - Cloud Tasks キューからのタスク削除は理論上可能だが、既に invocation が開始済みのタスクは削除不可
  - 実行中の Cloud Function invocation を外部から中断する手段は存在しない
- **Implications**: 防衛的アプローチ（書き込みブロック）のみが現実的な解

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `isDebateActive` に runId チェックを統合 | `isDebateActive(topicId, runId?)` として照合を追加 | 変更箇所が1関数に集中 | 「討論の活性確認」と「世代確認」の2責務が混在し関心の分離が崩れる | 不採用 |
| `addTurn` 内で世代照合（単一ガードポイント） | `addTurn` 関数内で Firestore の runId を照合し、ミスマッチなら書き込みなし・`null` 返却 | 全ターン種別（ペルソナ・ファシリテーター・介入）を自動カバー。呼び出し元を増やしても漏れが発生しない | Firestore 読み込みがターンごとに1回増える（LLMコストに対して軽微） | **採用** |
| `executeChapterTask` 起動時に照合 | チャプタータスク先頭で runId を照合し早期終了 | 早期終了が可能 | LLM呼び出し前の照合は競合ウィンドウをカバーしない | 不採用（ターン単位の精度が必要） |

---

## Design Decisions

### Decision: runId 照合を `addTurn` 内に置く（単一ガードポイント）

- **Context**: ペルソナターン・ファシリテーターターン・介入ターンすべてが `addTurn` を経由する
- **Alternatives Considered**:
  1. `isDebateActive` に runId を組み込む — 関心の分離が崩れる
  2. `generatePersonaTurn` 内の `addTurn` 直前にインラインで照合 — ファシリテーターターン（`generateFacilitatorTurn`）・介入ターン（`persistInterventionTurn`）がカバーされない
  3. `executeChapterTask` / `executeTurn` 先頭で照合 — LLM呼び出し前のチェックは競合ウィンドウをカバーしない
- **Selected Approach**: `addTurn` 関数内で Firestore の `runId` を照合し、ミスマッチなら書き込みなし・`null` 返却
- **Rationale**: 全ターン種別が `addTurn` を経由するため、ここをガードにすれば呼び出し元の種別を問わず完全にカバーできる
- **Trade-offs**: Firestore 読み込みがターンごとに1回増えるが、LLMコストに比べて無視できる
- **Follow-up**: テストで runId ミスマッチ時に `null` が返ること、後続ターンが打ち切られることを確認する

### Decision: runId ミスマッチ時は例外でなく `null` を返す

- **Context**: 照合失敗は予期されたオペレーショナルな状態（エラーではない）
- **Alternatives Considered**:
  1. 例外をスロー — Cloud Tasks のリトライが発動し、同じ旧世代タスクが再実行される
  2. `null` を返す — 呼び出し元の while ループが終了し、以降のターン生成が打ち切られる
- **Selected Approach**: `null` を返し、呼び出し元（`executeTurn` → `executeChapterTask`）が正常終了する
- **Rationale**: リトライは不要。世代が変わった事実は変わらず、リトライすれば再度 runId ミスマッチとなる
- **Trade-offs**: エラーログとして記録されないが、運用上の混乱は少ない

---

## Risks & Mitigations

- Firestore 読み込みエラー時に runId チェックをスキップすると旧世代が書き込む可能性がある → 照合 Firestore 読み込み失敗時は保守的に `null` を返す（書き込みをブロック）
- `runId` フィールドが存在しない既存 topics ドキュメント（移行期）では照合をスキップする → backward compatibility として許容（要件 3.3/3.4）
- 次章タスクへの `runId` 引き継ぎが漏れると世代照合が機能しなくなる → `enqueueChapterTask` を唯一のエンキュー関数にし、常に `runId` を渡す設計にする
