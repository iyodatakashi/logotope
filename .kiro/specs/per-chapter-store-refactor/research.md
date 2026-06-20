# Research Notes: per-chapter-store-refactor

設計判断とその根拠の記録。design.md の自己完結性を保つため、ここには背景・比較・代替案の詳細を置く。

## 調査で確定した事実

### F-1: 「現在の章」の真実は章ドキュメントの status
- トピックドキュメントに `currentChapterId` / `currentChapterIndex` の専用永続フィールドは存在しない。
- オーケストレータが章処理開始時に `functions/src/pipeline/debate/debate-orchestrator.ts:82` で `updateChapterStatus(topicId, chapterDoc.id, 'running')` をセットする。
- `createTopic.svelte.ts:205` のコメントが言及する「currentChapterIndex」は Functions 側が再開時に算出する値であり、保存フィールドではない。
- **結論**: `currentChapterId` は `chapters.find(c => c.status === 'running')?.id` から**導出**する。独立した可変状態として保持・セットしない。

### F-1b: current 判定を currentChapterId 比較に一元化する（設計洗練）
- `status === 'running'` を各所で再評価するのではなく、`currentChapterId` を**単一の軸**として保持し、各章/各エンゲージメントの「current か」を `chapterId === currentChapterId` の比較で導く。
- これにより「どれが現在か」の判定ロジックが1箇所に集約され、chapter 側と engagement 側が同じ `currentChapterId` を参照する対称構造になる。
- `status` の入力的役割（`currentChapterId` の決定材料）と、`pending`/`completed` の生データとしての保持は維持する。current 判定だけを `currentChapterId` 比較に寄せる。
- **配置**: `currentChapterId` は `chaptersStore` が保持し、`currentChapterStore`・`currentEngagementStore` はそれを参照する。

### F-1c: currentChapterId は「算出」ではなく「設定」する（ドメイン判断）
- これは**ドメインのモデリング判断**であり、Svelte 仕様とは無関係。`currentChapterId` を「アクセス毎に status を走査して導く値」ではなく、「いま着目している章を表す、設定される単一の状態」として扱う。
- 採用: `currentChapterId` を `$state` とし、**章コレクションの `onSnapshot` コールバック内でセット**する（`currentChapterId = find(c => c.status === 'running')?.id ?? null`）。バックエンドの status 更新がスナップショットで届いたときに設定する、という形。
- Svelte が関係するのは実装手段のみ: この設定を `$effect` で行わないこと（コールバック内でのセット）。これにより `$effect.root` / `effect_orphan` を構造的に排除する。
- 補足（MCP 確認の実装制約）: `.svelte.ts` で再代入する `$state` は直接 export できないため、既存の `createXxxStore` ファクトリ + getter 公開パターンを踏襲する。

### F-2: engagements は章スコープのサブコレクション
- `topics/{topicId}/chapters/{chapterId}/engagements/{personaId}`（`per-chapter-engagements` 仕様で移行済み）。
- 全章を跨ぐ単一コレクションは存在しないため、全章のエンゲージメントを得るには章ごとに購読する必要がある。

### F-3: 現状の購読範囲の制約
- 現状の `engagementsStore` は running 章1つだけを購読しており、過去章（completed）のターンにはエンゲージメントが表示されない。
- 全章購読にすると、この制約は副次的に解消される。

## 設計軸の決定

### 軸1: チャプターリストの集約 → 「コレクション購読 + 章インスタンス保持」
- `chaptersStore` がコレクション `topics/{topicId}/chapters` を1本の `onSnapshot` で購読し、各章を `ChapterStore` インスタンスとして保持する。
- 各 `ChapterStore` は独立して Firestore を購読しない（コレクションスナップショットからデータを受け取る保持役）。
- **却下した代替**: 各 `ChapterStore` が自ドキュメントを個別購読する案（gap-analysis の A2）。「1（コレクション）+ N（各章）」の二重購読となり、章データは元々コレクション購読で得られるため無駄。

### 軸2: 実行中章の engagements 供給 → 「全章購読 + 導出セレクタ」
- `engagementsStore` が全章ぶんの `EngagementStore` を生成・購読する。
- 「current 章のみ購読」を選ぶと、current の変化を監視して購読を張り替える処理（＝廃止対象の `setChapterId` / effect 相当）が復活するため却下。
- 全章購読により切替ロジックがゼロになり、本リファクタの目的（`setChapterId`・`$effect.root` 廃止）に最も忠実。コストは章数（数個）ぶんの軽量サブコレクションリスナーで許容範囲。

### 軸3（設計中に判明した核心）: 章リスト変化への追従を $effect なしで行う
- `engagementsStore` は「どの章が存在するか」を知らないと `EngagementStore` を生成・破棄できない。これは本質的にリアクティブな反映を要する。
- ここで `chaptersStore.chapters` を `$effect` で監視すると、当初エラー（`effect_orphan`：モジュールトップレベルでの bare `$effect`）が再発する。`$effect.root` は singleton で合法だが、本リファクタはまさにこの effect 駆動の複雑さを排除するのが目的。
- **決定**: `engagementsStore` 自身が章コレクション `topics/{topicId}/chapters` を `onSnapshot` 購読し（章ID・順序の取得のみ）、その**プレーンなコールバック内**で `EngagementStore` 群を reconcile（新規生成・破棄）する。`$effect` を一切使わず、ストア間のリアクティブ依存も持たない。
- **トレードオフ**: 章コレクションが2回購読される（`chaptersStore` と `engagementsStore`）。ただし章コレクションは小さく軽量で、effect 復活やストア間結合よりも望ましい。
- **却下した代替**: (a) `engagementsStore` が `chaptersStore.chapters` を読み `$effect.root` で reconcile → effect を再導入。(b) `chaptersStore` のコールバックから `engagementsStore` を通知 → 2ストアが engagements 生成を共同所有し境界が曖昧化（design-principles「No Hidden Shared Ownership」違反）。

## 関連・別件

### R-rename: session.types.ts → debate.types.ts
- 当ファイルの実体は討論ドメイン型（Chapter / Turn / PostDebateComment / Published*）。Functions 側は既に `debate.types.ts`。
- 本spec の `ChapterWithId` 廃止と同じ「型整理」の文脈だが、リネームは独立した機械的変更（13参照）。
- **方針**: 本spec の boundary 外とし、別途処理することを推奨（design.md の Open Questions 参照）。
