# Implementation Plan

- [x] 1. Foundation: 型定義・設定の基盤追加
- [x] 1.1 Tavily API 設定を追加する
  - Firebase Functions の環境変数に `TAVILY_API_KEY` を追加する（`.env` およびデプロイ設定）
  - `functions/src/config/ai.ts` に検索関連の定数（タイムアウト、最大結果件数 `SEARCH_MAX_RESULTS = 5`）を追加する
  - 完了状態: 設定定数がコード上で参照可能で、`TAVILY_API_KEY` 未設定時の挙動が定義されている
  - _Requirements: 1.4, 4.3_

- [x] 1.2 (P) `AgentTurnResult` に検索メタデータ型を追加する
  - `functions/src/types/index.ts` の `AgentTurnResult` に `searchUsed?: boolean` と `searchQueries?: string[]` を追加する
  - 完了状態: TypeScript strict mode でコンパイルエラーなし。既存の呼び出し元コードに型エラーが発生しない
  - _Requirements: 5.1, 5.2_
  - _Boundary: AgentTurnResult (types/index.ts)_

- [x] 1.3 (P) Firestore ターン型と永続化関数に検索メタデータを追加する
  - `DebateTurn` と `CreateDebateTurnParams` に `searchUsed?: boolean`, `searchQueries?: string[]` を追加する
  - `createDebateTurn` で `params.searchUsed` が `true` のときのみターンオブジェクトに当該フィールドを含める（既存の undefined スキップパターンに準じる）
  - 完了状態: `createDebateTurn({ ..., searchUsed: true, searchQueries: ['query'] })` を呼ぶと Firestore の `arrayUnion` オブジェクトに `searchUsed` と `searchQueries` が含まれる
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: DebateTurn, CreateDebateTurnParams, createDebateTurn (repository.ts)_

- [x] 2. (P) SearchService を実装する
  - `functions/src/search/search-service.ts` を新規作成する
  - `isAvailable()`: `process.env.TAVILY_API_KEY` の有無を確認して `boolean` を返す
  - `executeSearch(query: string)`: Tavily Search API を呼び出し、スニペットを `SEARCH_MAX_RESULTS` 件以内で連結した文字列を `SearchResult.content` として返す
  - ネットワークエラー・HTTP エラー時は例外を投出せず `{ ok: false, error: string }` を返す
  - 完了状態: `TAVILY_API_KEY` が設定された環境で `executeSearch('日本の少子化 統計')` が検索結果文字列を返し、未設定時は `isAvailable()` が `false` を返す
  - _Depends: 1.1_
  - _Requirements: 1.4, 4.1, 4.3, 4.4_
  - _Boundary: SearchService (search/search-service.ts)_

- [x] 3. (P) システムプロンプトに検索ガイダンスを追加する
  - `buildPersonaSystemPrompt` 内の「発言の根拠は自分が直接経験したこと・職場で見聞きしたことに限る。立場を守るために〜」の箇所を削除し、「数値・統計・最新動向など正確性が求められる情報を述べる場合は、推測や記憶に頼らず検索ツールを積極的に使用すること。検索クエリは自分の立場・職業・関心に沿った視点で構築すること。検索ツールは必要なときのみ使用し 1〜2 回以内にとどめること。」に置換する
  - `factInstruction` の「出典・数字は事前取材レコードの範囲にとどめ、不確かなことは断言しない。」を「検索ツールで確認した情報は根拠として使ってよい。確認していない情報は断言しない。」に置換する
  - 完了状態: 生成されたシステムプロンプトに検索ガイダンスが含まれ、旧「個人経験のみ」制限文言が含まれていない
  - _Requirements: 2.1, 2.2, 2.4, 3.2, 3.3, 3.4_
  - _Boundary: buildPersonaSystemPrompt, factInstruction (persona-agent.ts)_

- [x] 4. 検索ツール付きアジェンティックループを実装する
- [x] 4.1 `buildFullTurnTools` に `web_search` ツール定義を追加する
  - `buildFullTurnTools` のシグネチャに `searchService: SearchService` 引数を追加する
  - `searchService.isAvailable()` が `true` のとき `web_search` ツール（`execute` あり）を返す tools に含め、`false` のときは既存の `{ submit_turn }` のみを返す
  - `web_search.execute` 内で `searchService.executeSearch(query)` を呼び出し、失敗時は「検索結果を取得できませんでした。知っている範囲で発言してください。」を返す
  - 完了状態: `isAvailable() === true` のとき tools に `web_search` が含まれ、`false` のとき含まれない。TypeScript の型エラーなし
  - _Depends: 2_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 4.3_

- [x] 4.2 `generateTurn` をアジェンティックループに変更する
  - `generateTurn` 内で `collectedSearchQueries: string[]` を初期化し、`web_search.execute` 呼び出し時にクエリを収集する
  - `generateText` の `toolChoice` を `'required'` に変更し、`maxSteps: 4` を追加する
  - `buildFullTurnTools(styleGuide, lengthGuide, searchService)` で `web_search` を含む tools を生成する
  - `fullResult.toolCalls[0]` を `fullResult.steps.flatMap(s => s.toolCalls).find(c => c.toolName === 'submit_turn')` に置き換えて全ステップから `submit_turn` を探す
  - `submit_turn` が見つからない場合は `toolChoice: { type: 'tool', toolName: 'submit_turn' }` + `maxSteps: 1` で単一ステップのリトライを行う（既存パターン踏襲）
  - `AgentTurnResult` の戻り値に `searchUsed: collectedSearchQueries.length > 0`, `searchQueries: collectedSearchQueries.length > 0 ? collectedSearchQueries : undefined` を追加する
  - 完了状態: 数値・統計に関するターン生成時に Claude が `web_search` を呼び出し、`AgentTurnResult.searchUsed === true` かつ `searchQueries` に実行クエリが含まれて返る
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 4.2, 4.4_

- [x] 5. オーケストレーターから検索メタデータを Firestore に連携する
  - `debate-orchestrator.ts` の `generatePersonaTurn` で `repo.createDebateTurn` を呼ぶ箇所に `searchUsed: turnResult.value.searchUsed` と `searchQueries: turnResult.value.searchQueries` を追加する
  - 完了状態: 討論実行後、検索を使用したターンの Firestore ドキュメントに `searchUsed: true` と `searchQueries: [...]` が保存されている
  - _Depends: 1.3, 4.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. テスト
- [x] 6.1 (P) `SearchService` のユニットテストを書く
  - Tavily API のレスポンスをモックし、正常応答・HTTP エラー（500）・タイムアウトそれぞれで期待通りの `SearchResult` が返ることを検証する
  - `isAvailable()` が `TAVILY_API_KEY` の有無に応じて正しく切り替わることを検証する
  - 完了状態: `SearchService` のユニットテストがすべてパスする
  - _Requirements: 1.4, 4.1, 4.3_
  - _Boundary: SearchService_

- [x] 6.2 (P) `generateTurn` の検索統合テストを書く
  - モックの `SearchService`（`isAvailable: true`）を使い、検索あり時に `AgentTurnResult.searchUsed === true` かつ `searchQueries` が1件以上含まれることを検証する
  - `isAvailable() === false` のとき `searchUsed` が `undefined` で既存の1ステップ動作と同等のレスポンスになることを検証する
  - 完了状態: `generateTurn` の統合テストがすべてパスする
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3_
  - _Boundary: PersonaAgentService.generateTurn_

- [x] 6.3 フォールバックと永続化のテストを書く
  - 検索 API エラー時（`SearchService.executeSearch` が `{ ok: false }` を返す場合）も `generateTurn` が正常な `content` を含む `AgentTurnResult` を返すことを検証する
  - `createDebateTurn` に `searchUsed: true, searchQueries: ['q']` を渡したとき Firestore の `arrayUnion` オブジェクトに当該フィールドが含まれることを検証する
  - 完了状態: フォールバックと永続化のテストがすべてパスする
  - _Depends: 6.1, 6.2_
  - _Requirements: 4.1, 4.2, 4.4, 5.1, 5.2_
