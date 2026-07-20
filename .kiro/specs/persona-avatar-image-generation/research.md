# Research & Design Decisions

## Summary
- **Feature**: `persona-avatar-image-generation`
- **Discovery Scope**: Extension（フロント表示の小改修）＋ Feasibility Spike（画像生成の実現可能性検証）
- **Key Findings**:
  - 生成モデルは **Gemini 2.5 Flash Image（"Nano Banana"）** を Firebase AI Logic 経由で利用する。PNG 出力・固定 1024px・1:1 対応・**参照画像を最大3枚**渡してスタイル固定が可能。日本語プロンプト対応。
  - Gemini 画像モデルは**透過（アルファ）出力を仕様として保証しない**。よって「白背景で生成 → 後処理で輝度→アルファ変換」を前提化する。全出力に不可視の **SynthID** 透かしが入る。
  - 既存 [PersonaAvatar.svelte](src/lib/sharedComponents/PersonaAvatar.svelte) は白背景の不透明PNGを luminance マスク＋`mix-blend-mode: multiply` で着色している。**multiply がシルエット色と背景色を乗算的に結合**するため2色を独立指定できない。これが「白黒画像だと都合が悪い」の実体。

## Research Log

### Gemini 画像生成モデルの能力（Firebase AI Logic）
- **Context**: フィジビリの生成手段（Requirement 3）と、狙ったスタイル／バリエーションを指示で制御できるかの前提確認。
- **Sources Consulted**:
  - [Generate & edit images using Gemini (Nano Banana) | Firebase AI Logic](https://firebase.google.com/docs/ai-logic/generate-images-gemini)
  - [Learn about supported models | Firebase AI Logic](https://firebase.google.com/docs/ai-logic/models)
  - [Introducing Gemini 2.5 Flash Image | Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- **Findings**:
  - 出力は PNG、解像度は 1K（1024）固定。アスペクト比は 1:1 を含む多数から選択可（アバターは 1:1 を採用）。
  - テキスト＋画像プロンプトに対応。**参照画像を最大3枚**渡してスタイル・構図を寄せられる（既存サンプルをスタイルアンカーに使える）。
  - 会話的編集（生成物への追指示）に強く、バリエーション出し分け・微修正に向く。
  - 生成物には不可視の SynthID 透かしが入る（内部利用のアバターでは実害なし）。
- **Implications**:
  - スタイル固定は「テキスト規範＋既存サンプルの参照画像」で担保する方針が取れる。
  - 透過は保証されないため、アセット化には後処理（輝度→アルファ）が必須。生成段は白背景・黒基調に統一する。

### 2色独立着色を成立させる描画方式
- **Context**: Requirement 5（背景色・シルエット色の独立指定、縁で混ざらない）を満たす描画とアセット形態の決定。
- **Sources Consulted**: 既存 [PersonaAvatar.svelte](src/lib/sharedComponents/PersonaAvatar.svelte)、CSS Masking（`mask-mode`, `mask-image`）。
- **Findings**:
  - 現行は `mask: subtract(#fff, luminance(src))` で黒被写体を抜き、`background-color` を `mix-blend-mode: multiply` で乗せている。multiply は背後（コンテナ背景）と乗算合成されるため、背景色を変えるとシルエット色も連動して濁る。
  - シルエットを「**アルファをマスクにした単色塗り**」、背景を「**コンテナの背景色**」に分離すれば、両者は独立し、アルファ合成（silhouette over background）となり縁も濁らない。
  - この方式は「被写体=不透明、顔の内側と外側背景=透明」の**アルファ透過PNG**を正とすると最も単純・堅牢になる（輝度→アルファを後処理で焼き込む）。
- **Implications**:
  - アセットの正規形を「アルファ透過PNG（輝度→アルファ、色は持たない＝実質モノクロのマスク画像）」に決定。
  - 表示側は `mask-mode: alpha` の単色塗り＋コンテナ背景色に作り替え、`mix-blend-mode: multiply` を撤去する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 生成物（不透明PNG）をそのまま資産化し表示側で輝度マスク | 後処理なし | パイプライン最小 | アセットが自己記述的でない／輝度マスクの癖を全消費者が継承／2色独立には multiply 撤去等の工夫が必要 | 現行の延長 |
| B.（採用）生成→後処理で輝度→アルファ透過PNGに焼き込み、表示は alpha マスク単色塗り＋背景色 | 資産をアルファ透過に正規化 | 2色独立が自明・堅牢／アセットがどの描画方式でも使える／縁が濁らない | 後処理1段が増える | Req 5 の要求に直接適合 |
| C. モデルに透過出力を直接生成させる | 透過をモデル任せ | 後処理不要（理想時） | Gemini は透過を保証せず不安定 | 当てにしない（フォールバックで後処理必須） |

## Design Decisions

### Decision: 生成は「テキスト規範＋参照画像」で統制したオフライン・バッチとする
- **Context**: バリエーションを AI 任せにせず指示で出し分ける（Req 2.2）／狙ったスタイルの再現性を測る（Req 3.4）。かつ本番ランタイム依存にしない。
- **Alternatives Considered**:
  1. ランタイム動的生成 — 討論実行時にオンデマンド生成
  2. オフライン・バッチ生成（事前準備）— 変数を指定して一括生成し、人手で選別
- **Selected Approach**: 2 を採用。バリエーション軸（年齢帯・性別・髪型・アングル・ポーズ・服装・メガネ）を構造化した「バリエーション仕様」から、規範プロンプト＋既存サンプル参照画像を組み立ててバッチ生成する。生成物は人手で受け入れ判定し、合格のみ資産化。
- **Rationale**: 事前準備なので本番に生成依存を持ち込まない。指示駆動で軸を制御でき、再現性（合格率）も測れる。
- **Trade-offs**: 全マトリクスの量産は別フェーズ。本スペックは各軸を代表する少数の組合せで実現可能性を示すに留める。
- **Follow-up**: 実装時に生成 SDK（Firebase AI Logic クライアント／Google GenAI）を1つ確定。

### Decision: アセット正規形＝アルファ透過PNG（輝度→アルファ）、表示は2色独立
- **Context**: Req 5（背景色・シルエット色の独立指定）。現行 multiply が2色を結合してしまう。
- **Selected Approach**: 後処理で「白背景・黒被写体」を「輝度→アルファ（黒=不透明, 白=透明, 中間=半透明）」のモノクロRGBA PNGへ変換。表示は `mask-mode: alpha` でシルエット色を塗り、背景色はコンテナ背景で敷く。
- **Rationale**: 2色が完全独立、アルファ合成で縁が濁らない、資産が描画方式非依存。
- **Trade-offs**: 後処理1段が必要。既存20枚の資産は移行任意（本スペックは新方式の成立確認が主目的）。
- **Follow-up**: 後処理は輝度→アルファ＋正方トリミング＋1:1 リサイズ。ツールは実装時に確定（ImageMagick 等の一括処理を想定）。

## Risks & Mitigations
- **スタイルの非決定性**（同一プロンプトでも顔が描かれる等の逸脱）— 参照画像でアンカーし、受け入れチェックリストで機械的に不合格化。合格率を記録し閾値で Go/No-Go 判断。
- **透過が得られない**— 生成は白背景固定とし、透過はモデルに求めず後処理で確定的に生成。
- **半透明エッジの色濁り**— アルファ合成（単色 over 背景色）に一本化し、`mix-blend-mode` を使わない。
- **SynthID 透かし**— 内部用アバターのため許容。第三者配布時のみ留意。

## References
- [Generate & edit images using Gemini (Nano Banana) | Firebase AI Logic](https://firebase.google.com/docs/ai-logic/generate-images-gemini) — モデル能力・入出力仕様
- [Supported models | Firebase AI Logic](https://firebase.google.com/docs/ai-logic/models) — 解像度・アスペクト比・参照画像枚数
- [Introducing Gemini 2.5 Flash Image | Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/) — Nano Banana 概要・SynthID
