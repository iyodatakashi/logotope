# Gap Analysis: topic-fact-base-enrichment

## 概要

- **本仕様はほぼ全面がプロンプト工学（既存エージェントの生成・構造化プロンプトの調整）**であり、新規アーキテクチャ・新規サブコレクション・新規 API を必要としない。対象は `topic-fact-base` で確立済みの既存ファイル群。
- 選択済みの設計方針（層②＝信念ドキュメントの1セクション＝Option A）により、**型・永続形・消費者配線の変更は不要**（`FactItem`/`FactBase` 不変、信念は既存の markdown 文字列にセクション追加）。
- 下流供給（R5）は `getTopicContext`＋`formatFactBaseSection` で既に配線済み。事実の記述が具体化すれば**自動的に全消費者へ伝播**するため、下流側の新規実装は不要。
- 支配的リスクは**構造ではなく挙動品質**：充実（R1–3）・立場忠実な反映（R8）・帰属形の中立性（R7）・層②優先（R8.8/8.9）はいずれも LLM のプロンプト応答に依存し、保証・自動テストが難しい。既存の取材パイプライン（`persona-interview-grounding-pipeline`）の「反証起点」を「実態・立場から見た事実」へ再定位する点は**着地済み挙動の変更＝回帰リスク**。
- コスト/レイテンシ：事実の具体化・件数増は fact-research と全下流のトークンを増やす（事実は全消費者プロンプトに注入されるため増分が広がる）。

## Requirement-to-Asset Map

| Req | 既存アセット（対象ファイル） | 現状 | ギャップ | タグ |
|-----|------------------------------|------|----------|------|
| R1 具体性 | `functions/src/agents/fact-research-agent.ts`（`buildGroundingPrompt`/`buildStructuringPrompt`） | statement は自由文字列。プロンプトは「一般論・抽象評価を含めない」まで | 数値・固有名詞・日付・経緯の**保持を積極指示**する文言が無い | Constraint（プロンプト） |
| R2 網羅性・件数 | 同上（`structuringSchema = { facts: [{statement, sourceIndices}] }`） | 件数・網羅の指示なし、`facts` に `min()` 無し | 主要側面の網羅・十分な件数・恣意的切り詰め禁止の指示が無い | Missing（プロンプト） |
| R3 収集情報の保持・出典 | 同上（grounding テキスト→statement 蒸留） | 蒸留で grounding の具体を落とす。出典対応（`sourceIndices`→sources）は実装済み | grounding の具体を statement に**残す**指示が無い。出典は既存で充足 | Constraint（プロンプト） |
| R4 客観性・分離 | fact-research プロンプト（「主観・立場・評価を含めない」既存） | 既に主観除外の指示あり | 具体化に伴う主観混入の追加ガードのみ | Low gap |
| R5 下流一貫供給 | `pipeline/topics/topic-context.ts`（`getTopicContext`）＋`utils/prompt-formatters.ts`（`formatFactBaseSection`） | 全消費者へ同一供給・配線済み | **ギャップなし**（充実が自動伝播） | 充足 |
| R6 非破壊 | `createTopic.svelte.ts`/`PhaseFactResearch.svelte`（承認フロー）、`types/topic.types.ts`（型）、`interview-agent.ts`（R6.2） | 承認フロー・型・R6.2 実装済み。FE は statement/出典を表示 | 型/永続不変を維持しつつ、FE は具体化した記述を表示できる（既に折返し/スクロール対応） | Low gap |
| R7 中立性・帰属形・真実非保証 | fact-research プロンプト。出典は既存。UI 表示 | 争点の帰属/観測形の指示が無い。「真実として位置づけない」は framing | 帰属・観測形（誰が主張/実効支配、コンセンサス帰属）優先の指示。評価的特徴づけ（「係争中」等）回避。真実非保証は**コードで強制されず**プロンプト＋UI/製品の言い回しで担保 | Missing（プロンプト＋framing） |
| R8 層②リサーチ | `interview-agent.ts`（`verifyWithGrounding`「反証起点」/`generateFinalBelief`「initialBelief 6節 markdown」/`DraftBelief` 6項目）。永続 `beliefs:[{content}]`、消費 `persona-agent.latestBeliefContent` | 取材は「反証（真偽検証）」志向。信念は6節 markdown。層②の器は無い | (a) grounding を「実態・立場から見た事実」へ**再定位**、(b) `generateFinalBelief` に**「立場から見た事実」節を追加**（markdown 1節＝Option A、型不変）、(c) 任意で `DraftBelief` に構造化フィールド追加、(d) 層②優先の**指示を `persona-agent.generateTurn` に追加** | Missing（プロンプト）＋Behavioral change |

## 実装アプローチ

### Option A: 既存エージェントのプロンプト/フローを拡張（推奨）
- **対象**: `fact-research-agent.ts`（R1,2,3,4,7）、`interview-agent.ts`（R8 a/b）、`persona-agent.ts`（R8 優先）。
- 既存の生成・構造化プロンプトに具体性/網羅/帰属形の指示を追加し、`generateFinalBelief` の書式に「立場から見た事実」節を足す。**型・永続・API・消費者配線は不変。**
- **Trade-offs**: ✅ 新規ファイルほぼ無し・既存パターン踏襲・下流自動伝播 ／ ❌ プロンプト肥大化と挙動保証の難しさ・取材プロンプト再定位の回帰リスク・テスト文言更新の広がり。

### Option B: 新規コンポーネント
- 事実充実や層②を専用モジュール/型で切り出す。
- **却下寄り**: 生成の「作り方の調整」であり独立責務が薄い。Option A の方が構造的に自然。層②を構造化保持したい場合のみ、`DraftBelief` への1フィールド追加（小さな型変更）に限定するのが妥当。

### Option C: ハイブリッド（限定）
- 本体は A。層②を **markdown 節（Option A）で始め**、将来「立場横断の事実食い違い可視化」等の要求が出たら構造化フィールドへ抽出する follow-up、という段階戦略。
- **Trade-offs**: ✅ 最小で入れて拡張余地を残す ／ ❌ 二段運用の一貫性管理。

## Effort / Risk

- **Effort: M（3–7日）** — 変更ファイルは少数（3エージェント＋テスト）だが、挙動を狙いどおりにするプロンプト反復・取材再定位・テスト文言更新・簡易 eval が要る。
- **Risk: Medium** — 新規 tech/アーキ無し（Low 要因）だが、(1) 効果が LLM 挙動依存で保証しづらい、(2) 着地済み取材パイプラインの「反証→実態」再定位が品質回帰を招き得る、(3) established-but-denied/genuinely-open の分類は本質的に不確実、が Medium 要因。

## 設計フェーズへの申し送り（Research Needed）

1. **grounding の再定位手法**：「その立場の当事者が実際にどう認識するか」を狙い、「客観的真偽の裁定」に滑らない具体的プロンプト設計と、既存「反証起点」からの移行での品質担保（eval）。
2. **層② の器**：`generateFinalBelief` の markdown 1節（Option A）で始めるか、`DraftBelief` に構造化フィールドを足すか。grounding で層②を検証・反映するなら構造化が扱いやすい可能性。
3. **帰属・観測形の強制度（R7）**：プロンプトでの実現手法と、established-but-denied を過度に相対化しない線引き（R7.5 との緊張）。
4. **充実とコストの両立**：statement の具体度・件数をどこまで増やすか（全下流に注入されるためトークン増分が広がる）。上限/方針の要否。
5. **eval 戦略**：これらソフトな挙動変更に対する評価（既存 `*.eval.test.ts` 例：`fact-check-judge.eval.test.ts` に倣う）。プロンプト内包アサーション＋少数の代表テーマ（時事・領土/宗教・陰謀論）での目視/自動評価。
6. **真実非保証の担保面**：コードで強制されない「検証済み真実として位置づけない」を、プロンプト・UI 文言・下流の扱いのどこで表現するか（R7.6/7.7）。

## 推奨

- **Option A（既存エージェントのプロンプト拡張、型/永続不変）** を基本線とし、層② は **markdown 節から開始（Option C 的段階戦略）**。
- 設計では特に **(1) grounding 再定位の具体プロンプトと eval、(2) 層②の器の選択、(3) 帰属形と established-but-denied の線引き** を主要決定事項として扱う。
