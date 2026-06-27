# Gap Analysis: phase-generation-server-authority

承認済み要件（requirements.md）と既存コードベースの差分を分析する。フェーズ5（討論）は既にサーバ権威であり、本分析の**基準モデル**として参照する。

## 1. 現状調査（フェーズ別の責務マップ）

| フェーズ | 成果物の永続化 | `phaseStatus` 確定 | 主な実装箇所 |
|---|---|---|---|
| 1 ステークホルダー | **サーバ**（`stakeholders/0`） | **サーバ**（`'generated'`） | `functions/src/api/stakeholders.ts`（先行修正済）／`src/lib/models/topic/createTopic.svelte.ts` |
| 2 ペルソナ | クライアント（`setDoc` ループ） | クライアント | `functions/src/api/personas.ts`（返すのみ）／`createTopic.svelte.ts:126-154` |
| 3 取材 | クライアント（ペルソナ文書へ書込） | クライアント（全件完了を検知） | `functions/src/api/interviews.ts`（返すのみ）／`src/lib/stores/personas.svelte.ts` |
| 4 章立て | **サーバ**（`chapters/*`・`chapterAnalysis/0`） | クライアント | `functions/src/pipeline/chapters/chapter-generator.ts`／`createTopic.svelte.ts:156-171` |
| 5 討論（基準） | サーバ | **サーバ** | `pipeline/debate/debate-lifecycle.ts`・`pipeline/debate/post-debate-comments.ts` |

### 再利用可能な基準パターン（フェーズ5）
- `updateDebatePhaseStatus(topicId, status)`（[debate-lifecycle.ts:15](functions/src/pipeline/debate/debate-lifecycle.ts#L15)）: `phase: 5, phaseStatus, runId, updatedAt` をトランザクションで書く。
- 事後コメントステップ（[post-debate-comments.ts:47-54](functions/src/pipeline/debate/post-debate-comments.ts#L47-L54)）: **`phaseStatus === 'running'` のときだけ `'generated'` へ遷移する冪等トランザクション**。フェーズ3の「全件完了で1回だけ確定」に直接転用できる。

### 制約・規約
- ステアリング `firebase.md`: 「Firestore の CRUD はフロントエンドで直接」が原則。本仕様は AI 生成物と完了確定に限った**意図的な例外**（要件 Introduction に明記済）。
- ステアリング `structure.md`: 過度な共通化・中央ディスパッチャ禁止。共有化は「真に共通な処理（薄いヘルパー）」に限る。
- `functions/src/db/` は**存在しない**。共有リポジトリ層は未整備（`pipeline/fact-check/fact-check-repository.ts` のようにドメイン配下に置く前例あり）。
- サーバは Admin SDK のため Firestore ルールをバイパス（書込権限の追加対応は不要）。
- テストは専用 `tests/` にミラー配置（`testing.md`）。`src/tests/models/topic/topic.test.ts` は P1 修正で更新済。

## 2. Requirement-to-Asset マップ（ギャップ）

| 要件 | 既存資産 | ギャップ（タグ） |
|---|---|---|
| R1 成果物のサーバ永続化 | P1・P4 はサーバ永続化済 | **Missing**: P2（`personas.ts` が返すのみ）／P3（`runInterview` が返すのみ、結果書込はクライアント） |
| R2 `'generated'` のサーバ確定 | P1 済／post-debate-comments の冪等パターン | **Missing**: P4（クライアント書込→サーバ化、P1と同型）／P2／P3（全件完了の冪等確定） |
| R3 クライアント上書き防止 | P1 はガード実装済（catch で getDoc 確認） | **Missing**: P2（createTopic）・P3（personasStore）・P4（createTopic）に同様のガード／`'generated'` 自書込の撤去 |
| R4 開始・失敗ステータスの一貫化 | `setPhaseStatus`・`markInterviewsStarted/Stopped` | **Constraint**: `'running'` はトリガとしてクライアント維持で可。`'stopped'` の所有（特にP3）は要決定 |
| R5 討論基準への統一 | `updateDebatePhaseStatus`・冪等txパターン | **Opportunity**: サーバ用の薄い `setTopicPhaseStatus` ヘルパー化（過度な抽象化は避ける） |
| R6 中断・リロード耐性 | — | R1/R2 達成で自動的に充足 |
| R7 管理操作の維持 | `approve*`・`reset*` はクライアント | **No change**: 変更しない（境界） |

## 3. 実装アプローチ

### Option A: 既存パターンの横展開（推奨）
P1 で確立した修正型を各フェーズへ適用する。

- **P4 章立て**: `chapters.ts` 呼び出しでチャプター永続化後に `phaseStatus='generated'` をサーバ書込。`createTopic.generateChapters` は `'generated'` 自書込を撤去し、catch を「サーバ確定済みなら `'stopped'` で上書きしない」ガードへ。→ P1 と**完全に同型**。
- **P2 ペルソナ**: `personas.ts` 呼び出しでペルソナ文書（`sortOrder`・`approved:false`・`beliefs:[]`・`createdAt` ＋生成フィールド）をサーバ永続化し、`'generated'` を確定。戻り値は ids 程度に縮小。`createTopic.generatePersonas` は `setDoc` ループを撤去し、呼び出し＋ガードのみに。
- **P3 取材**（クライアント並列維持）: サーバ `runInterview` が**自ペルソナの結果を永続化**し、同一呼び出し内の冪等トランザクションで「全ペルソナ `completed`」を検知したら `'generated'` を確定（post-debate-comments パターン転用）。クライアントは fan-out と `'running'`（開始）・ペルソナ単位リトライは維持し、結果書込と `markInterviewsComplete` を撤去。
- **共有**: サーバ用の薄い `setTopicPhaseStatus(topicId, phase, status)`（および running→generated 限定の冪等版）を1つ用意。`updateDebatePhaseStatus` の汎用化に留め、ディスパッチャ化はしない。

**Trade-offs**: ✅ 既存パターンで一貫・低リスク。✅ フェーズ5と同モデルに収束。❌ P2/P3 はクライアントの永続化撤去に伴う戻り値・テストの広めの修正。

### Option B: リポジトリ/中央フェーズ管理層を新設
`functions/src/db/repository.ts` を作り全フェーズの書込を集約。
**Trade-offs**: ✅ 集約。❌ `structure.md` の「過度な共通化・中央化禁止」に反する。**非推奨**。

### Option C: ハイブリッド（P3 のみクライアント完了確定を温存）
P1/P2/P4 は Option A、P3 は結果永続化のみサーバ化し、完了確定は `markInterviewsComplete` を**ガード付き**で残す。
**Trade-offs**: ✅ P3 のリスク低減。❌ P3 だけ完了確定がクライアント残存で要件R5（一貫性）を部分的に満たさない。

## 4. 複雑度・リスク

| 対象 | Effort | Risk | 根拠 |
|---|---|---|---|
| P4 章立て | S（1-3日） | Low | P1 と同型。サーバ1書込＋クライアント1ガード |
| P2 ペルソナ | M（3-7日） | Medium | 永続化のサーバ移管・戻り値変更・FE/Functions 両テスト更新 |
| P3 取材 | M〜L | Medium-High | 並列呼び出し下の冪等な全件完了検知、`error`/`stopped` 意味論、リトライ経路、UI 状態整合 |
| 共有ヘルパー | S | Low | `updateDebatePhaseStatus` の薄い一般化 |

## 5. 設計フェーズへの申し送り

### 推奨
- **Option A** を採用（P3 のリスクが高ければ C へ後退可）。実装順は **P4 → P2 → P3**（容易・低リスク順、P1 は完了済）。
- 共有 `setTopicPhaseStatus`（＋ running→generated 限定の冪等版）を新設し、4フェーズ＋討論で共通利用。配置は `functions/src/utils/` か `pipeline/topics/` を設計で決定。

### Research Needed
1. **P3 の完了・失敗セマンティクス**: 並列呼び出し下で全件 `completed` を検知する冪等トランザクション設計。`error` ペルソナ存在時の phase 状態（`'running'` 据置 vs `'stopped'`）と、誰が `'stopped'` を書くか（クライアント catch を残す場合のガード方式）。リトライ後の再確定。
2. **冪等ガードの統一規則**: `running → generated` のみ許可し、`approved`/`stopped` を不用意に上書きしない遷移ルール（post-debate-comments を踏襲）。
3. **`generated` 自書込撤去後の `'running'` 所有**: クライアントがトリガとして `'running'` を書く現行を維持するか、サーバ開始時書込に寄せるか（一貫性 vs UX 即時性）。
4. **戻り値・型の影響範囲**: `generatePersonas`/`runInterview` のレスポンス縮小に伴う FE 呼び出し側・型定義の更新範囲。
5. **テスト更新**: `topic.test.ts`（P2/P4: クライアントが `'generated'`/persona を書かないこと）、`personas.svelte` ストアテスト（P3: 結果書込・完了確定の撤去）、Functions 側 `personas.ts`/`chapters.ts`/`interviews.ts` の phase 書込テスト追加。
