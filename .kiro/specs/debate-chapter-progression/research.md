# Research & Design Decisions

---

- **Feature**: `debate-chapter-progression`
- **Discovery Scope**: Extension（既存 `DebateOrchestratorService` への章進行機能の追加）
- **Key Findings**:
  - 章終了判定を別 AI 呼び出しにすることで、介入判定プロンプトの責務を切り離せる
  - `sessions/0` の embedded array にフィールドを追加するだけで済み、コレクション構造変更は不要
  - FE は `turns[].chapterIndex` から章グループを導出できるため、`ChapterDoc` に `startTurnIndex` は不要

---

## Research Log

### 既存アーキテクチャの章進行への適合性

- **Context**: `executeDebate` のフラットループをどう章構造に再編するか
- **Findings**:
  - `DebateState` はループ間でスタックとして機能しており、`history` / `speakCount` / `silenceMap` をチャプター間で継続させることが自然
  - `currentTurnIndex` がローカル変数であるため、`DebateState` に昇格させて `executeChapter` が読み書きする設計が最もシンプル
  - `resume()` は `sessions/0` の `currentChapterIndex` と `chapters` を読み取ることでチャプター単位の再開が実現できる

### Firestore スキーマ — 章データの格納方式

- **Context**: `chapters` をどこに、どの構造で格納するか
- **Sources Consulted**: `.kiro/steering/firebase.md`（埋め込み vs サブコレクション原則）
- **Findings**:
  - 章は「sessions と常に一緒に読む」「件数が有界（最大 6）」「1:1 に近い関係」 → 埋め込みが適切
  - `sessions/0` への `chapters[]` 追加は既存の `turns[]` / `postDebateComments[]` パターンと一致
  - FE は `turns[].chapterIndex` を使って章別グループを導出できるため、`ChapterDoc` に `startTurnIndex` / `endTurnIndex` を持たせる必要がない（オーケストレーター内部で管理）
- **Implications**: `saveChapters()` と `updateCurrentChapterIndex()` の 2 関数追加で済む

### FE 後方互換性

- **Context**: `chapters` がない旧セッションデータへの対応
- **Findings**:
  - `SessionDoc.chapters` / `TurnDoc.chapterIndex` をともにオプション型にすれば既存データは影響を受けない
  - `DebateViewer` で `debate.chapters` が undefined の場合は従来通りフラット表示にフォールバックできる

---

## Architecture Pattern Evaluation

| オプション | 説明 | 強み | 制限 |
|-----------|------|------|------|
| 2 層ループ（採用） | outer: 章ループ, inner: ターンループ | 責務が明確、`DebateState` 再利用 | `executeChapter` への引数が増える |
| 単一ループに章フラグ | 既存ループにフラグを追加 | 変更箇所が少ない | 制御フローが複雑化、可読性低下 |
| 章ごとに独立した Function 呼び出し | 章 = 1 FE リクエスト | 各章を独立してリトライ可能 | 関数タイムアウト、状態受け渡しが複雑 |

---

## Design Decisions

### Decision: `generateChapters` を 2 ステップ（論点洗い出し → 章構造化）にする

- **Context**: 単純に「4〜6 章を作れ」と指示すると、論点の多寡にかかわらず機械的に章数が決まってしまう
- **Alternatives Considered**:
  1. 単一 AI 呼び出し（Chain-of-Thought 指示のみ）— `tool_choice: 'auto'` が必要でツール呼び出しの保証が弱くなる
  2. 2 回の独立した AI 呼び出し — Step 1 で論点リスト、Step 2 で章立て
- **Selected Approach**: 2 回の API 呼び出し。`submit_issues`（5〜10 論点） → `submit_chapters`（論点を受けて章構造化）
- **Rationale**: 章数が論点の数と粒度から自然に決まる。中間データ（issues）が存在するためプロンプトのデバッグや品質評価がしやすい
- **Trade-offs**: 討論開始時に API 呼び出しが 1 回増加する。章数の上限は `submit_chapters` プロンプトの目安（3〜6）で制御する
- **Follow-up**: いずれかのステップが失敗した場合は `DEFAULT_CHAPTERS`（4 章）フォールバックへ進む

### Decision: 章終了判定を `evaluateIntervention` と分離する

- **Context**: 章の終了条件を AI に判断させる際に既存の介入判定に統合するか別呼び出しにするか
- **Alternatives Considered**:
  1. `evaluateIntervention` に `close_chapter` タイプを追加 — 1 回の AI 呼び出しで済む
  2. `evaluateChapterEnd` を独立した別メソッドとして追加 — 呼び出し回数は増えるが責務が明確
- **Selected Approach**: `evaluateChapterEnd` を独立メソッドとして追加
- **Rationale**: 介入判定のプロンプトは「ターンレベルの発言誘導」に特化しており、章終了という構造的判断を混在させると判定精度が下がる。呼び出し回数の増加は 1 章に 1 回（目標ターン数到達時のみ）であり許容範囲
- **Trade-offs**: AI API 呼び出しが章ごとに 1 回増加する。章あたり平均 40〜50 ターンに対して 1 回の追加呼び出しのため影響は軽微
- **Follow-up**: 章終了判定のプロンプトを calibrate して誤検知率を確認する

### Decision: `evaluateIntervention` 内の `close` タイプを章ループ中は無視する

- **Context**: 章進行中にファシリテーターが「討論を閉じる」と判断してもチャプターが残っている場合どうするか
- **Selected Approach**: `executeChapter` ループ内で `iv.type === 'close'` を受け取った場合は何もしない（現行コードと同じく `break` しない）
- **Rationale**: 討論終了の判断は章進行フローが担う。ファシリテーターの `close` 判断は最終章終了後の `generateClosing` 呼び出しに集約
- **Trade-offs**: ファシリテーターが自律的に討論を終わらせる能力を制限する。ただし `maxTurns` のハードリミットと強制遷移フェイルセーフが安全弁として機能する

### Decision: `DebateChapter`（内部型） vs `ChapterDoc`（FE/Firestore 型）を分離する

- **Context**: Functions 内部での章管理に必要な `startTurnIndex` / `endTurnIndex` を Firestore に保存するかどうか
- **Selected Approach**: Firestore / FE 側は `{ index, title, focusQuestion }` のみ。`startTurnIndex` / `endTurnIndex` はオーケストレーター内部のみで管理
- **Rationale**: FE は `turns[].chapterIndex` から章のターン範囲を導出できるため、Firestore に冗長データを持たせる必要がない。`resume()` も既存ターン群から `startTurnIndex` を導出可能
- **Trade-offs**: FE 側のグループ化ロジックが若干複雑になるが、ターンの `chapterIndex` フィールドで確実に判断できる

---

## Risks & Mitigations

- **AI 章生成の品質低下** — `DEFAULT_CHAPTERS` フォールバック（4 章）で確実に討論を継続できる
- **章終了判定が永遠に `false`** — 目標ターン数の 150% で強制遷移するフェイルセーフを設ける
- **`sessions/0` ドキュメントサイズ増加** — `chapters` は最大 6 要素 × 約 200B = 約 1.2KB の追加。既存上限（約 300KB）に対して無視できる水準
- **`resume()` での章状態復元ミス** — `sessions/0.chapters` と `currentChapterIndex` が Firestore に保存されるため、再起動後も正確に復元できる
