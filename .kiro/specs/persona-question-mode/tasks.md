# Implementation Tasks: persona-question-mode

## Tasks

- [x] 1. Foundation: 型定義の拡張
  - `Engagement.mode` のユニオン型に `'question'` を追加する
  - `PersonaReply.speechMode` のユニオン型に `'question'` を追加する
  - `DebateTurn.speechMode` のユニオン型に `'question'` を追加する
  - `TurnGenerationContext` に `otherPersonas: ReadonlyArray<{ id: string; name: string }>` フィールドを追加する
  - 変更後にTypeScriptコンパイルが通り、既存コードで型エラーが発生しないこと
  - _Requirements: 1.1, 2.3_

- [x] 2. Core: persona-agent.ts の更新
- [x] 2.1 ASSESS_ENGAGEMENT_TOOLS にquestionモードを追加
  - mode enumに `'question'` を追加し、mode選択の説明文を優先順位（question > fact > opinion > none）に従って書き直す
  - questionモードの定義「直前または以前の特定の参加者の発言を受けて問い返し・確認・反論を向けたい場合」と各スコア（1〜5）の意味を追加する
  - `intentSummary` に「誰のどの発言について何を聞きたいか」を80文字以内で記述する指示と、自分自身を対象にしてはならない制約を追加する
  - `ASSESS_ENGAGEMENT_TOOLS` のスキーマに `'question'` が含まれ、型検査が通ること
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3_

- [x] 2.2 evaluateEngagement に参加者名リスト引数を追加しフォールバック処理を実装
  - `evaluateEngagement` の引数に `otherPersonaNames: string[]` を追加し、プロンプトに参加者名リストを埋め込む（例: `「参加者: ${otherPersonaNames.join('、')}」`）
  - LLMが返した結果が `mode === 'question'` かつ `intentSummary` が空または未設定の場合、この関数内で `{ ...result, mode: 'opinion' }` に正規化して返す
  - `mode: 'question'` かつ `intentSummary` 非空の場合はそのまま返り、空の場合は `mode: 'opinion'` として返ること
  - _Requirements: 1.3, 1.4_

- [x] 2.3 generateTurn にquestionモード専用指示文を追加
  - `engagement.mode === 'question'` の場合に `questionInstruction` を生成する：`intentSummary` の内容と参加者名→IDの対応表を含め、`targetPersonaId` に質問相手のIDを必ず指定するよう強く促す指示文を組み立てる
  - `questionInstruction` をターン生成プロンプトに追加し、`PersonaReply.speechMode` に `'question'` をセットして返す
  - `question` モードで呼び出されたとき `questionInstruction` がプロンプトに含まれ、`speechMode: 'question'` が返ること
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 3. Integration: pipeline層の更新
- [x] 3.1 (P) engagement.ts で otherPersonaNames を構築して evaluateEngagement に渡す
  - `evaluateEngagements` 内で各ペルソナの評価時に、自分以外のペルソナ名リストを `personas.filter(p => p.id !== persona.id).map(p => p.name)` で構築して `evaluateEngagement` に渡す
  - `evaluateEngagementWithFallback` も同様に `otherPersonaNames` を構築して渡す
  - 全ペルソナのengagement評価が完了し、questionモードの結果も含め正しいEngagement配列が返ること
  - _Requirements: 1.3_
  - _Boundary: pipeline/debate/engagement.ts_

- [x] 3.2 (P) turn.ts で generatePersonaTurn を更新（otherPersonas構築・フォールバック）
  - `generatePersonaTurn` 内で `personas` から発言者を除く `otherPersonas` リスト（id + name）を構築して `TurnGenerationContext` に追加する
  - `PersonaReply.speechMode === 'question'` かつ `targetPersonaId` が未設定の場合、`effectiveSpeechMode` を `'opinion'` に差し替えて `addTurn` に渡す
  - `addTurn` の `speechMode` 引数の型を `'opinion' | 'fact' | 'question'` に更新する
  - `question` モードで `targetPersonaId` が設定されたターンは `speechMode: 'question'` として保存され、未設定時は `speechMode: 'opinion'` として保存されること
  - _Requirements: 2.4, 2.5_
  - _Boundary: pipeline/debate/turn.ts_

- [x] 4. Validation: ユニットテスト
- [x] 4.1 (P) エージェント層のユニットテスト
  - `ASSESS_ENGAGEMENT_TOOLS` のスキーマに `'question'` が含まれることをテストする
  - `evaluateEngagement` が `mode: 'question'` かつ `intentSummary` が空の場合に `mode: 'opinion'` を返すことをモックを使ってテストする
  - `generateTurn` が `question` モードで呼び出されたとき `questionInstruction` が指示文に含まれることをモックを使ってテストする
  - Vitestでテストが全件パスすること
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 3.1_
  - _Boundary: agents/persona-agent.ts_

- [x] 4.2 (P) pipeline層のユニットテスト
  - `generatePersonaTurn` でフォールバック（`targetPersonaId` 未設定時に `speechMode: 'opinion'` になること）をモックを使ってテストする
  - `generatePersonaTurn` で `question` モードかつ `targetPersonaId` が設定されたとき `speechMode: 'question'` でターンが保存されることをテストする
  - Vitestでテストが全件パスすること
  - _Requirements: 2.4, 2.5_
  - _Boundary: pipeline/debate/turn.ts_
