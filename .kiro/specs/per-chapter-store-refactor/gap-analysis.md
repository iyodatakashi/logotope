# Gap Analysis: per-chapter-store-refactor

## 1. 現状調査（Current State Investigation）

### 対象ストアと責務

| ファイル | 現状の責務 | 公開API |
|---|---|---|
| `src/lib/stores/chapters.svelte.ts` | 1トピックの**全チャプターを1ストアが配列管理**。コレクション `topics/{topicId}/chapters` を `orderBy('chapterIndex')` で `onSnapshot` 購読 | `chapters: ChapterWithId[]`、`turns: TurnDoc[]`（全章フラット化）、`runningChapter: ChapterWithId \| null`、`isLoaded`、`start`、`stop` |
| `src/lib/stores/engagements.svelte.ts` | **シングルトン** + `setChapterId(chapterId)` で購読対象チャプターを切替。`topics/{topicId}/chapters/{chapterId}/engagements` を `onSnapshot` 購読 | `engagementsMap: Map<turnId, ...>`、`setChapterId`、`start`（空実装）、`stop` |
| `src/lib/stores/currentTopic.svelte.ts` | モジュールレベルのシングルトン集約。`$effect.root` 内で `runningChapter?.id` を監視し `engagementsStore.setChapterId(...)` を呼ぶ | `topic`、`chaptersStore`、`engagementsStore`、`personasStore` 等のアクセサ、`start(topicId)` |

### 型定義

- `ChapterWithId = ChapterStateDoc & { id: string }` は [chapters.svelte.ts:5](../../../src/lib/stores/chapters.svelte.ts#L5) で定義・export。
- `ChapterStateDoc`（`chapterIndex`/`title`/`focusQuestion`/`discussionPoints`/`turns`/`discussionPointStatuses`/`status`）は [session.types.ts:46](../../../src/lib/models/session/session.types.ts#L46)。
- エンゲージメントは章ドキュメントの**外側**の別サブコレクション（`.../chapters/{chapterId}/engagements/{personaId}`）。`per-chapter-engagements` 仕様で移行済み。

### データ永続化形態

- チャプターは個別ドキュメント（`topics/{topicId}/chapters/{chapterId}`）として保存され、書き込み元は `functions/src/pipeline/chapters/chapter-generator.ts`。ターンと `status` は章ドキュメント内に内包されて更新される。
- → 各章は**独立した1ドキュメント**として購読可能。ただし「どの章が存在するか」を知るにはコレクションレベルの購読が必要。

### 消費側（Integration Surfaces）

| 消費者 | 利用しているAPI |
|---|---|
| `features/admin/debate/Phase5Debate.svelte` | `chaptersStore.turns`（全章）、`chaptersStore.chapters`、`chaptersStore.runningChapter`、`engagementsStore.engagementsMap.get(turnId)` |
| `routes/topics/[topicId]/+page.svelte`（公開） | 独自に `createChaptersStore(topicId)` を生成。`chapters`/`turns`/`isLoaded` を使用。**engagements は未使用** |
| `Phase5Debate.svelte.spec.ts` | `chaptersStore`・`engagementsStore`（`setChapterId` 含む）をモック |
| `engagements.test.ts` / `chapters.test.ts` | `setChapterId` ベース／コレクション配列ベースの検証 |

### 重要な現状挙動

- **engagements は「実行中チャプター1つ」しか購読していない**。`Phase5Debate` は全章のターンを表示するが、`engagementsMap` は running 章の分のみ。よって過去章のターンにはエンゲージメントが表示されない（現状の制約）。
- 公開ページは engagements を一切使わない。

---

## 2. 要件実現性分析（Requirements Feasibility）

| 要件 | 必要な技術要素 | 既存資産 | ギャップ |
|---|---|---|---|
| R1 章単位 chapterStore | 章1件分の状態を持つインスタンス生成関数 + 一覧/順序/running/turns 集約 | コレクション購読ロジックは流用可 | **Constraint**: 一覧と順序を知る主体が必要（後述の設計分岐） |
| R2 章単位 engagementsStore | `createEngagementsStore(topicId, chapterId)` へ署名変更、`setChapterId` 削除 | 購読本体・`buildEngagementsMap` は流用可 | **Missing**: chapterId を生成時引数化。複数章ぶんのインスタンス管理 |
| R3 ChapterWithId 廃止 | 型参照の置換 | テストは既にインライン型を使用 | **Low**: export 削除と参照差し替えのみ |
| R4 $effect.root/シングルトン除去 | 宣言的な running→engagements 連結 | — | **Unknown**: 連結方法が設計の核心（後述） |
| R5 独立性 | 2生成関数を別呼び出し、相互非内包 | — | 設計規約として担保 |
| R6 表示・ライフサイクル維持 | 消費側の参照更新、購読 start/stop の漏れなし | 既存 onMount パターン | engagements の参照経路が変わる |
| R7 テスト更新 | 3テストファイルの書き換え | — | **Low–Medium** |

### 複雑度シグナル
- 外部統合なし。純粋にクライアント状態構造のリファクタ。
- 核心は「章リストの集約者」と「running 章 engagements の宣言的供給」という2つの設計判断。

---

## 3. 実装アプローチ選択肢

ここでは本リファクタ特有の**2つの設計軸**ごとに選択肢を示す。

### 軸1: チャプターリストをどう持つか

#### Option A1: 集約ストアがコレクション購読し、章データを保持（現状の延長 + インスタンス化）
集約（`chaptersStore` 相当）がコレクションを `onSnapshot` 購読し、各章の `chapterStore` インスタンスを生成・更新する。`chapterStore` 自身はドキュメント購読せず、集約から流し込まれたデータを保持する。
- ✅ 購読が1本（コレクション）で効率的。順序・一覧が自然に得られる
- ✅ 現状の購読ロジックをほぼ流用、移行が小さい
- ❌ `chapterStore` が「自律的に購読する独立インスタンス」ではなく、集約に従属する
- ❌ 「章ごとにインスタンス」の意図が、購読単位ではなく状態保持単位に留まる

#### Option A2: 集約はIDリストのみ購読、各 chapterStore が自ドキュメントを購読
集約はコレクション購読で**章IDと順序のみ**を得る。各 `chapterStore(topicId, chapterId)` が自分のドキュメントを個別に `onSnapshot` 購読する。
- ✅ 各章が真に独立した購読インスタンス（意図に最も忠実）
- ✅ engagementsStore と対称的（どちらも `(topicId, chapterId)` で自律購読）
- ❌ 購読数が「1（コレクション）+ N（各章）」に増える。同じデータを二重購読する無駄
- ❌ 章追加/削除時のインスタンス生成・破棄のライフサイクル管理が必要

#### Option A3: 集約がコレクション購読でIDリスト生成、chapterStore は「章ごとのビュー」
A1 と A2 の中間。集約がコレクション購読し、スナップショットから各章データを保持しつつ、`chapterStore` を「その章ぶんのアクセサを束ねた軽量オブジェクト」として公開する（独立購読はしない）。engagementsStore は別途 `(topicId, chapterId)` で章ごとに生成。
- ✅ 二重購読を避けつつ「章ごとの単位」を表現
- ✅ R5（独立性）は engagementsStore を別生成することで満たす
- ❌ chapterStore と engagementsStore で「自律性のレベル」が非対称（前者は集約依存、後者は自律）

### 軸2: 実行中チャプターの engagements をどう供給するか（R4-3 / R6-5）

#### Option B1: 集約側の派生（derived）で running 章の engagementsStore を選ぶ
集約が章ごとに engagementsStore を保持し、`get runningEngagementsStore()` を `runningChapter` から `$derived` 的に返す。`$effect.root` 不要。
- ✅ 宣言的。`$effect.root` 廃止を直接満たす
- ✅ 消費側は `currentTopicStore.runningEngagementsStore?.engagementsMap` 等で参照
- ❌ 章ごとに engagementsStore を生成するなら、全章ぶん購読するか、running のみ遅延生成するかの判断が必要

#### Option B2: 全章の engagements を購読し、turnId→engagements を全章横断で提供
章ごとに engagementsStore を作り全章購読。消費側はターンの所属章に関係なく `turnId` で引ける。
- ✅ **現状制約（過去章のエンゲージメント非表示）を解消**できる副次効果
- ✅ 消費側のルックアップが単純（turnId 一意なら章を意識不要）
- ❌ 購読数が章数ぶん増える。完了済み章まで常時購読するコスト
- ❌ 要件は「現状挙動維持」なので、挙動改善は scope 判断が必要

#### Option B3: running 章のみ engagementsStore を生成（遅延・単一）
running 章が変わったら、その章の engagementsStore のみ生成し、旧章は破棄。実体は現状に近いが `setChapterId` ではなく「インスタンス再生成」で表現。
- ✅ 購読は常に1本。現状挙動を厳密維持
- ✅ R2（インスタンス化）と R4（setChapterId 廃止）を満たす
- ❌ 「running の切替検知→再生成」のトリガをどこに置くかで、結局 effect 的な監視が必要になりうる（集約の derived getter 内での生成は副作用になり注意）

---

## 4. 推奨と論点（Recommendations）

### 推奨の方向性（design で確定）
- **軸1**: Option A3 を軸に検討。理由は二重購読を避けつつ R5 を engagementsStore 分離で満たせるため。ただし「各章を真に独立購読したい」という当初意図を重視するなら A2。**A2 と A3 のどちらを取るかは、購読コストと意図忠実度のトレードオフであり、ユーザー判断が必要**。
- **軸2**: Option B1（集約の derived getter で running 章の engagementsStore を返す）を軸に検討。`$effect.root` 廃止に直結する。ただし engagementsStore を「全章生成」するか「running のみ生成」するかは B2/B3 の選択と連動。

### 設計フェーズへ持ち越す Research / 決定事項
1. **R-1**: 軸1（A2 二重購読 vs A3 集約保持）の選択。
2. **R-2**: 軸2で engagements を「全章購読（B2、現状制約の解消）」とするか「running のみ（B3、現状厳密維持）」とするか。要件 R6-5 は「running を反映」止まりなので、B2 は要件拡張の確認が要る。
3. **R-3**: 公開ページ `+page.svelte` は engagements 未使用。chapterStore の新APIに追従するだけでよいか（独自 `createChaptersStore` 生成箇所の扱い）。
4. **R-4**: `currentTopicStore` の集約APIの新しい形（`chaptersStore` の公開アクセサをどう変えるか、`engagementsStore` アクセサの置換）。
5. **R-5（別件・関連）**: `session.types.ts` → `debate.types.ts` リネーム。本specに取り込むか独立処理か未決。取り込む場合 `ChapterWithId` 廃止と同じ型整理の流れに乗せられる。

---

## 5. 工数・リスク（Effort & Risk）

- **Effort: M（3–7日）** — ファイル数は少ないが、集約構造と消費側の参照経路、テスト3本の書き換えが連動する。設計判断（軸1/軸2）が固まれば実装自体は直線的。
- **Risk: Low–Medium** — 外部統合なし・既知パターン内のリファクタでリスクは低い。中リスク要因は (a) 購読ライフサイクル（start/stop 漏れ・二重購読）、(b) running 章 engagements の derived 内生成が副作用にならないようにする Svelte 5 runes の扱い、の2点。

### Requirement-to-Asset Map（ギャップタグ）
- R1 → chapters.svelte.ts（**Constraint**: 集約者の決定）
- R2 → engagements.svelte.ts（**Missing**: chapterId 引数化）
- R3 → chapters.svelte.ts + 型参照13箇所（**Low**）
- R4 → currentTopic.svelte.ts（**Unknown**: 連結方式 = 軸2）
- R5 → 設計規約（**Constraint**: 相互非内包）
- R6 → Phase5Debate / +page.svelte（参照経路変更）
- R7 → engagements.test.ts / chapters.test.ts / Phase5Debate.svelte.spec.ts（**Low–Medium**）
