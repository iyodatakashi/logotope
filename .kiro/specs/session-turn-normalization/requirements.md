# 要件定義書

## はじめに

現在、Firestoreの`sessions/0.turns[]`配列内の各ターンドキュメントには、`speakerName`（発言者名）と`speakerRole`（発言者の役割）が毎回書き込まれている。これらはペルソナドキュメント（`topics/{topicId}/personas/{personaId}`）に既に存在する情報であり、`personaId`があれば参照可能な非正規化データである。

本仕様は、ターンドキュメントから冗長な発言者情報を除去してFirestoreを正規化しつつ、AIエージェントへ渡す会話履歴には引き続き必要な情報（名前・役割）が含まれるよう、情報解決のレイヤーを明確に分離することを目的とする。

## スコープ境界

- **対象**: Firestoreに保存する`TurnEmbed`の構造、AIプロンプト組み立て関数、管理画面・公開ページのターン表示
- **対象外**: ペルソナ生成ロジック、章立て生成、取材処理
- **隣接仕様との関係**: 公開ページ（`/topics/[topicId]`）は現時点でSSR時に`personaId`→ペルソナ情報の解決を行っており、本変更後も同様のアプローチを継続する

## 要件

### 要件 1: Firestoreターンドキュメントの正規化

**目的:** パイプライン開発者として、ターンドキュメントに冗長な発言者情報を保存しないようにしたい。そうすることで、ペルソナ情報の変更がターン履歴に影響しなくなり、Firestoreの保存サイズも削減される。

#### 受け入れ基準

1. When a debate turn is saved to Firestore, the Turn Pipeline shall not write `speakerName` or `speakerRole` fields to the turn document.
2. The Turn Pipeline shall write `personaId` for persona turns and omit `personaId` (or set it to null) for facilitator turns.
3. The Turn Pipeline shall continue to write all other existing fields (`id`, `turnIndex`, `speakerType`, `content`, `createdAt`, `chapterId`, `speechMode`, `engagementScore`, `fromQueue`, `targetPersonaId`, `targetedBy`, `searchUsed`, `searchQueries`) unchanged.
4. The `DebateTurn` TypeScript型から `speakerName` と `speakerRole` フィールドを削除する。

### 要件 2: AI会話履歴フォーマッタの改修

**目的:** パイプライン開発者として、`formatTurns()`がペルソナ情報を参照して発言者名・役割を解決できるようにしたい。そうすることで、ターンに名前が保存されていなくてもAIに適切な会話コンテキストを提供できる。

#### 受け入れ基準

1. When `formatTurns()` is called, the Turn Formatter shall accept a `personas` array as a required second argument for name/role resolution.
2. When formatting a persona turn, the Turn Formatter shall look up `personaId` in the `personas` array and use `persona.name` and `persona.specificRole`（なければ`stakeholderRole`）を発言者情報として使用する。
3. When formatting a facilitator turn (no `personaId`), the Turn Formatter shall use the constant label `'ファシリテーター'` as the speaker name and omit the role.
4. The Turn Formatter shall produce output in the same format as before: `[名前(役割)(ID:personaId)]: content` for persona turns, `[ファシリテーター()]: content` for facilitator turns.
5. While a `personaId` exists in a turn but is not found in the `personas` array, the Turn Formatter shall fall back to `Persona(${personaId})` as the speaker name.
6. When `formatTurns()` is called by agents, the callers shall pass the relevant `personas` array that is already available in the calling context.

### 要件 3: `queuedTrigger`の発言者名解決

**目的:** パイプライン開発者として、「持ち越しの言いたいこと」プロンプトに使われる`queuedTrigger.speakerName`をターンから直接読み取るのをやめ、ペルソナ情報から解決したい。

#### 受け入れ基準

1. When a pending trigger is constructed from a previous turn, the Turn Pipeline shall resolve the speaker name by looking up `triggerTurn.personaId` in the `personas` array, falling back to `'ファシリテーター'` if no `personaId`.
2. The `TurnGenerationContext.queuedTrigger` の `speakerName` フィールドは引き続き保持するが、ターンから読み取るのではなくペルソナ配列から解決した値をセットする。

### 要件 4: 管理画面のターン表示対応

**目的:** 管理者として、`speakerName`・`speakerRole`がターンに保存されなくなっても、管理画面上でターンの発言者名・役割が正しく表示されることを保証したい。

#### 受け入れ基準

1. When displaying debate turns in the admin debate view (`Phase5Debate.svelte`), the Session Display shall resolve speaker name from the `personaMap` using `turn.personaId`, falling back to `'ファシリテーター'`.
2. When displaying debate turns in the admin debate view, the Session Display shall resolve speaker role from `persona.specificRole ?? persona.stakeholderRole`, falling back to empty string.
3. The `TurnDoc` 型（フロントエンド: `session.types.ts`）から `speakerName?` および `speakerRole?` フィールドを削除する。

### 要件 5: 公開ページのターン表示対応

**目的:** 閲覧者として、公開ページで討論ターンの発言者名・役割が正しく表示されることを保証したい。

#### 受け入れ基準

1. When building `PublishedTurn` objects for the public debate page, the Public Page shall resolve `speakerName` and `speakerRole` from the `personas` array using `turn.personaId`.
2. When a turn's `personaId` is not found in the `personas` array (facilitator turn), the Public Page shall use `'ファシリテーター'` as `speakerName` and `''` as `speakerRole`.
3. The `PublishedTurn` TypeScript型の `speakerName` と `speakerRole` は引き続き必須フィールドとして保持する（表示用の解決済み値として使う）。
4. `DebateViewer.svelte`で選択ペルソナのターンをフィルタリングする際、`turn.speakerName`による比較ではなく`turn.personaId === selectedPersonaId`による比較に変更する。
