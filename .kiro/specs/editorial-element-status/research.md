# Research Log — editorial-element-status

## Summary
- Discovery type: **Light（既存システムの拡張・統合中心）**
- 既存の editorial パイプライン（functions/src/pipeline/editing）とフロント表示（EditingPage / NarrationSection / ImpressionSection）を対象に、記事要素の生成状態の永続化ポイントと表示制御を調査した。
- 結論: 各要素に明示的な状態（4値）を永続化し、run 終端で「生成待ちのまま残った要素」を失敗へ確定するスイープを足す。フロントは状態のみで表示する。

## Research Log

### 現状の永続形と書き込み経路
- `EditorialForFirestore = { intro: Narration, outro: Narration, impressions: Record<personaId, ImpressionForFirestore> }`（`functions/src/types/editorial.types.ts`）。`Narration = { draft, final }`、`ImpressionForFirestore = { sortOrder, draft, final }`。フロント（`src/lib/models/editorial/editorial.types.ts`）と一致。
- `editorial-repository.ts`: `clearEditorial` が intro/outro=`{draft:null,final:null}`・impressions=`{}` で初期化。`setIntro/setOutro/setImpression` は blind write（部分上書き）。
- `element-builders.ts`: `buildNarrationPart` は 生成失敗→`{null,null}` / 整え失敗→`{draft,null}` / 成功→`{draft,final}`。`buildImpressionPart` は **全滅時 `null`**（→ エントリ未作成）/ 整え失敗→`{draft,final:null}` / 成功→`{draft,final}`。
- **含意**: 「生成待ち（未生成）」と「生成失敗」がどちらも `{null,null}` かつ所感は absent で表現され、データからは区別不能。これが `isEditingFinished` を組み合わせている根本原因。

### run 終端の確定処理
- `editing-lifecycle.ts` の `finalizeEditingRun` は **章（editedChapters）の成否のみ**で phaseStatus を generated/stopped に確定。editorial 要素には触れない。`stopEditingRun` は終端失敗で stopped 化。
- 生成順（`editing-orchestrator`）は impressions → 各章 → intro/outro（終端で finalize）。
- **含意**: run が intro/outro ステージ前に停止すると intro/outro は初期の `{null,null}` のまま残る。所感も未到達なら absent。→ 状態を「失敗」に確定する終端スイープが必要。

### 個別再生成
- `regenerate-element.ts`: `regenerateIntro/Outro/Impression` は build 後 `final===null` なら例外送出（＝既存を保持、部分保存しない）。
- **含意**: Req 5（成功→更新 / 失敗→既存維持）に沿うには、build 結果の状態を見て「生成できた（draft 以上）なら書く／生成失敗なら書かず既存維持」に整理する。

### フロント表示
- `NarrationSection` / `ImpressionSection` は `part`（{draft,final}）と `isEditingFinished` から status を内部導出して表示。所感の absent は `displayImpressions` で `{draft:null,final:null}` にフォールバック。
- **含意**: 要素が状態を持てば `isEditingFinished` prop は不要。absent 所感は「pending」フォールバックに置換できる。

## Design Decisions
- **明示的な状態値を永続化**（4値: `pending`/`draft_only`/`final`/`failed`）。要件は「独立状態で表示制御」で、4値はその実現手段。
- **終端スイープ**を `finalizeEditingRun`（および stop 経路）に追加し、`pending` のまま残った intro/outro・未生成の所感を `failed` に確定する（Req 4.3 固着防止）。
- **buildImpressionPart は null を返さず**、全滅時は `status:'failed'` のエントリを返す（所感の absent を減らし、状態を明示）。
- **既存データ互換**（Req 7）: 状態欠落時は `final`→final / `draft`→draft_only / どちらも無し→failed に**フロント側で正規化**（onSnapshot 経由のためサーバの readEditorial は通らない）。

## Risks
- 終端スイープが所感の未生成を failed 化する際、承認ペルソナ一覧を要する（finalize の依存が増える）。→ スイープを専用関数に閉じる。
- 本番 functions のデプロイが必要（エミュレータ未使用）。旧データは Req 7 のフォールバックで表示は破綻しない。
