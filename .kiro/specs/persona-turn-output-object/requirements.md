# Requirements Document

## Introduction

`persona-agent.ts` の `generateTurn` 関数は、ペルソナが討論で1ターン分の発言を生成する際に `submit_turn` というダミーツールを使って出力を受け取っている。このダミーツールは「ツール呼び出しの引数」として構造化データを取り出すための迂回策であり、`execute` を持たずループを自然に終了させる役割しかない。

AI SDK v6 の `generateText` は `output` オプション（`Output.object()`）でツール使用と構造化出力を同時に実現できるため、`submit_turn` を廃止して `output.object` に移行する。これにより「ツールを呼び忘れる」というエラーリスクが消え、モデルへの指示も簡潔になる。

## Boundary Context

- **In scope**: `generateTurn` 関数内の出力取得方法の変更、`submit_turn` ツール定義の削除、テストの更新
- **Out of scope**: `evaluateEngagement`・`generatePostDebateComment` の変更、`web_search` ツールの動作変更、呼び出し元（`pipeline/` など）の変更
- **Adjacent expectations**: `generateTurn` の戻り値型 `Result<PersonaReply, PipelineError>` は変更しない

## Requirements

### Requirement 1: submit_turn ツールの廃止

**Objective:** 開発者として、ダミーツール `submit_turn` を削除したい。そうすることで、ツール呼び出し忘れによるエラーリスクをなくせる。

#### Acceptance Criteria

1. When `generateTurn` が呼ばれる, the Persona Agent shall `submit_turn` ツールを定義せず `generateText` を呼び出すこと
2. The Persona Agent shall `buildFullTurnTools` から `submit_turn` エントリを削除すること
3. When `web_search` が利用可能でない場合, the Persona Agent shall `tools` オブジェクトが空になるかわりに `tools` パラメータ自体を省略すること（空 tools オブジェクトを渡さない）

### Requirement 2: output.object による構造化出力

**Objective:** 開発者として、`generateText` の `output` オプションで構造化出力を取得したい。そうすることで、出力フィールドが型安全に保証される。

#### Acceptance Criteria

1. The Persona Agent shall `generateText` に `output: Output.object({ schema: turnOutputSchema })` を渡すこと
2. The Persona Agent shall `turnOutputSchema` に `content`（必須）・`beliefChangeType`（省略可）・`beliefChangeSummary`（省略可）・`beliefChangeUpdatedBelief`（省略可）・`targetPersonaId`（省略可）を定義すること
3. When `generateText` が完了した後, the Persona Agent shall `result.output` から発言内容を取得すること
4. The Persona Agent shall `submit_turn` のツール呼び出しを検索するコードを削除すること

### Requirement 3: web_search のステップ追跡維持

**Objective:** 開発者として、`web_search` の使用状況を引き続き追跡したい。そうすることで、`searchUsed` フラグと `searchQueries` を正確に返せる。

#### Acceptance Criteria

1. When `web_search` が呼ばれたステップが存在する場合, the Persona Agent shall `result.steps.flatMap(s => s.toolCalls)` で `web_search` 呼び出しを収集すること
2. The Persona Agent shall `searchQueries` を `PersonaReply` に含めること（現行動作を維持）

### Requirement 4: フォールバック判定の更新

**Objective:** 開発者として、非 Claude モデルが正常に出力を返したかを判定したい。そうすることで、失敗時に Claude へフォールバックできる。

#### Acceptance Criteria

1. When 非 Claude モデルの `generateText` が `result.output` に `content` を含まない結果を返した場合, the Persona Agent shall Claude モデルで再試行すること
2. If `generateText` が例外を throw した場合, the Persona Agent shall Claude モデルで再試行すること
3. The Persona Agent shall `submit_turn` のツール呼び出し有無によるフォールバック判定を削除すること

### Requirement 5: テストの更新

**Objective:** 開発者として、移行後も既存テストが正常に動作してほしい。そうすることで、リグレッションを検知できる。

#### Acceptance Criteria

1. The Persona Agent Test shall `ai` モックに `Output: { object: vi.fn(() => ({})) }` を追加すること
2. When `generateText` のモックを設定する場合, the Persona Agent Test shall `{ steps: [...] }` に加えて `{ output: { content, ... } }` を返すこと
3. The Persona Agent Test shall `submit_turn` ツール呼び出しを直接モックするコードをすべて削除すること
