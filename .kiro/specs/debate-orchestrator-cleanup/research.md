# Research & Design Decisions

---
**Purpose**: Discovery findings and design rationale for `debate-orchestrator-cleanup`.

---

## Summary
- **Feature**: `debate-orchestrator-cleanup`
- **Discovery Scope**: Extension（単一ファイルの内部リファクタリング）
- **Key Findings**:
  - `generatePersonaTurn` は AI 生成・Firestore 永続化・インメモリ状態更新を一括して行っており、130行超。分離することで各フェーズを独立してテスト可能になる
  - `tryStallIntervention` と `tryTopicDriftIntervention` は `validPersonaId + saveFacilitatorTurn + return SpeakerSelection` の同一構造を繰り返す。ヘルパー1関数で吸収できる
  - `evaluateEngagement` はペンディングインテント失効・意欲アセスメント・Firestore 保存の3責任を持つ。先頭の失効処理だけ抽出すれば残りは一貫する
  - `chapterHistory` フィルタ（`state.history.filter(t => t.chapterId === chapter.id)`）が4箇所に独立して存在する。ループ内で一度計算してパラメータとして渡せば排除できる
  - 外部モジュール・型定義への変更は不要。すべて `debate-orchestrator.ts` の内部関数リストに収まる

## Research Log

### generatePersonaTurn の責任分析
- **Context**: Req 1 — 多責任関数の分離
- **Findings**:
  - Firestore 書き込みが2箇所（`addTurn`、`updatePersonaBelief`）あり、どちらも後続の状態更新に必要なIDを生成する
  - `updatePersonaBelief` の戻り値 `savedBelief.id` は `persona.beliefs` への追記に必要 → 先にFirestore書き込みが完了しないと状態更新できない
  - よって「Firestoreが先、状態更新が後」という順序制約が存在する
  - 対応: `generatePersonaTurn` はすべての I/O を完了させ `PersonaTurnResult` を返す。後続の `applyPersonaTurnToState` が純粋な状態更新を行う
- **Implications**: `PersonaTurnResult` は turnId・savedBelief・remainingPendingIntents・targetPersonaId を含む必要がある

### pendingIntent 消費の Firestore 書き込みの扱い
- **Context**: ペンディングキュー消費は状態更新（`pendingIntents.delete/set`）と Firestore 書き込み（`setPendingIntents`）が対になっている
- **Findings**:
  - `generatePersonaTurn` 内での Firestore write-through を維持し、消費後の残エントリを `PersonaTurnResult.remainingPendingIntents` として返す
  - `applyPersonaTurnToState` はこれを受け取り `state.pendingIntents` を更新する（Firestore 呼び出しなし）
  - インメモリ状態とストレージが同じターンで同期されるという不変条件は維持される

### 介入関数の差異分析
- **Context**: Req 3 — `tryStallIntervention` と `tryTopicDriftIntervention` の重複
- **Findings**:
  - Stall: `targetId` が undefined でもファシリテーターターンを保存する（対象なしのコメントとして機能）
  - Drift: `targetId` が undefined の場合は保存せず即返却する（対象なし = 逸脱なしと解釈）
  - 共通部分: `saveFacilitatorTurn` の呼び出し + `SpeakerSelection | undefined` の構築
  - 対応: `persistInterventionTurn(sessionId, state, content, targetId, chapterId)` として共通化。Drift のみ targetId が undefined のとき呼び出し前に早期 return する

### chapterHistory の重複箇所
- **Context**: Req 4
- **Findings**:
  - 出現箇所: `runChapterLoop`（`chapterTurnCount` クロージャ内）、`tryStallIntervention`、`tryTopicDriftIntervention`、`generatePersonaTurn`（buildTurnContext のため）、`generateChapterTransition`（`recentHistory` は別物）
  - `generateChapterTransition` の `recentHistory = state.history.slice(-10)` は chapterHistory とは異なるスライスのため対象外
  - ループ内で1ターンごとに再計算して下位関数に渡すことで重複を排除できる

## Design Decisions

### Decision: `generatePersonaTurn` の戻り値を `boolean` から `PersonaTurnResult | null` に変更
- **Context**: 状態更新を呼び出し元に移すため、保存結果を戻り値として返す必要がある
- **Alternatives Considered**:
  1. boolean のまま、状態更新を関数内に残す → Req 1 を満たせない
  2. 戻り値を `PersonaTurnResult | null` にし、呼び出し元が `applyPersonaTurnToState` を呼ぶ → 採用
- **Selected Approach**: Option 2
- **Rationale**: I/O と状態変化を明確に分離できる。`null` は討論停止（debate not active）を表す
- **Trade-offs**: 呼び出し元（`runChapterLoop`、`generateUnansweredReply`）に `applyPersonaTurnToState` の呼び出しが追加されるが、責任が明確になる

### Decision: `persistInterventionTurn` の always-save セマンティクス
- **Context**: Stall は target なしでも保存、Drift は target なしなら保存しない
- **Alternatives Considered**:
  1. `requireTarget: boolean` パラメータを追加 → 呼び出し側の意図が見えにくくなる
  2. ヘルパーは常にsave（Stall用）として設計し、Drift は呼び出し前に early return → 採用
- **Selected Approach**: Option 2
- **Rationale**: ヘルパーの実装がシンプルで副作用が明確。各 caller が自分の条件を制御する

## Risks & Mitigations
- `PersonaTurnResult` を返すように変更するため `generatePersonaTurn` の呼び出し元（`runChapterLoop`、`generateUnansweredReply`）のシグネチャが変わる — 同じファイル内なので影響範囲は局所的
- `chapterHistory` をループ内で再計算するコストはターン数に比例するが、現在も各関数内で同様の計算をしているため増加なし
