# Research & Design Decisions

## Summary

- **Feature**: `inline-speech-fact-check-correction`
- **Discovery Scope**: Extension（既存のターン生成ループ＋ファクトチェック資産への組み込み）
- **Key Findings**:
  - 依存先 `fact-check-validity-improvement` が完了し、`checkTurn` は **Phase0 断定ゲート（grounding なし）→ Phase1 grounding → Phase2 構造化 → 修正適否ジャッジ** の4段構成になっている。本仕様の要件2（断定のみ補正）・要件7.1（断定なしは検証起動せず素通し）は、この既存パイプラインで**すでに満たされている**。
  - 挿入点は [generatePersonaTurn](functions/src/pipeline/debate/turn.ts#L154) の `generateTurn`(L191) と `addTurn`(L225) の間ただ1か所。`runStep`（1タスク=1ターン・[timeoutSeconds 1800](functions/src/api/fact-check.ts#L69) ／討論ステップは [540s](functions/src/pipeline/debate/debate-orchestrator.ts)）の予算内で同期実行できるため、要件7のレイテンシ懸念は実態として小さい。
  - 再生成は新規実装不要。既存 [generateTurn](functions/src/agents/persona-agent.ts#L208) に指摘フィードバックの任意入力を足して1回だけ再実行すればよい。検証コアは `checkTurn` から `content` ベースの `checkContent` を抽出して共有する。

## Research Log

### Phase0 断定ゲートと修正適否ジャッジの現状（依存先の成果）

- **Context**: 要件2（断定主張のみ補正）・要件7.1（断定なしは素通し）が、依存先 `fact-check-validity-improvement` / `fact-check-correction-worthiness` の実装でどこまで賄えるかを確認する必要があった。
- **Sources Consulted**:
  - [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts)（`checkTurn` L131-）
  - [fact-check-judge.ts](functions/src/pipeline/fact-check/fact-check-judge.ts)（`judgeCorrectionWorthiness`）
  - [ai.constants.ts](functions/src/constants/ai.constants.ts#L6)（`factCheckAssertionGate/Grounding/Structuring/Judge` 登録済み）
- **Findings**:
  - `checkTurn` は Phase0 で`assertedClaims`を抽出し、`assertedClaims.length === 0` なら **grounding を起動せず `findings:[]` で即返す**（[L170](functions/src/pipeline/fact-check/fact-check-runner.ts#L170)）。これは要件7.1そのもの。
  - Phase0 はゲート失敗時に全文検証へフェイルオープン（見逃し回避）。Phase2 後に `judgeCorrectionWorthiness` で「修正に値する finding（correct/uncertain）」のみ `kept` として残す保守的フィルタが結線済み。
  - LLM モデルは4タスクとも `PIPELINE_MODELS` に登録済み。**インライン用に新規モデル登録は不要**。
- **Implications**: 本仕様の補正対象判定は「`checkContent`（=`checkTurn` のコア）を呼ぶ」だけで満たせる。要件2・7.1のためのロジックを新規に書かない。

### 検証コアの `DebateTurn` 依存とドラフト適用

- **Context**: `checkTurn(turn: DebateTurn, ...)` は `turn.id`/`turn.speakerType` を前提とするが、ドラフトはまだ `id` を持たない（id は `addTurn` 内 `nanoid()` で採番、[turn.ts L55](functions/src/pipeline/debate/turn.ts#L55)）。
- **Findings**:
  - `checkTurn` 内で `turn.id` は (a) Phase0/エラーのログ、(b) `finding.turnId` の束縛に使われるのみ。検証ロジック本体は `turn.content` と `turn.speechMode` だけで成立する。
  - `FactCheckContext` には `topicTitle` が必要。`generatePersonaTurn` は `chapter`（title/focusQuestion）しか持たないが、`topicTitle` は呼び出し元 [step.ts](functions/src/pipeline/debate/step.ts#L251) の `ctx.topicTitle` に既にある。引数で1段渡せばよい。
- **Implications**: `checkContent({ content, speechMode, speakerType }, context)` をコア関数として抽出。`checkTurn` は `checkContent` を呼んで `finding.turnId = turn.id` を後付けする薄いラッパに退避（既存の後追い経路・テストを温存）。`topicTitle` を `generatePersonaTurn` の引数に追加。

### 再生成（generateTurn 拡張）の干渉確認

- **Context**: 指摘フィードバックを `generateTurn` に注入したとき、検索ツール（web_search）・`beliefChange`・`targetPersonaId` 出力スキーマと干渉しないかを確認（gap-analysis の Research Needed）。
- **Findings**:
  - `generateTurn` は `system` + 単一 `user` メッセージ構成。フィードバックは `user` 末尾に説明節を足すだけで、`turnOutputSchema`（content/beliefChange/targetPersonaId）は不変。ツール定義も不変。
  - したがって再生成は「同じ関数を、`user` に指摘節を加えて1回だけ呼ぶ」で成立。スキーマ・ツールへの波及なし。
- **Implications**: `TurnGenerationContext` に任意 `factCheckFeedback` を追加し、存在時のみプロンプト節を付与する。再生成結果の `PersonaReply`（target/belief 含む）を採用ターンとして用いる（要件3.3：訂正で結論が変わるのは許容）。

### トレース保存先と後追い検証との関係（要件4・5）

- **Context**: 補正トレースを既存 `factCheck/result`（per-chapter, 後追い専用）へ入れるか、ターンに埋め込むか。後追い `runFactCheck` の二重 grounding をどう避けるか。
- **Sources Consulted**: [fact-check-repository.ts](functions/src/pipeline/fact-check/fact-check-repository.ts)、[fact-check.ts](functions/src/api/fact-check.ts)、[firebase.md](.kiro/steering/firebase.md)（埋め込み原則）
- **Findings**:
  - `factCheck/result` は「未解決の指摘」を意味し、章再生成で `delete` される（後追い前提）。ここに補正済み（解決済み）指摘を混ぜると要件5.3/5.4（二重・矛盾の回避）と衝突する。
  - 監査情報（原ドラフト・適用した指摘・補正有無）は対象発言と常に一緒に読むため、ターンへ co-locate するのが整合的（firebase.md の埋め込み原則）。
  - 後追い `checkChapter` は全ターンを `checkTurn` で grounding 検証する。インライン検証済みターンを再 grounding すると要件5.3に反する。
- **Implications**:
  - トレースは **ターン埋め込み**（`TurnFactCheckTrace`）に決定。補正有無・未検証フォールバックを同じ埋め込みで表現（要件4.2/4.3/6.2）。
  - 後追い `checkChapter` は、インライン検証済み（`factCheck.status === 'checked'`）ターンは **grounding を起動せず**、埋め込み済み finding を `turnId` 復元のうえ結果ドキュメントへ流す。未検証（`unverified`）ターンと従来ターンのみ `checkTurn` で再検証する（要件5）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: `generatePersonaTurn` 直書き | 検証→再生成を turn.ts に直接挿入 | 新規ファイルなし・最短 | `generatePersonaTurn` 肥大、`DebateTurn` 依存の場当たり | 責務過多で却下 |
| **B: 補正モジュール新設＋`checkContent` 抽出** | 薄い `verifyAndReviseDraft` を新設、`checkTurn` をコア化 | 責務分離・テスト容易・後追いとコア共有 | 新規ファイル＋小リファクタ | **採用** |
| C: ハイブリッド段階導入 | B のコアを先行投入、後追い重複整理を後フェーズ | 早期投入・ロールバック容易 | 2段階のスコープ管理 | B の上に段階導入の考え方を載せる |

→ **B を採用**し、要件5（後追い重複整理）は同一スペック内で設計しつつ、実装タスクとして分離可能にする（C の段階性を許容）。

## Design Decisions

### Decision: 検証コア `checkContent` の抽出位置

- **Context**: ドラフト検証と後追い章検証で同じ Phase0→Phase1→Phase2→judge を共有したい。
- **Alternatives Considered**:
  1. 新規 `fact-check-core.ts` に切り出す
  2. `fact-check-runner.ts` 内に `checkContent` を追加し `checkTurn` をラッパ化
- **Selected Approach**: 2。`checkContent` は debate を import しない（grounding/models/judge のみ）。後追い専用の `getChapterById`/`getTopicById` 依存は `checkChapter` 側に留まるため、`fact-check-runner.ts` 内共存で循環を生まない。
- **Rationale**: 新規ファイル増を避けつつ、プロンプト群・judge と同居でき差分最小。
- **Trade-offs**: `fact-check-runner.ts` がやや大きくなるが、責務は「発言/コンテンツの検証」で一貫。

### Decision: 補正トレースの保存先＝ターン埋め込み

- **Context**: 要件4（トレーサビリティ）・5（後追いとの非重複）・6.2（未検証フラグ）。
- **Selected Approach**: `DebateTurn.factCheck?: TurnFactCheckTrace` をターンに埋め込む。`factCheck/result`（後追い・未解決指摘）とは意味論を分離。
- **Rationale**: 監査情報を発言と co-locate（firebase.md）、後追いの「未解決」セマンティクスを汚さない。
- **Trade-offs**: ターンサイズ増・FE 型追従。埋め込み finding は co-located のため `turnId` を空で持ち、後追い結果へ流す際に `turn.id` で復元する。

### Decision: 後追い `runFactCheck` はインライン検証済みターンを再 grounding しない

- **Context**: 要件5.2/5.3/5.4。インライン全ターン検証 + 後追い grounding が二重に走るとコスト増・矛盾の温床。
- **Selected Approach**: `checkChapter` を改修し、`turn.factCheck?.status === 'checked'` のターンは grounding を起動せず埋め込み finding（`turnId` 復元）を `onTurnFindings` で結果ドキュメントへ反映。`unverified` ターン・トレースなしターンのみ `checkTurn` で検証。
- **Rationale**: 既存 FE 表示（`factCheck/result` 読取り）を単一の読取り面として維持しつつ、二重 grounding を解消。
- **Trade-offs**: `checkChapter` に分岐が増える。インライン未検証ターンの補完検証という後追いの役割は維持される。

### Decision: インライン検証のタイムアウト上限（要件6.3）

- **Context**: grounding の不安定さが1ターン予算（540s）を食い潰さないようにする。
- **Selected Approach**: `checkContent` の呼び出しを上限時間（定数 `INLINE_FACT_CHECK_TIMEOUT_MS`、既定 120,000ms）で `Promise.race` し、超過時はフォールバック（未補正・`status:'unverified'` 登録）。
- **Rationale**: 典型 grounding 10–30秒に対し十分な余裕。540s 予算を再生成・後続処理に残す。
- **Trade-offs**: タイムアウトしたターンは未検証で確定（後追いが補完）。

## Risks & Mitigations

- **コスト増（主因）** — ペルソナ発言ごとに Phase0(flash)＋場合により Phase1(pro)/Phase2(flash)/judge(flash)＋再生成(persona LLM)。Phase0 ゲートで断定なし発言は grounding を起こさず緩和。後追い重複解消で二重 grounding を排除。
- **再生成の副作用（target/後続文脈の齟齬）** — 再生成プロンプトで「論旨方向性・指名整合の維持」を明示（要件3.3）。`targetPersonaId` は再生成後の値を既存の `validPersonaId` で再検証。
- **判定品質依存** — 断定/修正適否の精度は依存スペックのプロンプトに依存。本仕様は判定を再設計せず再利用するため、品質改善は依存スペック側で継続。
- **タスク再試行時の再検証** — `addTurn` コミット前に検証が閉じるため、タスク再試行で検証が再走（コスト増だが正しさは保たれる）。冪等追記は不変。

## References

- [generatePersonaTurn](functions/src/pipeline/debate/turn.ts#L154) — 挿入点
- [checkTurn / checkChapter](functions/src/pipeline/fact-check/fact-check-runner.ts#L131) — 検証コアと後追い
- [judgeCorrectionWorthiness](functions/src/pipeline/fact-check/fact-check-judge.ts#L72) — 修正適否フィルタ
- [generateTurn](functions/src/agents/persona-agent.ts#L208) — 再生成の拡張点
- [fact-check.ts runFactCheck/Task](functions/src/api/fact-check.ts) — 後追い起動経路
- [firebase.md](.kiro/steering/firebase.md) — 埋め込み原則 / [structure.md](.kiro/steering/structure.md) — 過度な共通化の禁止
</content>
</invoke>
