# Requirements Document

## Introduction

現在 `pnpm test:unit` を実行すると、3件のテストファイル・13件のテストケースが失敗している。これらはいずれも最近のコード修正（テスト修正含む）によって生じた残存エラーである。本仕様はこれら13件の失敗テストをすべてパスさせ、既存の通過テスト（135件）を維持することを目的とする。

## Boundary Context

- **In scope**: 失敗している3ファイル・13テストの修正（PersonaFilter コンポーネント新規作成、PhasePanel ボタンクリック動作の修正、TopicForm フォーム操作・バリデーション・送信の修正）
- **Out of scope**: 新機能追加、既存コンポーネントのリファクタリング、テスト外の動作変更
- **Adjacent expectations**: `@14ch/svelte-ui` ライブラリの内部実装は変更しない。必要に応じてコンポーネント側の実装または Vitest browser 環境での互換性対応を行う

## Requirements

### Requirement 1: PersonaFilter コンポーネントの新規作成

**Objective:** As a 開発者, I want `PersonaFilter.svelte` コンポーネントが存在し正常にインポートできること, so that テストファイルがインポートエラーを起こさず全4テストケースが実行・通過できる

#### Acceptance Criteria
1. When テストが `import PersonaFilter from '$lib/features/topics/detail/PersonaFilter.svelte'` を実行したとき, the テストスイート shall `Failed to import test file` エラーを発生させずにテストを実行する
2. When `render(PersonaFilter, { personas, selectedPersonaId: null })` で全ペルソナを渡したとき, the PersonaFilter shall 各ペルソナの `name` と `role` をもとにボタンとして描画する
3. The PersonaFilter shall 「全員」ラベルのボタンを常に表示する
4. When `selectedPersonaId` がペルソナの `id` と一致するとき, the PersonaFilter shall 該当ボタンに `aria-pressed="true"` を付与する
5. When 「全員」ボタンをクリックしたとき, the PersonaFilter shall `onselect(null)` を呼び出す

### Requirement 2: PhasePanel コンポーネントのボタンクリック伝播

**Objective:** As a 開発者, I want PhasePanel のアクションボタンをクリックしたときに対応するコールバックが呼ばれること, so that 4件の「クリックで onXxx を呼ぶ」テストケースが通過できる

#### Acceptance Criteria
1. When `logicalState === 'not_started'` のとき生成ボタン（`generateLabel`）をクリックしたとき, the PhasePanel shall `onGenerate` を呼び出す
2. When `logicalState === 'running'` かつ `onStop` が渡されているとき停止ボタン（`stopLabel`）をクリックしたとき, the PhasePanel shall `onStop` を呼び出す
3. When `logicalState === 'stopped'` かつ `onRestart` が渡されているとき再開ボタン（`restartLabel`）をクリックしたとき, the PhasePanel shall `onRestart` を呼び出す
4. When `logicalState === 'generated'` かつ `approveLabel` と `onApprove` が渡されているとき承認ボタンをクリックしたとき, the PhasePanel shall `onApprove` を呼び出す
5. The PhasePanel shall Vitest Browser（Playwright Chromium）環境で上記ボタンクリックのコールバック伝播を正しく動作させる

### Requirement 3: TopicForm コンポーネントのフォーム操作・バリデーション・送信

**Objective:** As a 開発者, I want TopicForm のフォーム操作が Vitest Browser 環境で正しく動作すること, so that 9件の失敗テストケースがすべて通過できる

#### Acceptance Criteria
1. When タイトル未入力でフォームを送信したとき, the TopicForm shall `role="alert"` を持つ要素と「タイトルを入力してください」エラーメッセージを表示する
2. When タイトルに501文字以上を入力してフォームを送信したとき, the TopicForm shall「500文字以内で入力してください」エラーメッセージを表示し `onSubmit` を呼ばない
3. When 有効なタイトルを入力してフォームを送信したとき, the TopicForm shall `onSubmit(title, description, sourceUrls)` を正しい引数で呼び出す
4. When 説明欄に2001文字以上を入力してフォームを送信したとき, the TopicForm shall「2000文字以内で入力してください」エラーメッセージを表示し `onSubmit` を呼ばない
5. When 「URLを追加」ボタンをクリックしたとき, the TopicForm shall `placeholder="https://"` を持つ入力フィールドを表示する
6. When URL フィールドに `https://` または `http://` で始まらない値を入力してフォームを送信したとき, the TopicForm shall「https:// または http:// で始まるURLを入力してください」エラーメッセージを表示し `onSubmit` を呼ばない
7. When 有効な URL を入力してフォームを送信したとき, the TopicForm shall `onSubmit(title, description, ['https://example.com'])` のように sourceUrls を含めて呼び出す
8. When 「URLを追加」ボタンを5回クリックしたとき, the TopicForm shall `placeholder="https://"` を持つ入力フィールドを5件表示し「URLを追加」ボタンを非表示にする
9. The TopicForm shall Vitest Browser（Playwright Chromium）環境において `page.fill()` によるフォーム入力値の反映と `page.click()` によるフォーム送信を正しく処理する

### Requirement 4: 既存テストの非退行

**Objective:** As a 開発者, I want 現在パスしている135件のテストが引き続きパスすること, so that 修正作業が既存の機能を壊さない

#### Acceptance Criteria
1. The テストスイート shall 修正後に 21 件のテストファイルすべてをエラーなく実行する
2. When `pnpm test:unit` を実行したとき, the テストスイート shall 148件以上のテストが通過し、0件が失敗する
3. If 既存の通過テストが修正作業によって失敗に転じたとき, the 開発者 shall 追加修正を行い非退行を維持する
