# Research & Design Decisions: persona-avatar-generation

## Summary
- **Feature**: persona-avatar-generation
- **Discovery Scope**: Complex Integration（既存ペルソナ生成パイプライン＋公開射影の拡張 ＋ ランタイム画像生成という新規能力）
- **Key Findings**:
  - ペルソナ生成は Cloud Task 自己連鎖（stakeholders→personas→per-persona interview）。**アバター生成は interview と同型の per-persona ステージ**が自然な挿入点（[persona-chain.ts](../../../functions/src/pipeline/personas/persona-chain.ts)）。
  - 画像モデル呼び出しは [gemini-image-client.ts](../../../scripts/avatar-generation/gemini-image-client.ts) が `@ai-sdk/google` で実装済み → functions へ移植可能。ただし旧 `gemini-2.5-flash-image` は 2026-10-02 停止予定のため **`gemini-3.1-flash-image` へ移行**する。
  - 後処理は Python PIL（[postprocess.py](../../../scripts/avatar-generation/postprocess.py)）。ランタイムでは Node（`sharp`）へ移植が必要。保存先（Firebase Storage）は未整備。
  - 公開表示は話者名/肩書を要素ごとに焼き込む非正規化（[published-article.ts](../../../src/lib/models/published/published-article/published-article.ts)）。正規化（speakerId＋話者マップ）に作り替える。

## Research Log

### 画像生成モデルの選定（2026年7月時点）
- **Context**: R2 のランタイム AI 生成に使うモデルの可用性・寿命・適性。
- **Sources Consulted**: [Gemini 3.1 Flash Image](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image)、[Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation)、[Gemini 3.1 Flash Image (Google Cloud)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image)、[Release notes](https://ai.google.dev/gemini-api/docs/changelog)、[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)。
- **Findings**:
  - 既存オフラインツールが使う `gemini-2.5-flash-image` は **2026-10-02 停止予定**。
  - 現行の画像生成系は `gemini-3.1-flash-image`（Nano Banana 2・2026-02-26 リリース・4K 対応・汎用主力）、`gemini-3-pro-image`（高品質・高コスト）、`gemini-3.1-flash-lite-image`（低レイテンシ・低コスト）。
  - `-preview` 付き（`gemini-3.1-flash-image-preview` 等）は **2026-06-25 に停止済み**。安定版は接尾辞なし。
- **Implications**: **`gemini-3.1-flash-image` を採用**する。本用途は無地背景・顔なしのシルエットを 256×256 のアルファマスクへ落とすため、Pro の world knowledge やブランド整合性は不要で 4K も過剰。Lite は品質の下振れが読めないため基準線には採らない。モデル ID は定数として1箇所に集約する。

### 後処理の Node 移植
- **Context**: `postprocess.py`（輝度→アルファ・影カット・bbox クロップ・256×256・下端接地）を functions(Node) で再現。
- **Findings**: `sharp` が grayscale・閾値・trim（bbox）・resize・extend（パディング）・アルファ合成を提供し、`postprocess.py` の各段を再現可能。RGB=黒＋アルファのみの出力も作れる。
- **Implications**: 後処理は Node アダプタとして TS へ移植する（functions は Node ランタイムで Python が動かない）。`scripts/avatar-generation/` は TS 6ファイル＋`postprocess.py` 1つのみで、かつ .py はどの .ts からも呼ばれない手動実行スクリプト → TS 化は二重実装ではなく統一。**`postprocess.py` はリファレンス仕様として残し**、`candidates/` の既存 PNG を使ったピクセル比較のゴールデンテストで移植の等価性を担保する（定数のドリフトは全アバターの見た目を変えるため）。

### 保存方式（生成画像の置き場所）
- **Context**: 生成した per-persona アルファ PNG の保存先。アプリに Firebase Storage 利用は皆無。
- **Findings**: 選択肢は (a) Firebase Storage に公開読み取りで置き URL を永続、(b) Firestore ドキュメントに base64 埋め込み。256×256 アルファ PNG は数〜数十 KB。
- **Implications**: 画像はオブジェクトストレージが適切（ドキュメント肥大回避・`mask-image` に URL 使用可）。**Storage 採用**を推奨（Design Decision 参照）。

### 公開射影の非正規化
- **Context**: R5 の「話者情報を冗長に重複させない」。
- **Findings**: 現状 `resolveSpeaker` が `speakerName`/`speakerRole` を毎ターンに、`personaName` を気づきごとに焼き込む。所感も name/role を焼き込む（personaId は保持済み）。
- **Implications**: `PublishedArticle` に話者マップ（`speakerId → {name, role, avatarUrl, colorKey}`）を1回だけ持ち、ターン・気づき・所感は `speakerId` 参照に統一。既存4消費コンポーネントの改修を伴う。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 全部インライン | `runPersonasStage` で gender・カラー・画像生成・後処理・保存まで実行 | 新規最小 | 重い/失敗しやすい画像生成を同期化し段を脆く（30分上限・巻き添え） | 非推奨 |
| B: 全部独立サービス | gender/カラーも含め独立ステージ化 | 分離徹底 | 決定的で軽い処理まで分離し過剰 | 過剰 |
| C: ハイブリッド（採用） | 軽量・決定的（配色）はペルソナ生成に載せ、画像生成は per-persona ステップ（interview 同型・core 共有）＋失敗時フォールバック。公開射影の正規化は**本 spec の第1段として先に実施** | 性質ごとに分離。捨てる形の上に新機能を積まない。回帰の切り分けが容易 | 計画調整 | steering の「配管はメインロジックの後ろ」「過度な共通化をしない」と整合 |

## Design Decisions

### Decision: 画像生成を per-persona 非同期ステージに切り出す
- **Context**: 画像生成は遅く・課金・失敗し得る。ペルソナ生成の critical path（stakeholders→personas→interview）を汚さない。
- **Alternatives Considered**: 1) `runPersonasStage` にインライン、2) interview ステージに相乗り、3) 独立ステージ。
- **Selected Approach**: `stepKind: 'avatar'` を追加し、`runPersonasStage` 後に per-persona で enqueue（interview と並列）。終端ステップで phase 完了を gate しない（アバターは装飾・フォールバック有）。
- **Rationale**: interview と同じ自己連鎖パターンで実装が素直。失敗が phase 完了・討論に波及しない。
- **Trade-offs**: ステップ種別が増える ↔ 失敗隔離・リトライ・部分完了が自然。
- **Follow-up**: リトライ回数・タイムアウト、失敗時に avatar 未設定のまま完了させる挙動の確認。

### Decision: カラーは persona 生成時に決定的割り当て、濃淡は表示側
- **Context**: R3/R4。色相分散は topic のペルソナ集合が必要。安定・重複回避。
- **Selected Approach**: `runPersonasStage`（全ペルソナ既知・batch）で、24系統（色相環順）から `sortOrder` を基に均等分散した系統を重複なく割り当て（N>24 は循環）、`colorKey`（系統名のみ）を永続。表示側が `colorKey → --{系統}-600 / --{系統}-100-transparent` を解決。
- **Rationale**: 生成時1回で確定＝安定（並べ替え・追加で不変）。濃淡は表示側なので後からデザイン調整可能。
- **Trade-offs**: 追加ペルソナ時の再分散はしない（作り直しは regeneration で全体再生成）。

### Decision: 生成画像は Firebase Storage に保存、persona は URL を持つ
- **Context**: 画像の保存先が無い。公開表示は URL で `mask-image` に使う。
- **Alternatives Considered**: Firestore 埋め込み base64 vs Firebase Storage。
- **Selected Approach**: Firebase Storage（公開読み取り可能なパス）に置き、`avatarUrl` を persona に永続。
- **Rationale**: ドキュメントを肥大させない。画像はオブジェクトストレージが適切。`mask-image: url(...)` で利用可。
- **Trade-offs**: Storage 新規導入・rules 設定が要る ↔ ドキュメント軽量・配信素直。
- **Follow-up**: Storage セキュリティルール（公開読み取り）とパス設計、既存 `firebase-public` 読み取り経路との整合。

### Decision: 性自認と外見表現を2軸に分ける
- **Context**: R1。男女二元に強制せず（Req 1.2）、かつ生成入力は決定的である必要がある（Req 1.4）。さらにアバターは「どう見えるか」を描くものである。
- **Alternatives Considered**:
  1. 自由記述1フィールド — 表現の自由度は最大だが決定性が崩れる。
  2. 性自認1フィールド（3値）— 決定的だが、**性自認と外見が一致しない場合に破綻**する（例「男性の格好をしているが性自認は女性」を女性的な姿で描いてしまう）。
  3. 性自認＋外見表現の2軸（採用）。
- **Selected Approach**: `gender: 'male' | 'female' | 'non-binary'`（性自認）と `genderPresentation: 'masculine' | 'feminine' | 'androgynous'`（外見表現）を分けて永続。**アバター生成入力に使うのは `genderPresentation` のみ**。原則は一致させ、乖離はペルソナの背景が要する場合のみ。
- **Rationale**: 両者は消費者が異なる（性自認→立場・信念・背景／外見表現→画像生成）。1フィールドに畳むと、カミングアウト前の人などを実際と異なる姿で描き、マイノリティの声を正確に扱うという製品価値に反する。用語の精度として、LGBT のうち gender が扱うのは T と non-binary であり、L/G/B は性的指向で別軸（アバター生成にも不要）。トランスジェンダーは別値にせず性自認そのものを値とする（トランス女性は `gender: 'female'`）。
- **Trade-offs**: フィールドが1つ増える代わりに、実在のあり方を正しく表現でき、決定性も保てる。「その他」の catch-all は周縁化を避けるため置かない。
- **Follow-up**: 生成プロンプトで `androgynous` を安定に表現できるかを試験生成で確認する。

## Risks & Mitigations
- **画像品質の非決定性（人手レビュー無し）** — スタイル逸脱・顔描写等の不良品が公開に出る恐れ。緩和: 生成プロンプトを姉妹仕様の規範プロンプトに固定＋参照画像アンカー、（可能なら）簡易自動検証、不合格/失敗時は既存サンプルへフォールバック。**最大リスク**。
- **モデル差し替えによるスタイル再現性の変化** — 姉妹仕様の規範プロンプト・参照画像・既存アセットは `gemini-2.5-flash-image` 前提で作られた。`gemini-3.1-flash-image` で同じスタイルが再現できるかは未検証。緩和: 実装の先頭で代表バリエーションの試験生成を行い、必要ならプロンプトを調整する。
- **コスト・遅延** — 非同期ステージ化で UX 影響を回避。1トピック数百円未満の想定。
- **公開射影の作り替え** — 既存 `PublishedTurn` 等と4消費コンポーネントに影響。speakerId 正規化を1変更として束ね、既存表示の回帰を確認。

## References
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — 画像生成コスト・トークン
- [Gemini 3.1 Flash Image](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) — 採用モデルの仕様
- [Gemini API Release notes](https://ai.google.dev/gemini-api/docs/changelog) — preview 版の停止時期
- [Gemini pricing 2026 (CloudZero)](https://www.cloudzero.com/blog/gemini-pricing/) — 2026 の価格・後継モデル状況
