# Implementation Plan

## Tasks

- [x] 1. 事前スキャン: ストア境界外の Timestamp 使用箇所を特定する
- [x] 1.1 コンポーネント・ルートの `.toDate()` 呼び出しをスキャンして修正対象ファイルを一覧化する
  - `grep -r '\.toDate()' src/` でストア配下（`src/lib/stores/`）以外の `.toDate()` 呼び出しを検出する
  - ヒットしたファイルパスと行番号を確認し、後続タスク 6 の作業範囲を確定する
  - `grep` 結果がゼロの場合はタスク 6 をスキップできる
  - `pnpm exec svelte-check` で現在の型エラー数を記録しておき、作業後のベースラインとする
  - _Requirements: 5.1, 5.3_

- [x] 2. FE 型定義ファイルを更新する
- [x] 2.1 (P) `turn.types.ts` の `TurnDoc` を `TurnForFirestore` にリネームする
  - `TurnDoc` という名前を `TurnForFirestore` に変更する（フィールド構造は変えない）
  - `Turn` 型の `Omit<TurnDoc, 'createdAt'>` 参照を `Omit<TurnForFirestore, 'createdAt'>` に更新する
  - `turn.types.ts` の export から `TurnDoc` が消え `TurnForFirestore` が公開されている
  - _Requirements: 1.1, 1.2_
  - _Boundary: turn.types.ts_

- [x] 2.2 (P) `persona.types.ts` で `Belief`・`Interview`・`Persona` の型ペアを整備する
  - `BeliefDoc` → `BeliefForFirestore`（`createdAt: Timestamp`）にリネームし、`Belief`（`createdAt: Date`）を `Omit<BeliefForFirestore, 'createdAt'> & { createdAt: Date }` パターンで追加する
  - `InterviewDoc` → `InterviewForFirestore`（`completedAt?: Timestamp`）にリネームし、`Interview`（`completedAt?: Date`）を同パターンで追加する
  - `PersonaDoc` → `PersonaForFirestore`（`beliefs: BeliefForFirestore[]`・`interview?: InterviewForFirestore`）にリネームし、`Persona`（`beliefs: Belief[]`・`interview?: Interview`）を追加する
  - `persona.types.ts` から `BeliefDoc`・`InterviewDoc`・`PersonaDoc` が消え、`BeliefForFirestore`・`Belief`・`InterviewForFirestore`・`Interview`・`PersonaForFirestore`・`Persona` が公開されている
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.4, 3.1, 3.2_
  - _Boundary: persona.types.ts_

- [x] 2.3 (P) `topic.types.ts` で `FetchedSourceContent`・`StakeholderDoc`・`TopicDoc` を整備する
  - `FetchedSourceContent`（`fetchedAt: Timestamp`）を `FetchedSourceContentForFirestore` にリネームし、`FetchedSourceContent`（`fetchedAt: Date`）を `Omit<FetchedSourceContentForFirestore, 'fetchedAt'> & { fetchedAt: Date }` パターンで追加する
  - `TopicBase` を `TopicBaseForFirestore` にリネームする（`export` を外しファイル内部専用にする）
  - `TopicBase` の `fetchedSourceContents?: FetchedSourceContent[]` フィールドを `fetchedSourceContents?: FetchedSourceContentForFirestore[]` に更新する
  - `StakeholderDoc` を `StakeholderForFirestore` にリネームする
  - `TopicDoc` を `TopicForFirestore` にリネームする
  - `topic.types.ts` から `FetchedSourceContent`（Timestamp版）・`StakeholderDoc`・`TopicDoc`・`TopicBase` が消え、新名称と Date 版 `FetchedSourceContent` が公開されている
  - _Requirements: 1.1, 1.2, 2.3, 2.4_
  - _Boundary: topic.types.ts_

- [x] 2.4 (P) `engagement.types.ts` と `postDebateComment.types.ts` の Doc 型をリネームする
  - `engagement.types.ts` の `EngagementDoc` を `EngagementForFirestore` にリネームする
  - `postDebateComment.types.ts` の `PostDebateCommentDoc` を `PostDebateCommentForFirestore`、`PostDebateCommentsDoc` を `PostDebateCommentsForFirestore` にリネームする
  - 両ファイルから旧 `*Doc` 名が消え、`*ForFirestore` 名が公開されている
  - _Requirements: 1.1, 1.2_
  - _Boundary: engagement.types.ts, postDebateComment.types.ts_

- [x] 2.5 `chapter.types.ts` で `ChapterForFirestore`・`ChapterAnalysisForFirestore`・`DiscussionPointState` を整備する
  - `DiscussionPointStatusDoc` を `DiscussionPointState` にリネームする（`ForFirestore` サフィックスなし。Timestamp を持たず永続・インメモリ両用のため）
  - `ChapterDoc` を `ChapterForFirestore`（`turns: TurnForFirestore[]`）にリネームし、`Turn` の import を `TurnForFirestore` に更新する
  - `ChapterAnalysisDoc` を `ChapterAnalysisForFirestore` にリネームする
  - `Chapter` 型の `Omit<ChapterDoc, 'turns'>` 参照を `Omit<ChapterForFirestore, 'turns'>` に更新する
  - `chapter.types.ts` から旧 `*Doc` 名が消え `ChapterForFirestore`・`ChapterAnalysisForFirestore`・`DiscussionPointState` が公開されている
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3_

- [x] 3. functions 型定義ファイルを更新する
- [x] 3.1 (P) `debate.types.ts` の `ChapterStateData` を `ChapterForFirestore` にリネームする
  - `ChapterStateData` を `ChapterForFirestore` にリネームする（`turns: DebateTurn[]` など構造は変えない）
  - `DiscussionPointState` はリネームせずそのまま維持する
  - `DebateState` など `ChapterStateData` を参照している同ファイル内の型を `ChapterForFirestore` に更新する
  - `debate.types.ts` から `ChapterStateData` が消え `ChapterForFirestore` が公開されている
  - _Requirements: 1.3_
  - _Boundary: functions/debate.types.ts_

- [x] 3.2 (P) functions `chapter.types.ts` の `ChapterAnalysisDoc` を `ChapterAnalysisForFirestore` にリネームする
  - `ChapterAnalysisDoc` を `ChapterAnalysisForFirestore` にリネームする（フィールド構造は変えない）
  - `functions/src/types/chapter.types.ts` から `ChapterAnalysisDoc` が消え `ChapterAnalysisForFirestore` が公開されている
  - _Requirements: 1.4_
  - _Boundary: functions/chapter.types.ts_

- [x] 4. ストアを新しい型で更新する
- [x] 4.1 `chapters.svelte.ts` の inline 型を削除して `ChapterForFirestore` で直接キャストする
  - `RawTurn`・`RawChapter` の inline 型定義を削除する
  - `d.data() as RawChapter` を `d.data() as ChapterForFirestore` に置き換える
  - import を `TurnDoc`・`ChapterDoc` から `TurnForFirestore`・`ChapterForFirestore`・`Turn`・`Chapter` に更新する
  - `svelte-check` で型エラーがゼロになっている
  - _Depends: 2.1, 2.5_
  - _Requirements: 1.2, 2.5_

- [x] 4.2 (P) `personas.svelte.ts` に `PersonaForFirestore`→`Persona` の変換ロジックを実装する
  - import を `PersonaDoc` から `PersonaForFirestore`・`Persona` に更新する
  - `onSnapshot` コールバック内で `PersonaForFirestore` を `Persona` に変換する: `beliefs` 配列の各要素の `createdAt: Timestamp` を `.toDate()` で `Date` に変換し、`interview?.completedAt` も同様に変換する
  - ストアが公開する `personas` の型が `Persona[]` になっており、Timestamp がストア外に露出しない
  - _Depends: 2.2_
  - _Requirements: 3.3, 3.4, 3.5_
  - _Boundary: personas.svelte.ts_

- [x] 4.3 (P) その他のストアの型参照を更新する
  - `chapterAnalysis.svelte.ts`: `ChapterAnalysisDoc` → `ChapterAnalysisForFirestore`
  - `topics.svelte.ts`: `TopicDoc` → `TopicForFirestore`
  - `stakeholders.svelte.ts`: `StakeholderDoc` → `StakeholderForFirestore`
  - `postDebateComments.svelte.ts`: `PostDebateCommentDoc` → `PostDebateCommentForFirestore`、`PostDebateCommentsDoc` → `PostDebateCommentsForFirestore`
  - 各ストアファイルの型エラーがゼロになっている
  - _Depends: 2.3, 2.4, 2.5_
  - _Requirements: 1.2_
  - _Boundary: chapterAnalysis.svelte.ts, topics.svelte.ts, stakeholders.svelte.ts, postDebateComments.svelte.ts_

- [x] 5. `createTopic.svelte.ts` の `fetchedSourceContents` 変換を実装する
  - import の `FetchedSourceContent` を `FetchedSourceContentForFirestore` に更新する（引数型・内部型）
  - `let fetchedSourceContents: FetchedSourceContent[] | undefined = $state(topicDoc.fetchedSourceContents)` を、`fetchedAt: Timestamp` を `.toDate()` で `Date` に変換してから state に設定するように変更する
  - `createTopicStates` の戻り値（`Topic` 型）内の `fetchedSourceContents` が `FetchedSourceContent[]`（`fetchedAt: Date`）になっており、Timestamp がアプリ層に露出しない
  - _Depends: 2.3_
  - _Requirements: 2.3, 2.4_

- [x] 6. ストア境界外の `.toDate()` 呼び出しを除去する
- [x] 6.1 タスク 1.1 のスキャン結果に基づきコンポーネント・ルートの `.toDate()` 呼び出しを削除する
  - スキャンで発見した各箇所で `.toDate()` 呼び出しを削除する（ストア・モデルが Date を返すようになっているため不要）
  - 変更後に `svelte-check` を実行し、型エラーがゼロになっていることを確認する
  - タスク 1.1 でヒットがゼロだった場合はこのタスクをスキップする
  - _Depends: 4.2, 4.3, 5_
  - _Requirements: 5.1, 5.3_

- [x] 7. テストファイルを更新して型チェックとユニットテストを通過させる
- [x] 7.1 (P) FE テストファイルの型参照を更新する
  - `src/tests/stores/chapters.test.ts`: `ChapterDoc` → `ChapterForFirestore`
  - `src/tests/stores/chapterAnalysis.test.ts`: `ChapterAnalysisDoc` → `ChapterAnalysisForFirestore`
  - `src/tests/stores/stakeholders.test.ts`: `StakeholderDoc` → `StakeholderForFirestore`
  - `src/tests/models/chapter/chapter.types.test.ts`: `ChapterDoc` → `ChapterForFirestore`・`ChapterAnalysisDoc` → `ChapterAnalysisForFirestore`
  - 各テストファイルの型エラーがゼロになっている
  - _Depends: 2.3, 2.4, 2.5_
  - _Requirements: 5.3_
  - _Boundary: src/tests/_

- [x] 7.2 (P) functions テストファイルの型参照を更新する
  - `functions/src/tests/types/debate.types.test.ts`: `ChapterStateData` → `ChapterForFirestore`
  - テストファイルの型エラーがゼロになっている
  - _Depends: 3.1_
  - _Requirements: 5.3_
  - _Boundary: functions/src/tests/_

- [x] 7.3 型チェックとユニットテスト全件通過を確認する
  - `pnpm exec svelte-check` または `pnpm exec tsc --noEmit` を実行して型エラーがゼロであることを確認する
  - `pnpm test:unit` を実行して全件通過・ゼロ失敗であることを確認する
  - _Depends: 7.1, 7.2_
  - _Requirements: 5.1, 5.2, 5.4_
