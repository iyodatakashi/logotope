# Research & Design Decisions: debate-intro-closing

## Summary
- **Feature**: `debate-intro-closing`
- **Discovery Scope**: Extension（既存の編集フェーズ Phase 6 / `post-debate-editorial-pass` への統合）
- **Key Findings**:
  - 編集フェーズは `chapter(0..n) → comments → finalize` の「1ステップ=1 Cloud Task」チェーンとして完全実装済み。ステップ追加が既定の拡張手段。
  - 討論全体を紹介・総括するイントロ・クロージングは、`editor-agent` のターン単位編集（由来ID＋構造検証）とは処理特性が異なり、**由来追跡・構造検証を持たない自由生成**として別エージェントに分離するのが素直。
  - 成果物はトピック単位1件のため、`editedPostDebateComments/0` と同じ **1:1 固定 ID ドキュメント**（`editedIntroClosing/0`）で保存し、`clearEditedArtifact` の破棄対象に加える。
  - 公開閲覧ルート（`src/routes/debate/[id]`）・編集後コメントの FE 描画は未整備。表示要件（R4）は当面 admin の Phase6 プレビュー範囲で満たし、公開表示は後続。

## Research Log

### 編集チェーンの拡張ポイント
- **Context**: R5「編集パスと同一操作でイントロ・クロージングを生成」を、既存 Phase 6 のどこに接続するか。
- **Sources Consulted**: `functions/src/pipeline/editing/editing-orchestrator.ts`, `editing-step.ts`, `enqueue-editing-step.ts`, `editing-lifecycle.ts`, `api/editing.ts`
- **Findings**:
  - `advanceEditing(payload)` が `stepKind` で分岐し、次ステップを `enqueueEditingStep` して自己継続。状態は毎回 Firestore（原本＋`runId`）から再構築 → 冪等・再入可能。
  - `EditingStepPayload.stepKind` は `'chapter' | 'comments'` の判別ユニオン。`editingTaskKey` は `${runId}:${stepKind}:${chapterIndex}` の deterministic id。
  - `runCommentsEditStep` が末尾で `finalizeEditingRun` を呼び、全 `editedChapters` completed→`generated` / failed 残存→`stopped` を確定。
  - `runEditingStep`（onTaskDispatched）は例外を Cloud Tasks のリトライに委ね、最終試行失敗で `stopEditingRun`。
- **Implications**: 新 `stepKind='intro-closing'` を判別ユニオンに追加し、`advanceEditing` に分岐を足すだけで拡張できる。ただしイントロ・クロージング失敗が `stopEditingRun` を誘発すると R7（本編を妨げない）に反するため、**intro-closing ステップは例外を投げない best-effort** にする必要がある。

### イントロ・クロージングのチェーン内位置と finalize への非干渉
- **Context**: R7「イントロ／クロージングの生成失敗が討論本編・既存成果物を妨げない」「片方成功時は他方を保持」を、`finalizeEditingRun`（全 `editedChapters` completed で判定）と両立させる。
- **Findings**:
  - `finalizeEditingRun` は `editedChapters` のみを判定材料にしており、イントロ・クロージング成果物を見ない。→ イントロ・クロージングを finalize の**前**に置いても、finalize の generated/stopped 判定にイントロ・クロージングは影響しない。
  - チェーンを `chapter(0..n) → intro-closing → comments → finalize` とすると、`runCommentsEditStep`（finalize を内包）を**変更せずに**流用でき、既存編集ロジックへの干渉を最小化できる（要件 Out of scope「既存編集パスのロジック変更」と整合）。
  - intro-closing を comments の**前**に置くのは、クロージングの入力が編集後コメントに依存しない（討論本編＋テーマ／事実基盤＋ペルソナの信念・気づきで足りる）ため成立する。
- **Implications**: `advanceEditing` の `'chapter'` 分岐で「最終章の次」を `comments` から `intro-closing` に変更し、`'intro-closing'` 分岐で `runIntroClosingStep` 実行後に `comments` を enqueue する。`runCommentsEditStep`・`finalizeEditingRun` は不変。

### イントロ・クロージング生成の入力（原本 vs 編集後）
- **Context**: イントロ／クロージングを原本章（`readRawChapters`）と編集後章（`readEditedChapters`）のどちらから生成するか。
- **Findings**:
  - 編集後章は 'failed' 章が空ターンでフォールバックし得るため、入力として不完全になる可能性がある。
  - 原本章は常に完全。イントロ・クロージングは討論の「内容の実体」を語るものであり、実体は原本と編集後で不変。
- **Implications**: 入力は **原本（`getChaptersByTopicId`）＋承認済みペルソナ（信念・気づき）＋`getTopicContext`**。編集成功に依存せず堅牢。ただし全文をそのまま生成に渡すのではなく、下記のとおり圧縮（ダイジェスト）を挟む。

### 生成入力の量（全文 vs 圧縮ダイジェスト）
- **Context**: 討論全文（最大200ターン≈300KB）を `generateIntro`・`generateClosing` の2回、さらに将来の事後コメント生成に重複投入するのはコスト・安定性で不利（validate-design Issue 2）。
- **Findings**:
  - 圧縮（章ごとの要約＋ペルソナの立場・変化）を1回作れば、イントロ・クロージング双方がそれを使える。
  - 同じ圧縮は、将来編集フェーズへ移設予定の事後コメント生成でも再利用できる（ユーザー方針）。
- **Implications**: 消費者中立の **討論ダイジェスト（`buildDebateDigest` / `DebateDigest`）** をこの spec 内の共通モジュールとして先に作り、イントロ・クロージングはダイジェストを入力にする。全文は生成に渡さない。ダイジェストにイントロ・クロージング固有の意図を持ち込まない（再利用性の担保）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 編集チェーンにステップ追加＋intro-closing-agent 新設 | `intro-closing` ステップを chain に挿入、`intro-closing-agent.ts` で自由生成、`editedIntroClosing/0` に保存 | 既存の冪等・世代ゲート・再実行破棄をそのまま享受／責務分離 | ステップ種別・型・FE を横断 | **採用** |
| B: 独立イントロ・クロージング・サブパイプライン | 編集とは別 lifecycle/step を新設し連結 | 編集チェーンを汚さない | 「同一操作」を別ライフサイクル連結で表現＝状態二重化・過剰 | 却下 |
| C: `comments` ステップに畳み込む | `runCommentsEditStep` 内でイントロ・クロージングも生成 | 変更ファイル最小・チェーン形状不変 | 1ステップに2責務／R7の独立リトライ・保持が粗くなる | 却下 |

## Design Decisions

### Decision: 編集チェーンへ `intro-closing` ステップを挿入（位置は comments の前）
- **Context**: R5（同一操作）・R7（非干渉）・要件 Out of scope（既存編集ロジック不変）の同時充足。
- **Alternatives Considered**:
  1. `chapter → comments → intro-closing`（finalize を intro-closing に移動）— `runCommentsEditStep` を改変する必要。
  2. `chapter → intro-closing → comments`（finalize は comments のまま）— 既存ステップ本体不変。
- **Selected Approach**: 2。最終章の次に `intro-closing` を enqueue し、`intro-closing` 実行後に `comments` を enqueue。finalize は従来どおり `comments` ステップ末尾。
- **Rationale**: 既存の tested な `runCommentsEditStep`／`finalizeEditingRun` を触らず、イントロ・クロージングを純粋な追加ステップとして差し込める。finalize はイントロ・クロージングを判定に含めないため R7 と自然に両立。
- **Trade-offs**: チェーンが1段長くなる（Cloud Task 1回増）。許容範囲。
- **Follow-up**: intro-closing ステップが best-effort（例外を投げない）であることをテストで担保。

### Decision: intro-closing ステップは best-effort（例外を投げず、intro/closing を独立に生成）
- **Context**: R7.1（失敗が本編を妨げない）・R7.3（片方成功時に他方を保持）。
- **Selected Approach**: `runIntroClosingStep` は `generateIntro` と `generateClosing` を独立に呼び、成功した側のみ `editedIntroClosing/0` に書き込む（失敗側は `null`）。生成失敗は握りつぶしてログのみ。ステップ自体は例外を投げず、必ず `comments` へ連鎖する。
- **Rationale**: `runEditingStep` の最終試行失敗が `stopEditingRun` を呼ぶ設計のため、intro-closing で例外を投げると本編確定を停止させてしまう。best-effort にすれば finalize（editedChapters ベース）は常に到達する。
- **Trade-offs**: intro-closing 単体の Cloud Tasks リトライ恩恵を捨てる。再試行は編集パス再実行（R7.2）で担保。
- **Follow-up**: 一過性 LLM エラーに備え、`generateIntro`/`generateClosing` 内で軽いリトライ（既存 Result パターンの範囲）を検討。

### Decision: 成果物は `editedIntroClosing/0`（1:1 固定 ID）に `{ intro, closing }` を保持
- **Context**: R6（別成果物・topic 単位1件・原本不変）。
- **Selected Approach**: `topics/{topicId}/editedIntroClosing/0` に `EditedIntroClosingForFirestore = { intro: string | null; closing: string | null }`。`clearEditedArtifact` の破棄対象に追加。原本（chapters/postDebateComments）は読み取りのみ。
- **Rationale**: `editedPostDebateComments/0` と同じ 1:1 固定 ID パターン（`firebase.md`）。`null` で未生成／失敗を表し、FE は非 `null` のときのみ表示（R4.4）。
- **Trade-offs**: 「未実行」と「実行したが失敗」を成果物だけでは区別しない（phaseStatus が run 状態を補完）。最小構成を優先。

### Decision: 討論チェーンのスリム化（別スペック）を見越して自己完結・入力一般化で設計する
- **Context**: ユーザーより、討論チェーンから章まとめ・締め発言・事後コメント生成を将来削除／編集フェーズへ移設する方針の予告。いずれも現状は章の `turns` 配列に混在追記（章まとめ=`generateChapterTransition`、締め発言=`appendClosingTurn`）。
- **Selected Approach**: (1) 生成入力は `turns` を会話として一般的に扱い、章まとめ・締め発言ターンの存在に依存しない（材料はテーマ・章タイトル・会話・信念/気づきに限る）。(2) intro-closing ステップは他ステップの有無・順序に非依存の自己完結ステップとし、チェーン位置（現状コメント編集の前）を load-bearing にしない。完了確定にも非干渉（best-effort）。
- **Rationale**: スリム化で `turns` から特定種別が消えても、編集フェーズ後半が組み替わっても、本スペックのコードを変えずに耐えられる。
- **Trade-offs**: なし（現行の best-effort・自己完結方針の明文化）。
- **Follow-up**: 実装時、生成プロンプト/入力整形が章まとめ・締め発言に暗黙依存しないことをレビューで確認。

### Decision: 討論ダイジェスト（圧縮）を消費者中立の共通モジュールとして先に作る
- **Context**: Issue 2（全文投入のコスト）と、圧縮を事後コメント生成にも使い回したいというユーザー方針。
- **Alternatives Considered**:
  1. 全文投入で許容 — 実装単純だが総トークン・コスト大、再利用不可。
  2. 別 spec で圧縮を先に作る — 境界は綺麗だが spec が増える。
  3. この spec 内で消費者中立モジュールとして作る（採用）。
- **Selected Approach**: `functions/src/pipeline/debate/debate-digest.ts`（`buildDebateDigest`）＋ `functions/src/agents/debate-digest-agent.ts`（`summarizeChapter`）＋ `DebateDigest` 型。イントロ・クロージングは `DebateDigest` を入力にする。事後コメント生成への接続配線は将来 spec（本 spec の Out of Boundary）。
- **Rationale**: 1回の圧縮を複数消費者で共有でき、全文重複投入を避けられる。別 spec 化せずとも消費者中立に保てば将来 import で再利用可能。
- **Trade-offs**: 圧縮の所有が名目上 intro-closing spec になる（消費者中立の明記で緩和）。ダイジェストは非永続（同一ステップ内共有のみ。別ステップ再利用時の永続化は将来 spec が判断）。
- **Follow-up**: 圧縮プロンプトが中立（結論・優劣・特定立場支持なし）で、イントロ・クロージング固有情報を含まないことをレビューで確認。

## Risks & Mitigations
- **非結論プロンプトの品質**（R2/R3）— intro-closing 専用システムプロンプトで「結論・優劣・落としどころ・特定立場支持の禁止」を明示し、テストで代表ケースを検証。product.md「結論を求めない」と整合。
- **intro-closing 失敗の伝播**（R7）— best-effort 設計で finalize（editedChapters ベース）に非干渉。intro-closing は例外を投げないユニットテストで担保。
- **表示要件の部分充足**（R4）— 公開ルート・編集後コメント描画が未整備。当面 admin Phase6 プレビューで intro（章の前）／closing（章の後）を表示し、公開表示・コメント直前配置は後続とする旨を design に明記。
- **`clearEditedArtifact` の破棄漏れ** — editedIntroClosing/0 を破棄対象に追加しないと再実行時に旧イントロ・クロージングが残る（feedback: 再生成時の即時削除）。破棄をテストで担保。

## References
- `.kiro/steering/firebase.md` — Firestore 設計原則（1:1 固定 ID・埋め込み vs サブコレクション・課金）
- `.kiro/steering/product.md` — 「討論に結論を求めず、意見の多様性を価値とする」プロダクト姿勢
- `.kiro/specs/post-debate-editorial-pass/` — 編集フェーズの要件・設計（本フィーチャーの母体）
- `.kiro/specs/debate-intro-closing/gap-analysis.md` — 既存編集パイプラインの実装マップとギャップ
