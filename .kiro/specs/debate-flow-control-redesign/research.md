# Research & Design Decisions

## Summary
- **Feature**: `debate-flow-control-redesign`
- **Discovery Scope**: Extension（既存システムの再設計。詳細な現状調査は `gap-analysis.md` で実施済み）
- **Key Findings**:
  - 本番実行経路は `executeChapterTask`（Cloud Tasks）のみ。`run()`/`resume()` は削除可能で、状態復元の共通化により3重実装が解消できる
  - 介入評価の毎ターン化は、既存の意欲評価（全ペルソナ並列）と並列実行すればレイテンシ増をほぼゼロにできる
  - 意図キューのメモリ/Firestore 二重管理が章またぎ消失バグの根因。Firestore をソースとする write-through 方式で解消する

## Research Log

### 介入評価の毎ターン化によるコスト・レイテンシ影響
- **Context**: 要件 6.1 で介入評価が間隔トリガーから毎ターン実行に変更された
- **Sources Consulted**: `debate-orchestrator.ts` の現行ターンループ、`facilitator-agent.ts` の `evaluateIntervention`
- **Findings**:
  - 現状、1ターンあたり LLM 呼び出しは「意欲評価 ×（ペルソナ数−1、並列）＋発言生成 ×1」。介入評価は 8 ターンに1回
  - 介入評価と意欲評価はどちらも「直前ターンまでの履歴」を入力とし、相互依存がない → `Promise.all` で並列化可能
  - コスト増は Sonnet 1呼び出し/ターン（ペルソナ4〜6名構成では約 +20%）。クールダウン2ターンでスキップされる分があるため実増は更に小さい
- **Implications**: 意欲評価と介入評価を並列実行する。レイテンシ影響は実質ゼロ、コスト増は許容範囲。モデルの軽量化（Haiku）は品質劣化リスクがあるため初期実装では行わず、運用後の調整余地として残す

### 指名・直接質問ターンでの章終了シグナル記録
- **Context**: 要件 2.5。現行の `recentScores` は意欲評価が走ったターンしか記録されず、指名・直接質問の連鎖中は章終了判定の窓が更新されない
- **Sources Consulted**: `executeChapter` の `recentScores` 更新箇所（評価分岐内のみ）
- **Findings**:
  - 指名・直接質問が発生している＝直接的な応酬が続いている＝議論は活性状態とみなせる
  - 「評価スキップターン＝活性」と記録すれば、章終了判定（直近5シグナルすべて非活性）が保守側に倒れ、活発な応酬中に章が切れることがなくなる
- **Implications**: ターンごとに必ず1件の活性シグナル（0/1）を記録する設計とする。意欲評価実行ターンは「full score≥4 または score≥5 が存在するか」、評価スキップターン（指名・直接質問・キュー消化）は常に「1（活性）」を記録する

### 意図キューの永続化モデル
- **Context**: 要件 5.5。現状はメモリ（`state.pendingItems`）と Firestore（`engagements/{personaId}.pendingIntents`）の二重管理で、本番経路では復元されず、消費も `fromQueue` 時しか同期されない
- **Sources Consulted**: `repository.ts` の `saveEngagements` / `consumePendingIntent` / `loadPendingIntents`、`executeChapterTask` の状態初期化
- **Findings**:
  - 章単位実行（540秒）内ではメモリ保持が効率的。問題は「章開始時の復元漏れ」と「変更の書き戻し漏れ」の2点のみ
  - 毎ターン Firestore から読み直す案は、ペルソナ数分のドキュメント読み込みがターン数分発生し課金面で不利（steering の課金原則に反する）
- **Implications**: write-through 方式を採用。章開始時に `loadPendingIntents` で復元（失効分を除去）し、以降のキュー変更（追加・消費・失効）は発生の都度 Firestore に反映する。メモリはワーキングコピーであり、ソースオブツルースは Firestore とする

### 章上限+1ターン（未応答指名の応答）の冪等性
- **Context**: 要件 2.7。Cloud Tasks はリトライ（最大3回）があるため、応答ターンの重複が懸念された
- **Sources Consulted**: `runChapter` の retryConfig、`executeChapterTask` の冪等性チェック（`currentChapterIndex`）と `fromTurnIndex` 算出
- **Findings**:
  - リトライ時は保存済みターンの末尾から `fromTurnIndex` を再計算して継続するため、保存済みの応答ターンが二重生成されることはない
  - 章完了の冪等性は `currentChapterIndex > chapterIndex` のスキップ判定で担保済み
- **Implications**: 追加の冪等性対策は不要。応答ターンは章ループ内の通常ターンとして保存されるため既存機構で安全

### 討論中断時のセッション状態
- **Context**: 要件 2.2 / 8.4。フォールバック廃止により「エラーで中断」という終端状態が新たに必要になった
- **Sources Consulted**: `api/debates.ts`（リトライ後の失敗は黙殺され session が `debating` のまま残る）、討論リセット機能（既存）
- **Findings**: 現状、Cloud Tasks の全リトライ失敗後はセッションが `debating` のまま放置され、管理画面から失敗が判別できない
- **Implications**: セッション status に `error` を追加し、`runChapter` で章実行が例外終了した場合（最終リトライ）に書き込む。管理者は既存のリセット機能で再実行できる。フロントエンドは status 文字列をそのまま表示しているため表示対応は軽微（本仕様では status 書き込みまでをスコープとし、管理画面の表示改善はスコープ外）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 現行構造のまま個別修正 | `executeChapter` 内の分岐を直接修正 | 差分最小 | 857行に制御が絡んだ構造が残り R9 を満たせない。バグ再発リスク | 不採用 |
| B: 完全モジュール分割 | 制御ロジックを全面的に新モジュールへ | テスタビリティ最大 | 一括書き換えでリグレッションリスク大 | 不採用 |
| C: ハイブリッド（削除→抽出→修正） | 死活経路削除後、純粋関数を段階抽出 | リスク分割・既存パターン（エクスポート純粋関数）踏襲 | フェーズ間で新旧混在期間あり | **採用** |

## Design Decisions

### Decision: フロー制御ロジックの純粋関数モジュール化（`pipeline/flow/`）
- **Context**: 要件 9.2（各ルールの独立テスト）。現状はループ内に話者選択・介入・章終了が絡み合う
- **Alternatives Considered**:
  1. オーケストレーター内のエクスポート関数として整理（現状の `shouldEvaluateIntervention` 方式の拡張）
  2. `pipeline/flow/` ディレクトリに責務別ファイルを新設
- **Selected Approach**: 2 を採用。`speaker-selection.ts` / `chapter-progress.ts` / `intervention-policy.ts` / `state-restore.ts` の4モジュールに分離し、LLM 呼び出し・Firestore 書き込みを一切含まない純粋関数とする
- **Rationale**: 857行のオーケストレーターに留めると肥大が解消されない。純粋関数はモックなしでテストでき、AI モック前提の steering テスト方針とも整合する
- **Trade-offs**: ファイル数は増えるが、各ファイルは100行前後で責務が明確になる
- **Follow-up**: 抽出時に現行ロジックとの等価性をテストで担保（修正対象の差分以外は挙動維持）

### Decision: 話者選択の決定を単一関数・単一の決定型に集約
- **Context**: 要件 4.1。現状は指名・直接質問・緊急リアクション・キュー・スコアの判定がループ内の複数箇所に分散し、介入評価が選択結果を後から上書きする
- **Alternatives Considered**:
  1. 現行順序（意欲評価→選択→介入評価→上書き）を維持
  2. 介入評価を意欲評価と並列実行し、結果を統合して優先順位どおりに単一関数で決定
- **Selected Approach**: 2 を採用。`decideNextSpeaker` が全入力（指名・直接質問・介入結果・意欲評価・キュー・沈黙）を受け取り、`SpeakerDecision`（personaId・source・mode・intentSummary）を返す
- **Rationale**: 「指名が無視される」系のバグは選択ロジックの分散が根因。優先順位を1関数に置けば要件 4.1 とコードが1対1対応する
- **Trade-offs**: 意欲評価と介入評価が並列実行されるため、介入発言の直後に行われる意欲評価ベースの選択は介入発言を見ていない（invite 指名時は無関係。topic_shift 時は1ターンだけ評価が古くなるが、現行も同じ挙動）
- **Follow-up**: topic_shift 直後のターン品質を実討論で確認

### Decision: `generateTurn` の引数をコンテキストオブジェクトに統合
- **Context**: 要件 7.1。現状9引数で呼び出し側の取り違えリスクが高い
- **Alternatives Considered**:
  1. 現状の位置引数を維持（インターフェース変更なし）
  2. `TurnGenerationContext` オブジェクトに統合
- **Selected Approach**: 2 を採用
- **Rationale**: 呼び出し元はオーケストレーターのみで影響範囲が閉じている。Adjacent expectations（変更最小化）は「外部からの利用」を守る趣旨であり、単一呼び出し元の内部整理は許容範囲
- **Trade-offs**: テストの書き直しが必要（いずれにせよテストは再構成対象）

### Decision: セッション status への `error` 追加
- **Context**: 要件 2.2 のフォールバック廃止により失敗の終端状態が必要
- **Selected Approach**: `runChapter` で章実行の例外を捕捉し、Cloud Tasks の最終試行（リトライ上限）で `sessions/0.status = 'error'` を書き込んで再スローする
- **Rationale**: セッションが `debating` のまま無限に残る現状の問題も同時に解消する
- **Trade-offs**: status 値が増えるためフロントエンドの status 分岐に未知値が流れるが、表示のみで動作に影響しない
- **Follow-up**: 管理画面でのエラー表示・再実行導線の改善は別仕様とする

## Risks & Mitigations
- 挙動変更（介入頻度増・章終了条件変更）による討論品質の変化 — 実トピックでの討論生成を実装後検証タスクに含める
- 920行の既存オーケストレーターテストの書き直し漏れ — 抽出した純粋関数ごとにテストを先行作成し、統合テストは `executeChapterTask` ベースで再構成する
- `run()`/`resume()` 削除によるテスト・ツールの参照切れ — 削除フェーズの最初に全参照を grep で確認する

## References
- `.kiro/specs/debate-flow-control-redesign/gap-analysis.md` — 現状調査・要件対応マップ
- `.kiro/specs/engagement-driven-debate-flow/requirements.md` — 意欲評価・キューの原仕様
- `.kiro/specs/debate-chapter-progression/requirements.md` — 章進行の原仕様
- `.kiro/specs/async-debate-execution/` — Cloud Tasks 実行基盤（維持対象）
