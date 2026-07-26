# Gap Analysis: editing-pass-regeneration-efficiency

## 1. 現状調査（Current State）

### 対象サブシステム
編集工程（記事要素＝導入・締め・所感の生成／再生成）。原本の討論（chapters の生ターン・personas の信念/気づき）は読み取りのみ。

### 主要アセット
- `functions/src/pipeline/debate/debate-digest.ts` — `buildDebateDigest`。原本章＋承認済みペルソナから `DebateDigest` を組み立てる。章ごとに `summarizeChapter`（LLM）を**逐次**実行。コメントに明記のとおり **Firestore には保存しない**（呼び出し側でメモリ消費）。
- `functions/src/pipeline/editing/element-builders.ts` — `buildIntroOutroInput`（`buildDebateDigest` を呼ぶ）／`buildNarrationPart`（`writer.begin()` を**内部先頭**で呼び、原本生成→整え→完了）。
- `functions/src/pipeline/editing/intro-outro-step.ts` — 一括編集ランの導入・締め生成。`buildIntroOutroInput` を**1回**呼び、その結果を intro・outro 両方に使い回す。
- `functions/src/pipeline/editing/regenerate-element.ts` — 個別再生成。`regenerateNarration` は導入・締めそれぞれで**毎回** `buildIntroOutroInput`（＝ダイジェスト全構築）を呼ぶ。`writer.begin()` はその**後**（`buildNarrationPart` 内）に来る。所感（`regenerateImpression`→`buildImpressionPart`）は `writer.begin()` が**先頭**。
- `functions/src/pipeline/editing/editorial-repository.ts` — 統合ドキュメント `topics/{id}/editorial/0`（`EditorialForFirestore = {intro, outro, impressions}`）の読み取りと**部分上書き（blind write）**。`narrationWriter.begin` は `setIntro/setOutro`＝`editorialRef.update`（**単一書き込み・トランザクションなし**）。`clearEditorial` は `.set({intro,outro,impressions})`＝**ドキュメント全体を上書き**。
- `functions/src/pipeline/editing/edited-repository.ts` — `clearEditedArtifact`（全 editedChapters 削除＋`clearEditorial`）。

### 無効化フック（重要）
`clearEditedArtifact` は「上流が変わったら編集成果物を捨てる」中央地点で、以下から呼ばれる:
- `debate-lifecycle.ts:114`（討論の作り直し）
- `editing-lifecycle.ts:20` `startEditingRun`（編集ラン開始）
- `api/fact-research.ts:44` / `api/personas.ts:51` / `api/chapters.ts:42`（ダイジェスト入力が変わる操作）

→ ダイジェストの入力（原本討論・ペルソナ）が変わりうる操作は、すべて既に `clearEditedArtifact` を通る。

### 規約
- リポジトリ層は blind write（部分上書き）中心、`runTransaction` は世代ガードが要る所のみ（`finalizeEditingRun`/`stopEditingRun`）。
- 段階書き込みは `ElementWriter`（begin→toEditing→finish）に集約。

## 2. 要件→アセット対応（Requirement-to-Asset Map）

| 要件 | 関連アセット | ギャップ |
|---|---|---|
| R1 生成中の即時反映（重い前処理より前に status） | `regenerateNarration`（begin が digest の後） | **Missing**: begin を `buildIntroOutroInput` の前へ。所感は充足済み。 |
| R2 ステータス変更の最小・非トランザクション | `narrationWriter.begin`＝`update` 単一書き込み | **充足**（既に単一 update・トランザクション不使用）。新規で壊さないことが要点。 |
| R3 前処理失敗時のステータス整合 | `regenerateNarration` の digest 失敗時 `writer.finish(null)` | **Constraint**: begin を前倒しすると、digest 失敗が「生成中」の後に起きる。失敗時に必ず終端（生成失敗）へ落とす経路を維持する。 |
| R4 要素間の順序一貫性 | 所感=先頭 begin / 導入・締め=後 begin | **Missing**: 導入・締めを所感と同じ「status 先行」に揃える。 |
| R5 ダイジェストの保存・再利用 | `buildDebateDigest`（非保存）／`editorial/0`／`clearEditedArtifact` | **Missing**: 保存先と再利用経路。**無効化は既存 `clearEditedArtifact` を再利用可能**。 |

## 3. 実装アプローチ（Options）

**前提: R1/R4（順序修正）はどの案でも「既存コードの編集」で共通**（ステップの並べ替えに「新規コンポーネントで作る」別解は無い）。したがって A/B の差は **R5（ダイジェストのキャッシュをどこに置くか）の一点**に集約され、本 feature では **Option B と Option C は実質同一**（C は「順序＝既存編集＋digest＝専用」を明示しただけ）。

### Option A: 既存拡張 — ❌ 不採用
- **R5（再利用）**: `DebateDigest` を `editorial/0` に一フィールド（例 `digest`）として保存。無効化は `clearEditorial` の全上書きに自動で乗る（コード追加ほぼ不要）。
- **不採用の理由**: `editorial/0` は FE が **onSnapshot で購読**している（`src/lib/stores/editorial.svelte.ts:47`。導入・締め・所感の生成中ステータスをライブ表示するため）。ここに大きめの digest を入れると、**ステータス更新のたびに討論全体の要約がブラウザへ配信され**、内部キャッシュをクライアントに露出する。無効化コードが不要という利点より、この配信/露出の害が勝る。

### Option B: 新規コンポーネント — ✅ 採用（＝実質 Option C）
- **R1/R4（順序）**: `regenerateNarration` を「`begin()`（生成中に切替）→ `buildIntroOutroInput`（保存があれば再利用・無ければ構築して保存）→ 生成」の順に組み替える。`buildNarrationPart` から begin を外に出す（または begin 済み前提の薄い版を用意）。一括の `intro-outro-step` とも整合させる。
- **R5（再利用）**: ダイジェスト永続を**専用ドキュメント**に分離し、専用リポジトリ（read/write/invalidate）が所有。`buildIntroOutroInput` はそれを呼ぶだけ。FE には購読させない＝digest をクライアントに流さない。
- **無効化**: `clearEditedArtifact`（討論・ペルソナ・章・fact-research の変更すべてから呼ばれる中央地点）に「当該 doc を消す」1行を明示追加。
- **トレードオフ**: ✅ 責務が綺麗／`editorial/0`（FE 購読対象）を汚さない・digest を配信しない ❌ 無効化に明示コード（1行）が要る

### ドキュメント構造（ユーザー方針）
- `editorial/0`（無名 singleton）をやめ、`topics/{id}/editorial/outputs`（導入・締め・所感の成果物）と `topics/{id}/editorial/digest`（キャッシュ）に**名前付きで分離**する。
- `editorial/0 → editorial/outputs` のリネームは既存データ移行を伴う（下記 5 の判断参照）。

## 4. 複雑度・リスク

- **Effort: S（1〜3日）** — 既存パターン（blind write・ElementWriter・clear 網）に乗る局所変更。
- **Risk: Low〜Medium** — Low: 順序組み替えは局所。Medium: 「保存した要約をいつ捨てて作り直すか」の判断を誤ると、古い要約を使い続ける（討論が変わったのに更新されない）か、逆に毎回作り直してキャッシュが効かない、のどちらかが起きる（詳細は 5 の判断1）。

## 5. 設計フェーズへの申し送り

### 推奨
- **Option B を基本**（順序＝既存コードの局所編集、R5＝**専用ドキュメント** `editorial/digest` に分離）。理由: `editorial/0` は FE 購読対象なので digest を混ぜると要約がクライアントへ配信される。B と C は本 feature では同一。
- あわせて `editorial/0 → editorial/outputs` へリネームし、成果物とキャッシュを名前付きで分ける（ユーザー方針）。

### 決着済み（調査で判明）
- **Firestore rules は手当て不要**: `firestore.rules` の editorial は `match /editorial/{docId}` の**ワイルドカード**（公開読み取り = `published==true`）。`outputs` も `digest` も既存ルールが当たるので、リネーム/追加で rules 変更・デプロイは不要（既知の「デプロイ済み rules ズレ→permission-denied」リスクは発生しない）。
- **移行方式**: `editorial/0 → editorial/outputs` は、`functions/src/scripts/` にコミットして残す冪等 backfill（全トピック＝公開済み含む をコピー）で行う。使い捨てスクリプトにしない。順序は「backfill 先 → デプロイ」または「読み取りフォールバック（`outputs` 無ければ `0`）」で、公開記事が空の `outputs` を読む一瞬を防ぐ。
- **無効化フック**: `clearEditedArtifact`（討論・ペルソナ・章・fact-research 変更のすべてから呼ばれる）に digest doc 削除を1行追加すれば、上流変更で digest が無効化される。

### 決めるべき設計判断 / Research Needed
1. **【決定: 案A】保存した要約（ダイジェスト）を、いつ捨てて作り直すか。** 要約の材料は討論の中身（章の生ターン・ペルソナの信念/気づき）だけで、討論が変わらなければ要約は正しいまま。よって「討論が変わったとき」に捨てればよいが、それをどう検知するかで2案あった:
   - **案A（採用・簡単）**: 編集成果物を捨てる既存処理 `clearEditedArtifact` に相乗りする。これは討論・ペルソナ・章・fact を変えたときだけでなく「討論はそのままで編集をやり直したとき」にも走るので、その分だけ要約を1回ムダに作り直す。実装は最小（既存フックに1行）。
   - 案B（不採用・厳密）: 討論に「版（バージョン）」を持たせ、その版が変わったときだけ要約を捨てる。編集をやり直しても討論が同じなら再利用する。版を持たせて比較する仕組みが要る。
   - **差が出る場面**: 導入・締めの個別再生成を連打するケース（今回の主目的）はどちらの案でも要約を再利用でき差は出ない。違いが出るのは「編集パス全体をやり直す」ときだけ（案Aはそのたび1回作り直す）。主目的は案Aで足りるため案A を採用。
2. **【決定: 含める】outputs リネームを本 spec に含めるか**: `digest` 追加（R5・移行不要）に加え、`0→outputs` リネーム（backfill を伴う）も本 spec に含める。要件は R6 として追加。
3. **【決定: 共有する】一括ランとの共有**: `buildIntroOutroInput` を初回の一括ラン・個別再生成の双方が通す共通のキャッシュ対応関数にする。`intro-outro-step` が初回に構築・保存した digest を後続の個別再生成が再利用し、初回↔再生成での digest 重複構築を無くす。
4. **begin の再配置方法**: `buildNarrationPart` の begin をどう外出しし、一括ラン（既に digest を1回だけ持つ）と個別再生成の両方で「status 先行」を一貫させるか。
5. **digest の公開可否**: rules のワイルドカードにより、公開トピックの `editorial/digest` も公開読み取り可能になる（討論の公開内容由来なので実害は小）。サーバー限定に厳密化するなら rules で digest を公開読み取りから除外する1行を足すか。
6. `DebateDigest` の Firestore シリアライズ可否の最終確認（構造は素の object 配列で問題は見当たらない）。
