# Research & Design Decisions

## Summary
- **Feature**: `editing-pass-resilience`
- **Discovery Scope**: Extension（編集チェーン・出力を「記事＝順序付きセクション」へ再フレーム）
- **Key Findings**:
  - 編集出力は概念上「1つの記事」で、順序付きセクション（導入・本体(章)・締め・所感）から成る。各部品は draft→final の統一ライフサイクルを持ち、差は「数」と「原本の作り方」だけ。
  - `runChapterEditStep`（runId 非使用）・`runIntroClosingStep`（runId ログのみ）は単体再実行可。`finalizeEditingRun` は stopped→generated 再評価に流用可。
  - 所感を personaId キーのマップにすると個別再生成が read 不要の blind write になり、統合ドキュメント内でも競合しない。導入/締めも同様にフィールドの blind write。

## Research Log

### 出力の再フレーム: 記事＝セクション
- **Context**: 「出力はバラバラの生成物ではなく、最終的に1記事へ統合される部品」という要件者の設計意図。
- **Findings**: 導入・本体・締め・所感は記事のセクション。物理ストレージの分割は概念と独立に選べる。
- **Implications**: 堅牢化・可視化・個別再生成・命名を、セクション共通の作法1つで設計する。読み取り側で記事へ結合。

### 統合ドキュメントと競合回避
- **Context**: 1ドキュメント統合と、同時個別再生成の競合。
- **Findings**: 競合の本体は「配列の read-modify-write」。所感を配列→personaId キーのマップにすると、個別再生成は該当キーの blind write（read 不要）になり競合しない。分割は不要。
- **Implications**: 導入/締め/所感を `editorial/0` 1ドキュメントに統合し、所感はマップ。部分更新（blind write）で競合ゼロ。

### 本体(章)の物理統合と 1MB 制約
- **Context**: 「最終的に本体も含め1記事へ」というゴール像。
- **Findings**: Firestore 1ドキュメント上限 1MB。長尺討論（最大〜200ターン、日本語）の編集後本体は数百KB〜1MBに接近しうる。
- **Implications**: 本体(章)は当面 `editedChapters` 別保存。概念上は記事のセクション。サイズ保証が取れたら畳めるが、読み取りモデル（記事＝セクション）は不変。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 出力ごとに別 doc・別処理 | 現状 | 既存踏襲 | バラバラ・非対称・統合前提でない | 却下 |
| 記事＝セクション統一形 ＋ editorial 統合 doc（所感マップ）＋本体別保存 | 採用 | 共通作法1つ・競合なし blind write・統合前提・移行不要 | 本体の物理統合は 1MB 制約で先送り | **採用** |

## Design Decisions

### Decision: 出力を「記事の順序付きセクション」として設計
- **Selected Approach**: 導入・本体・締め・所感をセクションとし、各部品は draft→final・完成=final。堅牢化/可視化/個別再生成/命名を共通作法で。
- **Rationale**: 生成過程の部品を「1記事のセクション」として統合前提で扱う要件意図に一致。将来の完全統合を塞がない。

### Decision: 導入/締め/所感を editorial/0 に統合・所感は personaId マップ
- **Selected Approach**: `editorial/0 = { intro:{draft,final}, outro:{draft,final}, comments:{personaId:{sortOrder,draft,final}} }`。個別再生成は該当キーの部分更新（blind write）。
- **Rationale**: 1ドキュメントの簡潔さと、同時個別再生成の競合ゼロを両立。分割は不要。

### Decision: 命名整理（closing→outro、所感=impressions、comments 予約）
- **Selected Approach**: 締め=`outro`（intro と対称）、所感=`impressions`。旧 `postDebateComments`/`editedPostDebateComments`/`editedIntroClosing` は `editorial/0` に統合し廃止。関数も `generateClosing`→`generateOutro`、`generatePostDebateComment`→`generateImpression`、`editComments`→`editImpressions`、`editIntro`/`editOutro` 新設。
- **Rationale**: 冗長・非対称の解消。`comments` は将来の「一般ユーザーが公開記事に貼るコメント」機能のために予約し、参加者の所感には使わない（衝突回避）。

### Decision: 記事の語彙と個別再生成の分割
- **Selected Approach**: 全体＝**記事（Article）**、独立に作り直せる最小単位＝**記事要素（`ArticleElement`）**（章/導入/締め/所感）。個別再生成のコアは種別ごとに4関数（`regenerateChapter`/`regenerateIntro`/`regenerateOutro`/`regenerateImpression`）に分割し、onCall `regenerateArticleElement` は認証・実行中拒否・振り分けだけの薄い入口にする。
- **Rationale**: 各再生成は共通ロジックがほぼ無いため1関数に押し込まない。共通なのは入口の停止ゲートのみ。用語は読み手が理解できるよう design 冒頭に定義を置く。

## Risks & Mitigations
- 本体(章)の 1MB 超（長尺討論） — 本体は別保存を維持。将来の物理統合はサイズ保証を前提。
- 同時個別再生成の競合 — blind write（キー部分更新）で回避。
- 生成中の誤「未完成」表示 — `editingSettled`（generated/stopped）でのみ明示。
- デプロイ [project-no-emulator] — functions 変更は本番デプロイ必須。討論側非干渉で編集側のみ完結。

## References
- 旧 `post-debate-comment-generation-decouple`（原本生成の編集移設・chapter-end 終端）
- ステアリング `tech.md` / `structure.md` / `testing.md`
