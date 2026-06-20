# 実装タスク: session-turn-normalization

- [x] 1. Foundation: 型定義の更新
- [x] 1.1 (P) バックエンドのターン型から発言者情報フィールドを削除する
  - `DebateTurn` 型の `speakerName?`・`speakerRole?` フィールドを削除する
  - `TurnGenerationContext.queuedTrigger.speakerName` はそのまま保持する（in-memory 解決済み値）
  - 型変更後に TypeScript コンパイルエラーが発生し、後続タスクで修正が必要な箇所が明確になること
  - _Requirements: 1.4_
  - _Boundary: debate.types.ts_

- [x] 1.2 (P) フロントエンドの型定義を正規化に合わせて更新する
  - `TurnDoc` 型から `speakerName?`・`speakerRole?` フィールドを削除する
  - `PublishedTurn` 型に `personaId?: string | null` フィールドを追加する（ペルソナフィルタリング用）
  - `PublishedTurn` の `speakerName`・`speakerRole` は引き続き必須フィールドとして保持する（表示用解決済み値）
  - TypeScript の型チェックでフロントエンド側の修正箇所が明確になること
  - _Requirements: 4.3, 5.1, 5.3, 5.4_
  - _Boundary: session.types.ts_

- [x] 2. Core: バックエンドパイプラインの正規化実装
- [x] 2.1 (P) ターン書き込み処理から発言者情報を除去し、`queuedTrigger` 名前解決をペルソナ配列に切り替える
  - `addTurn()` のパラメータリストから `speakerName`・`speakerRole` を削除する
  - `addTurn()` 内の Firestore 書き込みで `speakerName`・`speakerRole` のフィールドを除去する
  - `generateFacilitatorTurn()`・`generatePersonaTurn()`・`persistInterventionTurn()` の `state.turns.push()` から `speakerName`・`speakerRole` を除去する
  - `generatePersonaTurn()` 内の `queuedTrigger` 構築時に、`triggerTurn.speakerName` を参照するのをやめ、`personas` 配列から `triggerTurn.personaId` を使って名前を解決する。`personaId` がなければ `'ファシリテーター'` を使用する
  - 新規書き込みされたターンドキュメントに `speakerName`・`speakerRole` フィールドが含まれないこと
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2_
  - _Boundary: pipeline/debate/turn.ts, pipeline/debate/intervention.ts_

- [x] 2.2 (P) AIプロンプト用フォーマッタが `personas` 配列から発言者名・役割を解決するよう改修する
  - `formatTurns()` のシグネチャを `(turns, personas)` に変更し、第2引数 `personas: ReadonlyArray<Persona>` を必須とする
  - ペルソナターンの場合は `personaId` で `personas` を検索し、見つかった `persona.name`・`persona.specificRole`（なければ `stakeholderRole`）を使用する
  - ファシリテーターターン（`personaId` なし）の場合は `'ファシリテーター'` を固定ラベルとして使用する
  - `personaId` が `personas` に存在しない場合は `Persona(${personaId})` にフォールバックする
  - 出力フォーマットは変更前と同一: `[名前(役割)(ID:personaId)]: content`・`[ファシリテーター()]: content`
  - `formatTurns(turns, [])` のような空配列ケースでもエラーが発生しないこと
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: utils/prompt-formatters.ts_

- [x] 3. Core: エージェントへの `personas` 引き渡し
- [x] 3.1 エージェントの `formatTurns()` 呼び出しに `personas` を渡す
  - `persona-agent.ts` の `recentTurns`・`ownTurns` の2箇所で `formatTurns(turns, personas)` の形式に更新する
  - `facilitator-agent.ts` の `formatTurns()` 呼び出し箇所を確認し、同様に `personas` を渡す
  - どちらの呼び出し元も既に `personas` 配列を引数として受け取っているため、渡し方の変更のみで済む
  - TypeScript コンパイルが通り、エージェントが `personas` 配列から正しく発言者名を解決した会話履歴を受け取れること
  - _Requirements: 2.6_
  - _Depends: 2.2_

- [x] 4. Core: フロントエンド表示対応
- [x] 4.1 (P) 管理画面のターン表示をペルソナマップからの解決に切り替える
  - `Phase5Debate.svelte` でターンを表示する際に `t.speakerName` を参照している箇所を削除し、`personaMap.get(t.personaId)` から名前を取得するよう変更する
  - 発言者名は `persona?.name ?? 'ファシリテーター'`、発言者役割は `persona?.specificRole ?? persona?.stakeholderRole ?? ''` で解決する
  - `speakerName`/`speakerRole` を持たない新形式のターンドキュメントで管理画面のターン一覧が正しく表示されること
  - _Requirements: 4.1, 4.2_
  - _Depends: 1.2_
  - _Boundary: Phase5Debate.svelte_

- [x] 4.2 (P) 公開ページの `PublishedTurn` 構築にペルソナ ID を追加し、フィルタリングを堅牢化する
  - `+page.svelte` の `PublishedTurn` 構築処理で `personaId: t.personaId ?? null` を追加する
  - `speakerName` と `speakerRole` は引き続き `personas` 配列（`personaMap`）から解決してセットする（既存ロジックの維持）
  - `DebateViewer.svelte` のペルソナフィルタリング条件を `t.speakerName === persona?.name` から `t.personaId === selectedPersonaId` に変更する
  - 選択ペルソナを変えるとそのペルソナのターンだけが正しくフィルタリングされること（名前重複ペルソナでも誤検知しないこと）
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Depends: 1.2_
  - _Boundary: routes/topics/[topicId]/+page.svelte, DebateViewer.svelte_

- [x] 5. Validation: ビルド確認とテスト整合
- [x] 5.1 TypeScript コンパイルを通し、既存テストを正規化後の実装に合わせて修正する
  - `functions` と `src` 両方で `npm run build` / `tsc --noEmit` が警告なく通ること
  - `formatTurns()` のユニットテストがある場合、`personas` 引数を渡す形式に更新する
  - `addTurn()` 関連のテストがある場合、`speakerName`/`speakerRole` パラメータを除去した呼び出し形式に更新する
  - テストスイート全体がパスすること
  - _Requirements: 1.4, 2.1, 2.6, 3.2, 4.3, 5.4_
