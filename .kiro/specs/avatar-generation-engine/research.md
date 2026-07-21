# Research & Design Decisions: avatar-generation-engine

## Summary
- **Feature**: `avatar-generation-engine`
- **Discovery Scope**: Extension（既存 functions への統合。編集ベース手法の復元と本番置換）
- **Key Findings**:
  - 編集ベースの配管（プロンプト・後処理・seed・検証ハーネス）は既に functions 内にコード化済みで、新規発明はほぼ不要。心臓部（seed 添付プロンプト）も avatar-prompt.ts に存在する。
  - 本質ギャップは (a) 本番で1ペルソナに可変軸と seed を割り当てる規則が無い、(b) 検証と本番が別実装（Req 1.4 は同一実装を要求）の2点。
  - 編集ベース手法は一度も 2.5 で実検証されておらず、これが唯一の成立ゲート兼最大リスク。

## Research Log

### 既存の生成経路と再利用可否
- **Context**: 何を作り直し何を再利用するかを確定するため。
- **Sources Consulted**: `functions/src/avatar/*`、`functions/src/scripts/{build-avatar-seeds,verify-avatar-generation}.ts`、`functions/src/api/avatars.ts`、`scripts/avatar-generation/*`、gap-analysis.md。
- **Findings**:
  - `avatar-prompt.ts`（編集ベース）・`avatar-postprocess.ts`（`toAsset`）・`seeds/*.png`（40枚 on-style）・`verify-avatar-generation.ts`（枠測定）は再利用可。
  - 本番 `avatars.ts` は text-only 生成＝破棄経路。`scripts/avatar-generation/prompt-builder.ts` も `REFERENCE_IMAGES:[]` の text-only＝破棄経路。
  - `build-avatar-seeds.ts` は `SOURCE_DIR` が移動済み sheets を指し破損。`verify` は MODEL が 3.1（Req は 2.5）。
- **Implications**: 「配管を再利用し、心臓部を1本の共有エンジンに束ね、text-only は不採用（記録は残す）、2.5 で検証」という構成が素直。フィジビリコード（scripts/avatar-generation）は削除せず記録として保全する。

### スケール一貫の担保方式
- **Context**: 頭サイズ/位置を個体間で揃える方式の確定。
- **Findings**: 先行 validation の通り、後処理の幾何検出による自動正規化は破綻（顔穴＝首連結・首くびれ＝ロングヘア）。生成側で「ズーム＋目線のみ seed 一致」を固定し、後処理は高さ基準の枠正規化（0.92・下端接地）に留める。両者は役割が別（頭サイズ一貫＝生成側、枠占有＝後処理）。
- **Implications**: `avatar-prompt.ts` の LOCKED（相対＋顔高45%絶対）と `avatar-postprocess.ts`（0.92/接地）を両方維持。顔高は旧 seed 実測 35.4% から 45%（顔を大きくする）へ変更。

### 正規化・スケール定数の出所
- **Context**: 「効く数値をコードに・単一定義」（Req 1.2）。
- **Findings**: 採用値は 0.92・下端接地（下余白0）。却下値 0.855/0.063 は steering `spec-dependencies.md` にのみ残る古い記述で、コードは全て 0.92。ただし `0.92`/`256` が `avatar-seeds.ts` と `avatar-postprocess.ts` に二重定義。影しきい値 36、顔高 35.4% も各所に散在。
- **Implications**: 定数を単一 module に集約し全参照をそこへ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: avatars.ts 拡張 | 本番ハンドラに生成手法を直接埋め込む | 新規最小・配線温存 | 検証=本番同一（Req 1.4）を満たしにくい・ロジックがハンドラに混在 | 却下 |
| B: 新規エンジンに全部集約 | 本番固有処理も含めエンジンへ | 分離明快 | Firestore/Storage まで動かすと過剰・境界が曖昧 | 却下 |
| C: 共有エンジン＋薄ラッパ（採用） | 純粋生成をエンジンに、Firestore/Storage/lifecycle は avatars.ts、verify も同エンジン | Req 1.4 を構造保証・関心分離・配線温存 | エンジン入出力の写像設計が要る | 採用 |

## Design Decisions

### Decision: 検証と本番を1本の共有エンジンにする（Option C）
- **Context**: Req 1.4「検証用と本番用の実装を分けない」。
- **Selected Approach**: `avatar-engine.ts` に `generateAvatarAsset(spec)`（seed選択→プロンプト→モデル→後処理）を置き、本番 `runAvatarCore` と offline verify の双方がこれを呼ぶ。
- **Rationale**: 乖離を構造的に不能にする。過去の再現不能はここが分かれていたことが一因。
- **Trade-offs**: エンジンの入出力（persona→生成入力）を明示設計する必要。

### Decision: 可変軸と seed を personaId から決定的に導出
- **Context**: 本番の persona は髪型/体型/ポーズ等を持たない（Req 3 のギャップ）。Req 1 は再現可能性を要求。
- **Alternatives Considered**:
  1. persona スキーマに軸を追加保存 — スキーマ変更・書き込み経路増。
  2. 毎回ランダム — 再現不能・再生成で別人化。
  3. personaId の安定ハッシュでカタログから決定的に選ぶ（採用）。
- **Selected Approach**: `resolveVariation(personaId, attempt, generation, presentation)` が `(personaId, attempt)` ハッシュで髪型/体型/ポーズ/アングル/メガネと seed index（1..4）を決定的に選ぶ。スキーマ変更なし・初回（attempt=0）は同一 persona で常に同一 spec・再生成は attempt を変えて別選択を探索。
- **Rationale**: 再現可能（コード＋personaId で spec が定まる）・個体差は seed×軸で担保・書き込み経路を増やさない。
- **Trade-offs**: 生成画像そのものはモデル非決定性で毎回変わる（spec は不変・画は再レンダ）。これは Req 1 の「再現可能＝手法/入力が定まる」の範囲で許容。

### Decision: モデルは gemini-2.5-flash-image（本番も）
- **Context**: Req は 2.5 で検証。3.1 移行はスコープ外。本番置換は「検証した実装」を入れる。
- **Selected Approach**: エンジンの画像モデルを 2.5 に固定。`AVATAR_IMAGE_MODEL` を 2.5 に戻す（現状 3.1 は破棄する text-only 経路のための値）。
- **Rationale**: 変数を1つに絞る。検証済みモデルを本番に入れる。3.1 移行は後続 spec で単独再検証。

### Decision: androgynous は生成スキップ（未生成のまま）
- **Context**: seed アンカーが masculine/feminine のみ。persona は androgynous を取りうる。
- **Alternatives Considered**: masc/fem へマップ（外観を偽る）／スキップ（未生成）。
- **Selected Approach**: androgynous は適合 seed 無しとして**生成をスキップし `avatarGeneratedAt` 未設定のまま残す**（既存の「未生成」許容と同じ）。androgynous seed 追加時に個別再生成で回収。
- **Rationale**: 外観を偽らない・本番を落とさない・既存の欠落回収経路に乗る。

## Risks & Mitigations
- **編集ベース手法が未検証（High）** — Req 7 の 2.5 実生成を最優先タスクにし、様式・枠・軸適合を人が確認。不合格ならプロンプト反復（design はプロンプトを差し替え可能な構造にする）。
- **可変軸の決定的割り当てが単調に見える（Medium）** — seed 4枚×カタログ×ハッシュ分散で個体差を確保。検証で散り具合を確認。
- **命名/定数の一本化で参照漏れ（Low）** — 型で強制（Presentation/Generation の単一定義）＋既存 golden test で後処理等価性を担保。

## References
- 先行 spec 結論: `.kiro/specs/persona-avatar-image-generation/validation/{per-persona-variation,go-no-go,results}.md`
- steering: `.kiro/steering/spec-dependencies.md`（フィジビリ成果はコードで残す／依存の引き継ぎ）
