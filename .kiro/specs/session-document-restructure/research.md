# Research & Design Decisions

---
**Feature**: `session-document-restructure`
**Discovery Scope**: Complex Integration（既存コードへの広範な影響）

## Summary

- **Key Findings**:
  - `sessions/0` は現在11フィールドを持ち、ライフサイクルが異なる4種類のデータを混在させている
  - データ移動後に残るメタデータ（createdAt/completedAt/publishedAt/totalTurns）はすべて死にフィールドか導出可能 → **sessions/0 ドキュメントごと廃止**できる
  - `engagements` サブコレクションは sessions/0 廃止に伴い `topics/{topicId}/engagements` へ移動が必要
  - ターンへの `chapterId` フィールドは、チャプタードキュメントに分散管理すれば不要になる
  - `DebateViewer` が使う `startTurnIndex` は、各チャプタードキュメントの最初のターンの `turnIndex` から導出可能（明示保存不要）
  - `restartChapter` の配列フィルタリング処理がチャプタードキュメント削除に単純化される
  - 後方互換フォールバックは設けない（クリーン切替・再生成で移行）

## Research Log

### sessions/0 フィールドのライフサイクル分析

- **Findings**:
  - `createdAt/completedAt/publishedAt/totalTurns`: セッション期間に存在・更新される純粋なメタデータ
  - `turns[]`: 討論中に `FieldValue.arrayUnion` で逐次追記される討論記録
  - `chapters[]/currentChapterIndex`: Phase4 で生成、Phase5 実行の基盤、完了後も参照される
  - `chapterIssues`: Phase4 生成時のみ書き込み、管理画面表示以外に用途なし
  - `discussionPointStatuses`: 各チャプター開始時にリセット、完了時またはやり直し時に `FieldValue.delete()` される
  - `postDebateComments[]`: 討論完了直前（finalizeDebate内）のみ追記される後処理成果物

### chapterId フィールドの扱い

- **Context**: 現在 `DebateTurn.chapterId` でどのチャプターに属するターンかを識別している
- **Findings**:
  - `debate-orchestrator.ts`: `state.turns.filter((t) => t.chapterId === chapter.id)` でチャプターターン数をカウント
  - `debate-lifecycle.ts`: `restartChapter` でチャプター以降のターンを `chapterId` でフィルタリング
  - チャプタードキュメントにターンを分散させれば、所属チャプターはドキュメント自体で表現され `chapterId` フィールドは不要
- **Implications**: `DebateTurn` 型から `chapterId` を除去できる。ただし `chapterTurnCount()` はドキュメント内の turns.length で代替

### startTurnIndex の扱い

- **Context**: `ChapterDoc.startTurnIndex` が `DebateViewer.svelte` でチャプター境界判定に使われている
- **Findings**: チャプタードキュメントが turns[] を持つ場合、章の最初のターンの `turnIndex` が `startTurnIndex` に相当する
- **Implications**: `startTurnIndex` は `chapter.turns[0]?.turnIndex` から導出可能。明示的フィールドが不要になる。`DebateViewer` のチャプター境界ロジックを修正が必要

### Firestore reads の変化

- **Context**: chapters コレクションに分散後、全ターンを取得するには複数ドキュメント読み込みが必要
- **Findings**:
  - 通常チャプター数は4〜8件（Firestore読み込み上限1MBから遠い）
  - SvelteKit SSR では公開ページのキャッシュが有効（`+page.server.ts` でのプリロード対象）
  - `firebase.md` の「常に一緒に読むデータは同じドキュメントへ」原則に一見反するが、チャプター数が有界で小さいため許容範囲
- **Implications**: 公開ページで章+ターン取得に複数 `getDocs` が必要。`onSnapshot` を chapters コレクション全体に張ることで管理画面はリアルタイム性を維持できる

### 生成物の配置方針（topic = 進行管理、生成物 = サブコレクション）

- **Context**: ユーザー方針「topic は進行管理に徹し、各フェーズの生成物は専用サブコレクション（固定IDドキュメント）に置く」
- **Selected**:
  - `postDebateComments` → `topics/{topicId}/postDebateComments/0`
  - `chapterIssues` → `topics/{topicId}/chapterAnalysis/0`
- **Rationale**: topicドキュメントを進行管理（phase/phaseStatus/publishedAt）に限定し、肥大化を防ぐ。各生成物はライフサイクルが異なるため独立ドキュメントが自然。固定ID `0` で 1:1 関係をパス決定的に表現（firebase.md の方針）
- **Note**: `stakeholders` も同じ方針でサブコレクション化できるが、Phase1 の直交課題かつ本スペックの原問題（session 整理）外のため、今回は topic 埋め込みのまま据え置き（後続スペック候補）

### 後方互換フォールバックの要否

- **Context**: 既存本番データは旧 sessions/0 構造。フォールバックを設けるか
- **Selected**: **設けない（クリーン切替）**
- **Rationale**: ユーザー判断。フォールバックは移行後に除去する追加作業を生む。既存の生成済み・公開済み討論は管理者が章立てから再生成して新構造へ移行する
- **Trade-off**: 移行前の既存トピックは再生成まで表示が壊れる。管理者運用で許容

### sessions/0 廃止可否の検証

- **Context**: 全データ移動後、sessions/0 に残るメタデータ（createdAt/completedAt/publishedAt/totalTurns）が必要か
- **Findings**（grep による実使用調査）:
  - `createdAt`: どこからも読まれていない。`topic.createdAt` が既に存在
  - `completedAt`: `finalizeDebate` で書き reset で消すが、制御フローで読む箇所が0件
  - `publishedAt`: 公開判定・一覧ソート・表示はすべて `topic.publishedAt` を参照。`session.publishedAt` は書かれるが読まれない（冗長）
  - `totalTurns`: `Phase5Debate.svelte` の進捗表示1箇所のみ。完了時にしかセットされず `chapters` のターン数から導出可能
  - `getDebateSessionByTopicId` の2呼び出し元（orchestrator・debates.ts）はいずれも `session.chapters`/`currentChapterIndex` のみ使用 → chapters コレクションへ移動
- **Implications**: sessions/0 のメタデータはすべて死にフィールドか導出可能。ドキュメントごと廃止できる。完了状態は `topic.phaseStatus === 'generated'`（finalizeDebate のトランザクションで設定済み）＋全チャプター `status: 'completed'` で表現

### engagements サブコレクションの移動

- **Context**: `engagements` は現在 `topics/{topicId}/sessions/0/engagements/{personaId}`。sessions/0 廃止で親が消える
- **Findings**: engagements ドキュメントは2種のデータを持つ
  - `history`: `history.${turnIndex}`（グローバル）でターンごとの発言意欲スコアを蓄積。フロントは全 engagements を1コレクション読みし turnIndex でマップ化して表示
  - `queuedIntents`: 保留中の発言意図。`triggerTurnIndex` + `INTENT_EXPIRY_TURNS` で失効し、**章開始時に `loadQueuedIntents` が全ペルソナ分をロードするためチャプター境界をまたいで持ち越される**
- **Selected**: `topics/{topicId}/engagements/{personaId}` に移動（チャプター別ではなくトピック直下）
- **Rationale**: 集約単位はチャプターではなくペルソナ。`queuedIntents` が章をまたぐため per-chapter にすると分断する。フロント読み出しも1コレクション読みで済む
- **Follow-up（後継spec候補）**: `history` を chapters 配下に分割する案を別スペックで検討する。その場合 `queuedIntents`（章またぎ）と `history`（章局所）の分離設計が前提になる

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | Notes |
|--------|-------------|-----------|-------|-------|
| chapters コレクション（採用） | `chapters/{chapterId}` を主単位としターンを各チャプターに分散 | データの意味的まとまり、やり直し処理が単純化 | 全ターン取得に複数読み込み | チャプター数が有界なため現実的 |
| sessions/0 継続 + フィールド分割のみ | chapterIssues と postDebateComments だけ別出し | 変更最小 | 根本問題（sessions混在構造）が残る | ユーザーが「chapters を主単位に」を要件として選択 |

## Design Decisions

### Decision: `turnIndex` のスコープ（グローバル vs チャプター内）

- **Context**: ターンをチャプター別ドキュメントに分散した際、turnIndex をどのスコープで管理するか
- **Alternatives**:
  1. グローバル連番を維持
  2. チャプター内連番に変更（`chapterIndex + 配列位置` で全体順序を導出）
- **Selected**: グローバル連番を維持（このスペックのスコープ外として据え置き）
- **Rationale**: engagement 履歴（`history.${turnIndex}`）・`QueuedIntent.triggerTurnIndex`・`DebateState.lastFacilitatorTurnIndex` など広範な依存がある。除去自体は技術的に可能（turnId への置き換え）だが変更範囲が大きく、このスペックの変更と分離して別スペックで対処する
- **Follow-up**: `turnIndex` 廃止スペックで対処（engagement・QueuedIntent・DebateState の依存を一括置換）

### Decision: chapters コレクションの `status` フィールド

- **Context**: 現行の `currentChapterIndex` をどう置き換えるか
- **Selected**: 各チャプタードキュメントに `status: 'pending' | 'running' | 'completed'` を持たせる
- **Rationale**: `currentChapterIndex` は「どのチャプターが実行中か」を示す。チャプタードキュメント自体に status を持たせれば、`status === 'running'` のドキュメントを参照するだけでよく、追加の sessions/0 読み込みが不要になる

### Decision: `restartChapter` の単純化

- **Context**: 現行は `sessions/0.turns` を配列フィルタリングして削除。複雑なロジックがある
- **Selected**: 対象チャプター以降のチャプタードキュメントの `turns` と `discussionPointStatuses` をリセット（空配列 / deleteField）し、`status` を `'pending'` に戻す
- **Rationale**: チャプタードキュメント単位で管理するため、配列フィルタリングが不要になる

## Risks & Mitigations

- **本番データの後方互換性** — 旧 sessions/0 構造のデータが存在する。フォールバック読み込みを実装し、移行期間中は両構造を許容する
- **chapters コレクション読み込みの原子性** — 複数ドキュメントを同時読み込みする際、書き込み中の状態を読む可能性がある。ターン追記は `FieldValue.arrayUnion` で原子的なため基本は安全。コレクション全体読み込みはスナップショット一貫性が保証されない点を許容する
- **`chapterId` 除去による tests の修正範囲** — 多数のテストが `chapterId` を持つターンを使っている。型変更に伴いテストデータの更新が必要

## References

- `functions/src/pipeline/debate/debate-orchestrator.ts` — chapterTurnCount、saveDiscussionPointStatuses の実装
- `functions/src/pipeline/debate/debate-lifecycle.ts` — restartChapter の現行実装
- `functions/src/pipeline/chapters/chapter-generator.ts` — sessions/0 への章データ書き込み
- `src/lib/features/topics/detail/DebateViewer.svelte` — startTurnIndex によるチャプター境界判定
- `.kiro/steering/firebase.md` — Firestore 設計原則（埋め込み vs サブコレクション）
