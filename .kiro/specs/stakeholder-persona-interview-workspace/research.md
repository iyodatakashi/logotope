# Research & Design Decisions: stakeholder-persona-interview-workspace

## Summary
- **Feature**: `stakeholder-persona-interview-workspace`
- **Discovery Scope**: Extension（既存3フェーズ画面の統合・UI再編＋選択的ペルソナ生成の小さなBE拡張）
- **Key Findings**:
  - 既存の生成・取材ロジック（`generateStakeholders` / `generatePersonas` / `runInterviews` / 各 `reset*`）とサーバ権威なステータス確定（`confirmPhaseGenerated`）はそのまま再利用でき、統合は主にUI層＋薄いBE引数追加で成立する。
  - `persona.approved` は編集フェーズが依存する（`EditingPage.svelte` が `approved` で所感対象を絞る）。承認廃止後も「取材操作」に `approvePersonas`（`approved:true` 付与）を畳み込む必要がある。
  - フェーズは3つ据え置く方針のため BE の `PhaseKey` 契約は不変。UIの「1画面化」は StepNav のナビ・グルーピングとルート集約で吸収する。

## Research Log

### 承認（approve）操作の暗黙化とフェーズ前進の仕組み
- **Context**: 3フェーズを据え置きつつ承認ボタンを廃し、次操作に畳み込む要件（R6）。既存の前進経路を壊さず畳めるか確認。
- **Sources Consulted**: `models/topic/createTopic.svelte.ts`（`advancePhase`/`generatePersonas`/`approve*`）、`stores/personas.svelte.ts`（`approvePersonas`/`runInterviews`/`markInterviewsStarted`）、`functions/src/utils/topic-phase.ts`（`confirmPhaseGenerated`）。
- **Findings**:
  - `generatePersonas`（model）は `setPhaseStatus('personas','running')` を書くため、`phase=stakeholders` から呼ぶと phase が `personas` へ前進する＝**ステークホルダー承認が暗黙的に成立**する（`phaseLogicalState` は phase 比較で `approved` を導出）。
  - `runInterviews`（store）は先頭で `markInterviewsStarted()`（`phase='interviews'`）を書くため、`phase=personas` から呼ぶと **ペルソナ承認が暗黙的に成立**する。ただし `approvePersonas` が別途行う `persona.approved=true` は書かれない。
  - `confirmPhaseGenerated` は「対象フェーズから前進済みなら触らない」冪等トランザクション。承認で phase が進んでも巻き戻さない。
- **Implications**:
  - ペルソナ生成ボタン＝`generatePersonas(selected)` で stakeholders 承認が畳める（追加の承認呼び出し不要）。
  - 取材ボタンは `approvePersonas()`→`runInterviews()` の順で呼び、**`approved:true` を確実に付与**する（編集フェーズ依存のため必須）。
  - 「章立てへ進む」は `approveInterviews()`（=`advancePhase('interviews')`）→`goto(chapters)`。

### ステークホルダー↔ペルソナの対応キー
- **Context**: 行レイアウト（R1-3）と選択的生成（R4-3）に、サブセット生成・再生成後も崩れない対応が必要。
- **Sources Consulted**: `functions/src/agents/persona-generator-agent.ts`、`functions/src/api/personas.ts`、`stores/stakeholders.svelte.ts`、`models/persona/persona.types.ts`。
- **Findings**:
  - 現状ペルソナは由来ステークホルダーを `stakeholderRole`（総称文字列・LLMがエコー）でしか保持しない。役割名の重複・表記揺れ・LLMのエコー忠実性に依存し脆い。
  - ステークホルダーの `id` は `stakeholders/0` 配列のインデックス（`String(i)`）で安定。
  - 生成は「立場ごとに1体」（`.length(count)`, `sortOrder=i`）で、サーバが永続時に決定的に付番できる。
- **Implications**:
  - ステークホルダーに **安定 `id`（サーバ付番）** を永続し、これを唯一の突合キーとする。ペルソナは `stakeholderId` で由来を保持し、採用選択も同じ id で管理する（位置ベースの識別子は使わない）。
  - 由来解決は出力順に依存しないよう、エージェントにエコー用タグを出力させサーバがタグ→id で解決する（位置＋`stakeholderRole` はフォールバック）。
  - 既存（`id`/`stakeholderId` 不在）データ表示のため、`stakeholderRole===stakeholder.role` フォールバックを補助的に用意（R7-2）。

### UIライブラリ・ナビの利用可否
- **Context**: 採用チェックボックスと、3フェーズを1ステップに見せる StepNav。
- **Sources Consulted**: `@14ch/svelte-ui` の `dist/index.js` エクスポート、`components/Tab.svelte`、`sharedComponents/StepNav.svelte`。
- **Findings**:
  - `@14ch/svelte-ui` は `Checkbox` / `Switch` を提供。採用選択は `Checkbox` を使用。
  - `Tab` は `customPathMatcher` を受け、複数URLを1タブのアクティブ判定に束ねられる。
- **Implications**:
  - StepNav は PHASE_DEFS を直接タブ化する現行から、**ナビ・グループ（fact-research / ペルソナ準備 / 章立て / 討論 / 編集）** をタブ化する形へ変更。`stakeholders`/`personas`/`interviews` を「ペルソナ準備」1タブに畳む。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存 `PhasePanel` を横並び | 3画面の PhasePanel を並べる | 変更小 | `PhasePanel` は縦1列前提で行対応（R1-3）を表現不可 | 却下 |
| B: 新規ワークスペース＋行部品 | `PersonaWorkspacePage`＋`StakeholderPersonaRow` を新設、表示部品と生成ロジックは再利用 | 行レイアウト・採用選択を素直に表現、ステアリング「画面処理は画面に直接」に整合 | 3操作の状態機械を自前で持つ | 採用 |
| C: フェーズを1つへ畳む | PHASE_DEFS を統合 | 概念が単純 | FE/BE の PhaseKey 契約・承認・ダッシュボードに広く波及 | ユーザ方針で不採用（3据え置き） |

## Design Decisions

### Decision: フェーズ3据え置き＋承認の暗黙化
- **Context**: R6。3フェーズを保ちつつ承認ボタンを廃止。
- **Alternatives Considered**: 1) フェーズ畳み込み（BE波及大） 2) 明示承認の維持（要件不一致）。
- **Selected Approach**: PHASE_DEFS 不変。承認＝次操作へ畳み込み（ペルソナ生成→stakeholders承認、取材→personas承認＋`approved:true`、章立てへ進む→interviews承認）。
- **Rationale**: BE契約・下流・既存データに無変更。UIの簡潔化のみで要件を満たす。
- **Trade-offs**: ＋影響最小 / － 3操作の状態導出を画面が担う。
- **Follow-up**: 取材操作で `approved:true` 付与を必ず通す（編集フェーズ依存）。

### Decision: 安定 `stakeholder.id` を唯一の突合キーとする（対応づけ＋採用選択）
- **Context**: R1-3 / R4-3（行対応）と R3 / R4（採用選択）の同一性キー。当初は「採用選択＝配列インデックス集合（`Set<number>`）」で設計していたが、位置は再調査で総入れ替えされると陳腐化し、別途の再シードを要した（レビュー Issue 2）。
- **Alternatives Considered**:
  1. 配列インデックス — 位置ベース。サブセット・再調査で不安定（当初案・却下）。
  2. `stakeholderRole` を突合キーに流用 — スキーマ追加ゼロだが役割名の一意性・LLMエコー忠実性に依存。
  3. 安定 `id` を永続 — 位置非依存で堅牢（採用）。
- **Selected Approach**: `StakeholderForFirestore` に安定 `id`（サーバ付番）を追加。ペルソナは `stakeholderId` で由来を保持し、採用選択は `Set<stakeholderId>` で管理。**行対応と採用選択を単一の安定キーに統一**する。由来解決は出力順非依存とするためエージェントにエコー用タグを出させ、サーバがタグ→id で解決する（フォールバック: 位置＋役割照合）。
- **Rationale**: 位置の陳腐化（Issue 2）と LLM出力順依存（Issue 1）を、単一の安定キー導入で同時に解消できる。再調査時は id 総入れ替え＝選択が新集合で自然に全 ON になり、再シードの小細工が不要。
- **Trade-offs**: ＋堅牢・2つの懸念を1決定で解消 / － `StakeholderForFirestore.id` と `Persona.stakeholderId` の永続追加、エージェント出力スキーマにタグ1項目追加。
- **Follow-up**: 旧データ（id 不在）は `String(index)`／`stakeholderRole` フォールバックで表示。`stakeholderId` はレガシー整合のため任意（`?`）とする。

### Decision: 選択的ペルソナ生成の入口
- **Context**: R4-1,2。採用ステークホルダーのみ生成。
- **Selected Approach**: `generatePersonas` onCall に `selectedStakeholderIds: string[]` を追加。サーバは `stakeholders/0` を選択 id で絞ってエージェントへ渡し、出力のエコー用タグから由来を解決して各ペルソナへ `stakeholderId` を付与。全件経路は「全 id 選択」で吸収。
- **Rationale**: エージェントは配列を反復生成するため、サブセット化は入力の絞り込みで成立。
- **Trade-offs**: ＋既存エージェント無改修に近い / － onCall とペイロード契約の更新。
- **Follow-up**: 選択0件はクライアントで実行前ガード（R3-4）。

## Risks & Mitigations
- LLM出力順が入力順と一致しない可能性 → 一次はエージェントのエコー用タグで由来解決（サーバがタグ→`stakeholder.id` で `stakeholderId` を付与）。二次に位置＋`stakeholderRole` フォールバック。生成は1立場1体・`.length(count)` を維持。
- 旧データに `stakeholder.id`／`persona.stakeholderId` が無い → 表示は `String(index)`／`stakeholderRole===role` フォールバック。恒久整合は再生成で確立。
- 承認畳み込みで `approved:true` を書き漏らすと編集フェーズが空になる → 取材ハンドラで `approvePersonas()` を先に必ず呼ぶことをテストで担保。
- StepNav のグルーピング変更が他ナビ利用箇所へ波及 → StepNav は単一の共有ナビであり、グループ定義はフェーズモデルにグローバルに置く（画面別分岐にしない）。

## References
- `@14ch/svelte-ui` `Checkbox` / `Tab`（`customPathMatcher`）— UI標準部品
- `functions/src/utils/topic-phase.ts` — フェーズ状態確定の規範（`confirmPhaseGenerated`）
