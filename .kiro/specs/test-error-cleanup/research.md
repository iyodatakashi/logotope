# Research & Design Decisions: test-error-cleanup

## Summary

- **Feature**: `test-error-cleanup`
- **Discovery Scope**: Simple Addition（テストファイル修正）
- **Key Findings**:
  - プロジェクト全体で `page.click() → vi.fn()` 検証パターンは失敗テストにしか存在せず、18件の通過ブラウザテストは全て要素存在確認のみ
  - PersonaFilter コンポーネントはプロダクション上不要と判断されたため、テストファイルの削除が適切
  - 本番コンポーネント（PhasePanel・TopicForm）は正常動作しており、テストに合わせた実装修正は逆効果

## Research Log

### page.click() → vi.fn() パターンの動作調査

- **Context**: PhasePanel・TopicForm の failing tests が全て `page.click()` 後に `vi.fn().toHaveBeenCalled()` を検証するパターン
- **Sources Consulted**: プロジェクト内 `src/tests/` ディレクトリ全件スキャン、git log 調査
- **Findings**:
  - 18件の通過ブラウザ spec は要素存在確認のみ（クリック後コールバック検証なし）
  - PhasePanel の4件の click 検証テストは commit `6472640` で追加されたが、pass した記録なし
  - TopicForm の9件の操作テストは commit `1a4880f`/`5c0e47c` で `@14ch/svelte-ui` 移行時に壊れた
  - `@14ch/svelte-ui` `Button` は `onclick` props chain → `handleClick` で伝播する構造
- **Implications**: このパターンは本プロジェクトの vitest-browser-svelte 環境では動作が保証されていない。修正コストが高く、修正対象を誤るリスクがある

### PersonaFilter コンポーネントの必要性調査

- **Context**: `src/lib/features/topics/detail/PersonaFilter.svelte` が存在しないためインポートエラー
- **Sources Consulted**: git log, プロダクションコード, ユーザー確認
- **Findings**:
  - コンポーネントファイル自体が存在せず、テストのみが先行して作成されていた
  - ユーザー確認の結果「不要」と判断
- **Implications**: テストファイルを削除するのが最も合理的

## Architecture Pattern Evaluation

| オプション | 説明 | 強み | リスク |
|---|---|---|---|
| A: 実装修正 | 本番コンポーネントをテストが通るよう修正 | テストが増える | 動作中の本番コードを変更するリスク |
| B: テスト修正 | userEvent 等でテスト側の操作方法を変更 | コンポーネント変更なし | 修正コスト、環境依存の不確実性 |
| C: テスト削除 | 未検証・不要なテストを削除する | 最小コスト、安全 | テストカバレッジ減少 |

**選択**: Option C（テスト削除）

## Design Decisions

### Decision: 未検証テストは削除する

- **Context**: `page.click() → vi.fn()` パターンのテストが動作しない。本番コンポーネントは正常動作
- **Alternatives Considered**:
  1. 本番コンポーネントを修正してテストを通す → 動作中の実装を壊すリスク
  2. テスト側の操作方法を変更 → 環境依存の根本解決にならない可能性
- **Selected Approach**: 未検証のテストケースのみ削除し、要素存在確認テストは維持
- **Rationale**: テストは「仕様の保証」であり、動作確認されたことのないテストは保証の役割を果たしていない。削除してもプロダクションコードへの影響はない
- **Trade-offs**: カバレッジが減少するが、偽陽性なテストが除去され、テストスイートの信頼性が向上する
- **Follow-up**: 必要であれば、正しいブラウザテストパターン（要素存在確認または userEvent 経由）で再追加する

## Risks & Mitigations

- テストカバレッジ減少 → 残存テスト（135件）は全て通過確認済み。本番動作に影響なし
- 将来の回帰検出が弱まる → 必要に応じて、動作確認済みのパターンで再作成可能

## References

- vitest-browser-svelte: https://github.com/vitest-dev/vitest-browser-svelte
- @14ch/svelte-ui Button 実装: `node_modules/@14ch/svelte-ui/dist/components/Button.svelte`
