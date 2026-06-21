# Requirements Document

## Project Description (Input)
チャプター生成パイプラインにおいて、グループ化ステップ（採用論点のクラスタリング）と章立て生成ステップ（タイトル・フォーカス問い・discussionPoints の生成）を分離する。さらに章の並び順を決める処理を純粋関数として独立させる。現状はグループ化と章立て生成が1つのAI呼び出しで行われており、AIがタイトルを生成する必要性から章数上限（5章）に引っ張られた不自然なグルーピングが生じている。

## Introduction

`chapter-agent.ts` の `composeChapters` 関数は現在、採用論点のクラスタリングとチャプタータイトル・フォーカス問いの生成を1つのAI呼び出しで行っている。これにより、AIは「タイトルを生成すべき章」を上限数まで作ろうとするバイアスを持ち、論点の自然なクラスタ数ではなく章数制約に引っ張られたグルーピングになる。

本仕様では3つのステップに分離する：
1. **グループ化** — 採用論点を意味的にクラスタリングするのみ
2. **章立て生成** — グループを受け取り、タイトル・フォーカス問い・discussionPoints を一括生成
3. **並べ替え** — general 由来の論点が多いグループを先頭にする純粋関数

## Boundary Context

- **In scope**: `functions/src/agents/chapter-agent.ts` のグループ化・章生成・並べ替え処理、`functions/src/pipeline/chapters/chapter-generator.ts` の中間書き込みロジック、`ChapterAnalysisDoc` 型の再設計、関連するユニットテスト・統合テスト、`Phase4Chapters.svelte` の中間表示
- **Out of scope**: スコアリング処理（`scoreIssues`）、選別処理（`selectIssues`）、論点生成処理（Step 1）、討論パイプライン
- **Adjacent expectations**: `chapter-generation-scoring` スペックで実装済みの `ChapterProgress` 型・`onProgress` コールバック機構を引き続き使用する

## Requirements

### Requirement 1: グループ化ステップの純粋化

**Objective:** As a システム設計者, I want グループ化AI呼び出しが論点のクラスタリング（index割り当て）のみを行う, so that グルーピング結果が章数制約やタイトル生成の都合に左右されず、論点の意味的近さのみで決まる

#### Acceptance Criteria

1. The chapter generation pipeline shall グループ化スキーマとして `issueGroups: [{ issueIndexes: number[] }]` を返す形式を使用し、title・focusQuestion は含めない（精度向上のためテキストの echo は許容するが保持しない）
2. When グループ化AIを呼び出すとき、the chapter generation pipeline shall グルーピングのみを求めるプロンプトを送信し、タイトル・フォーカス問いの生成を要求しない
3. When グループ化結果が0グループを返したとき、the chapter generation pipeline shall 全採用論点を1グループにまとめるフォールバックを適用する
4. The chapter generation pipeline shall 採用論点がすべていずれかのグループに割り当てられることを保証し、未割り当て論点は最終グループに追加する

---

### Requirement 2: 章立て生成ステップの拡張

**Objective:** As a システム設計者, I want 章立て生成AI呼び出しがグループを受け取りタイトル・フォーカス問い・discussionPoints を一括生成する, so that 章の構造が論点クラスタに基づいて適切に設計される

#### Acceptance Criteria

1. The chapter generation pipeline shall 章生成スキーマとして `chapters: [{ title: string, focusQuestion: string, discussionPoints: string[] }]` を使用する
2. When 章立て生成AIを呼び出すとき、the chapter generation pipeline shall グループ番号と割り当て論点テキストのみを入力とし、タイトル・フォーカス問い・discussionPoints を生成する
3. The chapter generation pipeline shall 各章に nanoid で一意のIDを付与して `Chapter` 型として返す

---

### Requirement 3: 章の並べ替え（純粋関数）

**Objective:** As a システム設計者, I want 生成された章をgeneral由来の論点が多い順に並べる純粋関数が存在する, so that 討論の入口が専門知識のない視聴者にとって親しみやすい章になる

#### Acceptance Criteria

1. The chapter generation pipeline shall グループ化・章立て生成とは独立した純粋関数で章の並べ替えを行う
2. The chapter ordering function shall 各グループに含まれる general 由来の論点数が多いグループを先頭に配置する
3. The chapter ordering function shall general 由来の論点数が同数の場合、元のグループ順を維持する
4. When 章立て生成が完了したとき、the chapter generation pipeline shall 並べ替え関数を適用してから `Chapter[]` を返す

---

### Requirement 4: ChapterAnalysisDoc の再設計

**Objective:** As a 開発者, I want 論点情報・スコア・グループ所属が単一の `issues` 配列に集約される, so that 重複なく論点の状態を段階的に表現できる

#### Acceptance Criteria

1. The `Issue` type shall `text: string`、`source: 'general' | 'persona'`、`score?: number`、`reason?: string`、`selected?: boolean` を持ち、論点の唯一の保持先である — `score`/`reason`/`selected` はパイプラインの進行に応じて段階的に付与される
2. The chapter analysis document shall `issues: Issue[]`・`issueGroups?: IssueGroup[]` の構造を持ち、`general`/`persona` の2配列に分けない（`source` フィールドで区別する）
3. The `IssueGroup` type shall `issueIndexes: number[]`（`issues` 配列へのインデックス参照）のみを持ち、論点テキスト等を複製しない — この型はローカル処理と Firestore 永続で同一とする
4. When 論点生成ステップが完了したとき、`planChapters` shall `chapterAnalysis/0` に `issues: [{text, source},...]` を `set` する
5. When スコアリングステップが完了したとき、`planChapters` shall `issues` 各論点に `score`・`reason`・`selected` を追記した形で `update` する
6. When グループ化ステップが完了したとき、`planChapters` shall `issueGroups`（`issueIndexes` のリスト）を `update` する

---

### Requirement 5: 中間アウトプットの Firestore 書き込み更新

**Objective:** As a 管理者ユーザー, I want グループ化完了時点でグループ構成が画面に表示される, so that パイプラインの進行状況をリアルタイムに確認できる

#### Acceptance Criteria

1. When グループ化ステップが完了したとき、the chapter generation pipeline shall `onProgress({ step: 'issues_grouped', issueGroups: [{ issueIndexes }] })` を呼び出す（`chapters_composed` から改名）
2. While 画面表示時、`Phase4Chapters` shall Step1 で `issues` を `source` でフィルタして表示し、Step3 で `issueGroups` の各 `issueIndexes` を `issues` で解決して論点テキストを引きグループ単位で表示する
3. When 章立て生成ステップが完了したとき、`planChapters` shall `topics/{topicId}/chapters` コレクションに `ChapterDoc` を `set` する

---

### Requirement 6: テストの整合性維持

**Objective:** As a 開発者, I want すべての既存テストが新しいパイプライン構造に対応している, so that リグレッションなく実装を変更できる

#### Acceptance Criteria

1. The chapter agent unit tests shall グループ化モック結果として `{ issueGroups: [{ issueIndexes: number[] }] }` を返す形式に更新される
2. The chapter agent unit tests shall 章生成モック結果として `{ chapters: [{ title: string, focusQuestion: string, discussionPoints: string[] }] }` を返す形式に更新される
3. When グループ化プロンプトを検証するテストにおいて、the test shall タイトル・フォーカス問いの生成要求がプロンプトに含まれないことを確認する
4. The chapter generator tests shall `issues_grouped` イベントを発火するコールバックモックを使用する
5. The chapter ordering function shall 純粋関数として単体テストで検証可能である
