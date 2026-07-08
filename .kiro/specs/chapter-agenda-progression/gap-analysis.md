# Gap Analysis: chapter-agenda-progression

## 1. 現状調査（Current State）

論点ライフサイクル・介入・終了制御の主要資産：

- **論点状態管理** `functions/src/pipeline/debate/agenda.ts`
  - `getActiveAgendaItemState` / `getActiveAgendaItem`：最新 introduced（introducedOrder 最大）をアクティブ論点として解決。
  - `markIntroduced(state, index, relevantIds)`：untouched リスト上の index を introduced にし introducedOrder を採番。
  - `markAddressed(state, point)`：論点を addressed にする（**現状の唯一の呼び出し元は `reconcileEarlyEndCoverage`**）。
  - `getUnheardRelevant(state)`：アクティブ論点で未発言の関連参加者。
- **介入プロンプト** `functions/src/agents/facilitator-agent.ts`
  - `evaluateTopicDrift`（A・3択）：選択肢2で未提示論点を投入。content を選択論点に切り込ませる縛りは既にある（:164 付近）。
  - `evaluateStallIntervention`（B・出尽くし）：手順(1)が「章の趣旨に沿って新しい論点を**決める**」と**自由発明**を許し、(3) content を「決めた論点」に。**未提示リストからの忠実選択に縛られておらず、リスト外の発明も可能**（R1/R2 の穴）。
- **介入フロー** `functions/src/pipeline/debate/intervention.ts`
  - `tryIntervention`：drift→stall のカスケード。前進時に `markIntroduced`（:226）で新論点を introduced 化。
  - 立場カバレッジゲート：`unheardActive` の間は `selectedAgendaItemIndex = undefined`（:219）で前進を封じる。
- **消化(addressed)判定** `evaluateAgendaItemCoverage`（facilitator-agent.ts）を `step.ts:reconcileEarlyEndCoverage` が **早期終了間際に一括**実行（`isEarlyEndCandidate` 成立時のみ）。
- **章終了判定** `debate-orchestrator.ts:decideNextStep`（:71-97）：`hitCap`（章cap／maxTurns）または `earlyEnd`（isEarlyEndCandidate）で終了。末尾に未応答指名があれば finalResponse(+1) を1回挟む（:93）。
- **conventions**：純粋関数を分離（agenda/utils）、状態は DebateState を引数で受け渡し、永続は `saveAgendaItemStatuses`。テストは `functions/src/tests/pipeline/debate/` に併置。

> 注：本セッションで暫定的に入れていた B プロンプト忠実化・Fix 2（stall 封じ）・cap 下げは、スコープ拡大に伴い**すべて reset 済み**。本 spec 実装で正式に入れ直す。

## 2. Requirement → 資産マップ（gap タグ）

| Req | 既存資産 | Gap |
|---|---|---|
| R1 次論点投入の忠実性 | drift(A) は既に忠実縛りあり／**stall(B) は手順(1)で自由発明・忠実縛り無し** | **Missing**（B の忠実化。content=選択論点・折衷禁止・index 必須） |
| R2 アジェンダ外発明の禁止 | B 手順(1)「章の趣旨で新論点を決める」 | **Missing**（B をリスト内選択に限定。リスト空なら発明せず介入しない） |
| R3.1 前進元を addressed 化 | `tryIntervention` の markIntroduced 直前で `getActiveAgendaItemState`→`markAddressed` | **Missing**（前進時の addressed 記録が無い） |
| R3.2 最終論点の出尽くし→addressed | stall の出尽くし判断 | **Missing/Decision**（リスト空でも出尽くし判断だけ効かせ、発明せず addressed 化する経路が必要） |
| R3.3 カバレッジ未充足なら記録しない | `unheardActive` 前進封じ（:219） | **既存で充足**（前進が起きない＝addressed も付かない） |
| R3.4 引き戻しは記録しない | drift はインデックス無し前進なし | **既存で充足** |
| R4.1 全 addressed→章終了 | `decideNextStep`（agenda 受領済み） | **Missing**（allAddressed 終了分岐が無い） |
| R4.2 最終応答 +1 | `hasUnansweredTargetAtEnd`（:93） | **既存で再利用可** |
| R4.3 盛り上がり不問 | allAddressed を quietStreak と独立分岐に | **Missing** |
| R4.4 論点なし章は対象外 | hasPoints 判定 | **既存で充足** |
| R5 追加LLM評価なし・一括評価非依存 | addressed を出尽くし由来に一本化 | **Decision**（`reconcileEarlyEndCoverage`/`evaluateAgendaItemCoverage` の除去 or 併存） |
| R6.1 未消化中は終了しない | allAddressed 判定の性質 | **既存で充足** |
| R6.2/6.3 cap/maxTurns 尊重 | `decideNextStep` は hitCap を先に判定 | **既存で充足**（allAddressed を追加分岐にすれば cap 優先を維持） |

## 3. 実装アプローチ

### Option A: 既存フローを拡張（推奨）
- **忠実性・発明禁止（R1/R2）**：`evaluateStallIntervention` の手順を「上の未提示論点リストから選ぶ（新たに考え出さない）／content は選んだ論点そのものに切り込む・折衷禁止・index 必須／**リストが無ければ介入しない（発明しない）**」に書き換える。drift(A) は既に縛りありなので原則現状維持。
- **消化記録（R3）**：`tryIntervention` で `markIntroduced` の**直前**に「現アクティブ論点（=前進元）を `markAddressed`」を挿入。前進は `unheardActive` 解除後なので R3.3 は自動充足。最終論点は「リスト空時に出尽くし判断だけ行い addressed 化」する専用パスを stall 側に用意（発明はしない）。
- **終了（R4）**：`decideNextStep` に `allAddressed → chapter-end` 分岐を追加（hitCap の後段・earlyEnd と並列）。finalResponse(+1) は既存流用。
- **消化評価の整理（R5）**：addressed が出尽くし由来で確定するため、`reconcileEarlyEndCoverage` の消化判定は不要化。除去 or セーフティネット存置を design で決定。
- **永続**：addressed 更新を `saveAgendaItemStatuses` に必ず載せる。

✅ 既存パターン内・新規ファイル最小 ❌ 介入プロンプト・介入フロー・終了判定の3箇所に手が入り、一括評価の帰結判断を伴う

### Option B: 新コンポーネント（アジェンダ進捗トラッカー）
addressed 遷移を専用モジュールに集約。✅ 分離・単体テスト容易 ❌ 状態遷移は既に agenda に集約済みで過剰。今回の粒度では不要。

### Option C: ハイブリッド
消化記録・終了は Option A の拡張、最終論点の出尽くし専用パスだけ小さな新ヘルパに隔離。✅ 最終論点処理の見通し ❌ 分岐増。Option A で十分なら不要。

## 4. Effort & Risk
- **Effort: M（4〜6日）**：介入プロンプト（忠実化・発明禁止）＋状態遷移（addressed）＋終了分岐＋一括評価の整理＋テスト更新。
- **Risk: Medium**：介入・終了の複数箇所に触れ、一括消化評価の除去と絡む。デグレ（R6.1）・cap 優先（R6.2/6.3）・忠実性の回帰テストが要。

## 5. 設計フェーズへの申し送り

**主要な意思決定**
1. **stall(B) の作り替え粒度**：忠実選択＋発明禁止＋「リスト空時は出尽くし判断のみ（発明せず addressed 化）」を1関数でどう表現するか。新種の LLM 呼び出しは増やさない方針。
2. **`reconcileEarlyEndCoverage` / `evaluateAgendaItemCoverage` の帰結**：完全除去か、ついで消化拾いのセーフティネットとして残すか。本 spec の趣旨（出尽くし＝消化）では除去が整合的。
3. **addressed 永続のタイミング**：中間論点（介入ターン内）と最終論点（終了直前）で `saveAgendaItemStatuses` を確実に走らせる配線。

**Research Needed**
- `decideNextStep` が参照する agenda が「最新の addressed 反映済み」であることの保証（executeTurn→enqueue→次 step の復元経路での順序）。
- 既存テスト（facilitator-agent / intervention / intervention-gate.integration / agenda / orchestrator 系）への影響と、R1/R6 の回帰テスト追加。
