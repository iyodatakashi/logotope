# Gap Analysis: debate-flow-control-redesign

## 1. 現状調査

### 1.1 関連アセット

| ファイル | 行数 | 役割 |
|---|---|---|
| `functions/src/pipeline/debate-orchestrator.ts` | 857 | フロー制御の中核。話者選択・介入・章進行・状態管理がすべて集中 |
| `functions/src/agents/facilitator-agent.ts` | 554 | ファシリテーターのLLM呼び出し（オープニング・介入評価・章立て・遷移・クロージング） |
| `functions/src/agents/persona-agent.ts` | 469 | ペルソナのLLM呼び出し（発言意欲評価・発言生成・事後コメント） |
| `functions/src/db/repository.ts` | 490 | Firestore 読み書き（ターン・章・エンゲージメント・キュー） |
| `functions/src/api/debates.ts` | 45 | エントリポイント（`startDebate` → Cloud Tasks `runChapter`） |

### 1.2 実行経路の事実関係（重要）

本番で使われる経路は **`startDebate` → Cloud Tasks `runChapter` → `executeChapterTask()` のみ**である。

- `run()` / `resume()` / `executeDebate()` は `index.ts` からエクスポートされる API のどこからも呼ばれていない（テストからのみ参照）
- 状態復元ロジック（speakCount / silenceMap / lastFacilitatorTurnIndex の再構築）が `resume()` と `executeChapterTask()` に**ほぼ同一の形で重複実装**されている
- `resume()` は `loadPendingIntents` でキューを復元するが、**本番経路の `executeChapterTask()` はキューを復元しない**（`pendingItems: new Map()`）→ 章をまたぐと意図キューが消失するバグ

### 1.3 確認されたデッドコード・不整合

| 項目 | 状態 |
|---|---|
| `run()` / `resume()` / `executeDebate()` | 本番未使用（テストのみ） |
| `FacilitatorAgentService.selectNextSpeaker()` | どこからも呼ばれていない（エンゲージメント駆動に置換済み） |
| `FacilitatorAgentService.evaluateChapterEnd()` | どこからも呼ばれていない（recentScores ベースに置換済み） |
| `evaluateParticipationBalance()` | 呼ばれているが**戻り値が捨てられている**（debate-orchestrator.ts:649） |
| `silenceThreshold` / `minTurnsPerPersona` オプション | 定義のみ、参照ゼロ |
| 介入タイプ `close` | LLM に選択肢として提示されるが、返ってきても無視される |
| `PendingThought` interface（facilitator-agent.ts） | `selectNextSpeaker` 専用。同時に削除対象 |
| 介入ターン・クロージングターン | `chapterIndex` が付与されていない（要件 R2-9 違反） |
| キューのメモリ/Firestore 乖離 | キュー外発言時、メモリ側は最古エントリを消費するが Firestore 側は消費しない |
| recentScores（章終了シグナル） | 指名・直接質問ターンでは更新されず、章終了判定が歪む（要件 R2-5 違反） |

### 1.4 既存の規約・制約

- TypeScript strict / アロー関数標準 / Vitest（AI はモック）
- Firestore: `topics/{topicId}/sessions/0` にターン埋め込み（`arrayUnion`）、エンゲージメントは `sessions/0/engagements/{personaId}` サブコレクション
- Cloud Tasks: 章単位で 540 秒タイムアウト・最大3回リトライ → **章単位の冪等性が必須制約**
- `debate-orchestrator.test.ts`（920行）は `run()` 中心に書かれており、実行パス整理に伴い大幅な書き直しが必要

## 2. 要件-アセット対応マップ

| 要件 | 既存実装 | ギャップ |
|---|---|---|
| R1 ライフサイクル | `executeChapterTask` + `finalizeDebate` で実装済み | **Constraint**: `executeDebate` と重複。一本化が必要 |
| R2-1,3,6,8 章生成・上限・遷移 | 実装済み | なし |
| R2-2 章生成失敗→エラー | フォールバック実装 | **Missing**: `DEFAULT_CHAPTERS` と分岐3箇所の削除、エラー伝播 |
| R2-4 早期終了（全員発言条件なし） | `allPersonasSpoke` 条件あり | **Missing**: 条件削除（`minSpeaksPerPersonaInChapter`・`chapterSpeaks` も削除） |
| R2-5 意欲記録の一貫更新 | 指名ターンで `recentScores` 未更新 | **Missing**: 記録方法の再設計（Research Needed） |
| R2-7 未応答指名の応答ターン | ループ先頭で打ち切り、指名消失 | **Missing**: 上限到達時の応答ターン許容（+1ターン） |
| R2-9 全ターンに chapterIndex | 介入・クロージングターンに欠落 | **Missing**: 付与の一元化 |
| R2-10 close 廃止 | 無視するだけで選択肢に残存 | **Missing**: ツールスキーマ・プロンプトから削除 |
| R3 発言意欲評価 | `assessEngagement` 実装済み | なし（失敗時 score1 扱い・Firestore 保存とも実装済み） |
| R4 話者選択の優先順位 | 各分岐は存在するが、介入評価が選択の**後**に走り結果を上書きする構造 | **Constraint**: 優先順位（指名最優先）に合わせた評価順序の再構成 |
| R5-1〜4 キュー追加・失効・消費 | 実装済み | **Missing**: メモリ/Firestore の消費同期（1.3参照） |
| R5-5 全実行パスでキュー復元 | `resume()` のみ復元 | **Missing**: 本番経路 `executeChapterTask` での復元 |
| R6-1,2 毎ターン評価＋クールダウン | 8ターン間隔＋沈黙トリガー | **Missing**: `shouldEvaluateIntervention` 置換、`interventionInterval` 削除 |
| R6-3〜6 介入タイプ・指名・保存 | 実装済み（close 除く） | R2-10 と連動 |
| R7 制御コンテキスト伝達 | `generateTurn` 引数9個で実装済み | **Constraint**: 引数肥大。オブジェクト化の検討余地 |
| R8 実行パス一本化・状態復元共通化 | 3経路に重複 | **Missing**: `run`/`resume` 削除 or 統合、復元ロジック抽出 |
| R9 デッドコード除去・テスタビリティ | 1.3 の通り多数残存 | **Missing**: 削除＋テスト再構成 |

## 3. 実装アプローチ選択肢

### Option A: 既存構造のまま個別修正

`executeChapter` 内の各分岐をその場で修正し、デッドコードを削除する。

- ✅ 差分最小・既存テストの流用度が高い
- ❌ 857行のオーケストレーターに話者選択・介入・章進行が絡み合った構造が残り、R9（独立テスト可能）を満たせない
- ❌ 今回のバグ群（指名消失・キュー不整合）は「状態がループ内に散在している」ことが根因であり、再発リスクが残る

### Option B: フロー制御の完全モジュール分割

話者選択・介入判定・章終了判定・状態復元を純粋関数モジュール（例: `pipeline/flow/`）に分離し、オーケストレーターは進行役のみとする。

- ✅ R9 を完全に満たす。各ルールが単体テスト可能
- ✅ LLM 呼び出し（agents）と制御ロジック（flow）の境界が明確になる
- ❌ ファイル構成の変更が大きく、レビュー負荷が高い
- ❌ 一度に書き換える範囲が広くリグレッションリスク

### Option C: ハイブリッド（推奨）

1. **削除フェーズ**: `run`/`resume`/`executeDebate`・未使用メソッド・未使用オプション・`DEFAULT_CHAPTERS`・`close` を削除し、本番経路（`executeChapterTask`）一本に整理
2. **抽出フェーズ**: 「話者選択（優先順位）」「介入判定（クールダウン）」「章終了判定」「状態復元」を純粋関数として抽出（既存の `shouldEvaluateIntervention` と同様のエクスポート関数パターンを踏襲）
3. **修正フェーズ**: 要件との差分（キュー復元・chapterIndex 付与・未応答指名・意欲記録の一貫化・毎ターン介入評価）を抽出済みの関数に対して実装

- ✅ 段階ごとに動作確認でき、リスクを分割できる
- ✅ クラス構造・repository インターフェース・Cloud Tasks 基盤は不変（Adjacent expectations 充足）
- ❌ フェーズ間で一時的に新旧パターンが混在する

## 4. 工数・リスク評価

- **工数: M（3〜7日）** — 新規技術なし・既存パターン踏襲だが、テスト書き直し（920行）と挙動変更の検証が主負荷
- **リスク: Medium** — 本番パイプラインの挙動変更を含む。LLMモックでのユニットテストは可能だが、討論品質（介入頻度・章の長さ）は実討論での確認が必要

## 5. 設計フェーズへの推奨事項

**推奨アプローチ**: Option C（削除 → 抽出 → 修正の3フェーズ）

**主要な設計判断ポイント**:
1. 話者選択の優先順位を単一関数に集約する際の、介入評価との実行順序（要件は「指名最優先」— 介入評価を意欲評価の前に置くか後に置くか）
2. `generateTurn` の引数9個のオブジェクト化（インターフェース変更最小化との兼ね合い）
3. テスト戦略: 抽出した純粋関数のテストを先に書き、オーケストレーター統合テストは `executeChapterTask` ベースに書き直す

**Research Needed（設計フェーズで解決）**:
1. **毎ターン介入評価のコスト・レイテンシ影響** — Sonnet 1呼び出し/ターンの追加。意欲評価（全ペルソナ並列）と直列になるため、ターンあたり数秒の増加見込み。Haiku 等の軽量モデル利用や意欲評価との並列実行の検討
2. **指名・直接質問ターンでの意欲記録方法** — 意欲評価をスキップするターンで章終了シグナル（recentScores 相当）をどう更新するか（スキップ時は「意欲あり」とみなす、等）
3. **キューの永続化モデル** — メモリ/Firestore の二重管理をやめ、Firestore を単一ソースとするか（章単位実行・540秒制約下では毎ターン読み書きのコストは許容範囲か）
4. **章上限+1ターン許容の冪等性への影響** — Cloud Tasks リトライ時に応答ターンが重複しないか
