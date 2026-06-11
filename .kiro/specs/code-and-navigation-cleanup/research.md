# Research & Design Decisions

## Summary
- **Feature**: `code-and-navigation-cleanup`
- **Discovery Scope**: Extension（既存システムのリファクタリング＋管理画面ナビゲーション再構築）
- **Key Findings**:
  - `@14ch/svelte-ui` に Stepper はないが、`Tab`（href ベース・`disabled` 対応・現在パス自動判定）がステップナビゲーションに流用可能。リセット確認には `ConfirmDialog`（`danger` プロップあり）が最適
  - Phase1〜4 コンポーネントは props が `topicId`/`topicTitle` のみで、フェーズ別ルートへの移行は小さい差分で可能
  - `resetToPhaseN` は「フェーズNを再実行する状態に巻き戻す」セマンティクスで、新設計の「このフェーズからやり直す」ボタンにそのまま対応付く（`resetToPhase3` と `resetDebate` は実質同一処理で統合候補）

## Research Log

### @14ch/svelte-ui のナビゲーション・ダイアログ部品
- **Context**: ステップナビゲーションとリセット確認ダイアログにライブラリ部品を優先使用する（プロジェクト規約）
- **Sources Consulted**: `node_modules/@14ch/svelte-ui/dist/components/*.d.ts`
- **Findings**:
  - `Tab`: `tabItems: { label, href, disabled? }[]` + `pathPrefix` で URL 連動のタブナビを提供。現在パスの自動アクティブ判定あり
  - `Nav`/`NavItem`: 汎用ナビ。`selectedVariant` あり。Tab より自由度が高いが用途過剰
  - `ConfirmDialog`: `title`/`description`/`danger`/`onSubmit` を持ち、`open()`/`close()` メソッドを export。破壊的操作の確認に適合
  - Stepper/Steps 系コンポーネントは存在しない
- **Implications**: ステップナビは `Tab` をラップした薄い `StepNav` コンポーネントで実現（未到達フェーズは `disabled`）。リセット確認は `ConfirmDialog`（`danger: true`）を使用。カスタムUIの新規実装は最小化できる

### フェーズとステータスの対応関係
- **Context**: フェーズ別URLへの分割には `DebateStatus` → フェーズ番号の決定的な対応が必要
- **Sources Consulted**: `src/lib/types/index.ts`、`admin/debate/[id]/+page.svelte`、`admin/+page.svelte`
- **Findings**:
  - `pending`/`surveying` → Phase 1（ステークホルダー調査）
  - `generating_personas` → Phase 2（ペルソナ生成）
  - `interviewing` → Phase 3（取材）
  - `debating`/`completed`/`published` → Phase 4（討論）
  - 対応は全ステータスを被覆する全域写像（未知ステータスのフォールバックのみ要検討）
- **Implications**: `statusToPhase(status)` ユーティリティを単一の真実として `$lib` に置き、リダイレクト判定・StepNav の活性制御・閲覧/編集モード判定をすべてこれに依存させる

### リセット処理の現状セマンティクス
- **Context**: 「前のフェーズに戻る」ボタンの破壊的リセットを分離・明示化する（要件 4.5/4.6）
- **Sources Consulted**: `src/lib/stores/topic.svelte.ts:62-105`
- **Findings**:
  - `resetToPhase1`: 全ペルソナ削除＋セッション削除＋status→`surveying`
  - `resetToPhase2`: 全ペルソナの interview/beliefs 消去＋セッション削除＋status→`generating_personas`
  - `resetToPhase3`: セッション削除＋status→`interviewing`
  - `resetDebate`: セッション削除＋status→`interviewing`（`resetToPhase3` と実質同一。batch か逐次かの差のみ）
  - いずれも確認なしで即実行される
- **Implications**: ストアの関数自体は再利用可能。`resetDebate` は `resetToPhase3` に統合して重複を削除（R3.1）。UI側は「フェーズNからやり直す」ボタン＋破棄内容を列挙した ConfirmDialog に置き換える

### SvelteKit ルート構造とストア共有
- **Context**: フェーズ別URL化で `topicStore` を4ページが共有する方法
- **Sources Consulted**: 既存コード（`+layout.svelte` パターン、Svelte 5 runes）、SvelteKit 規約
- **Findings**:
  - `admin/debate/[id]/+layout.svelte` を新設し、`topicStore` の生成・開始・停止とステップナビ・タイトル・not found 表示を集約できる
  - Svelte 5 では `setContext`/`getContext` でストアインスタンスをページへ受け渡すのが標準的
  - `onSnapshot` はキャッシュを共有するため、各ページが個別にストアを作っても課金は増えないが、ライフサイクル管理が分散する（layout 集約が優位）
- **Implications**: layout がストアのオーナー。ページは context 経由で参照。認証待ち（`onAuthStateChanged`）も layout に一元化し、ページ個別の生リスナー（R3.2 の重複）を撤去する

### E2E テストの扱い
- **Context**: デモルート削除でプロジェクト唯一の E2E（`demo/playwright/page.svelte.e2e.ts`）が消える
- **Findings**:
  - Playwright 設定はスキャフォールドのまま（`testMatch: '**/*.e2e.{ts,js}'`）。実ページの E2E は Firestore エミュレータ前提となり本スペックの範囲を超える
  - テストが0件の場合 `playwright test` は失敗終了する
- **Implications**: デモルートと同時に E2E スキャフォールド一式（テスト・`playwright.config.ts`・`test:e2e` スクリプト・devDependency）を削除する。実 E2E の整備は別スペックへ先送り（Non-Goal に明記）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 単一ページ維持＋内部ステップUI | 現行URLのまま表示切替だけステップナビ化 | 差分最小 | URLとフェーズが非対応のまま。ブラウザ履歴が機能しない（要件 4.1/4.7 未達） | 不採用 |
| B: フェーズ別ルート＋layout集約（採用） | `/admin/debate/[id]/{phase}` に分割し layout がストア・ナビ・ガードを集約 | URL=フェーズの一般的構造。戻る/進むが自然に機能。ページは表示に専念 | ルート数増。リダイレクト規則の設計が必要 | SvelteKit の標準パターンに合致 |
| C: クエリパラメータでフェーズ表現 | `?phase=2` で切替 | ルート増なし | SvelteKitのルーティング機能（layout分離・型付きパラメータ）を活かせず、リンク・アクティブ判定が手動 | 不採用 |

## Design Decisions

### Decision: フェーズURLのスラッグ
- **Context**: 4フェーズのURL命名
- **Alternatives Considered**:
  1. 番号方式 — `/admin/debate/[id]/phase/1`
  2. 意味スラッグ — `/admin/debate/[id]/stakeholders|personas|interviews|debate`
- **Selected Approach**: 意味スラッグ方式
- **Rationale**: URLから内容が読め、既存の機能ドメイン命名（stakeholders/personas/interviews/debates）と一致する
- **Trade-offs**: フェーズ順序がURLから読めないが、StepNav が順序を提示する
- **Follow-up**: `/admin/debate/[id]` 直アクセスは現在フェーズへリダイレクト

### Decision: 過去フェーズの閲覧モード実装
- **Context**: 要件 4.3「過去フェーズをデータ変更なしで閲覧」
- **Alternatives Considered**:
  1. 閲覧専用の別コンポーネントを新設
  2. 既存 Phase1〜4 コンポーネントに `readonly` プロップを追加
- **Selected Approach**: `readonly` プロップ追加（フェーズページが `statusToPhase` 比較で算出して渡す）
- **Rationale**: Phase コンポーネントは表示ロジックを既に持ち、閲覧モードは操作ボタン群の非表示化が主。複製は R3（重複排除）に逆行する
- **Trade-offs**: コンポーネント内に条件分岐が増えるが、二重実装より保守性が高い
- **Follow-up**: readonly 時に生成系アクション（生成開始・承認・公開等）が一切発火しないことをユニットテストで担保

### Decision: リセット操作の配置と統合
- **Context**: 要件 4.5/4.6。ナビゲーションとリセットの分離
- **Selected Approach**: 過去フェーズ閲覧時にのみ「このフェーズからやり直す」ボタンを表示し、`ConfirmDialog`（danger）で破棄対象を列挙して承諾後に `resetToPhaseN` を実行 → 該当フェーズURLへ `goto`
- **Rationale**: 「やり直したいフェーズのページで実行する」操作モデルは、現行の「前に戻る＝戻り先を再実行」より直感的
- **Trade-offs**: 現行より1クリック増えるが、誤操作によるデータ消失を防ぐ
- **Follow-up**: `resetDebate` を `resetToPhase3` へ統合。実行中討論のキャンセル（`cancelRunningDebate`）が引き続き呼ばれることを確認

### Decision: 認証ガードの書き換えとログイン後復帰
- **Context**: 要件 5.2、R3.2（authリスナー重複）。現状は 50ms ポーリング＋固定 `/admin` 遷移
- **Selected Approach**: `admin/+layout.svelte` の `$effect` で `authStore.loading`/`user` を監視。未認証確定時に `goto('/admin/login?redirect=<現在パス>')`。ログイン成功時は `redirect` を検証（`/admin` 始まりのみ許可）して復帰。認証済みで `/admin/login` に来た場合は `/admin` へ
- **Rationale**: ポーリング排除でリアクティブ化。redirect 検証でオープンリダイレクトを防止
- **Trade-offs**: 認証フローの回帰リスクがあるため実装順を最後にし、ログイン/ログアウト/直リンクを手動確認する
- **Follow-up**: ページ個別の `onAuthStateChanged` を撤去し、layout の認証確定後にページがレンダリングされる保証に置き換える

### Decision: E2E スキャフォールドの削除
- **Context**: デモルート削除で唯一のE2Eが消える（§Research Log 参照）
- **Selected Approach**: デモルート・E2Eテスト・Playwright設定・`test:e2e` スクリプトを一括削除
- **Rationale**: 実態のないテストインフラは「無駄なコード」に該当。実E2EはFirestoreエミュレータ整備とセットで別スペックとすべき
- **Trade-offs**: E2E再導入時に設定の再追加が必要（コスト小）
- **Follow-up**: 非回帰基準は `pnpm check`＋ユニットテスト＋主要フローの手動確認に置く

## Risks & Mitigations
- 認証ガード書き換えによるログイン不能・無限リダイレクト — `$effect` の依存を `loading`/`user` のみに限定し、login ページを guard 対象外とする既存条件を維持。手動確認チェックリストを tasks に含める
- フェーズリダイレクトのループ（未知ステータス時） — `statusToPhase` を全域写像とし、未知値は Phase 1 にフォールバック
- 削除ファイルの見落とし参照（ビルドは通るが実行時エラー） — 削除後に `pnpm check`＋`pnpm build`＋Functions ビルドを必須化
- readonly 化漏れによる過去フェーズでの誤操作 — readonly 時はアクション関数を渡さない（UIの無効化だけに頼らない）設計とする

## References
- `@14ch/svelte-ui` 型定義（`node_modules/@14ch/svelte-ui/dist/components/`） — Tab / ConfirmDialog / Nav の contract
- `.kiro/specs/code-and-navigation-cleanup/gap-analysis.md` — 削除対象棚卸し・遷移問題の全リスト
- `.kiro/steering/firebase.md` — ストア集約原則・onSnapshot 方針
