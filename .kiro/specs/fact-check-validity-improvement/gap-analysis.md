# Gap Analysis: fact-check-validity-improvement

## 概要

- 本機能は既存 `chapter-fact-check`（実装済み）の**判定ロジックの妥当性向上**であり、実行制御・永続・UI 基盤は再利用する。変更の中心は [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) のプロンプトと構造化スキーマ、および post-processing の3点に集約される。
- 必要な入力シグナルはほぼ既存資産で揃っている：`DebateTurn.speechMode`（`'opinion' | 'fact' | 'question'`）が既にターンに保持され、現在日時は `currentDateString()`（[prompt-formatters.ts](functions/src/utils/prompt-formatters.ts#L4)）が再利用可能。新規の配管はほぼ不要。
- 主な設計判断は「**非断定と判定した主張をどう残すか**」の一点。単純抑制（finding を出さない）で済ませるか、分類・根拠を保持して透明性（要件4）を満たすかで、`FactCheckFinding` 型・Phase2 スキーマ・FE 表示の拡張範囲が変わる。
- 難所はコードではなく**プロンプト設計（断定/非断定の判定精度）**。仕様上ファジーで、過剰抑制（見逃し）と過小抑制（誤検出）のバランス調整が必要。要件3.6（不確実なら検証側に倒す）を保守的デフォルトとして実装でき、リスクは限定的。
- 全体としては Option A（既存拡張）が妥当。Effort **S〜M**、Risk **Low〜Medium**（プロンプト品質依存のみ Medium）。

## 1. 現状調査（Current State）

### 関連資産

| 資産 | 役割 | 本機能との関係 |
|------|------|----------------|
| [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) `checkTurn` / `checkChapter` | 発言単位 Phase1(grounding)→Phase2(構造化)→post-processing | **変更の中心**。プロンプト・スキーマ・抑制ロジックを追加 |
| 同 `buildPhase1Prompt` / `buildPhase2Prompt` | 検証・構造化プロンプト | 断定性の判定指示を注入する場所 |
| 同 `findingSchema`（Zod, L17-23） | Phase2 出力構造（`verdict: incorrect/unverifiable`） | 分類を残すなら拡張点 |
| 同 `FactCheckContext`（L28-32） | テーマ・章・focusQuestion を検証に渡す | 現在日時を追加する箇所（要件3.5） |
| [turn.types.ts](functions/src/types/turn.types.ts#L10) `DebateTurn.speechMode` | `'opinion'|'fact'|'question'` | 質問モードの補助シグナル（要件1.4）。runner は未使用 |
| [prompt-formatters.ts](functions/src/utils/prompt-formatters.ts#L4) `currentDateString()` | 「本日は YYYY年M月D日」 | 時間軸検証の基準（要件3.5）に再利用 |
| [fact-check.types.ts](functions/src/types/fact-check.types.ts) `FactCheckFinding`（functions） | 指摘データ契約 | 分類を残すなら拡張（編集工程の入力契約） |
| [factCheck.types.ts](src/lib/models/factCheck/factCheck.types.ts) `FactCheckFinding`（FE） | FE 同形型 | functions 側に追従 |
| [FactCheckFindings.svelte](src/lib/features/admin/debate/FactCheckFindings.svelte) | 発言ごとの指摘表示 | 要件4.3を表示まで含めるなら拡張 |

### 規約・制約

- **置き場所**: AI 検証ロジックは `functions/src/pipeline/fact-check/`。プロンプトは runner 内にコロケート（既存踏襲）。
- **型の分離**: functions（`types/`）と FE（`models/`）で同形型を二重管理。`*ForFirestore` 命名規約。functions 側を正とし FE が追従。
- **ハルシネーション防止の既存ガード**: runner が `turn.content.includes(f.claim)` で引用照合、`sourceIndices` を解決済み出典に写像、`turnId` は runner 付与。新ロジックもこの post-processing 層に足すのが自然。
- **過度な共通化の禁止**（structure.md）: 中央ディスパッチャを作らず、判定は runner 内に素直に書く。

## 2. 要件 → 資産マップ（Requirement-to-Asset Map）

| 要件 | 必要な技術要素 | 既存資産 | ギャップ |
|------|----------------|----------|----------|
| 1.1〜1.2 主張ごとの断定/非断定判定 | Phase1/Phase2 プロンプトに断定性判定の指示 | プロンプト構造あり | **Missing**: 断定性の判定指示・基準 |
| 1.3 発話意図＋言い回しで判定 | 発言全体を見た判定 | 発言全文を Phase1 に投入済み | **Missing**: 判定観点の明示 |
| 1.4 `speechMode` を補助に利用 | runner が `turn.speechMode` をプロンプトへ | `DebateTurn.speechMode` 保持済み・runner 未使用 | **Missing**: シグナル受け渡し（軽微） |
| 1.5 シグナル単独で一律除外しない | 主張ごとの判定維持 | — | **Constraint**: 抑制ロジックの設計方針 |
| 1.6 分類を主張に関連付け保持 | 分類フィールド | `FactCheckFinding` に枠なし | **Missing**: 型・スキーマ拡張（要判断） |
| 2.1〜2.4 非断定は incorrect 指摘しない | 抑制 or リラベル | runner の verdict post-processing（L138） | **Missing**: 非断定 finding の抑制/リラベル |
| 3.1〜3.2 断定は従来どおり検証・指摘 | 既存検証フロー | 実装済み | **対応済み**（回帰防止が論点） |
| 3.3 質問内の確定事実は検証 | 主張単位の断定判定 | — | **Missing**: プロンプトでの線引き |
| 3.4 制度変更を最新事実で検証 | grounding 検索 | 実装済み（反証起点 grounding） | **対応済み**（プロンプトで最新性を強調可） |
| 3.5 時間軸は現在日時基準で検証 | context に現在日時 | `currentDateString()` 流用可 | **Missing**: `FactCheckContext` に日付追加 |
| 3.6 不確実なら検証側に倒す | 保守的デフォルト | — | **Missing**: プロンプト/抑制の方針 |
| 4.1〜4.2 除外の分類・根拠を保持 | 分類・理由の記録 | `FactCheckFinding` に枠なし | **Missing**: 記録構造（要判断・要件1.6と同根） |
| 4.3 管理画面で断定根拠を確認 | FE 表示 | `FactCheckFindings.svelte` | **Unknown**: 表示まで含めるかスコープ判断 |

## 3. 実装アプローチ

### Option A: 既存 runner を拡張（推奨）

- **対象**: [fact-check-runner.ts](functions/src/pipeline/fact-check/fact-check-runner.ts) のプロンプト2種・`findingSchema`・post-processing、`FactCheckContext` への日付追加。`speechMode` を `checkTurn` 内でプロンプトに反映。
- **やること**:
  1. Phase1/Phase2 プロンプトに「事実として断定された主張のみを指摘対象とし、問い・前提・仮定・代弁は対象外。ただし質問文中でも確定事実（過去の出来事・既成の状態）として述べた部分は検証する」という線引きを追加（要件1,2,3.3）。
  2. `FactCheckContext` に現在日時を加え、時間軸主張を基準日付で検証（要件3.5）。最新性の強調文を追加（要件3.4）。
  3. `turn.speechMode` を Phase1 プロンプトの手掛かりとして渡す（要件1.4）。一律除外しない注記（要件1.5）。
  4. 非断定主張の扱い（後述の分類保持方針に依存）。
- **トレードオフ**:
  - ✅ 変更が1ファイルに集中、既存パターン・ガードを再利用
  - ✅ 永続・実行制御・FE 基盤に手を入れない（回帰範囲が狭い）
  - ❌ runner プロンプトが長くなる（責務は単一のまま）

### Option B: 判定を独立ステップ/モジュール化

- **対象**: 断定性分類を Phase1 前の独立 LLM ステップ、または別関数に切り出す。
- **トレードオフ**:
  - ✅ 判定責務が分離しテスト容易
  - ❌ 発言あたりの LLM 呼び出しが増えコスト/レイテンシ増（現状 発言×2 → ×3）
  - ❌ structure.md の「過度な共通化をしない」に照らし、現状の規模では過剰

### Option C: ハイブリッド（プロンプト判定＋分類の記録を段階導入）

- **Phase1（最小）**: プロンプト＋post-processing で非断定を**単純抑制**（finding を出さない）。型変更なし。要件1,2,3を満たす。
- **Phase2（透明性）**: 要件4.1/4.2/1.6 のため `FactCheckFinding` に分類フィールド（例 `assertionType` / 非断定の verdict 追加）を導入し、除外理由を保持。FE 表示（4.3）も併せて拡張。
- **トレードオフ**:
  - ✅ 早期に誤検出を解消、透明性は段階的に
  - ✅ 型・FE 変更を後続に隔離でき、編集工程の入力契約変更を熟慮できる
  - ❌ 2段階のスコープ管理が必要

## 4. 分類保持に関する設計判断（要設計確定）

要件2は「非断定は incorrect 指摘を出さない」、要件4.1/1.6は「除外した分類・根拠を保持」を要求する。両立には：

- **案1: 単純抑制**（型変更なし）— 非断定は finding を生成しない。要件2は満たすが、要件4.1（除外の記録）・1.6（分類保持）を満たさない。
- **案2: verdict 拡張** — `verdict` に `'contextual'`（非断定/前提）等を追加し、抑制でなく**リラベルして残す**。FE は incorrect と別表示。要件1.6/2/4.1を最小拡張で満たす。`FactCheckFinding`（functions/FE 両方）・Phase2 スキーマ・`FactCheckFindings.svelte`・編集工程の入力契約（Revalidation Trigger）に波及。
- **案3: 分類フィールド追加** — `assertionType: 'asserted' | 'question' | 'hypothetical' | 'attributed'` を finding に持たせる。最も表現力が高いが契約変更が大きい。

→ design フェーズで案2 を軸に検討するのが、要件充足と契約変更量のバランスが良い。

## 5. Effort & Risk

- **Effort: S〜M（2〜5日）** — プロンプト改修＋context への日付/speechMode 追加は S。分類保持（案2/3）と FE 表示・型二重管理・テスト更新まで含めると M。
- **Risk: Low〜Medium**
  - Low: 既存パターンの拡張で配管はほぼ不要、回帰範囲が runner と型に限定。
  - Medium: **断定/非断定の LLM 判定精度**がファジーで、誤検出と見逃しのトレードオフ調整が必要。要件3.6（不確実なら検証）を保守的デフォルトにし、評価サンプル（今回提示の4例）で回帰確認することで低減。
  - Constraint: `FactCheckFinding` の形変更は編集工程の入力契約（chapter-fact-check の Revalidation Trigger）に触れる。変更時は両スペック整合を確認。

## 6. design フェーズへの引き継ぎ

### 推奨アプローチ
- **Option A（runner 拡張）＋ Option C の段階導入**。まずプロンプト＋post-processing で誤検出を解消し、分類保持（案2: verdict リラベル）を同設計内で確定。

### 主要な設計判断
1. 非断定主張を**抑制か / リラベル保持（案2）か**（要件4・編集工程契約に直結）。
2. `FactCheckContext` への現在日時の与え方（`currentDateString()` 流用＝ファクトチェック実行時刻基準でよいか、生成時刻基準が要るか）。
3. `speechMode` をどの程度判定に効かせるか（手掛かり止まり＝要件1.5の担保）。
4. 要件4.3（管理画面表示）を本スペックに含めるか、判定・記録までに留めるか。

### Research Needed（design で確認）
- 断定/非断定判定のプロンプト設計と、提示済み4例（停戦前提・国連/赤十字の仮定・W杯試合数・時間軸）での評価方法。
- verdict 拡張時の FE 表示（`FactCheckFindings.svelte`）の出し分けと、既存 `data-verdict` スタイルへの追加。
- Phase2 スキーマ拡張が既存テスト（[fact-check-runner.test.ts](functions/src/tests/pipeline/fact-check/fact-check-runner.test.ts)）に与える影響範囲。
