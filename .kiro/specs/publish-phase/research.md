# Research & Design Decisions — publish-phase

---
**Purpose**: 要件と既存コードベースの gap 分析。設計フェーズの入力とする。
---

## Summary

- **Feature**: `publish-phase`
- **Discovery Scope**: Extension（既存フェーズ機構の拡張 + 公開画面1枚の新設）
- **Key Findings**:
  - フェーズ前進・承認・画面遷移の既存パターンがそのまま流用でき、`publish` フェーズ追加のほとんどは定義の追加だけで機能する（`nextPhase`/`advancePhase`/レイアウトのリダイレクトはすべて `PHASE_DEFS` 駆動で自動追従）
  - **firestore.rules が公開読み取りを `publishedAt != null` で判定している（重大）**。OFF 時に `publishedAt` を残す本仕様では、rules を `published == true` へ切り替えないと「非公開に戻しても一般公開読み取りが継続する」実質的なセキュリティホールになる。rules 変更は必須スコープ
  - `publishDebate()` は既に存在するが**呼び出し元ゼロの未配線コード**。公開画面がその初の呼び出し元になる（`published: true` の書き込みを追加拡張）
  - BE `isDebateCompleted()` が「討論完了」を `phase === 'editing'` ハードコードで判定しており、`phase === 'publish'` まで進むと編集の再実行がブロックされる。BE 修正（＝デプロイ）が必要
  - StepNav ライブラリは 0.0.56 で `progress: { step, status: 'done' }` に対応済み。最終ステップの完了表示はキー指定のまま表現できる

## Requirement-to-Asset Map

### Req 1: 公開状態の明示的モデル化（`published`）

| 資産 | 現状 | Gap |
|---|---|---|
| FE 型 [topic.types.ts](../../../src/lib/models/topic/topic.types.ts) | `publishedAt?` のみ | **Missing**: `published` フィールド追加（`TopicForFirestore` は `published?: boolean`、アプリ層 `Topic` は境界で正規化した `published: boolean` が既存の境界変換方針に整合） |
| BE 型 [topic.types.ts](../../../functions/src/types/topic.types.ts) | 「FE TopicForFirestore と同一形」規約 | **Missing**: 同フィールド追加 |
| 公開操作 [createTopic.svelte.ts:118-127](../../../src/lib/models/topic/createTopic.svelte.ts#L118) | `publishDebate()` が `publishedAt` + `personaCount` 焼き込みを実装済み。**呼び出し元なし（未配線）** | **Constraint**: `published: true` を追記して流用。personaCount 再集計（公開スナップショット仕様）は維持 |
| 非公開操作 | 存在しない | **Missing**: `unpublish`（`published: false`、`publishedAt` は保持） |
| 境界変換 [topics.svelte.ts:18-28](../../../src/lib/stores/topics.svelte.ts#L18) | `toTopic` で Timestamp→Date 変換 | 追加点: `published: topicDoc.published ?? false` の正規化（Req 7 も同時に満たす） |

### Req 2: `publish` フェーズの追加

| 資産 | 現状 | Gap |
|---|---|---|
| FE [phase.types.ts](../../../src/lib/models/phase/phase.types.ts) / [phase.constants.ts](../../../src/lib/models/phase/phase.constants.ts) | 6フェーズ（editing が終端） | **Missing**: `PhaseSlug` に `'publish'`、`PHASE_DEFS` 末尾にエントリ追加（statusLabels の文言要検討） |
| BE [phase.types.ts](../../../functions/src/types/phase.types.ts) | FE と同一集合の規約 | **Missing**: `'publish'` 追加（正準リストコメントも更新） |
| `nextPhase`/`isLastPhase`/`phasePath`/レイアウトのリダイレクト | すべて `PHASE_DEFS` 配列駆動 | なし（定義追加に自動追従） |
| BE [debate-lifecycle.ts:86-92](../../../functions/src/pipeline/debate/debate-lifecycle.ts#L86) `isDebateCompleted` | `phase === 'editing'` で「討論完了済み」判定 | **Constraint（要修正）**: `phase === 'publish'` で `false` を返し、公開フェーズ到達後の編集再実行がブロックされる。「editing 以降なら完了」への修正が必要 → **functions デプロイ必須**（エミュレータ不使用運用） |
| FE [phase.ts:48-49](../../../src/lib/models/phase/phase.ts#L48) `phaseDisplayLabel` | `generated && isLastPhase` → `completed` スタイル | **Constraint**: 終端が publish に移ることで、editing generated のバッジが `completed`→`ready` に変わる（意図通りの変化）。publish フェーズのバッジ表現は要設計（下記 Research Needed 4） |

### Req 3: 編集フェーズからの前進

| 資産 | 現状 | Gap |
|---|---|---|
| 承認パターン [createTopic.svelte.ts:71-94](../../../src/lib/models/topic/createTopic.svelte.ts#L71) | `approveChapters`/`approveDebate` = `advancePhase(currentKey)`（次フェーズ + `not_started` を書く） | **Missing**: `approveEditing`（= `advancePhase('editing')`。publish 追加後は自動で `publish` へ前進） |
| 「次に進む」UI パターン | [GenerateChaptersPage.svelte:225-283](../../../src/lib/features/admin/topic-detail/chapters/GenerateChaptersPage.svelte#L225) / GenerateDebatePage に確立済み（`canAdvance` = generated\|\|approved、承認→遷移、失敗時エラー表示） | **Missing**: [EditingPage.svelte:230](../../../src/lib/features/admin/topic-detail/editing/EditingPage.svelte#L230) の「最終ステップのため持たない」空プレースホルダを「次に進む」ボタンに置換 |

### Req 4: 公開画面

| 資産 | 現状 | Gap |
|---|---|---|
| ルート | `src/routes/admin/topics/[topicId]/{phase}/+page.svelte` は feature ページへの thin wrapper 規約 | **Missing**: `publish/+page.svelte` + `src/lib/features/admin/topic-detail/publish/PublishPage.svelte` |
| スイッチ UI | `@14ch/svelte-ui` 標準使用の規約 | **Unknown**: スイッチ（Toggle/Switch）コンポーネントの有無・API（Research Needed 1） |

### Req 5: StepNav の完了判定

| 資産 | 現状 | Gap |
|---|---|---|
| ライブラリ | `@14ch/svelte-ui@0.0.56`: `progress?: number \| string \| { step, status: 'in-progress' \| 'done' }` 対応済み | なし |
| ラッパー [StepNav.svelte](../../../src/lib/sharedComponents/StepNav.svelte) | `progress` = currentPhase を含むグループのキー（文字列のみ＝常に in-progress 扱い） | **Missing**: `STEP_GROUPS` に公開ステップ追加、`progress` を `{ step, status }` 化。status = publish なら `published`、それ以外は `phaseStatus === 'generated'` で `'done'` |
| テスト [StepNav.svelte.spec.ts](../../../src/tests/sharedComponents/StepNav.svelte.spec.ts) | 既存ラッパーの仕様を検証 | **Constraint**: 公開ステップ・done 判定のケース追加が必要 |

### Req 6: 公開判定の単一真実化

| 資産 | 現状 | Gap |
|---|---|---|
| 公開トップ [+page.svelte:8](../../../src/routes/+page.svelte#L8) | `publishedAt != null` フィルタ | **Missing**: `published` へ変更（ソートの `publishedAt ?? updatedAt` は日時用途なので維持可） |
| [TopicListItem.svelte:18](../../../src/lib/features/topics/list/TopicListItem.svelte#L18) | `{#if topic.publishedAt}` 分岐 | **Missing**: `published` 分岐へ変更（日時表示は `publishedAt` のまま） |
| **[firestore.rules](../../../firestore.rules)** | 一般公開読み取りを `publishedAt != null` で許可（topics 本体 + personas/chapters/editedChapters/editorial 等サブコレクション、計5箇所以上） | **Missing（重大）**: `published == true` へ切り替え。放置すると OFF 後も一般読み取りが継続する（`publishedAt` を保持する新仕様と衝突） |

### Req 7: 既存トピックの後方互換

| 資産 | 現状 | Gap |
|---|---|---|
| FE 読み込み境界 | `toTopic` あり | `?? false` 正規化で吸収（Req 1 と同時対応） |
| **既存の公開済みデータ** | `publishedAt` はあるが `published` が無い | **対応しない（ユーザー判断）**: データ migration（バックフィル）はスコープ外。rules 切替後、既存トピックは `published` 未設定＝非公開扱いとなり、必要なら公開画面から再度 ON にすればよい |

## Implementation Approach Options

### Option A: 既存パターン拡張 + 公開画面のみ新設（推奨）
- フェーズ定義・承認・境界変換・rules はすべて既存ファイルへの追記/変更。新規は公開画面（thin wrapper + feature ページ）と `unpublish` 操作のみ。
- ✅ 全変更が確立済みパターンの延長で、レビュー・影響範囲が読みやすい
- ✅ 「画面の操作は画面に直接書く」steering 方針に合致
- ❌ 特になし（規模が小さく分離の必要がない）

### Option B: 公開ドメインを独立モジュール化（publish store / publish service 新設）
- ✅ 公開関連の将来拡張（予約公開等）の置き場ができる
- ❌ 現時点でスイッチ1つの操作に対して過剰。steering の「過度な共通化・抽象化をしない」に反する

**推奨: Option A**。

## Effort & Risk

- **Effort: S（1–3日）** — 全て既存パターンの延長。新規画面1枚は最小構成（スイッチのみ）。
- **Risk: Medium** — コード自体は Low だが、(1) firestore.rules の変更が一般公開面のアクセス制御に直結、(2) functions デプロイ（`isDebateCompleted` 修正）を伴うため。既存公開トピックが rules 切替後に非公開扱いとなる点は許容済み（migration スコープ外）。

## Design Decisions（設計フェーズで確定）

### Decision 1: 公開スイッチは `@14ch/svelte-ui` の `Switch` を使用
- **Context**: 公開 ON/OFF の UI 部品の選定（Research Needed 1）
- **Findings**: `Switch.svelte` が存在。`value: boolean`（`bind:value` 対応）+ `onchange: (value: boolean) => void`、`disabled` あり
- **Selected Approach**: `Switch` を使用。`onchange` で publish/unpublish 操作を呼び、失敗時は表示を永続値へ戻してエラー表示
- **Rationale**: UI ライブラリ標準使用の規約どおり。カスタム実装不要

### Decision 2: 公開トップの購読クエリは現状維持（クライアントフィルタのみ `published` に変更）
- **Context**: `where('published', '==', true)` への切り替え可否（Research Needed 2）
- **Findings**: `topicsStore` は admin 一覧と公開トップで共用されており、全件購読 + クライアントフィルタ構成。未認証アクセス時のクエリ provability は既存課題であり本仕様以前から存在する
- **Selected Approach**: 購読構造は変えず、公開トップのフィルタ述語のみ `topic.published` へ変更。クエリ最適化・未認証対応は Out of Boundary（将来の公開閲覧ページ spec で扱う）
- **Trade-offs**: 最小変更で済む一方、未認証の一覧取得は未解決のまま（現状と同じ）

### Decision 3: admin バッジは `phaseDisplayLabel` に `published` を渡して publish 分岐で導出
- **Context**: `phase='publish'` のバッジ表現（Research Needed 3）。`phaseDisplayLabel` は `(phase, phaseStatus)` しか見ない
- **Selected Approach**: 入力を `{ phase, phaseStatus, published }` に拡張し、`phase === 'publish'` は `published` から `公開中(completed)` / `未公開(pending)` を導出。`PHASE_DEFS` の publish `statusLabels` は型を満たすフォールバック（全状態 `未公開`）として定義
- **Implications**: 終端フェーズが publish（`generated` に到達しない）へ移ることで、`generated && isLastPhase → completed` 分岐は不要になる。この分岐と、それにより未使用となる `isLastPhase` は削除する（editing の `generated` バッジは `completed` → `ready` スタイルに変わるが、これは「編集はもう終端でない」ことの正しい反映）

### Decision 4: 公開中は上流ステップをロックする（コンテンツ凍結）
- **Context**: `startEditing` は phase を `editing` に巻き戻し、再生成は**旧データを処理開始時に即時削除**する。公開中に上流を操作すると、公開コンテンツが空の状態で一般公開される期間が生じる
- **Alternatives Considered**:
  1. 制限しない（当初案）— 軸の独立は保てるが、公開中の再生成でコンテンツが空のまま公開され続ける。また `phase='editing' && published=true` の状態で「StepNav の公開ステップを完了表示」（Req 5.5）が progress の単一カーソル構造上表現不能になる
  2. `startEditing` で自動非公開化 — 編集操作の暗黙の副作用で公開が消えるのは最悪の形
  3. 遷移レベルでロック（StepNav の上流ステップ不活性 + URL リダイレクト）— 変更は防げるが**閲覧まで塞がる**。公開中に内容を確認したいという正当な用途を潰すためユーザー判断で却下
  4. **操作レベルで凍結（採用）** — 閲覧は許可し、変更操作のみ不活性化
- **Selected Approach**: 編集可否を**フェーズごと**の純粋関数 `phaseEditable(current, target)`（phase モデル。`phaseLogicalState` と同型パターン）として一元導出し、各フェーズ画面が自分のフェーズ定数で判定して自画面の変更系要素（生成・再生成・インライン編集・並べ替え・追加削除・タイトル編集）に適用する。`target='publish'` は常に編集可（公開中にスイッチを OFF にできる必要がある — topic 全体の単一フラグでは公開画面だけ画面側の例外化が必要になるため、フェーズ別判定を採用）。遷移・閲覧・「次に進む」（公開中は承認済みのため単なる遷移）は不活性化しない。コンテンツを変更したい場合はスイッチ OFF（非公開化）してから行う
- **Rationale**: 公開コンテンツの完全性が最優先、かつ閲覧性を犠牲にしない。判定の定義は1箇所（`phaseEditable`）に集約し、どの要素が「変更操作」かは各画面が持つ — 中央ディスパッチャを作らない steering 方針と両立。ガードは UI レベルのみ（単一管理者の自傷防止が目的。BE 側の操作ガード追加はスコープ外）
- **Trade-offs**: 公開中は誤字修正のような軽微な変更でも一旦非公開化が必要（意図した挙動 — 中間状態を公開しないための代償）。全フェーズ画面に `disabled` 適用が入るため変更ファイル数は増えるが、各変更は浅い
- **Implications**: phase を巻き戻す生成系操作も凍結されるため、UI 経路上 `published=true` ⇒ `phase='publish'` の不変条件が成立し、Req 5.5 が表現不能になるエッジ状態（editing + published）は到達不能。要件 5.5/5.6 は文言修正不要
- **Follow-up**: BE `isDebateCompleted` の修正は依然必要（非公開化後の再編集は `phase='publish'` から `startEditing` を呼ぶため、「`phase` が editing または publish なら討論完了扱い」でなければブロックされる）。変更系要素の網羅漏れがリスク — タスクで画面ごとに列挙して確認する

※ 既存データの migration（`published` バックフィル）はユーザー判断によりスコープ外。既存トピックは rules 切替後に非公開扱いとなり、必要に応じて公開画面から再公開する運用とする。

## Risks & Mitigations

- **rules 切り替えで既存公開トピックが非公開化** — 許容する（migration はスコープ外・ユーザー判断）。必要なら公開画面から再公開。
- **OFF 後も読める穴（rules 未変更）** — rules 変更を必須タスクとして tasks に明記。
- **BE 型と FE 型のドリフト** — 両 `phase.types.ts` / `topic.types.ts` の変更を同一タスクで実施し、正準リストコメントも同時更新。
- **公開中の再編集による成果物と公開内容の乖離** — Research 5 の設計判断で明確化。

## References

- 要件: [requirements.md](requirements.md)
- StepNav ライブラリ: `node_modules/@14ch/svelte-ui/dist/components/StepNav.svelte`（0.0.56、`progress: { step, status }` 対応）
- 承認・前進パターン: `src/lib/models/topic/createTopic.svelte.ts`（`advancePhase` / `approveDebate`）
- 「次に進む」UI パターン: `src/lib/features/admin/topic-detail/chapters/GenerateChaptersPage.svelte`
