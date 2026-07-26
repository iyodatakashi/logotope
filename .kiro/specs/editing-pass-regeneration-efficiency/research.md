# Research & Design Decisions: editing-pass-regeneration-efficiency

## Summary
- **Feature**: `editing-pass-regeneration-efficiency`
- **Discovery Scope**: Extension（既存の編集パイプラインへの局所拡張）
- **Key Findings**:
  - 導入・締めの個別再生成（`regenerateNarration`）は `begin()`（生成中へ切替）が重い `buildIntroOutroInput`（討論ダイジェスト構築）の後にあり、生成中表示が遅れる。所感（`buildImpressionPart`）は begin 先頭で既に正しい。
  - `buildDebateDigest` は章ごとの LLM 要約を逐次実行し Firestore に保存しない。個別再生成のたびに丸ごと再計算している。入力は原本討論（章の生ターン・ペルソナ信念/気づき）だけで編集では不変。
  - `clearEditedArtifact` が「編集成果物を捨てる」中央地点で、討論・ペルソナ・章・fact-research 変更のすべてから呼ばれる。ダイジェスト無効化（案A）のフックにそのまま使える。
  - `editorial/0` は FE が onSnapshot 購読（`src/lib/stores/editorial.svelte.ts:47`）。digest をここに入れると要約がクライアントへ配信されるため、digest は別ドキュメントに分離する。
  - `firestore.rules` の editorial は `match /editorial/{docId}` のワイルドカード。`outputs`/`digest` も既存ルールが当たり、rules 変更・デプロイは不要。

## Research Log

### 順序（begin の位置）
- **Context**: 「生成中」が押下直後に出ない（R1）。
- **Sources**: `functions/src/pipeline/editing/regenerate-element.ts`（`regenerateNarration`）、`element-builders.ts`（`buildIntroOutroInput` / `buildNarrationPart`）、`editorial-repository.ts`（`narrationWriter.begin`＝単一 `update`）、`intro-outro-step.ts`（一括ラン。digest を1回構築し intro/outro 両方に使う）。
- **Findings**: `buildNarrationPart` が内部先頭で `begin()` を呼ぶため、`regenerateNarration` では `buildIntroOutroInput`（重い）の後に begin が来る。begin は status を書く単一 update でトランザクション不使用（R2 は現状で充足）。
- **Implications**: `begin()` を `buildNarrationPart` から呼び出し側へ引き上げ、個別再生成・一括ランの双方で「begin 先行 → 重い前処理 → 生成」に統一する（R1/R4）。

### ダイジェストの再利用と無効化
- **Context**: 個別再生成のたびの丸ごと再計算を避ける（R5）。
- **Sources**: `debate-digest.ts`（`buildDebateDigest`、非保存・逐次 LLM）、`edited-repository.ts`（`clearEditedArtifact` → `clearEditorial`＋editedChapters 削除）、呼び出し元 `debate-lifecycle.ts:114` / `editing-lifecycle.ts:20`(`startEditingRun`) / `api/fact-research.ts:44` / `api/personas.ts:51` / `api/chapters.ts:42`。
- **Findings**: 無効化に必要なトリガー（討論/ペルソナ/章/fact 変更・編集ラン開始）は全て `clearEditedArtifact` を既に通る。digest を別ドキュメントにすると `clearEditorial` の全上書きには乗らないため、`clearEditedArtifact` に明示削除を1行足す（案A）。
- **Implications**: 案A（`clearEditedArtifact` 相乗り）を採用。編集ラン開始でも無効化されるため「討論不変でも編集ラン再実行で1回作り直し」が起きるが、主目的（個別再生成の連打）は再利用でカバーされる。

### ドキュメント構造と rules
- **Context**: digest の保存先／`editorial/0` の命名（R5・R6）。
- **Sources**: `editorial-repository.ts`（`editorialRef = editorial/0`）、FE 読み取り `editorial.svelte.ts:47` / `topics.svelte.ts:85` / `published-article.ts:36`（公開読み取り）、`firestore.rules`（`match /editorial/{docId}`）。
- **Findings**: `editorial/0` を参照する実コードはバックエンド1（`editorialRef`）＋フロント3。rules はワイルドカードで新パスをカバー。公開トピックでは digest も公開読み取り可能になる副作用あり（討論の公開内容由来なので実害小）。
- **Implications**: 成果物を `editorial/outputs`、digest を `editorial/digest` に分離。`0→outputs` は既存データ移行を伴う（backfill）。rules は触らない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存拡張（digest を editorial/outputs に相乗り） | digest を成果物ドキュメントの1フィールドに保存 | 無効化コード不要（clearEditorial 全上書きに乗る） | outputs は FE 購読対象。digest がクライアントへ配信・露出 | 不採用 |
| B/C: 専用ドキュメント分離（採用） | digest を `editorial/digest` に専用リポジトリで分離、無効化は `clearEditedArtifact` に1行 | 責務が綺麗・FE に配信しない | 無効化に明示コード1行 | R1/R4 の順序修正は既存編集で共通のため B と C は実質同一 |

## Design Decisions

### Decision: digest キャッシュは専用ドキュメント（Option B）
- **Context**: R5 の保存先。`editorial/0`(=outputs) は FE 購読対象。
- **Alternatives**: A=outputs に相乗り / B=専用ドキュメント。
- **Selected**: `topics/{id}/editorial/digest` に `DebateDigest` を保存する専用リポジトリを新設。
- **Rationale**: FE に digest を配信しない。責務分離。
- **Trade-offs**: 無効化に明示コード（`clearEditedArtifact` に1行）が必要。

### Decision: 無効化は案A（clearEditedArtifact 相乗り）
- **Context**: R5 のキャッシュ無効化のタイミング。
- **Alternatives**: A=既存 clear に相乗り / B=討論バージョンをキーに厳密化。
- **Selected**: 案A。`clearEditedArtifact` に digest 削除を追加。
- **Rationale**: 主目的（個別再生成の連打）はどちらでも再利用でき差が出ない。案B はバージョン管理の手間の割に得が小さい。
- **Trade-offs**: 討論不変でも編集ラン再実行のたびに digest を1回作り直す（許容）。

### Decision: `editorial/0 → editorial/outputs` リネームと移行
- **Context**: 無名 singleton `0` の曖昧さ解消＋digest との名前付き分離（R6）。
- **Selected**: `editorialRef` を `outputs` に変更。既存データは `functions/src/scripts/` にコミットする冪等 backfill で `0→outputs` をコピー。デプロイ順序は「backfill 先 → デプロイ」。
- **Rationale**: 公開記事（読み取り専用）は編集中でないため、backfill 先行で移行ウィンドウの実害が無い。
- **Trade-offs**: 運用手順（backfill を先に流す）を守る必要。ゼロウィンドウを厳密化したいなら公開読み取りに一時フォールバック（outputs 無ければ 0）を足す選択肢。

## Risks & Mitigations
- 移行中に公開記事が空の `outputs` を読む — backfill を先に実行（公開記事は編集されないため実害小）。厳密化するなら読み取りフォールバック。
- digest が公開トピックで公開読み取り可能 — 討論の公開内容由来で実害小。厳密化するなら rules に digest 除外を1行。
- begin を builder から引き上げる際、一括ランで begin 済み要素の二重 begin や finalize スイープとの整合 — 呼び出し側で begin を1回だけ呼び、`buildNarrationPart` は begin を持たない契約に統一。

## References
- 既存 backfill 前例: `functions/src/scripts/backfill-persona-avatars.ts`
- steering: `.kiro/steering/project-knowledge.md`（no-emulator/デプロイ必須・公開SSRは本番rules）、`.kiro/steering/conventions.md`（使い捨て禁止・再生成は開始時即時クリア）
