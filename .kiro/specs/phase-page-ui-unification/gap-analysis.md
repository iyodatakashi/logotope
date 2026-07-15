# Gap Analysis: phase-page-ui-unification

> **本仕様は保留中。** `persona-generation-consolidation`（ステークホルダー〜ペルソナ〜取材の一気通貫化・3フェーズ→1フェーズ）を先に実施する。それによりペルソナ画面が単一対象になり、本分析の §3（取材の連鎖）と、要件の Requirement 5（ペルソナ画面の例外）は統合仕様側へ吸収される。以下の分析のうち、UI 統一の骨格（操作ペイン3領域・1ボタンスロット規則・`nextPhase` の画面遷移用途の撤去）は引き続き有効。

## 1. 現状調査（Current State）

### 対象アセット

| 種別 | パス | 現状 |
|---|---|---|
| 器 | `src/lib/sharedComponents/PhasePanel.svelte` | `actions`（sticky）/ `content` / `progress` の3スニペットのみ。操作の中身は各画面が持つ |
| 画面 | `.../topic-detail/theme/ThemePage.svelte` | **改修中**。「次に進む」実装済み。`approve` の例外を `catch {}` で握りつぶし |
| 画面 | `.../topic-detail/fact-research/FactResearchPage.svelte` | **改修中**。前後ナビ実装済み。再調査が操作ペイン中央、生成がコンテンツ側で方針と不整合 |
| 画面 | `.../topic-detail/persona/GeneratePersonaPage.svelte` | **改修中**。列ヘッダー実装済みだが `handleForwardClick` が空実装。取材UIがコメントアウト。ペルソナ生成ボタンの `loading` が `interviewsState` を誤参照 |
| 画面 | `.../topic-detail/chapters/GenerateChaptersPage.svelte` | **未着手**。旧方式（状態別に生成/再生成/承認を操作ペインへ列挙） |
| 画面 | `.../topic-detail/debate/GenerateDebatePage.svelte` | **未着手**。旧方式＋`Checkbox`（1章モード）が操作ペインに同居 |
| 画面 | `.../topic-detail/editing/EditingPage.svelte` | **未着手**。旧方式。討論未完了時は `PhasePanel` ごと出さないゲートあり |
| モデル | `src/lib/models/phase/phase.ts` | `phaseOrder` / `nextPhase` / `isLastPhase` / `phasePath` / `phaseLogicalState`。**フェーズ単位**の純関数 |
| 定数 | `src/lib/models/phase/phase.constants.ts` | `PHASE_DEFS` = 8フェーズ（theme / fact-research / stakeholders / personas / interviews / chapters / debate / editing） |
| ナビ | `src/lib/sharedComponents/StepNav.svelte` | `STEP_GROUPS` = 6ステップ。**stakeholders / personas / interviews を「ペルソナ生成」1ステップに束ねる**。この束ね定義はコンポーネント内に private |
| レイアウト | `src/routes/admin/topics/[topicId]/+layout.svelte` | 未到達フェーズへのアクセスを現在フェーズへリダイレクトするガード |
| ストア | `src/lib/stores/personas.svelte.ts` | `approvePersonas` / `runInterviews`（FE が fanout）/ `runInterview` |
| モデル | `src/lib/models/topic/createTopic.svelte.ts` | 全 `approveX` / `resetX` / `generateX` / `startDebate` 等の callable ラッパ |

### 規約（steering から）

- **過度な共通化をしない**（structure.md）— 画面の操作・遷移は画面に直接書く。フェーズ分岐の中央ディスパッチャを作らない。`goto` を `models/` に置かない
- CSS は BEM、Block 名はコンポーネント名の kebab-case
- UI は `@14ch/svelte-ui` を優先（`Button` は `variant: ghost|filled|outlined|glass` / `rounded` / `icon` / `iconPosition` / `loading` / `disabled` を実装済み。**要件が要求する様式はすべて既存 API で表現可能**）
- テストは `src/tests/` にソース構造をミラー。ブラウザ spec は `*.svelte.spec.ts`
- **エミュレータ未使用・本番 Functions 直結**（memory）。Functions 変更はデプロイ必須

## 2. 要件別ギャップマップ

| 要件 | 既存アセット | ギャップ | 分類 |
|---|---|---|---|
| R1 操作ペイン3領域 | `PhasePanel.actions` | 器は流用可。各画面のマークアップ書き換えのみ | 既存で充足 |
| R2 遷移先の明示 | `nextPhase()` を画面遷移に流用 | `nextPhase('stakeholders')` → `'personas'`＝同じ画面。**画面遷移の導出として成立していない**。→ 新たな仕組みで置き換えるのではなく**撤去**する（§4） | **撤去対象** |
| R3 承認の畳み込み | 各 `approveX()` | `ThemePage` / `FactResearchPage` の `catch {}` がエラーを握りつぶす（R3.4 違反）。他4画面は承認ボタンが残存 | **Missing（一部）** |
| R4 中央領域の実行操作 | 各画面の生成/再生成ハンドラ | ハンドラは流用可。配置とボタン様式の書き換え | 既存で充足 |
| R5 ペルソナ列ヘッダー | WIP で実装済み | `loading` の誤参照（`interviewsState` → `personasState`）を修正 | 軽微な欠陥 |
| R6 実行中・停止・空表示 | 各画面のスケルトン・空表示 | 配置換えに伴う整理のみ | 既存で充足 |
| R7 全画面適用 | — | chapters / debate / editing が未着手。persona のコメントアウト除去 | **Missing** |
| R8 非退行 | `ConfirmDialog` 文言・`reset*` 破棄範囲・楽観 `isStarting` | 維持するだけ。**既存の page spec がボタン文言をアサートしており全滅する**（`ThemePage.svelte.spec.ts` の「承認して次へ進む」等） | **Constraint** |
| R9 構造制約 | structure.md | 画面遷移を導出する新機構を作らないこと（撤去のみ） | **Constraint** |
| （対象外）生成→取材の自動連鎖 | `generatePersonas`（onCall）／`runInterview`（onCall・per persona）／`confirmInterviewsGeneratedIfAllComplete`（**完了判定はすでにサーバ権威**） | **後続 spec へ切り出し**（§3）。本 spec では取材を1スロットの状態分岐として吸収する | **Deferred** |

### レイアウトのリダイレクトガードとの整合（R9.4）

`approveX()` は Firestore への `updateDoc` であり、Client SDK の latency compensation により**ローカル書き込みが即座に `onSnapshot` へ反映**される。したがって `await approve()` 直後の `goto(next)` 時点で `topic.phase` は前進済みで、ガードに弾かれない。**現行実装のままで整合する**（新たな待ち合わせ機構は不要）。

## 3. 取材の連鎖をどこでやるか（**本 spec の対象外 / 後続 spec へ切り出し**）

> **結論（決定済み）**: 本 spec は UI 統一に範囲を絞る。取材の自動連鎖は下記 Option C（サーバ側 Cloud Tasks）で**後続の別 spec** として実施する。以下は、その後続 spec のための調査結果として残す。
>
> 本 spec の範囲では、取材はペルソナ列のボタンスロットに状態分岐として吸収する（ペルソナ生成済み・取材未実行のときだけ「取材する」を出す）。ボタンを横に並べないため、暫定措置がレイアウト CSS に残らない。連鎖 spec が入ったら状態分岐を1本削除するだけで済む。副作用として「ペルソナを保持して取材だけやり直す（再取材）」の単独操作が落ちるが、これは連鎖 spec でどのみち消える操作なので方向は逆行しない。

### 決定的な事実

`functions/src/api/interviews.ts` の `runInterview` は、自ペルソナの結果を永続化した後に `confirmInterviewsGeneratedIfAllComplete(topicId)` を呼ぶ。**「全ペルソナ完了 → `interviews` を `generated` 確定」はすでにサーバ権威**で、並列多重呼び出しに対して冪等。連鎖化でいちばん難しい完了集約は**解決済み**。

FE の `personasStore.runInterviews()` が担っているのは3点のみ:
1. `phase: 'interviews', phaseStatus: 'running'` の書き込み
2. 未完了ペルソナへの `runInterview` 並列 fanout（`Promise.allSettled`）
3. 失敗時の `stopped` 書き込み

いずれもサーバへ移設可能。

### Option A: FE で連鎖（`generatePersonas` → `runInterviews` を await 連結）

- **変更範囲**: `GeneratePersonaPage.svelte` のみ。Functions 変更なし＝デプロイ不要
- **致命的な弱点**: `runInterviews` は store の `personas`（`onSnapshot` 由来）を対象に fanout する。`generatePersonas` の callable が解決した時点では、**サーバが書いた persona 文書がまだクライアントに届いていない**（サーバ書き込みなので latency compensation が効かない）。対象が空 or 部分集合のまま取材が走り、`confirmInterviewsGeneratedIfAllComplete` が未完了ペルソナを見て永久に `generated` に到達しない
- 回避には「`personas` が期待件数に達するまで待つ」ポーリング/`$effect` 待ち合わせが要る。**要件 R6.3 はこの回避策を要求している状態**
- **評価**: 回避策ありきの設計。memory `feedback-stable-id-not-array-index` の教訓（回避策を書き始めたらモデル選択を疑う）に照らして筋が悪い

### Option B: Firestore トリガー（`onDocumentCreated` on `personas/{personaId}`）— 非推奨

- **弱点1**: 再取材（`all=true`）・再開（未完了のみ）は文書作成ではないので発火しない。結局もう1本経路が要る
- **弱点2**: batch commit で N 件同時 create → N トリガーが並列発火。Cloud Tasks の deterministic task id による重複排除が使えず、リトライ時の二重取材を防ぎにくい
- **弱点3**: 「なぜ取材が走ったか」がコード上で追えない（暗黙起動）
- **利点**: `generatePersonas` を触らない

### Option C: `generatePersonas` の末尾で取材タスクを enqueue（Cloud Tasks）— **推奨**

討論（`enqueueStep` / `runStep`）・編集（`enqueueEditingStep` / `runEditingStep`）と**同型の既存パターンに乗る**。

- `generatePersonas`: batch commit（`approved: true` を付与）→ `phase: 'interviews', phaseStatus: 'running'` → ペルソナごとに `runInterviewStep` タスクを deterministic id（`${topicId}:${personaId}`）で enqueue
- `runInterviewStep`（新 `onTaskDispatched`）: 既存 `runInterview` の中身を pipeline 関数に抽出して呼ぶ。終端失敗（最終試行）で `interviews` を `stopped` にする（`runEditingStep` と同じ形）
- 完了確定は既存 `confirmInterviewsGeneratedIfAllComplete` がそのまま機能する
- 再取材・再開は `startInterviews(topicId, { all })` の onCall を新設し、同じ enqueue 経路へ流す
- FE は `generatePersonas` を呼ぶだけ。`personasStore` から `runInterviews` / `runInterview` / `markInterviews*` / `approvePersonas` を撤去できる
- **R6.3（取材対象の欠落）が構造的に消滅する** — サーバは自分が書いた persona を直接知っているので、反映待ちが存在しない
- **タイムアウト耐性**: 各取材が独立タスク（`timeoutSeconds: 540`、Cloud Tasks リトライ付き）。onCall の 300s 制約から解放される
- **コスト**: Functions 改修＋デプロイ（エミュレータ未使用のため本番直結）。`personas` store のテスト（`src/tests/stores/personas.test.ts`）と persona 画面 spec の書き換え

### Option D: `generatePersonas` 内でインライン fanout（`await Promise.allSettled`）

- 「ペルソナ生成 + 全ペルソナ取材」を 300s の onCall に収める必要があり、LLM マルチターン取材では現実的でない。**却下**

## 4. 実装アプローチ（UI 部分）

### Option 1: 各画面に直接書く（推奨）

- 6画面それぞれの `actions` スニペットを「左 / 中央 / 右」の3領域に書き換える。ボタン構成は画面ごとに素直に列挙する
- 遷移先は各画面がリテラルで直接持つ（下記「画面遷移の導出を撤去する」）。共通ヘルパーは作らない
- structure.md の「画面ごとに将来分岐しうる UI は共通化せず各画面に素直に書く」に合致

### Option 2: 共通 `PhaseActions` コンポーネントを作る（非推奨）

- 「前に戻る / 中央 / 次に進む」を props で受ける部品。一見きれいだが、中央領域の中身が画面ごとに全く違い（生成／停止＋チェックボックス／実行せず承認）、結局 snippet 渡しになる
- ペルソナ画面（中央空・列ヘッダーへ移設）と編集画面（次に進む無し）で分岐が入り、structure.md の禁止事項（条件分岐で複数画面を1部品に詰め込む）に抵触
- **ただし** `PhasePanel` 側に「3領域のレイアウト（`space-between`）」だけを CSS で持たせるのは共通化して良い範囲

### 画面遷移の導出を撤去する（R2 の中核）

`nextPhase()` は**2つの役割を兼ねている**。片方は成立し、片方は成立しなくなっている。

| 用途 | 呼び出し元 | 成立するか |
|---|---|---|
| **ドメインの phase 前進** — 承認時に Firestore の `phase` を次フェーズへ進める | `createTopic.svelte.ts:34` `advancePhase()` | **成立する。** データモデル上は8フェーズが順に進むという前提が生きている（`stakeholders` → `personas` → `interviews` は phase としては別物であり、それぞれ `phaseStatus` を持つ） |
| **画面遷移の導出** — 「次にどの画面へ行くか」を決める | `ThemePage` / `FactResearchPage` / `GenerateChaptersPage` / `GenerateDebatePage`（+ WIP の `GeneratePersonaPage`） | **成立しない。** `nextPhase('stakeholders')` = `'personas'` は同じペルソナ画面。「1フェーズ＝1画面」だった頃の前提の上にしか立たない |

**方針: 後者を撤去する。代替の仕組みを作らない。**

- 各画面が「前に戻る」「次に進む」の遷移先を**リテラルで直接持つ**（`goto(phasePath(topic.id, 'chapters'))`）。WIP の `FactResearchPage.handleBackClick` がすでにこの形（`'theme'` を直書き）
- `STEP_GROUPS` は**切り出さない**。ナビ表示の束ね方は `StepNav` の都合であり、遷移先は各画面の都合。両者を1つの共通テーブルに統合すると、structure.md が禁じる「共通物を変えると意図しない他画面に影響する」構造に戻る
- `phase.ts` の `nextPhase()` は `advancePhase()` 用に**残す**（export も維持）。撤去するのは画面側の呼び出しのみ
- `phaseOrder()` はレイアウトのリダイレクトガードで使われており、これも phase 単位で正しく機能している（**残す**）

> 前ターンで「ステップ前後解決ヘルパーを UI 層へ切り出す」と書いたが、これは成立しなくなった仕組みを別の場所で作り直す案だった。撤去が正しい。

## 5. Research Needed（設計フェーズへ持ち越し）

1. **ステークホルダーが `stopped` のときの列ヘッダー表示** — 要件が討論の `stopped` しか規定していない。ペルソナ列の `stopped`（取材失敗）は R5 で「取材を再開する」を規定済み
2. **編集画面のゲート表示位置** — R7.10 が「討論未完了でも『前に戻る』で戻れる」ことを要求。現行は `PhasePanel` ごと出さないため、ゲートを content 側へ移す必要がある
3. **既存 page spec の書き換え範囲** — `ThemePage` / `PhaseFactResearch` / `GeneratePersonaPage` / `Phase4Chapters` / `Phase5Debate` / `Phase6Editing` の spec がボタン文言をアサートしており、全面的に書き換わる
4. **廃止操作の後始末** — 「実行せず承認する」（`FactResearchPage.emptyApprove`）、単独の再取材（`regenerateInterviewsDialog` と `personasStore.runInterviews(title, all=true)` の `all` 引数）が未使用になる。R8.2 により撤去する
5. **`fact-research-lifecycle.test.ts` の扱い** — 「実行せず承認も同じ `nextPhase` 経路で前進する（R2.5）」を検証しているが、「実行せず承認」の廃止と画面遷移からの `nextPhase` 撤去の双方に抵触する。`advancePhase` のドメイン前進としては依然有効なので、テストの意図を読み替えて書き換える

## 6. 工数とリスク

| 範囲 | 工数 | リスク | 根拠 |
|---|---|---|---|
| **本 spec**: UI 統一（6画面・遷移先の直書き化） | **M**（3–7日） | **Low** | 既存パターンの踏襲。新規依存なし。新しい共通機構を作らない（`nextPhase` の画面遷移用途を撤去するだけ）。`Button` の既存 API で全様式を表現できる。**Functions を触らないためデプロイ不要**。作業量は画面数（6）と page spec の書き換えに比例 |
| （後続 spec）取材のサーバ連鎖 | M（3–7日） | Medium | 討論・編集に同型の既存実装（`enqueueEditingStep` / `runEditingStep`）があり設計リスクは低い。ただし Functions 改修＝**本番デプロイ必須**（エミュレータ未使用）で、取材の失敗・リトライ経路を本番で検証することになる。Cloud Tasks キューの新規登録も必要 |

## 7. 設計フェーズへの推奨

1. **UI は Option 1（各画面に直接書く）。** 画面遷移を導出する仕組みは新設せず、`nextPhase()` の画面遷移用途を撤去して遷移先を各画面へ直書きする。共通化してよいのは「`PhasePanel` の3領域レイアウト CSS」のみ
2. **ボタンスロットは常に1つ**という規則を、中央領域・ペルソナ列ヘッダーの双方に例外なく適用する。並置が必要に見えたら、まず「その操作は本当に要るのか」「状態分岐で表現できないか」を疑う（事実リサーチの「実行せず承認する」は前者で、操作自体を廃止して解決した）
3. **取材は状態分岐として1スロットに吸収する。** 後続の連鎖 spec で削除しやすいよう、「取材する」を独立した部品やレイアウトに切り出さず、`{:else if}` の1分岐として素直に書く
4. 既存 page spec の書き換えを tasks に明示的に含める（非退行の担保）
5. 後続 spec（取材のサーバ連鎖）を `.kiro/specs/` に別途起票する。§3 がその調査結果
