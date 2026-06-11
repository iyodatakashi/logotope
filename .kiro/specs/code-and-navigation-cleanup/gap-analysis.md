# Gap Analysis: code-and-navigation-cleanup

## 1. 現状調査サマリー

リファクタリング系スペックのため、本分析は「要件に対する不足機能の特定」ではなく「削除・改善対象の棚卸し」が中心となる。コードベース全体を調査し、以下の具体的な対象を特定した。

### 1.1 未使用コードの棚卸し（Requirement 1 対応）

| 対象 | 種別 | 根拠 |
|---|---|---|
| `src/routes/demo/+page.svelte` | デモルート | SvelteKit初期スキャフォールド。本番機能から未リンク |
| `src/routes/demo/playwright/+page.svelte` | デモルート | 同上。`page.svelte.e2e.ts` からのみ参照 |
| `src/lib/components/admin/DebatePreview.svelte` (+spec) | コンポーネント | コードベース内参照ゼロ |
| `src/lib/components/admin/InterviewReview.svelte` (+spec) | コンポーネント | 参照ゼロ |
| `src/lib/components/admin/PersonaReview.svelte` (+spec) | コンポーネント | 参照ゼロ |
| `src/lib/components/admin/StakeholderReview.svelte` (+spec) | コンポーネント | 参照ゼロ |
| `src/lib/api/client.ts` (+`client.spec.ts`) | APIクライアント | `authFetch`/`buildAuthHeaders` は参照ゼロ。httpsCallable（`api/topics.ts`）に置き換え済みの旧REST実装 |
| `src/lib/vitest-examples/` 一式 | サンプル | スキャフォールドのサンプルコード（greet, Welcome） |
| `src/lib/index.ts` | 空スタブ | コメントのみ |
| `functions/src/pipeline/debate-orchestrator.test.ts:34` | 壊れた参照 | 存在しない `./progress-tracker.js` から型をimport。モック含め古い実装の残骸 |

**注意**: `demo/playwright/page.svelte.e2e.ts` はプロジェクト唯一のE2Eテスト。デモルート削除は唯一のE2Eを失うことを意味する（→ §4 判断事項）。

### 1.2 progress コレクション（Requirement 2 対応）— **すでに撲滅済み**

`progress/{topicId}` コレクションへの読み書きはフロントエンド・Functions ともに**存在しない**（grep全件確認済み）。残骸は以下のみ:

- `debate-orchestrator.test.ts` の `ProgressTrackerService` 型import（存在しないファイル参照）

→ **Requirement 2 は実質完了済み**。要件を「残骸（テストの古いモック）の除去と撲滅完了の検証」に縮小するか、Requirement 1 に統合することを推奨。

### 1.3 重複・規約違反（Requirement 3 対応）

| 対象 | 内容 |
|---|---|
| `src/routes/+page.svelte:11-34` | 公開トップでFirestoreクエリをインライン実装。firebase.md の「Firestoreアクセスは `src/lib/stores/` に集約」に違反。`createTopicsStore`（published フィルタ版）への統合候補 |
| `admin/+page.svelte:22-30` / `admin/debate/[id]/+page.svelte:18-26` | `onAuthStateChanged` + store起動のパターンが2ページで重複。authStore があるのに生の Firebase Auth リスナーを各ページが張っている |
| `admin/+layout.svelte:9-18` | 50ms間隔の `setInterval` で認証状態をポーリング。authStore のリアクティブ状態（`$effect`）で代替可能なハック実装 |
| `topics/new/+page.svelte:10` ほか | `function` 宣言（プロジェクト規約はアロー関数） |

### 1.4 画面遷移の問題点（Requirement 4 対応）

| 箇所 | 問題 | 要件対応 |
|---|---|---|
| `admin/+page.svelte:37` | `location.href = '/admin/topics/new'` でフルページリロード遷移。SPA内遷移（`goto`）と混在し不自然 | 4.6 |
| `admin/login/+page.svelte:16` | ログイン成功後は常に `/admin` 固定。元いたページへ戻れない（redirect パラメータなし） | 4.2 **Missing** |
| `admin/+layout.svelte` | 未認証リダイレクト時に元のURLを保持しない | 4.2 **Missing** |
| `admin/debate/[id]/+page.svelte:46-47` | 存在しないトピックIDでも「読み込み中...」を永久表示（not found 状態がない＝行き止まり） | 4.4 **Missing** |
| `admin/login` | 認証済みユーザーがアクセスしてもダッシュボードへリダイレクトされない | 4.6（軽微） |
| 公開ページ | トップ・討論閲覧ともローディング表示・not found・戻る導線あり | 4.3/4.5 ✅ 既存OK |
| テーマ作成→`/admin/debate/{id}` 遷移 | 実装済み | 4.1 ✅ 既存OK |

### 1.5 ステアリングと実態の乖離（付随発見）

- `structure.md`: `admin/topics/+page.svelte`・`functions/src/api/topics.ts`・`pipeline/stakeholder-analyzer.ts` 等を記載しているが実在しない（構成が変わった後の更新漏れ）
- `tech.md`: 公開ページは「`+page.server.ts` でSSR配信しSEO確保」とあるが、`+page.server.ts` は1つも存在せず全ページクライアントレンダリング（onMount + onSnapshot）

→ ステアリング更新は本スペックのスコープ外だが、完了後に `/kiro:steering` での同期を推奨。SSR化はSEOに関わる別件として切り出すべき（本スペックの Out of scope に合致）。

## 2. Requirement-to-Asset Map

| 要件 | 既存資産 | ギャップ | タグ |
|---|---|---|---|
| R1 未使用コード削除 | §1.1 の10項目を特定済み | 削除実行と参照確認のみ。網羅検出ツール（knip等）は未導入 | Constraint |
| R2 progress撲滅 | 撲滅済み | テストの残骸1件のみ。**要件の縮小を推奨** | 済 |
| R3 重複統合 | stores パターン確立済み | 公開トップのインラインクエリ、auth リスナー重複 | Missing |
| R4 画面遷移 | 主要遷移は概ね健全 | ログイン後復帰、not found 行き止まり、`location.href` 混在 | Missing |
| R5 非回帰 | Vitest（unit多数）、`pnpm check`、Playwright設定 | E2E実体はデモ用1件のみ。デモ削除でE2Eゼロになる | Constraint / Unknown |

## 3. 実装アプローチ

### Option A: 既存ファイルの修正のみ（削除＋ピンポイント修正）
- 未使用ファイル削除、`location.href`→`goto`、not found 分岐追加、login に redirect パラメータ追加
- ✅ 最小差分・低リスク ❌ auth リスナー重複と認証ガードのポーリングは残る

### Option B: 認証・データアクセス層の整理を含む統合
- A に加え、認証ガードを `$effect` ベースに書き換え、ページ個別の `onAuthStateChanged` を layout/authStore に集約、公開トップのクエリを stores に移動
- ✅ 規約（firebase.md）との整合が取れ、重複が根絶 ❌ 認証フローの回帰リスクがやや上がる

### Option C: 段階実施（推奨）
- Phase 1: 削除系（§1.1 全件 + テスト残骸）— 挙動変更ゼロ、ビルド・型チェックで検証
- Phase 2: 画面遷移修正（§1.4）— 1項目ずつ独立して検証可能
- Phase 3: 重複統合（§1.3）— 認証まわりは最後に慎重に
- ✅ 各段階で非回帰確認でき、ロールバック単位が明確 ❌ コミットが分かれる程度

## 4. 工数・リスク

- **Effort: S（1–3日）** — 削除対象は特定済み、遷移修正は局所的、新規アーキテクチャなし
- **Risk: Low〜Medium** — 削除・遷移修正は Low。認証ガード書き換え（Option B/C Phase 3）のみ Medium（ログイン/ログアウト/直リンクの動作確認必須）

## 5. 設計フェーズへの推奨事項

1. **Option C（段階実施）を推奨**。削除 → 遷移 → 統合の順
2. **Requirement 2 の扱いを決める**: 撲滅済みのため「残骸除去＋検証」に縮小（要件修正）するのが正確
3. **E2Eテストの扱いを決める**: デモルート削除と同時に唯一のE2Eが消える。(a) E2Eごと削除し unit + `pnpm check` を非回帰基準とする、(b) 公開トップ・討論閲覧の実E2Eを書く — のいずれかを設計で決定
4. **Research Needed**:
   - 未使用「エクスポート・型」の網羅検出（knip / ts-prune の導入要否。手動grepでは型定義の取りこぼしリスク）
   - `@14ch/svelte-ui` で置換可能な手書きUI（badge・カード等）の特定（R3.3）
5. スコープ外として記録: 公開ページのSSR化（tech.md との乖離）、ステアリング3ファイルの更新

## 6. 追補: 管理画面フェーズナビゲーションの現状詳細（ユーザーフィードバック反映）

ユーザー方針: `/admin/debate/[id]` の status による単一ページ表示切替を廃止し、フェーズごとにURLを分けたステップナビゲーションに再構築する。

### 現状の構造
- `admin/debate/[id]/+page.svelte` が `topic.status` で `Phase1Stakeholders`〜`Phase4Debate` を切替（URL固定・フェーズと非対応）
- 「前のフェーズに戻る」ボタン（Phase2/3/4）は実際には `topicStore.resetToPhase1/2/3` を呼ぶ**破壊的リセット**:
  - `resetToPhase1`: 全ペルソナ削除＋セッション削除＋status巻き戻し（`topic.svelte.ts:62`）
  - `resetToPhase2`: 全ペルソナの interview/beliefs 消去＋セッション削除（`topic.svelte.ts:72`）
  - `resetToPhase3`: セッション削除（`topic.svelte.ts:87`）
  - 確認ダイアログなしで即実行される
- 過去フェーズの結果（承認済みステークホルダー・ペルソナ等）を「閲覧だけ」する手段が存在しない

### 設計フェーズへの論点
- フェーズURL設計（例: `/admin/debate/[id]/stakeholders|personas|interviews|debate`）と既存 `/admin/debate/[id]` からのリダイレクト
- ステップナビゲーション共通コンポーネント（`@14ch/svelte-ui` に Steps/Stepper 系があるか確認）
- 過去フェーズの「閲覧モード」（読み取り専用表示）と「リセットして再実行」の操作分離＋確認ダイアログ
- 未到達フェーズへの直アクセス時は現在フェーズへリダイレクト
- Phase1〜4 コンポーネントはほぼそのまま各ルートの `+page.svelte` に移せる構造（propsは `topicId`/`topicTitle` のみ）

工数への影響: フェーズURL化により Effort は S→**M（3–7日）** に引き上げ。リセット分離・閲覧モードの実装が加わるため。
