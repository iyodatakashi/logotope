# Technical Design

## Overview

本設計は `debate-orchestrator.ts` の `executeTurn` および `executeChapterTask` メインループに対する局所的な修正である。現在の `pendingIntervention` パターンは、介入発火時にファシリテーターターンの Firestore への保存を次イテレーション冒頭まで遅延させるが、同じ `executeTurn` 呼び出し内でメンバーターンの生成を止めていない。これにより「メンバー発言 → ファシリテーター発言」というターン順序の逆転と、ファシリテーター発言を含まない古い engagement 評価でメンバーが発言するという問題が発生している。

修正の核心は「介入を検出した時点で `persistInterventionTurn` を即時呼び出してファシリテーターターンを確定させ、`generatePersonaTurn` を呼ばずに早期リターンする」ことである。これにより `pendingIntervention` 遅延機構が不要になり、メインループも単純化される。

### Goals

- ターン順序をファシリテーター発言 → メンバー応答の正しい順序に修正する
- ファシリテーターターン保存後に `state.lastSpeakerId` をクリアし、次イテレーションで全メンバーを engagement 評価対象にする
- 介入後イテレーションの engagement 評価がファシリテーター発言を含む最新履歴を使うことを保証する

### Non-Goals

- ファシリテーター・ペルソナエージェントの内部ロジック変更
- Firestore スキーマ変更
- フロントエンド・表示層への変更
- `chapterTurnCount` や `shouldEndChapterEarly` のロジック変更

---

## Boundary Commitments

### This Spec Owns

- `executeTurn` の介入検出後フロー（即時保存・早期リターン）
- `persistInterventionTurn` の postcondition（`state.lastSpeakerId` クリア）
- `executeChapterTask` メインループからの `pendingIntervention` 処理ブロック除去
- `DebateState.pendingIntervention` フィールドの削除

### Out of Boundary

- `evaluateEngagement` 関数本体の変更（`lastSpeakerId` クリアにより自動的に全員評価になる）
- `tryTopicDriftIntervention` / `tryStallIntervention` の判定ロジック
- `enqueueHighEngagementIntents` 本体の変更（介入パスでも同関数を呼び出す）

### Allowed Dependencies

- `persistInterventionTurn`（既存関数、シグネチャ変更なし）
- `state.targetPersona` による指名繰り越し機構（既存、変更なし）
- `resolvePairConversation`（既存、変更なし）

### Revalidation Triggers

- `persistInterventionTurn` のシグネチャまたは副作用が変更された場合
- `DebateState` 型の `targetPersona` フィールド定義が変更された場合

---

## Architecture

### Existing Architecture Analysis

現在の `executeChapterTask` メインループは以下の2段構成：

1. **保存ブロック**: `if (state.pendingIntervention)` → ファシリテーターターンを保存
2. **executeTurn 呼び出し**: engagement 評価 → 介入検出 or メンバー発言

介入発火時の問題シーケンス：
- イテレーション N: `executeTurn` 内で介入検出 → `pendingIntervention` セット → **そのまま** `generatePersonaTurn` → メンバーターン保存
- イテレーション N+1: `pendingIntervention` → ファシリテーターターン保存 → `executeTurn` → 次のメンバーターン

結果として Firestore 上の順序は「メンバー → ファシリテーター」となり逆転する。

### Architecture Pattern & Boundary Map

```mermaid
sequenceDiagram
    participant Loop as executeChapterTask
    participant ET as executeTurn
    participant EE as evaluateEngagement
    participant PI as persistInterventionTurn
    participant GPT as generatePersonaTurn

    Note over Loop,GPT: 介入発火イテレーション（修正後）
    Loop->>ET: call
    ET->>EE: evaluateEngagement
    EE-->>ET: assessments
    ET->>ET: enqueueHighEngagementIntents（高意欲の全メンバーをキュー追加）
    ET->>PI: 介入検出→即時保存
    PI-->>ET: facilitatorTurn saved
    ET->>ET: state.lastSpeakerId = undefined
    ET->>ET: state.targetPersona = nominee
    ET-->>Loop: return true（早期リターン）

    Note over Loop,GPT: 次イテレーション（修正後）
    Loop->>ET: call
    ET->>EE: evaluateEngagement（ファシリテーターターン込み・全員対象）
    EE-->>ET: assessments（全メンバー）
    ET->>GPT: 指名メンバーが応答（ファシリテーター発言がコンテキストに含まれる）
    GPT-->>ET: memberTurn saved
    ET-->>Loop: return isActive
```

**Key Decisions**:
- 介入検出後に `persistInterventionTurn` を即時呼び出すことで、ファシリテーターターンが `state.turns` に追加されてから early return する
- `pendingIntervention` 遅延機構を廃止し、メインループを単純化

### Technology Stack

本修正に新たなライブラリや外部依存は不要。既存の TypeScript + Firebase Admin SDK の範囲内で完結する。

---

## File Structure Plan

### Modified Files

- `functions/src/types/debate.types.ts` — `DebateState` から `pendingIntervention` フィールドを削除
- `functions/src/pipeline/debate/debate-orchestrator.ts` — 下記3点の変更：
  1. `executeChapterTask` メインループから `pendingIntervention` 保存ブロック除去
  2. `executeTurn` の介入検出後フローを即時保存＋早期リターンに変更
  3. `persistInterventionTurn` に `state.lastSpeakerId = undefined` を追加

---

## System Flows

### 介入なし（通常メンバーターン）

変更なし。`executeTurn` → `evaluateEngagement` → `selectNextSpeaker` → `generatePersonaTurn` の既存フロー。

### 介入あり（修正後の全体フロー）

```mermaid
sequenceDiagram
    participant Loop as メインループ
    participant ET as executeTurn
    participant EE as evaluateEngagement
    participant TI as tryIntervention
    participant PI as persistInterventionTurn
    participant RS as resolveSpeechParams
    participant GPT as generatePersonaTurn

    Loop->>ET: イテレーション N
    ET->>EE: 全員評価（lastSpeakerId で除外）
    ET->>TI: 介入チェック
    TI-->>ET: 介入あり（content, targetPersonaId）
    ET->>ET: enqueueHighEngagementIntents（nominee 以外の高意欲メンバーをキュー追加）
    ET->>PI: ファシリテーターターン即時保存
    Note right of PI: state.turns に追加<br/>state.pairConversationTurns = 0<br/>state.lastSpeakerId = undefined（新規）
    PI-->>ET: saved
    ET->>ET: state.targetPersona = nominee（指名あり時）
    ET-->>Loop: return true

    Loop->>ET: イテレーション N+1
    ET->>ET: targetPersona 取得・クリア
    ET->>EE: 全員評価（lastSpeakerId undefined → 全員）
    Note right of EE: ファシリテーターターンが<br/>state.turns に含まれる
    ET->>RS: resolveSpeechParams（nominee）
    ET->>GPT: メンバー応答生成
    Note right of GPT: chapterTurns にファシリテーター<br/>発言が含まれる
    GPT-->>ET: memberTurn saved
    ET-->>Loop: return isActive
```

---

## Requirements Traceability

| Requirement | Summary | Component | Flows |
|-------------|---------|-----------|-------|
| 1.1 | 介入発火時にファシリテーターターンを同イテレーション内で保存 | `executeTurn` | 介入あり：`persistInterventionTurn` 即時呼び出し |
| 1.2 | 介入発火時にメンバーターンを生成しない | `executeTurn` | 介入あり：early return |
| 1.3 | 指名がある場合 `state.targetPersona` にセット | `executeTurn` | 介入あり：early return 前にセット |
| 1.4 | 介入発火イテレーションで早期終了 | `executeTurn` | `return true` |
| 2.1 | ファシリテーターターン保存時に `lastSpeakerId` をクリア | `persistInterventionTurn` | `state.lastSpeakerId = undefined` |
| 2.2 | 次イテレーションで全メンバーを評価対象に | `evaluateEngagement` | N+1 イテレーション |
| 3.1 | 介入後イテレーションでファシリテーターターン込みの履歴で評価 | `evaluateEngagement` | N+1 冒頭 |
| 3.2 | 指名メンバーが評価外の場合のフォールバック | `resolveSpeechParams` | 既存フォールバック（`lastSpeakerId` クリアにより通常は不要） |
| 3.3 | 現イテレーションのスコアを発言パラメータに使用 | `resolveSpeechParams` | N+1 の assessments から取得 |

---

## Components and Interfaces

| Component | Layer | Intent | Req Coverage | Key Change |
|-----------|-------|--------|--------------|------------|
| `executeTurn` | Orchestration | 1ターンの発言処理 | 1.1–1.4 | 介入時の即時保存＋早期リターン |
| `persistInterventionTurn` | Orchestration | ファシリテーターターン保存 | 2.1 | `state.lastSpeakerId` クリア追加 |
| `executeChapterTask` (loop) | Orchestration | 章ループ | — | `pendingIntervention` ブロック除去 |
| `DebateState` | Type | 討論状態 | — | `pendingIntervention` フィールド削除 |

### Orchestration Layer

#### `executeTurn`（変更）

| Field | Detail |
|-------|--------|
| Intent | 1イテレーション分の発言（ファシリテーターまたはメンバー）を処理する |
| Requirements | 1.1, 1.2, 1.3, 1.4 |

**Responsibilities & Constraints**
- 介入が発火した場合: `persistInterventionTurn` を呼び出してファシリテーターターンを保存し、`state.targetPersona` に指名をセットして `return true`
- 介入がない場合: 既存の engagement 評価 → 話者選択 → メンバーターン生成フローを維持
- `state.pendingIntervention` の参照・セットを行わない

**Contracts**: Service [x]

##### State Interface（変更後の介入分岐）

```typescript
// 介入検出後の早期リターンパス（新規）
// 介入を detectInterventionAndPersist 相当の処理で保存し早期リターンする
type executeTurnReturn =
  | true        // 介入処理完了（ファシリテーターターン保存済み）
  | boolean     // 通常メンバーターン完了（isEngagementActive の結果）
  | null;       // 討論停止検出
```

- Preconditions: `state.turns` が最新状態であること
- Postconditions（介入パス）: ファシリテーターターンが `state.turns` に追加済み、`state.lastSpeakerId === undefined`、`state.pendingIntervention` を変更しない
- Postconditions（通常パス）: メンバーターンが `state.turns` に追加済み、`state.lastSpeakerId` が更新済み

**Implementation Notes**
- 介入検出後、`persistInterventionTurn` の前に `enqueueHighEngagementIntents` を呼ぶ。介入時はどのメンバーも発言しないため、`speakerSelection.personaId` には存在しないダミー ID（例: `''`）を渡して全高意欲メンバーをキュー対象とする（「高意欲だが発言できなかった = キュー追加」の統一ルールに従う）
- 介入なしパスの `pairSelection` → drift → stall → normal の優先順位は変更しない
- 戻り値の型シグネチャは変更なし（`boolean | null`）。介入パスでは `isEngagementActive` を呼ばず常に `true` を返す

---

#### `persistInterventionTurn`（変更）

| Field | Detail |
|-------|--------|
| Intent | ファシリテーター介入ターンを Firestore と `state.turns` に保存する |
| Requirements | 2.1 |

**Responsibilities & Constraints**
- 既存の Firestore 書き込みと `state.turns.push` は変更しない
- `state.lastSpeakerId = undefined` を追加する

**Contracts**: State [x]

##### State Management

- State model: `state.turns`（ファシリテーターターン追加）、`state.pairConversationTurns = 0`（既存）、`state.lastSpeakerId = undefined`（新規追加）
- Postcondition: `state.turns` の末尾がファシリテーターターン、`state.lastSpeakerId` が `undefined`

**Implementation Notes**
- 戻り値（`SpeakerSelection | undefined`）のシグネチャは変更しない

---

#### `executeChapterTask` メインループ（変更）

| Field | Detail |
|-------|--------|
| Intent | `pendingIntervention` 保存ブロックを除去してループを単純化する |
| Requirements | — |

**変更箇所**:

```typescript
// 削除するブロック
if (state.pendingIntervention) {
    const { content, targetPersonaId, chapterId } = state.pendingIntervention;
    await persistInterventionTurn({ topicId, state, content, targetPersonaId, chapterId });
    state.pendingIntervention = undefined;
    if (state.turns.length >= maxTurns) break;
}
```

削除後、`executeTurn` の戻り値処理（`null` チェック、`activityLog.push`、`shouldEndChapterEarly`）はそのまま維持する。

---

#### `DebateState`（型変更）

| Field | Detail |
|-------|--------|
| Intent | `pendingIntervention` フィールドを削除して不使用フィールドを除去する |
| Requirements | — |

**変更前**:
```typescript
type DebateState = {
    // ...
    pendingIntervention?: { content: string; targetPersonaId?: string; chapterId: string };
    // ...
};
```

**変更後**: `pendingIntervention` フィールドを削除。他のフィールドは変更なし。

**Implementation Notes**
- `state-restore.ts` は `pendingIntervention` を復元対象に含めていないため、変更不要

---

## Testing Strategy

### Unit Tests

- `executeTurn`: 介入発火時に `enqueueHighEngagementIntents` → `persistInterventionTurn` が呼ばれ、`generatePersonaTurn` が呼ばれないこと
- `executeTurn`: 介入発火時の戻り値が `true`（null でも false でもない）であること
- `executeTurn`: 介入発火時に `state.targetPersona` が指名メンバーにセットされること
- `executeTurn`: 介入発火時に高意欲メンバー（nominee 除く）が intent キューに追加されること
- `persistInterventionTurn`: 呼び出し後に `state.lastSpeakerId` が `undefined` になること
- `executeTurn`: 介入なし時の既存フロー（メンバーターン生成）が変わらないこと

### Integration Tests

- 介入発火→次イテレーションの2ターン連続で Firestore 上のターン順序がファシリテーター→メンバーになること
- 介入後イテレーションの `evaluateEngagement` が全メンバーを評価対象とすること（モック利用）
- 指名メンバーが次イテレーションで `targeted_by_facilitator` として発言すること
