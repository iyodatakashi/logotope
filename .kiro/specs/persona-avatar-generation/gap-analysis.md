# Implementation Gap Analysis: persona-avatar-generation

要件（承認前）と既存コードベースのギャップを分析し、設計フェーズの判断材料を提供する。**決定でなく情報と選択肢の提示**が目的。

## Analysis Summary

- **表示側はほぼ準備済み**: [PersonaAvatar.svelte](../../../src/lib/sharedComponents/PersonaAvatar.svelte) は `src` / `silhouetteColor` / `backgroundColor` を受け、アルファマスク＋2色独立着色で描画できる。唯一の呼び出し箇所 [PublishedTurnItem.svelte](../../../src/lib/features/public/article-detail/PublishedTurnItem.svelte) が props 未指定なだけ。
- **ランタイム画像生成の基盤は未整備**: アプリ側（`src`/`functions`）に画像生成・Firebase Storage の利用は皆無。生成は `scripts/avatar-generation`（**オフライン**・Python 後処理＋人手レビュー前提）のみ。要件の「ランタイム AI 生成」は新規能力。
- **画像モデル呼び出しは移植容易**: [gemini-image-client.ts](../../../scripts/avatar-generation/gemini-image-client.ts) が `@ai-sdk/google` + `gemini-2.5-flash-image` で実装済み。functions は同 SDK・`GEMINI_API_KEY` パターンを既に使用（fact-check grounding 等）。呼び出し自体は流用可能。
- **後処理・保存・品質ゲートがギャップ**: 後処理は Python PIL（[postprocess.py](../../../scripts/avatar-generation/postprocess.py)、Node functions で非実行）、生成物の保存先が無い（Storage 未使用）、オフラインの人手合否判定に相当するランタイムの品質担保が無い。
- **ペルソナに性別・見た目フィールドが無い**: [persona-generator-agent.ts](../../../functions/src/agents/persona-generator-agent.ts) は gender を出力せず、`Persona` 型（FE/functions 双方）に性別・アバター・カラーが無い。

## Requirement-to-Asset Map

| 要件 | 既存資産 | ギャップ |
|---|---|---|
| R1 性別付与（LGBT配慮）・生成入力 | persona-generator-agent（zod schema）／persona.types.ts（FE/functions） | **Missing**: gender 出力・型・永続。**Constraint**: 既存 prompt-builder は男女二元前提（[variation-spec.ts](../../../scripts/avatar-generation/variation-spec.ts)）→ 多様な性表現への拡張が要る |
| R2 アバター画像の AI 生成 | gemini-image-client.ts（画像呼び出し）／postprocess.py（後処理）／persona-chain runPersonasStage（永続スロット） | **Missing**: ランタイム生成経路・後処理の Node 実装・生成物の保存先。**Constraint**: 後処理は Python、functions は Node |
| R2 生成失敗フォールバック | 既存サンプル 11枚（`assets/images/avatars/`） | **Constraint**: フォールバック資産はあるが選定ロジックは無い |
| R3 カラー自動決定（色相分散・重複回避・循環） | [variables.scss](../../../src/lib/assets/styles/variables.scss)（24系統・色相環順） | **Missing**: 割り当てロジック（新規・決定的・軽量） |
| R3 ファシリテーターのデフォルト色 | base 系トークン／[FACILITATOR_NAME](../../../src/lib/models/turn/turn.constants.ts) | **Missing**: 話者種別に応じた色分岐 |
| R4 決定性・安定性 | — | **Missing**: 生成物を一度確定し永続する仕組み（生成非決定性の固定） |
| R5 発言者表示への反映 | PersonaAvatar（表示準備済み）／published-article.ts（射影） | **Missing**: 呼び出し側配線。**Constraint**: 現状 `PublishedTurn` 等が話者名/肩書を要素ごとに焼き込む非正規化（要件は speakerId 参照＋話者情報の非重複を要求）→ 既存射影の作り替え |
| R5 公開/管理一致 | 公開=published 射影、管理=Persona 直読み | **Constraint**: 見た目の値はペルソナに載せ、両経路が同じ値を引ける必要 |
| R6 見た目の保証 | — | **Missing**: 全ペルソナに有効な見た目を保証するフォールバック統合 |

## Implementation Approach Options

### Option A: 既存ペルソナパイプラインに全部載せる（Extend）
`persona-generator-agent` に gender を追加し、`runPersonasStage`（[persona-chain.ts](../../../functions/src/pipeline/personas/persona-chain.ts)）内でアバター画像生成・後処理・保存・カラー割り当てまでインラインで行う。
- ✅ 新規モジュール最小・既存の永続スロットに素直
- ❌ 遅く失敗しやすい画像生成を同期パイプラインに埋め、`runPersonasStage` が肥大・脆く（Cloud Task 30分上限・部分失敗の巻き添え）

### Option B: アバター生成を独立ステージ/サービスに切る（New）
gender・カラー（軽量・決定的）はペルソナ生成に載せ、**画像生成は取材(interview)ステージに倣った独立の非同期ステージ**（新規）＋保存層として切り出す。
- ✅ 遅延・コスト・リトライ・部分失敗を隔離。品質ゲート/再生成も差し込みやすい
- ❌ 新規ファイル・ステージ配線が増える

### Option C: ハイブリッド（推奨）
- **軽量・決定的（gender・カラー割り当て）** → ペルソナ生成に載せる（Extend）
- **重い・非決定的（画像生成＋後処理＋保存）** → 独立の非同期ステージ（New）。**失敗/不合格時は既存サンプルへフォールバック**
- **公開射影の speakerId 正規化** → 独立した既存コードの作り替えとして扱う
- ✅ 各懸念を性質に応じて分離。段階導入可（まず gender+カラー+配線→次に画像生成）
- ❌ 計画の調整が要る

## Effort & Risk

| 作業 | Effort | Risk | 一言 |
|---|---|---|---|
| gender 追加（schema/型/prompt/永続） | S | Low | 既存パターンの拡張。多様な性表現の値域設計のみ注意 |
| カラー割り当てロジック | S | Low | 24系統の色相環順を利用した決定的選定。純アルゴリズム |
| 画像モデル呼び出しの functions 移植 | S–M | Low | gemini-image-client.ts をほぼ流用 |
| 後処理の Node 実装（Python→Node） | M | Medium | 輝度→アルファ・クロップ・リサイズを `sharp` 等で再実装 |
| 生成物の保存層 | M | Medium | Firebase Storage 新規導入 or Firestore 埋め込み（要選定） |
| 公開射影の speakerId 正規化 | M | Medium | 既存 `PublishedTurn`/`PublishedAwareness`/`PublishedImpression` と消費側を作り替え |
| ランタイム品質担保 | — | **High** | 人手レビュー無しで公開品質を保つ手段が未確立 |
| **総合** | **L–XL** | **High** | 高リスクは画像生成の非決定性・品質ゲートと新規インフラ（後処理/保存）に集中 |

## Research Needed（設計フェーズへ持ち越し）

1. **ランタイム品質ゲート**: 姉妹仕様は「人手で合否判定」する前提だった。ランタイム自動生成でスタイル逸脱・顔描写等の不良品を公開に出さない担保（自動検証／リトライ／不合格時フォールバック）をどう置くか。**最大の未解決点**。
2. **後処理の Node 化**: `postprocess.py`（輝度→アルファ・影カット・bbox クロップ・256×256・下端接地）を `sharp` 等で再現できるか。
3. **保存方式**: Firebase Storage 新規導入 vs Firestore ドキュメント埋め込み（256×256 アルファ PNG は小さいが、rules・公開読み取り・サイズを比較）。
4. **性別の値域と生成反映**: LGBT を含む多様な性のあり方をどう表現し、二元前提の prompt-builder/参照画像へどう反映するか。
5. **コスト・遅延**: 1トピック N ペルソナ分の画像生成コスト・所要時間と、同期/非同期の選択。
6. **姉妹仕様との棲み分け**: オフラインのカタログ/ツールを「フォールバック資産・参照画像・スタイル基準」としてどう再利用するか。

## Document Status

- gap-analysis.md フレームワークに従い、Grep/Read で既存コードを調査して作成（Web 調査は不要と判断）。
- 要件は**未承認**のまま分析（承認前でも設計判断・要件見直しに資するため実施）。

## Next Steps

- 本分析を踏まえ、要件を最終確認・承認 → `/kiro:spec-design persona-avatar-generation` で技術設計へ。
- 設計では特に **Research Needed 1（品質ゲート）** と **Option C の段階導入**を主要論点にすることを推奨。
