# Research & Design Decisions

---
**Feature**: `chapter-agenda-tracking`
**Discovery Scope**: Extension（既存の討論パイプラインへの機能追加）
**Key Findings**:
- 論点投入は A（論点ずれ）・B（出尽くし）両介入に統合する。B のみでは活発な議論で論点消化がドライブされないため（設計レビューで判明）
- 論点は3ステータス（untouched / introduced / addressed）で管理。introduced はアクションベース、addressed は AI 評価ベース
- `DebateState` はメモリ上で1チャプタータスクの実行中だけ保持されるため、ステータスの永続化は不要
- Chapter 型に `discussionPoints`（string[]）を追加。ステータス管理は DebateState 側

---

## Research Log

### 既存の介入機構の分析
- **Context**: 未消化論点の投入を既存の intervention 機構と統合できるか確認
- **Findings**:
  - `tryIntervention` は `!targetPersona || !canContinuePairConversation` のとき評価される
  - A（論点ずれ）→ B（出尽くし）の順に評価し、最初に発火した方を採用
  - **B（出尽くし）`evaluateStallIntervention`** がすでに「まだ議論されていない新しい論点に切り替えて振る」役割を担っている
  - ここに `unaddressedDiscussionPoints` を渡すことで、チャプター生成時に定義した論点を活用できる
- **Implications**: `evaluateStallIntervention` のシグネチャと prompt を変更するだけでよい。新しい介入タイプは不要

### チャプター開幕の論点1投げかけ
- **Context**: `generateOpening` / `generateChapterIntroduction` への最小変更で論点1を含められるか確認
- **Findings**:
  - `Chapter` 型に `discussionPoints` を追加すれば、関数シグネチャを変えずに参照できる
  - `generateOpening` は `firstChapter?: Chapter` を受け取り、prompt に `focusQuestion` を使っている。同様に `discussionPoints[0]` を追加すればよい
  - `generateChapterIntroduction` も同様
- **Implications**: 関数シグネチャ変更なし。prompt のテキストのみ変更

### チャプター終了判断への統合
- **Context**: 既存の early-end ロジック（`chapterEndCount >= CHAPTER_END_COUNT_LIMIT`）との統合方法
- **Findings**:
  - 早期終了 break の直前に「未消化論点の AI 評価」を挟むのが最小変更
  - `evaluateDiscussionPointCoverage` で未消化論点リストを返し、空でなければ `chapterEndCount = 0` にリセットして継続
  - AI 評価は早期終了条件が揃ったときのみ発火（毎ターン呼ばない）
- **Implications**: `debate-orchestrator.ts` の while ループ内の break 直前に条件を追加するだけ

### ターンキャップの見直し
- **Context**: 現行 `TURN_CAP_RATIO = 1.5` → cap = ceil(15 × 1.5) = 23 ターン。論点消化フェーズに十分か
- **Findings**:
  - 3〜5 論点 × 最低 3〜5 ターン = 9〜25 ターンの追加が必要
  - `discussionPoints` あり: `AGENDA_TURN_CAP_RATIO = 2.5` → cap = ceil(15 × 2.5) = 38 ターンが適切
  - `discussionPoints` なし: 既存 `TURN_CAP_RATIO = 1.5` を維持
- **Implications**: `debate.constants.ts` に `AGENDA_TURN_CAP_RATIO = 2.5` を追加。`executeChapterTask` で cap 計算を分岐

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| 都度 AI 評価（毎ターン） | ターンごとに論点消化を評価 | リアルタイム精度高 | AI 呼び出しコスト大、討論速度低下 |
| **早期終了トリガー時のみ評価（採用）** | 早期終了条件成立時のみ評価 | 最小 AI コスト、既存ロジックへの変更最小 | 評価タイミングが遅れる場合あり（許容範囲） |
| Firestore チェックリスト永続化 | 消化状況を Firestore に書き込む | タスク再実行時に復元可能 | 現状タスクは基本的に再実行を前提としないため過剰 |

---

## Design Decisions

### Decision: A・B 両介入に未完了論点を渡す（設計レビューで更新）

- **Context**: ファシリテーターの介入時に未完了論点をどう渡すか。当初は B（出尽くし）介入のみを統合点と想定していたが、設計レビューで「B は高意欲者なし時のみ発火するため、活発な議論では論点消化がドライブされず cap 到達まで未消化論点が残る」という欠陥が判明
- **Alternatives Considered**:
  1. B介入のみに論点を渡す（当初案）— 活発な議論で論点消化がドライブされない
  2. 新しい介入タイプを追加 — 既存フローを複雑化、評価順序の再設計が必要
  3. **A・B 両介入に未完了論点を渡す（採用）** — A は engagement 非依存（クールダウン経過 & 指名なしで発火）のため活発時もドライブ可能。指名連鎖は `MAX_PAIR_CONVERSATION_TURNS=3` で必ず途切れ A の発火機会が確保される
- **Selected Approach**: `evaluateTopicDrift`（A）と `evaluateStallIntervention`（B）の両方に `unaddressedDiscussionPoints?: string[]` を追加。A のプロンプトは三択（逸脱→引き戻し / 一段落→論点投入 / 深まり中→介入しない）で「流れ最優先」を明示。B のプロンプトは「流れ優先、落ち着いていれば論点投入」
- **Trade-offs**: cap 到達時に未完了論点が残るケースは依然ありうる（流れ優先のトレードオフとして許容）。論点投入の有無は LLM 判断に委ねるが、A・B 両経路でドライブ機会が増える

### Decision: 論点を3ステータス（untouched / introduced / addressed）で管理（設計レビューで更新）

- **Context**: 要件 2.3 は「introduced（着手）」、要件 3 は「addressed（完了）」を求める。当初設計は `unaddressedDiscussionPoints: string[]` の2状態のみで「投げかけ済みだが未消化」を表現できず、論点の重複投入リスクがあった
- **Selected Approach**: `DebateState.discussionPoints: DiscussionPointState[]`（`{ point, status }`）で管理。`introduced` はアクションベース（投入時にオーケストレーターがマーク）、`addressed` は内容ベース（AI 評価）。未完了 = `status !== 'addressed'`
- **追加変更**: `introduced` をマークするには「どの論点を投入したか」をファシリテーターが返す必要があるため、`FacilitatorReply` に `selectedDiscussionPointIndex?: number` を追加
- **Rationale**: 2軸（投げかけ／消化）を1つの enum に統一でき、重複投入の抑制（introduced を優先度低下）と終了判定（全 addressed）が明確になる
- **Trade-offs**: 型がやや複雑化するが、要件 2.3 と 3 を統一的に表現でき、ステータスは Firestore 非永続でメモリのみ。タスク再実行時は全 untouched で再初期化し AI 評価で復元

### Decision: 第1章の論点は日常感覚の切り口に制約（設計レビューで追加）

- **Context**: `generateOpening` は第1章で「専門用語・固有名詞禁止、誰でも答えられる入口」を要求。論点を機械的に開幕へ結合すると入口設計が崩れる
- **Selected Approach**: `generateChapters` の論点生成プロンプトに「第1章の discussionPoints は日常感覚で答えられる切り口にする」制約を追加

---

## Risks & Mitigations

- **AI 評価失敗リスク**: `evaluateDiscussionPointCoverage` が失敗した場合、フォールバックとして既存の early-end ロジックで終了する
- **論点生成品質リスク**: チャプター生成時に生成される `discussionPoints` が重複・過度に具体的になる可能性。プロンプトで「フォーカス問いに即した多様な切り口を3〜5件」と指示することで対処
- **第1章入口品質リスク**: 第1章の論点が専門的だと開幕の「誰でも答えられる入口」設計が崩れる。論点生成プロンプトに第1章は日常感覚の切り口という制約を追加
- **論点消化ドライブ不足リスク**: B介入のみでは活発な議論で論点が投入されない。A・B 両介入に論点を渡すことで緩和。ただし cap 到達時に未完了論点が残るケースは流れ優先のトレードオフとして許容
- **討論長大化リスク**: 全論点消化を終了条件にすると討論が長くなりすぎる可能性。`AGENDA_TURN_CAP_RATIO = 2.5` のハードキャップで上限を設定
