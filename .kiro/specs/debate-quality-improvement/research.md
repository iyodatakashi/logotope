# Research Log: debate-quality-improvement

## Summary
既存システムの Extension として分類。外部依存の調査は不要で、現行コードのパターン分析が中心。

### Discovery Scope
- `functions/src/agents/persona-agent.ts` — `buildPersonaSystemPrompt`, `generateTurn`
- `functions/src/pipeline/debate-orchestrator.ts` — `DebateState`, `executeDebate`, 発言者選択ロジック
- `functions/src/agents/facilitator-agent.ts` — `selectNextSpeaker`
- `functions/src/types/index.ts` — 共有型定義

---

## Research Log

### 1. 連続発言防止の現行ロジック分析

**現状:**
- `DebateState.lastAddressedPersonaId` で「明示的に指名された次の発言者」を保持
- `lastAddressedPersonaId` がある場合は直接使用、ない場合は `facilitator.selectNextSpeaker()` を呼ぶ
- `selectNextSpeaker` は `silenceMap`（沈黙ターン数）を受け取るが、「直前の発言者を除外する」ロジックは存在しない
- 結果として、ファシリテーターが同じペルソナを連続選択できる

**設計決定:**
- `DebateState` に `lastSpeakerId?: string` を追加
- `selectNextSpeaker` に `excludePersonaId?: string` を追加（直前の発言者ID）
- ファシリテーターのプロンプトで「excludeId の人物は除外」を明示
- 例外: excludeId を除いた場合に候補が0人になる場合は再選択を許容（要件1.3）

### 2. 語り口の個性化：属性→スタイル変換の設計

**現状:**
- `PersonaAttributes` に `age`, `occupation`, `stakeholderRole`, `background`, `interests`, `stanceDirection` あり
- 性別フィールドは現在 `PersonaAttributes` に存在しない
- `buildPersonaSystemPrompt` ではプロフィールをそのまま列挙するだけで、語り口指針なし

**設計決定:**
- `buildSpeechStyleGuide(persona: PersonaAttributes): string` 関数を新設
- 属性を元に**経験レベル**（若手/中堅/ベテラン/エキスパート）と**権威レベル**（低/中/高）を推定し、スタイル指針を生成
- 性別は `PersonaAttributes` に `gender?: string` を追加して対応（任意フィールド）
- スタイル指針はシステムプロンプトの冒頭に配置（既存の「発言スタイルの厳守事項」と統合）

**経験レベル推定ロジック（プロンプト内記述）:**
- age < 30 OR occupation に「新人/研修/アシスタント」等 → 口語体、短文、疑問形
- age 30-50, 管理職/専門家 → 論理的、業界語、断言的
- occupation に「職人/作業員/現場」等 → 経験談ベース、具体的、現場感
- stakeholderRole が経営者/有識者 → 自信を持った言い回し、遠慮なし

### 3. ファシリテーター介入頻度・参加バランス調整の設計

**現状:**
```typescript
if (currentTurnIndex % interventionInterval === 0 || hasSilence) {
  evaluateIntervention(...)
}
```
- 固定間隔（現在 `interventionInterval = 8`）で必ず評価を実行
- `hasSilence` チェックも行う
- 直接やりとり中かどうかは考慮されない
- `speakCount`（累計発言数）を介入判断に使っていない

**設計決定:**

**介入評価タイミング（`shouldEvaluateIntervention()` に切り出し）:**
- `consecutiveDirectExchanges >= 2`（直接やりとり進行中）かつ最大間隔内 → スキップ
- 直接指名なしのターンが発生（`consecutiveDirectExchanges` がリセット）→ 参加バランス評価を実行
- 緊急沈黙（`silenceMap` の最大値 > `personas.length`）→ 常に評価
- 最大間隔（`lastFacilitatorTurnIndex` から `interventionInterval * 2` ターン）超過 → 強制評価

**参加バランス評価（`evaluateParticipationBalance()` に切り出し）:**
- `speakCount` から各ペルソナの累計発言数を取得
- 平均を大きく下回るペルソナ（threshold: 平均の50%以下）を候補として列挙
- 候補がいる場合 → ファシリテーターの `evaluateIntervention` に「参加者リスト＋各発言数＋直近会話コンテキスト」を渡して invite 型介入を促す
- 候補がいない場合 → 介入なし（通常の `selectNextSpeaker` に委ねる）

**ファシリテーターへの情報渡し（`evaluateIntervention` の拡張）:**
- 現行: 会話履歴＋参加者リストのみ
- 変更後: 追加で各ペルソナの `speakCount` を渡す → AIが「発言少ない人 × 今の論点に関連性高い人」を判断して invite できる
- これによりオーケストレーター側がinvite対象を決め打ちせず、LLMが文脈判断する

**`consecutiveDirectExchanges` の管理:**
- `lastAddressedPersonaId` を使って発言した → カウントアップ
- `selectNextSpeaker` を使った（直接指名なし）→ 0 にリセット
- ファシリテーター介入があった → 0 にリセット

**`silenceThreshold` の見直し:**
- 固定値（現在5）→ `personas.length` の動的値に変更
- 5人討論なら閾値5。A→B→A→B→A の間に他3人が最大4ターン沈黙するのは自然なため、`personas.length` が妥当な上限

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `buildSpeechStyleGuide` を persona-agent.ts 内の純粋関数とする | 型依存を最小化し、テスト容易性を確保 |
| `excludePersonaId` を `selectNextSpeaker` の引数に追加 | ファシリテーターAIが除外ロジックを意識できる。AIに渡すことでより自然な選択が可能 |
| `consecutiveDirectExchanges` をカウンターで管理 | `ConversationTurn` 型に `addressedToPersonaId` を追加せずに済む。スキーマ変更なし |
| 性別フィールドを任意（`gender?: string`）とする | 既存ペルソナデータとの後方互換性を保つ |
| `evaluateIntervention` に `speakCount` を渡す | オーケストレーターがinvite対象を決め打ちせず、LLMが「発言量の少なさ×論点の関連性」を総合判断できる |
| `silenceThreshold` を `personas.length` の動的値にする | A→B→A パターンで他ペルソナが沈黙するのは自然。ペルソナ数を超えたら本当に発言機会がない状態 |
| 参加バランス評価を `evaluateParticipationBalance()` に切り出す | `shouldEvaluateIntervention()` と責務を分離し、テスト容易性を確保 |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| スタイル指針が過剰に長い場合、プロンプトが膨大になる | Medium | スタイルガイドを3-4行以内に収める制約をつける |
| `excludePersonaId` が常に適用されると2人討論で詰まる | Low | 要件1.3通り、候補0人の場合は除外を無視 |
| `consecutiveDirectExchanges` が長くなりすぎて介入が発生しない | Medium | `lastFacilitatorTurnIndex` からの最大間隔として `interventionInterval * 2` を上限とする |
| LLMが `speakCount` を無視してinviteを選ぶ可能性 | Low | プロンプトで「発言数の少ない人を優先」を明示。それでも文脈優先にする余地を残す |
| `maxTurns` をセーフティネット値にするといくら討論が続くか予測不能 | Medium | `minTurnsPerPersona * personas.length * 3` 程度を上限の目安とする。現状 `minTurnsPerPersona=6`・5人なら 90 ターン程度が妥当 |

### 4. 討論終了条件の再設計

**現状:**
- `while (currentTurnIndex < maxTurns && !debateEnded)` のループで、`maxTurns=60` に到達するか `debateEnded=true` になると終了
- `debateEnded` は `evaluateIntervention` が `close` を返し `allMet`（全員が `minTurnsPerPersona` 以上）で true になる
- `maxTurns=60` は実質的に通常終了として機能していた

**設計決定:**
- `maxTurns` を大幅に引き上げてセーフティネット専用にする（目安: `minTurnsPerPersona * personas.length * 3`、ただし動的ではなく設定値として固定）
- 現在 `maxTurns=60` → `200` 程度に変更（5人・`minTurnsPerPersona=6` なら通常 30〜60 ターン程度で自然終了する想定）
- 主終了条件はあくまで「ファシリテーターが close 判断 + 全員 minTurnsPerPersona 達成」のまま
- `evaluateIntervention` が `close` を返す機会は `shouldEvaluateIntervention` の評価タイミングに依存するため、適切な頻度で評価されることが重要
