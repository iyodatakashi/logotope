# Implementation Plan

> ロールアウトは設計の Migration Strategy に沿い、タスク1〜3（機構撤去＋Sonnet5化＋thinking無効）を先行デプロイ・スモーク検証してから、タスク4（OpenAI依存撤廃）へ進む。各タスクはビルドが壊れない順に並ぶ（呼び出し側を先に共有モデルへ移し、最後に旧解決層を撤去）。

- [x] 1. 定数更新と共有 Sonnet モデルの整備
- [x] 1.1 Claude Sonnet を最新化し、thinking 無効を注入した共有 Sonnet モデルを追加する
  - `AI_MODELS.SONNET` を `claude-sonnet-5` へ更新する。`AI_MODELS.OPUS` と Gemini 系のモデル ID は変更しない。
  - `wrapLanguageModel` と `defaultSettingsMiddleware` を用い、`providerOptions.anthropic.thinking = { type: 'disabled' }` を注入した共有 Sonnet モデルを解決層からエクスポートする（4.6 挙動＝thinking オフを維持）。
  - この段階では既存の `getPersonaModel` 等は残し、追加的変更としてビルドを壊さない。
  - 観察可能な完了条件: functions のビルドが通り、共有 Sonnet モデルがエクスポートされ、既存経路も従来どおり動作する。
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 2. 生成経路を共有 Sonnet モデルへ切替
- [x] 2.1 (P) Sonnet 利用エージェントを共有 Sonnet モデルへ置換する
  - ファシリテーター・章編集・整形・イントロ/アウトロ・ダイジェストの各エージェントのモデル指定を、直接の Sonnet 指定から共有 Sonnet モデルの使用へ切り替える。
  - 観察可能な完了条件: これらのエージェントの生成が共有 Sonnet モデル（thinking 無効）経由で実行される。
  - _Requirements: 5.2, 5.3_
  - _Boundary: Sonnet 利用エージェント群_
  - _Depends: 1.1_
- [x] 2.2 (P) ペルソナ生成経路を単一 Claude 化しフォールバックを整理する
  - ペルソナ発言・発言意欲評価・所感の各生成で `persona.llmType` 参照を撤去し、共有 Sonnet モデルを使用する。
  - ペルソナの system 構築ヘルパから `llmType` 分岐を撤去し、常に Claude 前提のキャッシュ付き system を返す。
  - 発言経路の別モデル（claude）へのフォールバック分岐を撤去し、空出力・恒久失敗時はエラー Result を返す。所感経路は既存どおりエラー Result を返す。
  - 観察可能な完了条件: 発言・所感が単一 Sonnet で生成され、別プロバイダ分岐が無く、空出力時にエラー Result が返る。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 3.1, 3.2, 3.3_
  - _Boundary: persona-agent_
  - _Depends: 1.1_

- [x] 3. 使い分け機構と型の撤去
- [x] 3.1 llmType 型・フィールド・解決層を一貫撤去する
  - 解決層から `getPersonaModel`・`providerForModel`・`PERSONA_MODELS` を撤去する（呼び出し側は 2.1/2.2 で移行済み）。`getGoogleProvider` と Gemini 系のモデル解決は保全する。
  - `LLMType` 型と、フロント・functions 両方のペルソナ型から `llmType` フィールドを撤去する。
  - ペルソナ生成の出力スキーマから `llmType` を除去し、生成されるペルソナに `llmType` を含めない。
  - 参照側を直接書き換え、再エクスポート等での見かけ上の互換維持は行わない。既存の永続ペルソナに `llmType` が残っていても読み取り時にエラーとしない。
  - 観察可能な完了条件: 本番コードに `llmType`・`getPersonaModel`・`PERSONA_MODELS` が残らずビルドが通り、Gemini 系解決は不変。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2_
  - _Depends: 2.1, 2.2_

- [x] 4. personaGenerator の Claude 化と OpenAI 依存撤廃
- [x] 4.1 ペルソナ生成タスクを共有 Sonnet モデルへ変更する
  - パイプラインモデル解決の `personaGenerator` を共有 Sonnet モデルへ変更し、対応する定数を `claude-sonnet-5` へ更新する。Gemini 系タスクの選定は変更しない。
  - 観察可能な完了条件: ペルソナ生成タスクが共有 Sonnet モデルで実行され、OpenAI を呼ばない。
  - _Requirements: 4.1, 4.2, 6.1, 6.2_
  - _Depends: 3.1_
- [x] 4.2 ペルソナ関連経路の OpenAI 依存を撤廃する
  - OpenAI プロバイダの import と依存関係を撤去し、Cloud Functions の全シークレット定義から OpenAI API キーを除去する。
  - 観察可能な完了条件: 本番コードに OpenAI 呼び出しが残らず、OpenAI プロバイダ依存とシークレット定義が存在しない。
  - _Requirements: 4.3_
  - _Depends: 4.1_

- [x] 5. テスト更新と回帰確認
- [x] 5.1 (P) モデル解決層のテストを更新する
  - 撤去した `getPersonaModel` の gemini/gpt 分岐テストを削除する。ペルソナ生成タスクの解決が共有 Sonnet モデル（anthropic 系）を返すこと、共有 Sonnet モデルが thinking 無効の設定を持つこと、Gemini 系解決と `getGoogleProvider` が不変であることを検証する。
  - 観察可能な完了条件: 更新後のモデル解決テストが全通過する。
  - _Requirements: 2.2, 4.2, 5.4, 6.1_
  - _Boundary: models テスト_
  - _Depends: 4.1_
- [x] 5.2 (P) ペルソナ生成エージェントのテストを更新する
  - gpt/gemini ペルソナ前提のテストを単一 Claude 前提へ整理し、`getPersonaModel` モックを撤去する。フォールバック撤去後に空出力時エラー Result を返すことを検証する。ペルソナ生成タスクの出力に `llmType` を含まないことを検証する。
  - 観察可能な完了条件: 更新後のペルソナ関連テストが全通過する。
  - _Requirements: 1.1, 1.2, 1.3, 2.3, 3.1, 3.2, 3.3_
  - _Boundary: persona-agent テスト_
  - _Depends: 3.1_
- [x] 5.3 (P) ペルソナ fixture とモックから llmType 依存を除去する
  - 各テストのペルソナ fixture から `llmType` を除去し、`getPersonaModel` をモックしていたテストのモックを整理する。討論コスト削減・編集/章の統合テストが引き続き通ることを確認する。
  - 観察可能な完了条件: fixture・モック更新後に対象ユニット/統合テストが全通過する。
  - _Requirements: 2.1_
  - _Boundary: テスト fixture 群_
  - _Depends: 3.1_
- [x] 5.4 ビルドと全ユニットテストの通過を確認する
  - functions のビルドとユニットテストを実行し全通過を確認する。本番コードに `llmType`・`getPersonaModel`・`PERSONA_MODELS`・OpenAI 呼び出しが残らないことを検索で確認する。
  - 観察可能な完了条件: ビルドと全ユニットテストが成功し、撤去対象の識別子が本番コードに 0 件である。
  - _Requirements: 5.2, 5.4_
  - _Depends: 4.2, 5.1, 5.2, 5.3_
