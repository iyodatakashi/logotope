# Research & Design Decisions

## Summary
- **Feature**: `fact-check-correction-worthiness`
- **Discovery Scope**: Extension（既存 fact-check パイプラインへの1段追加）
- **Key Findings**:
  - [checkTurn](functions/src/pipeline/fact-check/fact-check-runner.ts#L110) が後追い `checkChapter` と将来の inline 補正の**唯一の合流点**。`return`（L174）直前に判定段を挿入すれば、要件1.4「共通フィルタ」が配置のみで成立する。
  - 判定に必要な討論文脈は既存 [FactCheckContext](functions/src/pipeline/fact-check/fact-check-runner.ts#L30) をそのまま再利用でき、`turn.content` と確定済み findings も `checkTurn` 内に揃っている。新規配管はモデル定数1つ（`factCheckJudge`）と判定関数1本のみ。
  - 記録は案1（破棄＋ログ＋構造化返却）を採用し、`FactCheckFinding` 型・FE・repository を不変に保つ。これにより回帰範囲が runner＋新規 judge＋テストに限定される。

## Research Log

### 判定段の配置（共通フィルタの実現方法）
- **Context**: 要件1.4「finding を消費する全経路がフィルタ済みを受け取る」を、過度な共通化（中央ディスパッチャ）を避けつつ実現する必要がある（structure.md）。
- **Sources Consulted**: [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts)（`checkTurn` L110-186 / `checkChapter` L196-237）、[api/fact-check.ts](functions/src/api/fact-check.ts)（後追い経路）、inline-speech-fact-check-correction の gap-analysis。
- **Findings**:
  - `checkChapter` は章内の全発言を `checkTurn` で回すだけ（L225-235）。`checkTurn` の戻り値をフィルタ済みにすれば後追いは無変更で恩恵を受ける。
  - inline 補正（将来）も draft 検証で同じ判定を使う想定。判定関数を `DebateTurn` 非依存（`content + findings + context`）にすればドラフト（id 未確定）にも適用できる。
- **Implications**: 判定は「パイプライン1段」として `checkTurn` 内に置く。ディスパッチャ化しない。判定関数の入力は `DebateTurn` ではなく `content/findings/context`。

### 判定モデルの選択
- **Context**: 判定に使う LLM をどう供給するか。
- **Sources Consulted**: [PIPELINE_MODELS](functions/src/constants/ai.constants.ts#L6)、[getPipelineModel](functions/src/llm/models.ts#L35)（`factCheckGrounding`/`factCheckStructuring` の case L60-68）。
- **Findings**: `getPipelineModel` は Gemini provider を `GEMINI_API_KEY` で供給し、未設定時は claude へフォールバック。後追い（runFactCheckTask）も inline（runStep）も当該 secret を保持。
- **Implications**: `PIPELINE_MODELS.factCheckJudge`（gemini-2.5-flash 相当）を追加し、`getPipelineModel` の case に `factCheckJudge` を `factCheckStructuring` と同列で足す。構造化フェーズ（flash）と同等のモデルで足りる見込み。

### 既存ガードとの順序
- **Context**: 判定はどの段階の finding を入力にするか。
- **Findings**: post-processing（[L153-172](functions/src/pipeline/fact-check/fact-check-runner.ts#L153)）が引用照合（`turn.content.includes(f.claim)`）・出典写像・unverifiable 格上げを行い finding を確定する。
- **Implications**: 判定はこの確定済み finding を入力にする（post-processing の後段）。判定と finding の突合は配列インデックスで行う（引用照合の前例と整合）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: runner 直書き | `checkTurn` 内に判定関数とプロンプトを同居 | 新規ファイルなし・最短 | runner 肥大（Phase1/2＋post-processing で既に長い） | 動くが責務過多 |
| B: judge 別ファイル（採用） | `fact-check-judge.ts` に判定を分離、`checkTurn` から呼ぶ | 責務分離・単体テスト容易・inline 再利用余地 | 新規ファイル＋配線 | structure.md の「真に共通な処理のヘルパー化」に合致 |
| C: 消費者側に判定 | checkChapter/inline 各々に実装 | — | 要件1.4 違反・二重化 | 非推奨 |

## Design Decisions

### Decision: 判定段を checkTurn 内・judge 別ファイルに配置
- **Context**: 要件1.4（共通フィルタ）と structure.md（ディスパッチャ禁止）の両立。
- **Alternatives Considered**: A（runner 直書き）／B（別ファイル）／C（消費者側）。
- **Selected Approach**: B。`pipeline/fact-check/fact-check-judge.ts` に `judgeCorrectionWorthiness(content, findings, context)` を実装し、`checkTurn` の `return` 直前で呼んでフィルタ済み findings を返す。
- **Rationale**: 検出（runner）と修正適否（judge）の責務が分離し、評価ケースを judge 単体で回せる。inline がドラフトに同判定を使う将来にも `DebateTurn` 非依存で再利用できる。
- **Trade-offs**: 新規ファイル＋配線が増えるが、回帰範囲は限定され保守性が上がる。
- **Follow-up**: judge を `checkTurn` 以外から呼ばない（共通フィルタの単一性を保つ）。

### Decision: 対象外 finding は破棄＋ログ（案1、型不変）
- **Context**: 要件6.2/7 の「未判定・除外理由の記録」をどの水準で満たすか。
- **Alternatives Considered**: 案1（破棄＋ログ＋構造化返却でテスト検証、型不変）／案2（finding 型にフラグを足して永続、FE 波及）。
- **Selected Approach**: 案1。judge は採用 finding のみを `kept` として返し、全 finding の判定（decision＋reason）を構造化して返す。除外分・未判定分は `console` ログに出す。`FactCheckFinding` 型・FE・repository は不変。
- **Rationale**: 表示変更は out of scope。要件7.2（評価可能な単位の判定結果）は judge の構造化返り値＋単体テストで満たせる。永続が必要になれば後続スコープで案2に拡張可能。
- **Trade-offs**: 管理画面では「なぜ消えたか」が見えない（ログのみ）。評価・監査はテスト/ログに依存。
- **Follow-up**: 案2が要るとなった時点で `FactCheckFinding` 拡張と表示出し分けを別途設計。

### Decision: 判定失敗はフェイルオープン（finding 温存）
- **Context**: 要件6.1/6.3。判定の不安定さが検出済み finding を失わせてはならない。
- **Selected Approach**: judge 内部で `try/catch`。判定 LLM 失敗・タイムアウト・出力不整合（index 不一致等）時は、入力 findings を全件 `kept` として返し、各 finding を `decision: 'unjudged'` としてログ。
- **Rationale**: 検出（Phase1/2）の失敗系統と独立させ、フィルタ失敗は「素通し」に倒す（見逃しより過検出を許容＝要件5.3と同方向）。
- **Trade-offs**: 失敗時は過検出が表示に残るが、検証の信頼性（見逃さない）を優先。

### Decision: 保守的デフォルト（uncertain は残す）
- **Context**: 要件5.3「不確実なら残す」。
- **Selected Approach**: judge の出力 decision を `correct | skip | uncertain` とし、`skip` のみ除外。`correct`/`uncertain`/`unjudged` は残す。
- **Rationale**: 過検出抑制と見逃し防止のバランスを「除外は確信があるときだけ」に倒す。
- **Trade-offs**: 過検出が一部残るが、評価セットの「修正すべき」ケースを守れる。

### Decision: プロンプト品質は実 LLM 評価ハーネスで確認
- **Context**: 単体テストは steering 方針で LLM をモックするため、プロンプトが過検出（問いの前提・当為/提案）を実際に skip できるかは検証できない。
- **Selected Approach**: 任意実行・CI 非対象の評価ハーネス（`*.eval.test.ts`、専用 vitest project `eval`）を追加。実 Gemini を呼び、評価フィクスチャ（過検出5件＝skip 期待・回帰2件＝correct 期待）に対する判定が期待どおりかを `it.each` で検証＋判定理由をログ。`RUN_JUDGE_EVAL=1` かつ `GEMINI_API_KEY` のときのみ実行（`pnpm --prefix functions eval:judge`）。
- **Rationale**: 非決定的・有料な実 LLM 呼び出しを通常 CI から隔離しつつ、プロンプト調整時に汎化を実測できる。失敗は「そのケースで分類を外した」シグナル。
- **Trade-offs**: 実行は手動・結果は非決定的。回帰の自動防御は引き続きモック単体テストが担う。

## Risks & Mitigations
- プロンプトの汎化が不十分だと過検出が残る / 過剰除去で見逃す — 要件2.6（事例非埋め込み）・5.3（保守的デフォルト）を軸に、評価セット（過検出5件＋回帰）の両側を単体テストで固定。
- `checkChapter` 再試行で判定が再走し結果が揺れる — 既存 `resetFactCheckProgress` が部分追記をクリアするため整合は保たれる。
- judge 失敗で finding を失う — フェイルオープン（全件温存）で回避。
- コスト増 — finding を持つ発言のみ +1 LLM 呼び出し。finding 0 件は judge 非起動（要件1.3）。

## References
- [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) — 挿入対象（checkTurn / checkChapter）
- [fact-check.types.ts](functions/src/types/fact-check.types.ts) — finding 契約（不変方針）
- [ai.constants.ts](functions/src/constants/ai.constants.ts) / [models.ts](functions/src/llm/models.ts) — モデル定数・選択
- `.kiro/specs/fact-check-validity-improvement/` — 上流検出（断定性抑制）の既存スペック
- `.kiro/specs/inline-speech-fact-check-correction/` — 下流消費者（補正ゲート、保留中）
