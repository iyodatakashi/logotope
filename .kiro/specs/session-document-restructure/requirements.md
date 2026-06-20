# Requirements Document

## Project Description (Input)
sessionドキュメントの役割が多すぎるので整理したい。chapterIssesはchapterを生成するための中間生成物なので、session実行中は不要。chaptersやdiscussionPointStatusなども同一ドキュメントにある必要があるか要検討。postDebateCommentもsession後に生成するものなのでsessionにいる必要はない。など。

## Introduction

`topics/{topicId}/sessions/0` ドキュメントは現在、討論の実行記録・チャプター設定・ランタイム状態・後処理成果物など、ライフサイクルの異なるデータを混在して保持している。このフィーチャーでは、各フィールドのライフサイクルと利用用途を分析し、データを適切なドキュメントへ分散させる。分析の結果、**`sessions/0` ドキュメントは廃止する**（後述）。

### 現状の SessionDoc フィールド（`topics/{topicId}/sessions/0`）と移動先

| フィールド | 用途 | 移動先 |
|---|---|---|
| `turns` | 討論ターンの記録（全チャプター混在） | `chapters/{chapterId}.turns`（チャプター別に分散） |
| `chapters`, `currentChapterIndex` | チャプター構成と進行状態 | `chapters/{chapterId}` コレクション（`status` で進行表現） |
| `chapterIssues` | チャプター生成の中間成果物 | `chapterAnalysis/0`（Phase4 成果物） |
| `discussionPointStatuses` | 論点カバレッジのランタイム追跡 | `chapters/{chapterId}.discussionPointStatuses` |
| `postDebateComments` | 討論後の各ペルソナコメント | `postDebateComments/0` |
| `createdAt` | セッション作成時刻 | 廃止（`topic.createdAt` が既に存在し、読み取りなし） |
| `completedAt` | 討論完了時刻 | 廃止（制御フローで読まれていない） |
| `publishedAt` | 公開時刻 | 廃止（`topic.publishedAt` に一本化済み） |
| `totalTurns` | 総ターン数 | 廃止（`chapters` のターン数から導出） |

### 構造上の問題と方針

`sessions/0` という名前で「1セッション=1ドキュメント」としているが、実態はチャプターをまたいだ全ターン・全状態を1ドキュメントに詰め込んでいる。討論はチャプターを単位として進行するため、**`chapters/{chapterId}` をプライマリコレクションとし、チャプターごとにそのターン・論点状態等を管理する構造**の方が概念的に自然である。

さらに、各フィールドを移動した後の `sessions/0` に残るメタデータ（`createdAt`/`completedAt`/`publishedAt`/`totalTurns`）は、すべて死にフィールドか `topic` ドキュメント・`chapters` からの導出可能なもので占められる。そのため **`sessions/0` ドキュメント自体を廃止**し、次の責務分離を徹底する：

- **`topics/{topicId}`**: 討論全体の進行管理（`phase`/`phaseStatus`/`publishedAt` 等）に徹する
- **各フェーズの生成物**: それぞれ専用のサブコレクション（固定IDドキュメントまたはエンティティ別ドキュメント）に置く

## Boundary Context

- **In scope**: `SessionDoc` の廃止、各フィールドの適切な保存先への移動、フロントエンド・パイプライン双方のデータアクセス更新、リセット処理の整合性維持
- **Out of scope**: ターンデータ（`turns`）のサブコレクション化（チャプタードキュメント内の配列を維持）、`turnIndex` のグローバル連番廃止（別スペックで対処）、討論アルゴリズム・エージェントロジックの変更、UIデザインの変更
- **Adjacent expectations**: `firebase.md` のFirestore設計原則（ドキュメント1MB上限・読み込み課金・埋め込みvsサブコレクションの判断基準）を遵守する

## Requirements

### Requirement 1: チャプターをプライマリコレクションとしたドキュメント階層への再設計

**Objective:** As a 開発者, I want `chapters/{chapterId}` をプライマリコレクションとして討論データを管理する, so that データ構造が討論の実行単位（チャプター）と一致し、各チャプターのデータが独立して管理できる。

#### 想定する新しい Firestore 構造

```
topics/{topicId}                            ← 進行管理のみ
  title, phase, phaseStatus
  description?, sourceUrls?, fetchedSourceContents?
  personaCount?, createdAt, updatedAt, publishedAt?

topics/{topicId}/personas/{personaId}       ← Phase2/3（変更なし）

topics/{topicId}/chapters/{chapterId}       ← Phase4生成・Phase5更新
  chapterIndex: number
  title: string
  focusQuestion: string
  discussionPoints: string[]
  turns: TurnDoc[]                          ← そのチャプターのターンのみ
  discussionPointStatuses?: DiscussionPointStatusDoc[]  ← そのチャプターの論点追跡
  status: 'pending' | 'running' | 'completed'

topics/{topicId}/chapterAnalysis/0          ← Phase4 中間成果物（旧 chapterIssues）
  general: string[]
  persona: string[]

topics/{topicId}/postDebateComments/0       ← Phase5 後処理
  comments: PostDebateCommentDoc[]

（topics/{topicId}/sessions/0 は廃止）
```

#### Acceptance Criteria

1. The System shall `topics/{topicId}/sessions/0` ドキュメントを廃止する
2. The System shall チャプターデータを `topics/{topicId}/chapters/{chapterId}` コレクションで管理する
3. When Phase4でチャプターが生成される, the Chapter Pipeline shall 各チャプターを独立したドキュメントとして `chapters/` コレクションに書き込む
4. The Chapter Doc shall そのチャプターに属するターン（`turns`）と論点追跡（`discussionPointStatuses`）のみを保持する
5. When 討論が完了し各ペルソナのコメントが生成される, the Debate Pipeline shall `postDebateComments`を固定IDサブドキュメント `topics/{topicId}/postDebateComments/0` に保存する
6. When Phase4でチャプターが生成される, the Chapter Pipeline shall `chapterIssues`を固定IDサブドキュメント `topics/{topicId}/chapterAnalysis/0` に保存する
7. The System shall 公開判定・一覧ソート・公開日時表示に `topic.publishedAt` を使用する（旧 `session.publishedAt` を廃止する）
8. The System shall 討論完了状態を `topic.phaseStatus` と全チャプターの `status` で表現する（旧 `session.completedAt` を廃止する）
9. The Admin UI shall 進捗表示の総ターン数を `chapters` のターン数から導出する（旧 `session.totalTurns` を廃止する）

---

### Requirement 2: チャプター単位でのターン管理

**Objective:** As a 開発者, I want ターンをチャプターごとに分割して管理する, so that チャプターのやり直し・削除が配列フィルタリングではなくドキュメント操作で完結する。

#### Acceptance Criteria

1. The Chapter Doc shall そのチャプター内で生成されたターンを `turns` 配列として保持する
2. While 討論が実行中, the Debate Pipeline shall 新しいターンを対応するチャプタードキュメントの `turns` に `FieldValue.arrayUnion` で追記する
3. When 特定チャプターのやり直しが実行される, the Debate Pipeline shall 対象チャプター以降のチャプタードキュメントの `turns` をクリアする（配列フィルタリング不要）
4. When 討論閲覧ページが表示される, the Frontend shall 全チャプタードキュメントを読み込み、`chapterIndex` 順にターンを結合して表示する
5. The System shall `DebateTurn` 型から `chapterId` フィールドを除去する（チャプタードキュメント自体が所属を示すため不要）

---

### Requirement 3: チャプターランタイム状態の独立管理

**Objective:** As a 開発者, I want discussionPointStatusesをチャプタードキュメントで管理する, so that 論点追跡状態がそのチャプターのデータと同じ場所に存在する。

#### Acceptance Criteria

1. The Chapter Doc shall `discussionPointStatuses` をそのチャプターの論点追跡状態として保持する
2. While 討論が実行中, the Debate Orchestrator shall `discussionPointStatuses` を対応するチャプタードキュメントに更新する
3. When チャプターのやり直しが実行される, the Debate Pipeline shall 対象チャプタードキュメントの `discussionPointStatuses` をリセットする
4. When チャプターが完了する, the Debate Pipeline shall そのチャプタードキュメントの `discussionPointStatuses` を削除する（完了後は不要）
5. When Phase5管理画面が表示される, the Admin UI shall 現在実行中のチャプタードキュメントを onSnapshot で購読し `discussionPointStatuses` をリアルタイムで表示する

---

### Requirement 4: データアクセスの一貫性とマイグレーション

**Objective:** As a 開発者, I want 再設計後のデータ構造がフロントエンドとバックエンドで一貫して扱われる, so that 既存の動作を維持しつつドキュメント構造が整理される。

#### Acceptance Criteria

1. The Frontend shall `chapters/`・`chapterAnalysis/0`・`postDebateComments/0` への onSnapshot 購読を管理する専用ストアを持つ
2. When 各種管理操作（やり直し・停止・完了）が実行される, the Debate Pipeline shall 関連するすべてのドキュメント（チャプター・`postDebateComments/0`）をアトミックに更新する
3. The System shall `sessions/0` への読み書きをコードベース全体から除去する（型定義・ストア・パイプライン・リセット処理）
4. The TypeScript 型定義（`ChapterStateDoc`・`DebateSession` 等）shall 新しいドキュメント構造を正確に反映し、`SessionDoc` 型を除去する
