# Research & Design Decisions: phase-generation-server-authority

## Summary
- **Feature**: `phase-generation-server-authority`
- **Discovery Scope**: Extension（既存の生成パイプラインへの統合改修。外部依存・新ライブラリなし）
- **Key Findings**:
  - フェーズ5（討論）に「サーバ権威でステータス確定」の完成形が2つ存在する: `updateDebatePhaseStatus`（無条件 update）と post-debate-comments の **`running → generated` 限定の冪等トランザクション**。後者を全フェーズの完了確定の規範とする。
  - P1（先行修正済）と P4 は既にサーバが成果物を永続化済み。P4 は完了確定のみクライアント残存で、P1 と同型の最小修正で揃う。
  - P2・P3 は成果物の永続化がクライアントにある（P2: `setDoc` ループ、P3: ペルソナ文書への結果書込）。ここをサーバへ移すのが本仕様の主作業。P3 はクライアント並列呼び出しを維持する制約あり。

## Research Log

### 完了確定パターンの規範化
- **Context**: 4フェーズで `phaseStatus='generated'` の確定方法を統一したい。誰が・いつ・冪等にどう書くか。
- **Sources Consulted**: `functions/src/pipeline/debate/debate-lifecycle.ts:15-24`、`functions/src/pipeline/debate/post-debate-comments.ts:47-54`、`functions/src/api/stakeholders.ts`（P1修正後）。
- **Findings**:
  - post-debate-comments は `runTransaction` 内で `phaseStatus !== 'running'` なら no-op、`running` のときだけ `generated` に更新（冪等・終端）。
  - P1 修正は無条件 `update({ phase:1, phaseStatus:'generated' })`。単一呼び出しでは無条件でも実害ないが、再生成・承認との競合に対しては「running→generated 限定」のほうが安全。
- **Implications**: 共通の冪等ヘルパー `confirmPhaseGenerated(topicId, phase)`（running→generated 限定）を新設し、P1/P2/P4 と、P3 の全件完了時に共用する。P1 の無条件 update もこのヘルパーへ寄せて一貫させる。

### P3（取材）の完了判定をサーバ化しつつ並列呼び出しを維持
- **Context**: ユーザ指示によりペルソナ単位のクライアント並列呼び出しを維持。一方で成果物永続化と完了確定はサーバへ。
- **Sources Consulted**: `src/lib/stores/personas.svelte.ts:104-183`、`src/lib/features/admin/research/Phase3Interviews.svelte:75-106`、`functions/src/api/interviews.ts`。
- **Findings**:
  - 現状クライアント `runInterview` は結果をペルソナ文書へ書き、`runInterviews` が `Promise.all` 後に `markInterviewsComplete`（generated）を書く。per-persona の `in_progress` 即時クリア（`beliefs:[]`）は UX フィードバック（[[feedback-regenerate-immediate-clear]]）。
  - per-persona の `error` 状態でも `Promise.all` は解決し得る（クライアント `runInterview` は内部 catch して error 状態を書き rethrow しない）。
- **Implications**:
  - サーバ `runInterview` が「自ペルソナの最終結果（completed/error）の永続化」を担い、completed 永続化後に `confirmInterviewsGeneratedIfAllComplete`（全ペルソナ completed かつ running のときだけ generated）を実行。
  - クライアントは fan-out 起動・開始時の `running` 書込・per-persona の `in_progress` 即時クリア（UX）・全件 settle 後の `stopped` 判定のみを担う。完了（generated）確定はクライアントから撤去。

### 永続化のサーバ移管（P2）
- **Context**: `generatePersonas` は personas を返すのみで、クライアントが `setDoc` で永続化している。
- **Sources Consulted**: `functions/src/api/personas.ts`、`src/lib/models/topic/createTopic.svelte.ts:126-154`、`functions/src/pipeline/personas/personas.ts`。
- **Findings**: クライアント書込フィールドは `sortOrder`(index)・`approved:false`・`beliefs:[]`・`createdAt`・生成フィールド。これをサーバの batch write で再現可能。生成は in-memory 完了後に永続化するため、失敗時は未書込（部分書込なし）にできる。
- **Implications**: `generatePersonas` 呼び出しでサーバが batch でペルソナ文書を書き、`confirmPhaseGenerated(topicId, 2)` を実行。戻り値は不要（`Record<string, never>`）。クライアントは `setDoc` ループと generated 書込を撤去。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存パターン横展開（採用） | P1 で確立した「サーバ永続化＋冪等 generated 確定／クライアントはガード」を P2/P3/P4 へ展開し、薄い共通ヘルパーを1つ追加 | 一貫・低リスク・討論基準に収束 | P2/P3 はクライアント永続化撤去で戻り値・テスト修正が広め | gap-analysis Option A |
| B: リポジトリ/中央フェーズ管理層 | `functions/src/db/repository.ts` を新設し書込を集約 | 集約 | `structure.md` の中央化禁止に反する | 不採用 |
| C: P3 のみ完了確定をクライアント温存 | P3 は結果永続化のみサーバ化、generated はガード付き `markInterviewsComplete` 残存 | P3 のリスク低 | P3 が一貫性(R5)を部分未達 | フォールバック候補 |

## Design Decisions

### Decision: 完了確定は「running→generated 限定の冪等トランザクション」に統一
- **Context**: 4フェーズ＋討論で generated の書き方がバラバラ。再生成・承認との競合で誤上書きの懸念。
- **Alternatives Considered**:
  1. 無条件 `update(generated)` — 単純だが approved/stopped を上書きし得る。
  2. running→generated 限定の冪等 tx — post-debate-comments と同型。
- **Selected Approach**: 共通ヘルパー `confirmPhaseGenerated(topicId, phase)` を新設し running→generated のみ適用。P1 も移行。
- **Rationale**: 既存の規範（post-debate-comments）に一致し、冪等・競合安全。
- **Trade-offs**: トランザクション1回の追加コスト（軽微）。
- **Follow-up**: P3 は「全件 completed」を追加条件にした派生関数を用意。

### Decision: `running` 書込と per-persona の即時クリアはクライアントに残す
- **Context**: 完了・失敗をサーバ権威にしても、開始時の即時 UX フィードバックは維持したい。
- **Selected Approach**: 開始時の `phaseStatus='running'`（および P3 の per-persona `in_progress`/`beliefs:[]` 即時クリア）はクライアントが書く。成果物（最終結果）と generated はサーバが書く。
- **Rationale**: `running` はトリガ状態であり、クライアント消失で失われても害が小さい（再実行で復帰）。即時クリアは UX 要件（[[feedback-regenerate-immediate-clear]]）。
- **Trade-offs**: `running` の二重所有に見えるが、完了・成果物の権威は明確にサーバ。

### Decision: 生成 onCall は成果物を戻り値で返さない（`onSnapshot` 反映）
- **Context**: サーバが成果物を永続化するなら、callable の戻り値で結果を返す必要があるか。
- **Alternatives Considered**:
  1. 現状結果を返し続ける — 変更最小だが結果がレスポンスと Firestore に二重化。
  2. `{}` に縮小 — サーバ保存＋FE は `onSnapshot` 購読で反映。
- **Selected Approach**: 2 を採用。`runInterview` は `{}` を返す（`generatePersonas`/`generateStakeholders` と同形）。結果の Single Source of Truth は Firestore。
- **Rationale**: サーバ権威と整合し、戻り値から書き込む経路を物理的に排除できる。戻り値の消費者は現状ゼロ（クライアントは snapshot 駆動）。
- **Trade-offs**: 両側の callable 型縮小とレスポンス期待テストの更新が必要（難易度低）。

### Decision: 失敗時 `stopped` の所有
- **Context**: 生成失敗時のフェーズ停止表示。
- **Selected Approach**: P1/P2/P4 はクライアント catch がガード付き（サーバが generated 済みなら上書きしない）で `stopped` を書く。P3 はクライアントが全件 settle 後に「error あり」を検知してガード付きで `stopped` を書く。
- **Rationale**: P1/P2/P4 はサーバが throw すると成果物未確定のため、クライアントが停止を書くのが自然。P3 はクライアントが fan-out を所有するため失敗集約もクライアントが行うのが整合的。
- **Trade-offs**: `stopped` がクライアント所有のままだが、ガードにより generated を壊さない。

## Risks & Mitigations
- **P3 の並列トランザクション競合** — 各 server `runInterview` 完了時に topic 文書へ冪等 tx。小規模ペルソナ数なら許容。`running→generated` 限定で多重実行も安全。
- **P2 の部分書込** — 生成（in-memory）完了後に batch write することで「全件成功 or 未書込」を担保。
- **既存テストの破壊** — `topic.test.ts`（P1 で更新済）に加え P2/P4 の期待変更、`personas.svelte` ストアテストの P3 期待変更、Functions 側 phase 書込テスト追加が必要。
- **ステアリング `firebase.md` の原則からの逸脱** — AI 生成物の永続化に限った意図的例外として要件 Introduction に明記済。

## References
- `functions/src/pipeline/debate/post-debate-comments.ts:47-54` — 冪等 generated 確定の規範
- `functions/src/pipeline/debate/debate-lifecycle.ts:15-24` — サーバ phaseStatus 書込の前例
- `functions/src/api/stakeholders.ts` — P1 修正（本仕様の先行実装）
