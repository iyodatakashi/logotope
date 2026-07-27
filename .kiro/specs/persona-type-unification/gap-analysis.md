# Gap Analysis: persona-type-unification

## Analysis Summary
- **`role`（= `specificRole ?? stakeholderRole`）の導出が最低6箇所で重複**している（admin: DebateChapter / EditingChapter / EditingImpression / InterviewItem、public: `PublishedPersona` ビルダー、共通: `PersonaPostItem`）。**方針決定: 読み取り導出をやめ、`specificRole` を `role` へ改名・必須化し、永続フィールドとして一元化する（既存データは backfill 移行）。** `stakeholderRole`（総称）は別概念として維持。`??` は空文字を拾わないため、admin で空にすると役割が空表示になる現行の穴も、必須化＋書き込み時確定で解消する。
- **admin は既に無名の即席表示オブジェクト `{ name, role }` を各所で組んでいる**（DebateChapter.speakerLabel 等）。`PersonaForDisplay` はこれと `PublishedPersona`、`PersonaAvatar` の必要フィールドを1つに集約する自然な受け皿になる。
- **`PersonaForDisplay` は FE 専用**（描画用）。functions には描画が無いため、functions 側スコープは Req1/Req2（`PersonaForFirestore` のミラー化・`nationality` の一貫化）に限られる。
- **functions の runtime `Persona` は非テスト25ファイルが import** しており、runtime 形の改名・フィールド変更は高リスク。ただし Req1 は「永続形 `PersonaForFirestore` を追加定義し、runtime `Persona` はそのまま維持（派生関係を明示）」とすれば加算的で低リスクにできる。
- 全体は「型定義とその写像の整理」で振る舞い不変（Req7）。公開ビューの payload 純度（Req3.4）が唯一の実挙動への影響点。

## 1. Current State Investigation

### 型定義の現状
| 型 | 定義場所 | 役割 | 問題 |
|---|---|---|---|
| `PersonaForFirestore`（FE） | `src/lib/models/persona/persona.types.ts` | FE 永続形 | `nationality` 欠落。functions と不一致 |
| `Persona`（FE） | 同上 | FE ランタイム（Date 派生） | `PersonaForFirestore` から派生（正しい形） |
| `Persona`（functions） | `functions/src/types/persona.types.ts` | 永続＋ランタイム混在 | `PersonaForFirestore` 不在。`interview`→`interviewRecord` 平坦化、`nationality` あり |
| `PublishedPersona` | `src/lib/models/published/published-article/published-article.types.ts` | 公開描画専用の射影 | 公開専用の並行型。`{id, topicId, name, role, colorKey?, avatarGeneratedAt?}` |
| （無名の即席 `{name, role}`） | DebateChapter / EditingChapter 等 | admin の話者ラベル | 型が無く各所で再導出 |

### 慣習・整合の基準
- `editorial.types.ts` が「FE `*ForFirestore` は functions 側と一致させる」基準を明示（Req1 の根拠）。
- 「id で保持し描画時に解決」（`personaMap` / `personas` Map）が admin・public 共通の確立パターン（維持対象）。
- `PersonaAvatar` は `{ colorKey?, avatarGeneratedAt? }` のみ要求（`PersonaForDisplay` の部分集合）。
- functions の写像は `personas.ts` の `toPersona`（`getPersonasByTopicId` / `getPersonaById` が共有）。FE は `personas.svelte.ts` の `toPersona`。

### 統合の影響面（consumers）
- **public `PublishedPersona` 参照**: `published-article.types.ts`（定義）, `published-article.ts`（ビルダー）, 4 コンポーネント（PublishedTurnItem / PublishedImpressionItem / PublishedAwarenessDialog / PublishedChapter）, `PublishedArticle.personas`。
- **admin の role 再導出**: DebateChapter, EditingChapter, EditingImpression, InterviewItem, PersonaItem。
- **共通**: `PersonaPostItem.svelte`（未追跡・`persona.role` 参照で型エラー・保留中）。
- **functions `Persona` import**: 非テスト25ファイル（debate パイプライン・agents・avatar・api）。runtime 形は不変に保つ前提なら影響なし。

## 2. Requirement-to-Asset Map

| Requirement | 既存アセット | ギャップ | タグ |
|---|---|---|---|
| R1 永続/ランタイム分離・FE↔functions ミラー | FE は分離済み。functions は未分離 | functions に `PersonaForFirestore` を新設し runtime `Persona` との派生関係を明示 | Missing（functions 側） |
| R2 `nationality` 一貫化 | functions のみ保持・FE 欠落 | FE 永続形へ `nationality` 追加、または design で保持方針を確定 | Missing / Constraint（FE 未使用フィールドを持つ是非） |
| R3 `PublishedPersona` 統合 | `PublishedPersona` と builder が存在 | `PersonaForDisplay` へ置換、公開 payload に重い `Persona` を持ち込まない | Missing |
| R4 共通表示型 `PersonaForDisplay` | admin 即席 `{name,role}` / `PublishedPersona` / PersonaAvatar が事実上同形 | 単一 `PersonaForDisplay` を定義し双方が写像。`role` 含む最小形・`Partial` 許容 | Missing |
| R5 役割フィールドの `role` 改名・必須化 | 6+ 箇所で `specificRole ?? stakeholderRole` 再導出。生成スキーマは `specificRole` 必須だが FE 型は optional・admin は空にできる | `specificRole → role` 改名＋必須化。読み取り導出を廃し、空/欠落は書き込み時に `stakeholderRole` で確定 | Constraint（永続フィールド改名・多数箇所の置換） |
| R6 場当たり派生型の排除 | `PersonaForInterview` 撤去済 | `PublishedPersona` 廃止。新規の用途別部分型を作らない | — |
| R7 見える振る舞い不変・公開影響の明示 | — | 表示挙動は不変（役割・名前・アバター）。公開ビューの配信データ量への影響を design で明示 | Constraint |
| R8 既存データ移行（`specificRole → role`） | `functions/src/scripts/` に既存 backfill 群あり（`backfill-persona-*`） | `specificRole → role` の冪等 backfill を新規実装（欠落/空→`stakeholderRole`）。backfill 先行 or 読み取りフォールバックで移行中の表示欠落を防ぐ | Missing |

**Research Needed（design へ持ち越し）**
- `PersonaForDisplay` の格納場所（`models/persona` に置き admin/public 双方から参照するか、`sharedComponents` 近傍か）。
- `PersonaForDisplay` に `topicId` を含めるか（現 `PublishedPersona` は持つが描画で未使用の可能性）。`role` は必須フィールドの直参照になる（導出関数は不要）。
- `specificRole → role` 改名・必須化の適用順序と移行手順（backfill 先行 or 読み取りフォールバック）。生成スキーマ・admin 編集（空→`stakeholderRole` 確定）・全読み取り経路の同時更新範囲。
- `nationality` は **`PersonaForFirestore`（FE＋functions）と ランタイム `Persona` に持たせ、`PersonaForDisplay` には持たせない**（方針確定）。残る細部は FE 側の必須/optional と旧データ欠落の埋め方（backfill と同時か）。
- functions `Persona` の永続/ランタイム分離を「加算的（`PersonaForFirestore` 追加のみ）」に留めるか、runtime も改名するか（後者は25ファイル波及で本 spec では非推奨）。

## 3. Implementation Approach Options

### Option A: 加算的・低リスク（推奨）
- functions: `PersonaForFirestore` を**新設**（`interview` オブジェクト・`nationality` 込みの永続形）。runtime `Persona` は現状維持し「`PersonaForFirestore` から `interviewRecord` 平坦化＋Date 変換で派生」と型/写像で明示。25 consumers は無改変。
- FE: `PersonaForFirestore` に `nationality` を追加してミラー。`PersonaForDisplay` を `models/persona` に新設し、`role` 導出を単一の写像関数に集約。`PublishedPersona` を `PersonaForDisplay` に置換（builder と4コンポーネント）。admin の即席 `{name,role}` も順次 `PersonaForDisplay` に寄せる。`PersonaPostItem` を共通化して完成。
- **Trade-offs**: ✅ 振る舞い不変・関数横断の破壊なし ✅ 目的（重複排除・共通化）を満たす ❌ admin 側の置換箇所が多い（機械的）。

### Option B: runtime も含めた全面分離
- functions の runtime `Persona` も `PersonaForFirestore` からの派生に厳密化（interview の平坦化廃止等）。
- **Trade-offs**: ✅ 最も純度が高い ❌ 25ファイル波及・討論/取材/アバターの回帰リスク大。R7（振る舞い不変）と相性が悪く、本 spec 範囲を超える。

### Option C: ハイブリッド（段階）
- Phase 1: `PersonaForDisplay` 導入＋`PublishedPersona` 置換＋`PersonaPostItem` 共通化（表示層の統一を先行、価値が出る）。
- Phase 2: `PersonaForFirestore` の FE↔functions ミラー化＋`nationality`／`role` 一元化。
- **Trade-offs**: ✅ 早期に共通コンポーネントが完成 ✅ リスク分割 ❌ 一時的に新旧の写像が混在。

## 4. Effort & Risk
- **Effort: M（3–7日）** — 新型は小さいが、`PublishedPersona` 置換（builder＋4コンポーネント）と admin の `role` 再導出集約（6+箇所）で機械的作業量が中程度。
- **Risk: Low〜Medium** — Option A なら functions runtime 不変で Low。FE の表示置換は既存テスト（published-article / editorial / personas store）で担保でき Low。`nationality` の FE 反映と公開 payload 方針のみ設計判断（Medium 要素）。

## 5. Recommendations for Design Phase
- **推奨アプローチ: Option A（加算的）**。必要なら Option C の段階分割で `PersonaForDisplay`＋`PersonaPostItem` を先行。
- **Key decisions（design で確定）**:
  1. `PersonaForDisplay` の定義・配置・フィールド（最小 `{ id, name, role, colorKey?, avatarGeneratedAt? }`、`topicId` の要否）。`role` は必須フィールドの直参照。
  2. `specificRole → role` 改名・必須化・移行（backfill）を含める（R5/R8）。生成・admin 編集・全読み取り経路・型（FE/functions）を同時に更新し、`stakeholderRole` は総称として維持。
  3. functions は永続形 `PersonaForFirestore` の追加に留め、runtime `Persona` を不変にする（Option B は非スコープ）。
  4. `nationality` は `PersonaForFirestore`＋ランタイム `Persona` に持たせ、`PersonaForDisplay` には持たせない（確定）。残る細部（FE の必須/optional・旧データ欠落の埋め）のみ design で確定。
  5. 公開ビューの payload 影響（`PersonaForDisplay` への写像で管理フィールドを配信しない）を明示。
- **Carry-forward research**: 上記 §2「Research Needed」。
