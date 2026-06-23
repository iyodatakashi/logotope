# Requirements Document

## Project Description (Input)
討論ステップ処理（`functions/src/pipeline/debate/`）に残る責務混同を解消するスペック。先行スペック `debate-orchestrator-step-split` の責務監査で検出された 3 件のうち、当該スペックのスコープ外とした以下を扱う。挙動保存（既存テスト無変更で通過）を前提とする。

### 対象の責務混同

1. **終了判定の分裂（早期終了の補正ロジックが handler に inline）**
   - 「この章を終えるか」の判断は `decideNextStep` に集約されているはずだが、early-end を取り消す補正だけが `performTurnStep` に埋め込まれている（旧 step.ts の該当ブロック: 盛り上がりが落ちて早期終了しそうな局面で、LLM `evaluateDiscussionPointCoverage` により実は消化済みの論点を拾い、未消化が残れば quietStreak をリセットして章を継続させる処理）。
   - 終了判定ドメインが `decideNextStep` と `performTurnStep` の 2 箇所に分散している。
   - 整理方針案: 終了判定（cap・早期終了・補正）を 1 箇所へ集約し、handler は判定結果に従うだけにする。

2. **継続/盛り上がり判定（quietStreak）の分裂**
   - 「盛り上がっているか（continue か）」の評価は `executeTurn` 内（`shouldContinue` → `quietStreak` 増減）にあり、「それで終了か」の判定は `decideNextStep` 内（`quietStreak` を使った earlyEnd 判定）にある。
   - 評価と判定が別関数に分かれ、`quietStreak` という生データ経由で暗黙結合している。
   - 整理方針案: 盛り上がり評価と継続判定を同一ドメイン（判定モジュール）へ寄せ、結合を明示化する。

3. **オープニング処理における「章初期化（永続化）」と「オープニング生成（AI）」の混在**
   - `performOpenStep` が、章を running にし論点を untouched 初期化して保存する lifecycle 寄りの処理と、ファシリテーターのオープニング/章導入を生成する agent 寄りの処理を 1 関数に同居させている。
   - 整理方針案: 章初期化（永続化）と生成（agent 呼び出し）を別関数/別責務に分離する。

### 前提・制約
- 公開 API（`advanceDebate` / `decideNextStep` / `DEFAULT_OPTIONS`）の挙動・シグネチャは不変。
- 既存テスト（debate-parity / debate-step-idempotency / decide-next-step）はアサーション無変更で通過させる。
- 本スペックは `debate-orchestrator-step-split`（command-result 化・論点状態の `discussion-points.ts` 集約・ターン後処理の共通化）の**完了後**に着手する想定。整理対象の関数配置は同スペックの結果（`step.ts` / `debate-orchestrator.ts`）を前提とする。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
