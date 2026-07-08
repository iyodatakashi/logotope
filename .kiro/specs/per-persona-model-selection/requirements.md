# Requirements Document

## Project Description (Input)
ペルソナごとにモデルを使い分ける仕組みは必要か検討したい

## Introduction

検討の結果、次の方針を確定した。

1. **ペルソナ別モデル使い分けの撤去**: ペルソナごとにモデルを使い分ける仕組み（`llmType`）は撤去し、全ペルソナを Claude Sonnet に一本化する。
2. **ペルソナ生成タスクの Claude 化**: 従来 GPT（`gpt-5.5`）で行っていたペルソナ生成タスク（`personaGenerator`）も Claude Sonnet に寄せ、ペルソナ関連経路から OpenAI 依存を撤廃する。
3. **モデルの最新化**: プロジェクトで使用する Claude Sonnet を旧世代の `claude-sonnet-4-6` から最新の `claude-sonnet-5`（Claude Sonnet 5）へ更新する。ペルソナ経路だけでなく、Claude Sonnet を使う全エージェント（ファシリテーター・章編集・整形・イントロ/アウトロ・ダイジェスト等）に一律適用する。

判断根拠は、既存のペルソナ別機構が事実上形骸化していたことにある。各ペルソナは `llmType`（`'gemini' | 'claude' | 'gpt'`）を持つが、`PERSONA_MODELS` では `gemini` も `claude` も同一の `claude-sonnet-4-6` に解決され、実際に分岐するのは `gpt`（`gpt-5.5`）のみだった。さらに `gpt` ペルソナは所感生成にフォールバックが無く、OpenAI のクォータ超過時に恒常的なハード失敗を起こしていた。見かけ 3 種・実体 2 種の選択肢は討論の価値である「多様な立場の可視化」に寄与しておらず、複数プロバイダ運用（API キー・system プロンプト分岐・フォールバック）の保守コストと障害リスクだけを持ち込んでいた。ペルソナ生成の品質面でも、GPT でなければならない技術的必然性は無く、日本語の命名・多様性の観点では Claude で遜色ない。

本仕様はこの方針に沿って、ペルソナ人格ごとのモデル使い分け機構を一貫撤去し、ペルソナ関連の全生成経路を最新 Claude Sonnet に統一する。一方、fact-check・取材・ステークホルダー分析など「処理タスク単位で Gemini を使う必然性がある箇所」（`PIPELINE_MODELS` の Gemini 系）は本仕様の対象外とし、引き続き現行モデルを使用する。

## Boundary Context

- **In scope**:
  - ペルソナ人格ごとのモデル使い分け機構（`llmType` フィールド、`PERSONA_MODELS`、`getPersonaModel`、`buildPersonaSystem` のプロバイダ分岐、ペルソナ生成時の `llmType` 付与）の撤去
  - 全ペルソナ生成経路（発言・所感など）を Claude Sonnet に統一
  - ペルソナ生成タスク（`personaGenerator`）を GPT から Claude Sonnet へ変更
  - Claude Sonnet を使う全エージェントのモデル ID を `claude-sonnet-4-6` から `claude-sonnet-5` へ更新
- **Out of scope**:
  - `PIPELINE_MODELS` のうち Gemini を使うタスク（fact-check・取材・ステークホルダー分析など）のモデル選定。Gemini を使う必然性のある箇所は現状維持とする
  - Opus（`claude-opus-4-8`）は既に最新のため変更しない
  - 新規プロバイダ追加・プロンプトチューニング・生成品質改善の中身
- **Adjacent expectations**:
  - `llmType` 撤去と `personaGenerator` の Claude 化により、ペルソナ関連経路からは `OPENAI_API_KEY` が不要になる（他に GPT を使う箇所が残らないこと）
  - Gemini パイプライン処理は本変更の影響を受けない
  - モデル更新（Sonnet 4.6 → 5）はトークン数・コスト特性が変わりうるため、既存の AI SDK 経路で問題なく動作することを確認する

## Requirements

### Requirement 1: ペルソナモデルの最新 Claude Sonnet 一本化
**Objective:** 開発判断者として、全ペルソナを単一の最新 Claude Sonnet モデルで生成したい。形骸化した使い分けを廃し、挙動を単純で予測可能にするためである。

#### Acceptance Criteria
1. The ペルソナ生成経路 shall 全ペルソナを Claude Sonnet 5（`claude-sonnet-5`）で生成する。
2. When ペルソナ発言（`generatePersonaTurn`）を生成する場合, the ペルソナ生成経路 shall Claude Sonnet 5 を使用する。
3. When ペルソナ所感（`generateImpression`）を生成する場合, the ペルソナ生成経路 shall Claude Sonnet 5 を使用する。
4. The ペルソナ生成経路 shall ペルソナ単位でのモデル分岐を行わない。

### Requirement 2: 使い分け機構の一貫した撤去
**Objective:** 保守者として、形骸化した使い分け機構を関連箇所からまとめて除去したい。撤去漏れや見かけ上の互換維持による混乱を避けるためである。

#### Acceptance Criteria
1. The 変更 shall ペルソナ型から `llmType` フィールドを除去する。
2. The 変更 shall `PERSONA_MODELS`・`getPersonaModel`・`buildPersonaSystem` のプロバイダ分岐など、ペルソナ人格ごとのモデル使い分けに関わる分岐を除去する。
3. When ペルソナを生成する（`persona-generator-agent`）場合, the ペルソナ生成 shall `llmType` を付与しない。
4. If `llmType` を参照する箇所が残っている場合, then the 変更 shall 再エクスポート等での見かけ上の互換維持を行わず、参照側を直接書き換えて除去する。
5. Where 既存の永続ペルソナデータに `llmType` が残っている場合, the ペルソナ生成経路 shall 当該フィールドの有無にかかわらず Claude Sonnet で生成し、エラーとしない。

### Requirement 3: 単一プロバイダ化後の失敗時挙動
**Objective:** 運用者として、単一モデル化に伴い不要になったフォールバック分岐を整理しつつ、生成失敗時の挙動を破綻させないようにしたい。ペルソナごとにクォータ超過でハード失敗する事象を根絶するためである。

#### Acceptance Criteria
1. The ペルソナ生成経路 shall 別プロバイダ（OpenAI 等）へのペルソナ単位分岐を持たないため、当該プロバイダのクォータ超過に起因するペルソナ生成の恒常的失敗を発生させない。
2. When 単一プロバイダ化により Claude へのフォールバック分岐が自明に不要となる場合, the 変更 shall 冗長なフォールバック分岐を整理する。
3. If Claude API 呼び出しが一時的に失敗した場合, then the ペルソナ生成経路 shall 既存のリトライ方針に従って処理し、恒久エラーは呼び出し側へ明示的に返す。

### Requirement 4: ペルソナ生成タスクの Claude 化と OpenAI 依存の撤廃
**Objective:** 保守者として、ペルソナ生成タスクを Claude Sonnet に寄せ、ペルソナ関連経路の OpenAI 依存を断ちたい。impression と同種のクォータ起因失敗の火種を無くすためである。

#### Acceptance Criteria
1. When ペルソナを生成する（`generatePersonas`）場合, the ペルソナ生成タスク shall Claude Sonnet 5 を使用する。
2. The 変更 shall `PIPELINE_MODELS.personaGenerator` の GPT（`gpt-5.5`）指定を Claude Sonnet 5 へ置き換える。
3. Where ペルソナ関連経路に他の OpenAI 依存が残っていない場合, the 変更 shall 当該経路が `OPENAI_API_KEY` に依存しない状態にする。

### Requirement 5: Claude モデルの最新化
**Objective:** 保守者として、プロジェクトで使用する Claude Sonnet を最新世代へ更新したい。旧世代モデルの惰性利用を解消するためである。

#### Acceptance Criteria
1. The 変更 shall Claude Sonnet のモデル ID を `claude-sonnet-4-6` から `claude-sonnet-5` へ更新する。
2. The 変更 shall Claude Sonnet を使用する全エージェント（ファシリテーター・章編集・整形・イントロ/アウトロ・ダイジェスト等）に更新後のモデルを一律適用する。
3. The 変更 shall Opus（`claude-opus-4-8`）および Gemini 系パイプラインモデルの ID を変更しない。
4. When 更新後のモデルで各生成経路を実行する場合, the 各生成経路 shall 既存の AI SDK 呼び出し経路のまま正常に生成を完了する。

### Requirement 6: パイプライン Gemini モデルの現状維持
**Objective:** 保守者として、Gemini を使う必然性のあるパイプライン処理には手を入れず現状を維持したい。変更の影響範囲を限定するためである。

#### Acceptance Criteria
1. The 変更 shall `PIPELINE_MODELS` のうち Gemini を使うタスク（fact-check・取材・ステークホルダー分析など）のモデル選定を変更しない。
2. Where Gemini を使う必然性のある処理, the パイプライン処理 shall 引き続き現行の Gemini モデルを使用する。
