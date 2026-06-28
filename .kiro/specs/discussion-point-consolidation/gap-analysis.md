# Gap Analysis: discussion-point-consolidation

## 1. 現状調査（Current State）

### `focusQuestion` の全タッチポイント

| 層 | ファイル:行 | 役割 | 廃止後の扱い |
|---|---|---|---|
| 型（functions） | `types/chapter.types.ts:6,42,63` | `Chapter` / `ChapterForFirestore` / `ChapterEntry` の `focusQuestion` | フィールド削除 |
| 型（functions） | `types/fact-check.types.ts:23` | `FactCheckContext.focusQuestion` | 代替（active 論点 or `chapterTitle`） |
| 型（front） | `src/lib/models/chapter/chapter.types.ts:15` | `ChapterForFirestore`（`Chapter` が継承） | フィールド削除 |
| 生成 | `agents/chapter-agent.ts:53,237,256-267` | zod スキーマ・`buildChapters` 組み立て・生成プロンプト | スキーマ/プロンプトから `focusQuestion` を除去し論点側へ移譲 |
| 永続化 | `pipeline/chapters/chapter-generator.ts:53` | Firestore へ `focusQuestion` 書き込み | 書き込み削除 |
| 読み出し | `pipeline/debate/chapter.ts:15,34` | `ChapterDocData` / `toChapterEntry` マッピング | 読み出し削除（旧データの残存フィールドは無視） |
| 誘導・判定 | `agents/facilitator-agent.ts:46` | 司会システムプロンプト「会話が常にフォーカス問いに関連するよう誘導」 | active 論点基準へ書き換え（title フォールバック） |
| drift/stall | `agents/facilitator-agent.ts:108-158`（`evaluateTopicDrift`/`evaluateStallIntervention`） | 「フォーカス問いから逸脱」を判断基準に | active 論点とのずれへ書き換え |
| オープニング | `agents/facilitator-agent.ts:76` | 第1章フォーカス提示 | 先頭論点へ |
| 章導入 | `agents/facilitator-agent.ts:220-231` | `focusQuestion` ＋ `discussionPoints[0]` を**二重**に切り口提示 | 先頭論点に一本化（二重提示解消） |
| 発言者文脈 | `agents/persona-agent.ts:219` | `chapterContext` の「【この章のフォーカス】」 | 削除（active 論点注入は実装済み・R5）|
| ファクトチェック | `pipeline/fact-check/fact-check-runner.ts:63,309`・`fact-check-judge.ts:37`・`pipeline/debate/turn.ts:239` | 検証スコープ補足 `（focusQuestion）` | active 論点 or `chapterTitle` |
| UI（管理） | `src/lib/features/admin/topic-detail/debate/Phase5Debate.svelte:158` | `chapter.focusQuestion` 表示 | 非表示（title + discussionPoints 表示） |

### アクティブ論点追跡（既実装・本仕様の前提）

- `types/chapter.types.ts:31-35` `DiscussionPointState { point, status, introducedOrder? }`
- `pipeline/debate/discussion-points.ts:19-34` `markIntroduced`（提示で `introducedOrder` 採番）/ `saveDiscussionPointStatuses`（順序を永続化）
- `pipeline/debate/turn.ts:199-212` 発言者向けに「最新 `introducedOrder` の introduced 論点」を `activeDiscussionPoint` として算出・注入済み
- `agents/persona-agent.ts:220` `activePointNote`（発言者プロンプトへの注入、R5 はほぼ充足済み）

### 規約・テスト配置・制約

- 純関数は対応モジュール近くに置き `functions/src/tests/pipeline/debate/*.test.ts`（Firestore モック）でユニットテスト。
- 型は FE（`src/lib/models/`）と functions（`functions/src/types/`）で**二重定義**。両方の `focusQuestion` を削除する必要がある。
- 公開閲覧側（`src/routes/debate`・`components/public`）は `focusQuestion` を**参照していない**（影響は管理画面 `Phase5Debate.svelte` のみ）。
- Data Connect スキーマに章は無い（章は Firestore ドキュメント）。GraphQL 変更不要。
- 本番 Cloud Functions 直結・エミュレータ未使用のため、functions 変更はデプロイ必須・挙動はデプロイ後観測。

## 2. 要件 → アセット対応マップ

| 要件 | 既存アセット | ギャップ | 種別 |
|---|---|---|---|
| R1 focusQuestion 廃止・一本化 | 型3定義（functions）+1（front）、生成・永続・読み出し | フィールド削除と読み出し/書き込み除去。旧データは残存フィールド無視で後方互換 | Missing（機械的・広い） |
| R2 論点を well-formed な問いで生成 | `chapter-agent.ts` 生成プロンプト・zod スキーマ | 「一般人が日常感覚で理解できる問い」のペダゴジを focusQuestion から discussionPoints へ移す。出力品質は要検証 | Missing + **Unknown（品質）** |
| R3 active 論点基準の誘導・drift | `evaluateTopicDrift`、`facilitator-agent.ts:46`、`intervention.ts` | **facilitator 層に active 論点が渡っていない**（persona 層のみ実装）。算出を介入層へ展開し、プロンプト基準を書き換え | Missing（中核） |
| R4 stall 判定・投入候補の整合 | `intervention.ts:133-190`、`evaluateStallIntervention`、`markIntroduced` | 投入候補を「untouched のみ」に絞る。候補リスト/`selectedDiscussionPointIndex`/`markIntroduced` の**index 整合**が要調整 | Missing + **Constraint（index 整合）** |
| R5 発言者フォーカス一本化 | `persona-agent.ts:219-220`（active 注入済み） | `focusQuestion` 行の削除と title フォールバックのみ | Constraint（ほぼ充足） |
| R6 依存箇所の代替 | 章導入・fact-check・UI | 章導入の二重提示解消、fact-check スコープ代替、UI 非表示 | Missing（局所） |
| R7 active 論点不在時フォールバック | 各プロンプト・UI | 「active 論点が無ければ title」を全消費点で一貫適用。共通解決の置き場が論点 | Missing + **設計判断** |

## 3. 重要なギャップ（Research Needed）

> **最大の論点: 投入候補の index 整合**

`intervention.ts:133` の `unaddressedDiscussionPoints`（`status !== 'addressed'` ＝ untouched + introduced）は、(a) drift/stall プロンプトへ渡す候補リスト、(b) `selectedDiscussionPointIndex` の index 空間、(c) `markIntroduced(state, index)` 内の `filter(p => p.status !== 'addressed')`（`discussion-points.ts:21`）と、(d) `intervention.ts:182-190` の再導出、で**同じ index 空間を共有**している。R4-2 で候補を「untouched のみ」に絞るには、これら4点を同時に整合させる必要がある（片方だけ変えると投入論点がずれる）。

→ **設計で決める**: 候補表現を「untouched のみのリスト＋その index」に統一し、`markIntroduced` のフィルタも `untouched` 基準に合わせるか。あるいは index 受け渡しをやめ「論点文字列で指定」に変えて index 依存自体を解消するか。

その他の Research Needed:
- **active 論点解決の置き場**: 「最新 introduced、無ければ title」を persona / facilitator(誘導・drift・stall) / fact-check / 章導入 の各所で使う。`turn.ts:199-212` の reduce ロジックの重複を避け、`discussion-points.ts` に純関数 `getActiveDiscussionPoint(state)` 等を1つ置くのが妥当か（steering「真に共通な処理はヘルパー化可」に合致）。フォールバック（title）まで含めるかは設計判断。
- **生成品質（R2）**: focusQuestion を消し discussionPoints を「問いの形」に変えたとき、章導入や閲覧時の入口の分かりやすさが落ちないか。eval/サンプル生成での確認が必要（AI 生成ロジックはモックでユニット、品質は別途観測）。
- **fact-check スコープの粒度**: `FactCheckContext` は章単位で `focusQuestion` を1つ持つ（`turn.ts:239`）。fact-check はターン単位実行なので active 論点も渡せる。確定方針は「active 論点→無ければ chapterTitle」（ユーザー確認済み）。型の `focusQuestion` を `chapterTitle`/active に置換する形を設計で確定。
- **旧データ表示**: 既存の公開済み討論で focusQuestion 表示を消すことの是非（一括バックフィルは out of scope）。表示は title + discussionPoints へ統一でユーザー合意済み。

## 4. 実装アプローチ

### Option A: 全箇所をインプレース改修（純粋な削除＋付け替え）
- 型4定義から `focusQuestion` 削除、生成/永続/読み出しを除去、各プロンプトを active 論点基準に手書きで書き換え、UI 非表示。active 論点解決は各所にインライン。
- **Trade-off**: ✅ 新規抽象ゼロ・最小構成 / ❌ active 論点＋title フォールバックの解決ロジックが4〜5箇所に重複（`turn.ts` の reduce と同型）。整合ミスのリスク。

### Option B: active 論点解決の小ヘルパーを1つ導入＋インプレース改修（推奨）
- `discussion-points.ts` に純関数 `getActiveDiscussionPoint(state): string | undefined`（最新 introduced）と、必要なら `activeFocusOrTitle(state, chapter): string`（フォールバック込み）を新設。persona / facilitator(誘導・drift・stall) / fact-check / 章導入 が共通利用。`turn.ts:199-212` の既存インラインも置換。
- 投入候補は「untouched のみ」へ整合（`markIntroduced` フィルタ含む）。残りは Option A と同じインプレース改修。
- **Trade-off**: ✅ フォールバック規則を1箇所に集約し整合崩れを防止／既存 reduce の重複も解消 ✅ steering の「真に共通な純関数はヘルパー化可」に合致 / ❌ ヘルパーの責務境界（フォールバックを含めるか）を設計で明確化する必要。

### Option C: 段階導入（判定の付け替え → focusQuestion 物理削除）
- フェーズ1: active 論点解決ヘルパー＋判定軸の付け替え（誘導・drift・stall・fact-check・章導入）を、`focusQuestion` を**残したまま**実施しテスト緑を維持。フェーズ2: 型・生成・永続・読み出し・UI から `focusQuestion` を物理削除。
- **Trade-off**: ✅ 各フェーズでテスト緑・リスク分散・本番デプロイ単位を分けられる（本番直結・観測前提に好相性） / ❌ 一時的に focusQuestion と active 論点が併存し、tasks の段取りがやや増える。

## 5. Effort & Risk

- **Effort: M（3〜7日）** — 変更は広いが大半は機械的（型4・プロンプト6・生成1・UI1・テスト追従）。中核は「facilitator 層への active 論点導入」と「投入候補 index 整合」の2点で、ここに設計判断が集中する。
- **Risk: Medium** — 型削除・UI 非表示は Low。一方、(1) 投入候補 index 整合の崩れ、(2) drift 基準を傘→具体論点に変えることによる介入挙動の変化、(3) discussionPoints を問い化する生成品質、は挙動・品質リスク。本番直結・エミュレータ未使用のため、デプロイ後の観測と eval が必要。

## 6. 設計フェーズへの引き継ぎ

- **推奨アプローチ**: Option B（共通ヘルパー1つ＋インプレース）。段取りは Option C のフェーズ分け（判定付け替え→物理削除）をタスク順序として採用すると本番デプロイのリスクを分割できる。
- **設計で確定すべき主要判断**:
  1. 投入候補の表現（untouched のみへの統一 / index 依存の解消方法）と `markIntroduced` フィルタの整合
  2. active 論点解決ヘルパーの署名とフォールバック（title）の責務境界・適用順
  3. drift/stall/誘導/章導入の各プロンプト文面（active 論点基準・title フォールバックの言い回し）
  4. `FactCheckContext` の `focusQuestion` を active 論点／`chapterTitle` へ置換する形
- **Research（design へ持ち越し）**: discussionPoints 問い化の生成品質検証（eval）、drift 基準変更後の介入頻度の観測方法。
