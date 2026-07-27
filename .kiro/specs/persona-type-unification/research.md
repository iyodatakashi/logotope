# Research & Design Decisions: persona-type-unification

## Summary
- **Feature**: `persona-type-unification`
- **Discovery Scope**: Extension（既存コードの型整理・機械的リネーム＋データ移行）
- **Key Findings**:
  - `role`（= `specificRole ?? stakeholderRole`）の導出が最低6箇所で重複。生成スキーマは `specificRole` 必須だが FE 型は optional・admin 編集で空にできるため、`??` が空文字を拾わない穴がある。→ フィールド改名＋必須化で解消。
  - functions の runtime `Persona` は非テスト25ファイルが import。runtime 形を不変に保ち、永続形 `PersonaForFirestore` を加算的に導入すれば低リスク。
  - 公開 `PublishedPersona` と admin の無名 `{ name, role }` 即席オブジェクトは事実上同形。共通の軽量表示型 `PersonaForDisplay` に集約できる。
  - `specificRole` の改名対象は functions 12ファイル・FE 9ファイル。`nationality` は永続＋アバターで使用、FE では未使用。

## Research Log

### 現状の型定義と乖離
- **Context**: FE と functions の `Persona` が別物、公開に別型 `PublishedPersona`。
- **Sources Consulted**: `functions/src/types/persona.types.ts`, `src/lib/models/persona/persona.types.ts`, `src/lib/models/published/published-article/published-article.types.ts`, `editorial.types.ts`（一致基準）。
- **Findings**:
  - functions `Persona`：永続＋ランタイム混在。`interview` を `interviewRecord: string` に平坦化、`nationality: string` 必須、`specificRole: string` 必須。`PersonaForFirestore` 不在。
  - FE `PersonaForFirestore`：`specificRole?` optional、`nationality` 欠落、`interview?: InterviewForFirestore`（リッチ）。`Persona = Omit<..., timestamps> & { Date 版 }`。
  - `editorial.types.ts` が「FE `*ForFirestore` は functions と一致」基準を明示。
- **Implications**: 永続形 `PersonaForFirestore` を FE↔functions で構造ミラー化し、runtime `Persona` を派生（Timestamp→Date、interview 平坦化は functions runtime のみの派生）とする。

### `role` 導出の重複と空表示の穴
- **Context**: 表示役割の導出が各所に散在。
- **Sources Consulted**: `DebateChapter.svelte`(speakerLabel), `EditingChapter.svelte`, `EditingImpression.svelte`, `InterviewItem.svelte`, `PersonaItem.svelte`, `published-article.ts`(builder), `personas.ts`(functions read), `persona-chain.ts`。
- **Findings**:
  - `specificRole ?? stakeholderRole` が6+箇所。`??` は null/undefined のみ拾い、空文字 `""` は拾わない。
  - admin `PersonaItem` は `specificRole` を空文字にできる（placeholder=stakeholderRole）→ 空だと役割が空表示。
  - 生成スキーマ `specificRole: z.string()` 必須。
- **Implications**: 読み取り導出をやめ、`specificRole → role` に改名・必須化し、書き込み時に非空を保証（空/欠落→`stakeholderRole`）。既存データは backfill 移行。

### 改名対象範囲（`specificRole`）
- **Findings**:
  - functions（非テスト12）: `types/persona.types.ts`, `pipeline/personas/personas.ts`, `pipeline/personas/persona-chain.ts`, `agents/interview-agent.ts`, `agents/persona-agent.ts`, `agents/editor-agent.ts`, `agents/persona-generator-agent.ts`, `utils/prompt-formatters.ts`, `avatar/avatar-engine.ts`, `avatar/verify-avatar-generation.ts`, `avatar/avatar-prompt.ts`, `api/avatars.ts`。
  - FE（非テスト9）: 5 admin コンポーネント, `stores/personas.svelte.ts`, `models/persona/persona.types.ts`, `models/published/published-article/published-article.ts`, `.../published-article.types.ts`。
- **Implications**: `AvatarSpec.specificRole`（`avatar-engine`/`avatar-prompt`/`verify-avatar-generation` の別型フィールド）は Persona とは別。`api/avatars` の写像元 `persona.specificRole` を `persona.role` に変えるのみで、`AvatarSpec` の内部フィールド名は据え置き可。

### 統合影響面
- **Findings**: `PublishedPersona` 参照は定義＋builder＋4公開コンポーネント＋`PublishedArticle.personas`。`PersonaAvatar` は `{ colorKey?, avatarGeneratedAt? }` のみ要求（`PersonaForDisplay` の部分集合）。`PersonaPostItem.svelte`（未追跡・保留）は `persona.role` を要求。
- **Implications**: `PersonaForDisplay` に `PersonaAvatar` の必要フィールドを含め、1オブジェクトで名前・役割・アバターを賄えるようにする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 加算的（採用） | functions に `PersonaForFirestore` を新設し runtime `Persona` は不変。FE はミラー＋`role` 改名＋`PersonaForDisplay` 導入 | 振る舞い不変・25 consumers 無改変・目的達成 | admin の置換箇所が多い（機械的） | 推奨。gap-analysis Option A |
| B: 全面分離 | functions runtime も永続形から厳密派生（interview 平坦化廃止等） | 最高純度 | 25ファイル波及・討論/取材/アバター回帰リスク大 | 本 spec 非スコープ |
| C: 段階 | 表示層（PersonaForDisplay＋PersonaPostItem）先行、型ミラー＋role 移行を後続 | 早期に共通化価値・リスク分割 | 一時的に新旧写像が混在 | タスク分割で吸収可能 |

## Design Decisions

### Decision: 3層のペルソナ型（永続 / ランタイム / 表示）
- **Context**: 同名 `Persona` の意味ズレと表示用射影の乱立。
- **Selected Approach**: `PersonaForFirestore`（永続・FE↔functions ミラー）→ `Persona`（ランタイム・Date 派生）→ `PersonaForDisplay`（共通軽量表示・FE 専用）。
- **Rationale**: editorial.types.ts の確立パターンに一致。表示は最小形に絞り公開 payload を汚さない。
- **Trade-offs**: 型が3つになるが各層の責務が明快。runtime `Persona`（functions）は interview 平坦化を派生として保持（既存 consumers 温存）。

### Decision: `specificRole → role` 改名・必須化（読み取り導出の廃止）
- **Context**: `?? stakeholderRole` の散在と空文字の穴。
- **Alternatives Considered**:
  1. 読み取り時に単一の導出ヘルパー（`toPersonaForDisplay` 内で `?? stakeholderRole`）— 永続データ不変だが導出は残る。
  2. フィールド改名＋必須化＋書き込み時保証（採用）。
- **Selected Approach**: 永続フィールドを `role`（必須）に改名。生成は `role` 必須、admin 保存は空→`stakeholderRole` 確定。読み取りは `role` 直参照（導出なし）。既存は backfill 移行。
- **Rationale**: 表示役割を「永続フィールド1つ」に一元化。ユーザー要望（永続含む整理・導出撲滅）に合致。
- **Trade-offs**: Firestore フィールド改名＋移行が必要（backfill）。`stakeholderRole` は総称として残す。

### Decision: 移行順序（一時フォールバック → 撤去。design validation Issue 3 で確定）
- **Context**: 旧データは `specificRole` を持ち `role` を持たない。デプロイと backfill の順序に依存すると公開記事の役割が空表示になり得る。
- **Alternatives Considered**:
  1. backfill 先行・fallback なし — 最も単純だが運用順序が崩れると空表示。
  2. 初回デプロイに一時フォールバック `role ?? specificRole ?? stakeholderRole` → backfill 後に撤去（採用）。
- **Selected Approach**: (1) 一時フォールバック込みでデプロイ（順序非依存で安全）→ (2) `backfill-persona-role` 実行 → (3) 検証 → (4) 後続デプロイでフォールバック撤去し `role` 直参照へ。
- **Rationale**: 移行前デプロイでも役割の空表示を防ぐ。fallback は移行専用の単一 read 箇所に限り、end state では撤去して導出を恒久排除する。
- **Trade-offs**: 撤去タスクが1つ増える。移行中は単一箇所に一時的な導出が残る。
- **Follow-up**: 代表トピック（公開済み含む）で `role` 存在を確認後にフォールバック撤去。

### Decision: interview 永続型のミラー化と `researchSummary` 是正（design validation Issue 1 で確定）
- **Context**: interview 結果は persona ドキュメントの `interview` オブジェクトに単一保存されるが、functions に永続 `InterviewForFirestore` が無く（リテラル直書き＋読み取りで `interviewRecord` に平坦化）、FE 型は `researchSummary?` を持つのに functions は永続しない。
- **Selected Approach**: functions に永続 `InterviewForFirestore`（＋`DraftBelief`/`SearchSource`/`SearchResult` を型レイヤーへ集約）を新設して FE とミラー。`api/interviews.ts` の書き込みを型付け。FE 型・InterviewDialog から `researchSummary` を削除。runtime の非対称（FE=interview オブジェクト保持／functions=`interviewRecord` 平坦化）は意図として明示。
- **Rationale**: 永続形の FE↔functions 構造一致（Req1.2）を満たしつつ、幽霊フィールドを除去。
- **Trade-offs**: functions 型集約でファイル移動（`DraftBelief`/`SearchSource` の定義元変更）が発生。

### Decision: `role` 非空は「入口検証」で保証（総称フォールバック廃止。ユーザー判断で確定）
- **Context**: `role` を非空にする必要（Req5）。当初案は書き込み時 `role ||= stakeholderRole`（空→総称）だったが、「空欄→総称の自動置換」は推測困難な挙動で望ましくない、というユーザー判断。
- **Alternatives Considered**:
  1. 読み取り時フォールバック（`?? stakeholderRole`）— 撲滅対象。
  2. 書き込み時 総称置換（`||= stakeholderRole`）— 自動置換が推測困難で却下。
  3. 書き込み入口の検証で非空を保証（採用）。
- **Selected Approach**:
  - 生成: プロンプトで「空の `role` を返さない」明示＋スキーマ `z.string().min(1)` で空を弾く。
  - admin: 空文字・空白のみの保存をブロック（総称へ自動置換しない。空欄は空欄のまま扱う）。placeholder（総称表示）の誤解を招く挙動は見直す。
  - `stakeholderRole` は `role` のフォールバックに使わない（総称としてのみ保持）。
  - 移行 backfill のみ、旧データの空/欠落を一度だけ `stakeholderRole` で埋める（非空不変条件の穴埋め・移行専用）。
- **Rationale**: 自動置換の不透明さを排し、非空を入口で担保。読み取りは `role` 直参照でフォールバックゼロ（Req5.6）。
- **Trade-offs**: admin にバリデーションが増える。旧データ穴埋めは移行に限定。

### Decision: `nationality` の配置
- **Selected Approach**: `PersonaForFirestore`（FE＋functions）＋ runtime `Persona` に持たせ、`PersonaForDisplay` には持たせない。
- **Rationale**: 永続フィールドは実文書を忠実にミラー。表示には不要。
- **Trade-offs**: FE は未使用フィールドを型に持つが、ミラー厳密性を優先。`nationality` は生成時必須で書かれ移行不要（`role` のような backfill は不要）。

## Risks & Mitigations
- **フィールド改名の広域波及（functions 12・FE 9）** — 機械的リネームを型チェック＋既存テストで担保。runtime `Persona` 形は不変に保ち consumers を守る。
- **移行前デプロイで役割が空表示** — backfill 先行を運用手順で徹底（デプロイはユーザー実行）。必要なら移行期間フォールバックを一時採用。
- **admin で `role` を空保存** — 保存時に空→`stakeholderRole` 確定して必須不変条件を守る。
- **公開 payload の増加** — 公開ビューは `PersonaForDisplay` へ写像し、重い runtime `Persona` を配信しない。

## References
- `.kiro/steering/project-knowledge.md` — type-domain-decomposition（persona 部分）
- `src/lib/models/editorial/editorial.types.ts` — FE↔functions 永続形一致の基準
- 先行移行の実装参照: `functions/src/scripts/backfill-editorial-outputs.ts`, `backfill-persona-*.ts`
