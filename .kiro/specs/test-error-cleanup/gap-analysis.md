# Gap Analysis: test-error-cleanup

## Analysis Summary

- **PersonaFilter.svelte が完全に欠如**：テスト仕様はすでに存在するがコンポーネントファイルが作成されていない。インポートエラーで全4テストが即時失敗
- **PhasePanel・TopicForm のクリック+コールバック検証テストは未検証状態**：git 履歴を調査した結果、これらのテストはコードとともに追加されたが、実際に pass した記録がなく、ブラウザテスト環境での動作確認がされていない可能性が高い
- **根本原因の最有力仮説**：`@14ch/svelte-ui` の `Button` component を経由したハンドラ伝播と、`Input/Textarea` の `oninput` コールバック経由の値更新が、Vitest Browser（Playwright Chromium）環境で期待通り機能していない
- **同一プロジェクト内の先例**：同じパターン（click → vi.fn() 検証）は他のテストファイルには存在せず、全通過テストはボタン存在確認のみ（クリック後状態変化を確認しない）
- **推奨アプローチ**：PersonaFilter の新規作成（Option B）、PhasePanel/TopicForm はコンポーネントの handler wiring 修正（Option A）またはテスト側の相互作用方法見直し（Option C）の検討が必要

---

## 1. Current State Investigation

### 1.1 失敗ファイルの確認

| テストファイル | 失敗数 | 失敗種別 |
|---|---|---|
| `src/tests/features/topics/detail/PersonaFilter.svelte.spec.ts` | 4/4 | `Failed to import` (コンポーネント未作成) |
| `src/tests/sharedComponents/PhasePanel.svelte.spec.ts` | 4/20 | `vi.fn() not called` (click イベント未伝播) |
| `src/tests/features/admin/new-topic/TopicForm.svelte.spec.ts` | 9/12 | フォーム操作後の状態変化なし |

### 1.2 コードベース調査

**PersonaFilter 関連：**
- コンポーネント: `src/lib/features/topics/detail/PersonaFilter.svelte` → **不在**
- テスト仕様: `src/tests/features/topics/detail/PersonaFilter.svelte.spec.ts` → 存在
- 必要な型: `PersonaSummaryForViewer` → `src/lib/models/persona/persona.types.ts:50` に存在
- 類似コンポーネント: `src/lib/features/topics/list/TopicListItem.svelte` が参考実装として利用可能
- 設置先ディレクトリ `src/lib/features/topics/detail/` は空

**PhasePanel 関連（コンポーネントは存在、テストが failing）：**
```
src/lib/sharedComponents/PhasePanel.svelte  ← 存在・正常
```
- Button コンポーネント: `@14ch/svelte-ui` の Button、`onclick` を prop として受け取り `handleClick` 内で呼ぶ構造
- 失敗4件はすべて「ボタンクリック → vi.fn() 検証」テスト
- 通過16件はすべて「要素の存在確認」テスト ← **重要なパターン差異**

**TopicForm 関連（コンポーネントは存在、テストが failing）：**
```
src/lib/features/admin/new-topic/TopicForm.svelte  ← 存在
```
- 元実装（f828dde）: ネイティブ `<textarea bind:value={title}>` → `getByRole('textbox')` で取得
- 現実装（1a4880f以降）: `@14ch/svelte-ui` `Input` + `oninput={(v) => (title = String(v))}` → `getByLabelText('タイトル')` で取得
- オリジナルの tests は `getByRole('textbox').fill()` パターンで設計・一部通過していた可能性が高い

### 1.3 根本原因の特定

**git log 調査で判明した事実：**

1. `6472640`（PhasePanelからonRetryを廃止）のコミットで、`onRetry` クリックテストを削除し、同時に `onGenerate`/`onStop`/`onRestart`/`onApprove` クリックテストを新規追加した
2. これらの新規テストが actually pass したかどうかは git 履歴から確認できない（その後のコミットはリファクタリングや型変更のみ）
3. 通過するテストは全て存在確認のみ。プロジェクト全体で「click → vi.fn() 検証」パターンは失敗テストにしか存在しない

**技術的仮説（優先度順）：**

**仮説 A: Button の onclick 伝播問題**
- `@14ch/svelte-ui` Button が `onclick` を props として受け取り、内部 `handleClick` で `onclick(event)` を呼ぶ
- PhasePanel は `<Button onclick={onGenerate}>` でプロップ関数を直接渡す
- vitest-browser-svelte 環境で Svelte 5 の props chain 経由の click ハンドラが正しく発火しない可能性

**仮説 B: @14ch/svelte-ui Input の oninput 値更新問題**
- `Input` は `value = $bindable()` + `bind:value` + `oninput={handleInput}` の組み合わせ
- Playwright `fill()` → native input event → `handleInput` が `oninput?.(value)` を呼ぶ際、`bind:value` による `value` state 更新と `handleInput` の実行順序に依存
- `title` が空のまま submit → validate で必ずエラーになるはずだが、それも動いていない

**仮説 C: フォーム submit の不発（最重要）**
- "shows error when title is empty on submit" はフォーム操作（fill）なしでもボタンクリック → validate → alert 表示の流れのみ
- これが失敗 = Button クリック → form submit → `onsubmit` ハンドラの流れが機能していない
- ネイティブ `<textarea>` 使用時代（f828dde）には同様テストが通過していた

**仮説 C の理由（最も論理的）：** ネイティブ `<textarea>` 使用時代にテストが通過していたなら Button クリック自体は問題なかったはず。しかし現在の `@14ch/svelte-ui` `Input`/`Textarea` コンポーネントが追加されてから、同じフォーム submit テストが失敗している。`Input`/`Textarea` コンポーネント内のイベントハンドラが native form submit のバブリングを阻止している可能性。

---

## 2. Requirements Feasibility Analysis

### Requirement 1: PersonaFilter コンポーネント新規作成

| 必要な能力 | 現状 | ギャップ |
|---|---|---|
| コンポーネントファイル | 不在 | **Missing**: 新規作成が必要 |
| `PersonaSummaryForViewer` 型 | 存在（persona.types.ts:50） | なし |
| ペルソナ名ボタン描画 | 類似例あり（TopicListItem.svelte） | 軽微: 実装パターン適用 |
| `aria-pressed` 属性制御 | プロジェクト内での先例なし | **Unknown**: Svelte 5 での条件的 aria-pressed |
| `onselect` コールバック | なし | **Missing**: 新規実装 |

### Requirement 2: PhasePanel ボタンクリック伝播

| 必要な能力 | 現状 | ギャップ |
|---|---|---|
| PhasePanel コンポーネント | 存在・正常 | なし |
| Button クリック伝播 | 動作不明 | **Unknown**: vitest-browser 環境での動作確認が必要 |
| テスト検証パターン | プロジェクト既存なし | **Constraint**: 他テストは click 検証なし |

### Requirement 3: TopicForm フォーム操作

| 必要な能力 | 現状 | ギャップ |
|---|---|---|
| ネイティブ要素での fill → submit | 元実装で動作していた | なし |
| @14ch/svelte-ui Input での fill 伝播 | 動作不明 | **Unknown**: `oninput` コールバックチェーンの検証 |
| フォーム submit トリガー | 動作不明 | **Unknown**: Button type="submit" + @14ch/svelte-ui の組み合わせ |
| bind:value サポート | Input が `$bindable()` | 利用可能（未使用） |

---

## 3. Implementation Approach Options

### Option A: コンポーネント実装を修正する

**PersonaFilter**: 新規作成（必須）

**PhasePanel**:
- `onclick={onGenerate}` → `onclick={() => onGenerate()}` のアロー関数ラッパーに変更
- 旧実装の `onclick={() => void controller.runGenerate()}` パターンが通過していた根拠に基づく

**TopicForm**:
- `<Input value={title} oninput={(v) => (title = String(v))}>` → `<Input bind:value={title}>` に変更
- ネイティブ `bind:` バインディングを使用することで Playwright `fill()` との互換性を確保

**Trade-offs:**
- ✅ コンポーネント実装が vitest-browser と正確に動作することを保証
- ✅ テスト変更なし
- ❌ 根本原因が未確定のまま変更するリスク
- ❌ bind:value への移行は @14ch/svelte-ui の bind:value ($bindable) サポートを前提とする

### Option B: テスト側の相互作用方法を修正する（PersonaFilter 新規作成 + テスト方法見直し）

**PhasePanel/TopicForm テスト**:
- `page.click()` → `userEvent.click()` に変更（vitest-browser の userEvent API）
- または `fireEvent` を使用した同期的なイベント発火
- または クリックを直接テストせず、ストア操作を介したテストに変更

**Trade-offs:**
- ✅ コンポーネント変更なし（本番動作に影響しない）
- ✅ テスト方法の標準化
- ❌ userEvent の vitest-browser サポートの確認が必要
- ❌ テストが意図したユーザー体験を検証していない懸念

### Option C: ハイブリッドアプローチ（最も確実）

1. PersonaFilter: Option B で新規作成
2. PhasePanel: まずアロー関数ラッパー（Option A）を試し、効果がなければ native button または userEvent を検討
3. TopicForm: `bind:value` への移行（Option A）を試し、form submit の問題は実際にデバッグして原因特定

**Trade-offs:**
- ✅ 各問題の性質に応じた対処
- ✅ 最も確実に通過につながる
- ❌ 複数のアプローチを同時進行するため計画が必要

---

## 4. Effort & Risk Assessment

| タスク | Effort | Risk | 理由 |
|---|---|---|---|
| PersonaFilter 新規作成 | S | Low | テスト仕様から要件が明確、類似コンポーネントあり |
| PhasePanel クリック修正 | S-M | Medium | 根本原因不明確、修正後に効果確認が必要 |
| TopicForm フォーム修正 | M | Medium | bind:value 移行は影響範囲が限定的、confirm が必要 |
| テスト全体の非退行確認 | S | Low | `pnpm test:unit` 実行で即確認可能 |

---

## 5. Research Items for Design Phase

1. **vitest-browser-svelte での Svelte 5 props chain 経由 onclick の動作検証**: 最小テストケースで `onclick={vi.fn()}` 直接渡し vs `onclick={() => vi.fn()()}` ラッパーの違いを実験
2. **@14ch/svelte-ui Input の bind:value サポート確認**: `value = $bindable()` が宣言されているため、`bind:value={title}` が正しく機能するか確認
3. **Button type="submit" + @14ch/svelte-ui コンポーネントの form submit 動作**: Input/Textarea が追加された後に form submit が失敗しているのか、Button クリック自体が問題かを切り分け

---

## 6. Recommended Design Direction

**PersonaFilter**: Option B（新規作成）が唯一の選択肢。シンプルな実装で完結可能。

**PhasePanel + TopicForm**: Option C を推奨。
- まず PhasePanel に `onclick={() => onGenerate()}` ラッパーを適用して効果確認
- TopicForm は `bind:value` 移行で `fill()` との互換性を確保
- フォーム submit の問題は最小再現ケースを作って切り分け
- 最終的に `pnpm test:unit` で全13件の pass を確認
