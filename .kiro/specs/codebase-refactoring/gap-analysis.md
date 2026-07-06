# Gap Analysis: codebase-refactoring

調査日: 2026-07-06
調査方法: 機械チェック（grep・ベースライン検証）＋ 判読監査（BEM 準拠・デッドコード・配置実態の全数調査）

## 1. ベースライン検証結果（Requirement 1・10 の基盤）

リファクタリング着手前の時点で、検証パイプラインはすべて green。挙動保全の判定基盤は既に整っている。

| 検証 | 結果 |
|---|---|
| `pnpm check`（svelte-check） | 544 ファイル、0 エラー・0 警告 |
| `pnpm lint`（Prettier + ESLint） | 通過 |
| `pnpm test`（Vitest） | 33 ファイル・272 テスト全成功 |
| Functions ビルド（tsc） | 成功 |

## 2. Requirement 別 現状とギャップ

### Requirement 2: コーディング規約 — ギャップ小（Constraint なし）

| 項目 | 現状 | ギャップ |
|---|---|---|
| アロー関数 | `function` 宣言は **6 件・3 ファイルのみ**（`TopicForm.svelte`、`TopicListItem.svelte`、`admin/topics/new/+page.svelte`） | 軽微。機械的に置換可能 |
| `any` 禁止 | tests 除き **0 件** | 準拠済み |
| strict mode | svelte-check・tsc とも 0 エラー | 準拠済み |
| 省略変数名 | 変数宣言は 5 件（`e`・`idx`×3・`d`）。**コールバック引数の 1 文字名が約 113 件・40 ファイル超**（`(t) =>`・`(d) =>`・`(p) =>` 等） | **最大の違反領域**。頻出は `Phase6Editing.svelte`、`stores/topics・personas`、`pipeline/debate/` 各所 |

### Requirement 3: 配置と責務 — 要判断事項あり

| 項目 | 現状 | ギャップ |
|---|---|---|
| Firestore アクセス・httpsCallable の置き場所（AC 3.1） | Firestore 書き込みと callable は `models/topic/createTopic.svelte.ts`（topic インスタンス固有の操作）と stores（`personas.svelte.ts:136` = コレクション内ペルソナへの取材、`factCheck.svelte.ts:64`）に分かれる | **違反なし（解決済み）**。基準は「操作が属するエンティティの状態管理（シングルトン store / createXXX インスタンス）に置く」であり、現配置はこの基準に一貫（→ D1 は基準の明文化として要件 3.1 に反映済み）。UI コンポーネントからの直接呼び出しが無いことの確認のみ実装時に行う |
| UI 操作を models に置かない（AC 3.3） | `goto`・`$app/navigation` の models/stores 内使用は 0 件 | 準拠済み |
| 関数のトップダウン順（AC 3.4） | 機械チェック不能。未調査 | **Research Needed**（設計フェーズでサンプリング方法を決定） |
| `*.types.ts` は型と型ガードのみ（AC 3.5） | 違反 1 件: `topic.types.ts:54` の変換関数 `topicFromFirestore`（functions 側は型ガード `isNonEmptyArray` のみで準拠） | 軽微。移動先（利用側インライン）明確 |

### Requirement 4: 過度な共通化・デッドコード — ギャップ小

**デッドコード（確度高・4 ファイル）**:
- `features/admin/topic-detail/TopicDetailTemplate.svelte` — 空スタブ（クラス名 `topic-detial-template` に typo あり）、未参照
- `features/admin/topic-detail/general/TopicGeneralPage.svelte` — 0 バイト、未参照
- `features/topics/list/TopicListPage.svelte` — 未参照（`routes/+page.svelte` は `TopicListItem` を直接使用）
- `functions/src/types/interview.types.ts` — `Interview` 型が全体で未使用

**テスト専用の本番未使用関数（4 件・要確認）**: `setTopicPhaseStatus`、`readFactCheckResult`、`readEditedIntroClosing`、`isNonEmptyArray` → D3

**未使用の型 export（多数・低リスク・要確認)**: stores の `ReturnType` 型 6 件、models の型 7 件。意図的保持の可能性あり → D3

**過度な共通化**: 実質候補は `PhasePanel.svelte` のみ（7 フェーズ画面が使用、`logicalState` で内部分岐）。ただしラベル・操作は呼び出し側が渡す制御された設計で、structure.md の判定基準に照らして**分解不要と評価**（設計フェーズで最終判断）。バックエンドの orchestrator 群の `stepKind` 分岐は各機能内に閉じたステートマシンで問題なし。

**重複ロジック**: 明確な該当は 1 件のみ — 日付フォーマット `currentDateString()`（`prompt-formatters.ts:34`）と `formatDate()`（`fact-research-agent.ts:25`）が同一実装。

**日付整形の dayjs 統一（ユーザー決定・AC 4.4-4.5）**: dayjs はフロント・functions とも未導入のため両 package.json への追加が必要。置き換え対象は 3 箇所 — `TopicListItem.svelte:11`（`toLocaleDateString('ja-JP', ...)`）、`fact-research-agent.ts:26` と `prompt-formatters.ts:36`（手書き `YYYY年M月D日`）。functions 側 2 箇所は `format('YYYY年M月D日')` で出力同一を維持できる。フロント側は現行の `toLocaleDateString` 出力と同一になるフォーマット文字列を実装時に確認する。

### Requirement 5: BEM 記法 — 最大の作業ボリューム

全 36 コンポーネント中: **準拠 6・違反 17**・style なし 13。

| 違反パターン | 件数感 | 代表例 | 修正規模 |
|---|---|---|---|
| A. BEM 未導入のフラット命名 | 最多（約 9 ファイル） | `TopicListPage`(admin) が `.dashboard`、`Phase5Debate` が `.turns` `.turn.facilitator` | 大（構造ごと書き直し） |
| B. BEM だが Block 名がコンポーネント名と不一致 | 4 ファイル | `Phase2Personas` → `.personas__list`（正: `.phase2-personas__list`） | 小（改名のみ） |
| C. Modifier が `--` でない | Aと重複多数 | `.item-completed`、`.engagement.selected` | 中 |
| D. page/layout の Block 命名不備 | 3 ファイル | `routes/+page.svelte` が `.container` | 小 |

### Requirement 6: テスト配置 — ほぼ準拠済み

ソース同居 0 件、`tests/` 配下 103 件、命名 3 種すべて規約どおり。唯一の課題: `src/tests/models/session/` が実在しない `src/lib/models/session/` に対応（旧スキーマの名残）→ 掃除対象（D3）。

### Requirement 7: 仕様不備・不整合の検出 — 予備調査での候補

本調査で既に検出した実装側の不整合（本実装フェーズで正式に記録・報告する候補）:
1. **空スタブ・typo コンポーネント** — `TopicDetailTemplate.svelte`（typo `detial` 含む）、`TopicGeneralPage.svelte`（0 バイト）が放置
2. **旧スキーマの名残** — `src/tests/models/session/` ディレクトリ

※ httpsCallable が models と stores に分かれている点は当初不整合候補としたが、「操作が属するエンティティの状態管理に置く」基準（要件 3.1）に照らして一貫した配置であり、不整合ではないと判断（D1）。

※ ユーザー指示により、steering ドキュメント自体の陳腐化（実装は正しくドキュメントが古いだけの乖離）は本 spec の報告対象外。コードを正とする。（参考: steering の更新は別途 `/kiro:steering` で実施可能）

### チェーン構造レベルの問題（ユーザー要望による追加調査・詳細は [chain-structure-findings.md](chain-structure-findings.md)）

討論・生成・編集の3チェーンを構造レビューした結果、**高深刻度5件を含む約25件**を検出。4つの構造テーマに集約される:

1. **生成ライフサイクル状態機械の FE/サーバ分裂**（高3件: regenerate の後勝ち契約による座礁窓、stopped 書込の FE 在席依存、取材 fanout の失敗集約非対称）— editing フェーズで確立済みの「サーバ所有」規範に上流5フェーズが未到達。サーバ一本化で同時解消
2. **世代（runId）照合の不徹底** — 討論チェーンの高1件（A-1 ゾンビチェーン）は**ユーザー決定により本 spec で修正**（Requirement 9: 入口 runId 照合 + 棄却理由の伝播）。編集・生成フェーズ側の世代課題（B-8, C-2）は引き続き報告対象
3. **成果物の真実源分裂** — 章FCの指摘が編集の保護判定に合流しない件（C-1）は、**ユーザー決定により章FC機能ごと削除**（Requirement 8）で解消。C-4・C-6 の一部も同時消滅
4. **非原子な複数書込**（ターン確定後の副作用がリトライで再実行されない等）

これらの多くは修正に挙動変更を伴うため Requirement 7 の報告対象（対応は別 spec / 個別修正で判断）。一方、**挙動保全内で修正可能なもの**（早期終了判定式の二重実装、finalResponse の4箇所分散、StepContext の組成分裂とエイリアス、死んだ分岐・死にパラメータ、Result/throw 二流儀の統一など）は本 spec の実装タスク候補に組み込める。Firestore 読み取りの重複解消（A-2・C-5）は R1.4（パフォーマンス目的の書き換え禁止）との整理が必要 → D4。

## 3. 要判断事項（設計フェーズで決定）

- **D1: Firestore 書き込み・httpsCallable の置き場所 — 解決済み（ユーザー決定）** — models の createXXX と stores はインスタンスかシングルトンかの違いでしかなく、置き場所は操作の性質で決める。「操作が属するエンティティの状態管理（シングルトン store / createXXX インスタンス）に置く」を基準とし、現配置（topic フェーズ操作 = createTopic インスタンス、ペルソナ取材・ファクトチェック = 各 store）は基準どおりで移動不要。この基準を要件 3.1 として明文化済み
- **D2: BEM 違反 A グループ（9 ファイル）の改修深度** — class 属性と `<style>` の改名は挙動非破壊だが、見た目回帰の目視確認コストが 17 ファイル分発生。全件やるか、B/C/D の軽微違反のみ先行するか
- **D3: 未使用資産の削除範囲** — 確度高の 4 ファイルは削除推奨。テスト専用関数 4 件・未使用型 export 13 件は「意図的保持」の可能性があるためユーザー確認のうえ削除
- **D4: チェーン構造所見のうち「挙動保全内リファクタ」の本 spec への取り込み範囲** — chain-structure-findings.md の [改修=リファクタ] 群（A-3, A-6, A-7, A-8, B-4 死にパラメータ, B-9）をどこまで本 spec のタスクに含めるか。Firestore 読み取り重複の解消（A-2, C-5）は外部挙動は不変だが R1.4 の「パフォーマンス目的の書き換え禁止」に抵触しうるため扱いを明確化する
- **D5: 挙動変更を伴うチェーン構造問題の対応順序** — C-1/C-4 は章FC削除（Requirement 8）、A-1 は世代照合（Requirement 9）として本 spec で対応が確定。残る挙動変更系（B-1/B-2/B-3/B-5/B-6 の「生成ライフサイクルのサーバ一本化」、A-4, A-5, B-7, C-2, C-3 等）は本 spec 完了後の別 spec 化を推奨

## 4. 実装アプローチの選択肢

### Option A: 規約領域別スイープ（ルールごとに全体一括）
各要件を 1 スイープとして全体に適用（アロー関数化 → 短縮名改名 → BEM → …）。
- ✅ 各スイープが機械的で検証しやすい（1 スイープ = 1 検証サイクル）
- ✅ Requirement 10 の検証を領域ごとに刻める
- ❌ 同じファイルを何度も触る。関数並び順・仕様不備検出のような「通読が必要な作業」と噛み合わない

### Option B: モジュール別（ディレクトリごとに全規約適用）
`stores/` → `models/` → `features/` → `functions/pipeline/` … と領域ごとに全規約を適用。
- ✅ 1 ファイル 1 回の通読で全規約＋仕様不備検出を同時に済ませられる
- ❌ 進捗中は「どの規約がどこまで済んだか」が追いにくい。機械的な置換まで通読に巻き込まれ非効率

### Option C: ハイブリッド（推奨）
機械的な規約（アロー関数・短縮名・変換関数移動・デッドコード削除）は**領域別スイープ**で先に片付け、判読が必要な作業（関数並び順・仕様不備検出）は**モジュール別通読**で実施。BEM はファイル単位で独立性が高いため独立トラックとして並行。
- ✅ 各作業の性質に合った進め方。仕様不備検出（Req 7）は通読パスに自然に載る
- ❌ 3 トラックの完了管理が必要（tasks.md で吸収可能）

## 5. 規模・リスク評価

| 評価 | 判定 | 根拠 |
|---|---|---|
| Effort | **M（3–7日）** | 違反総量は限定的（BEM 17 ファイルが最大、次いで短縮名 113 箇所）。新規実装なし・全て既存パターン内 |
| Risク | **Low〜Medium** | 型チェック・272 テストの安全網あり。唯一の Medium 要素は BEM 改名の見た目回帰（scoped CSS のため class 属性と style の同期改名が必須）と、`createTopic.svelte.ts` を動かす場合の影響範囲（D1 で回避可能） |

## 6. 設計フェーズへの推奨

- **推奨アプローチ**: Option C（ハイブリッド）
- **D1 は解決済み**（置き場所は操作の性質で決める基準を要件 3.1 に明文化。コード移動なし）。残る要判断は D2（BEM 改修深度）と D3（未使用資産の削除範囲）のみ
- **Research Needed**:
  1. 関数並び順（トップダウン）の検査・是正手順 — 全ファイル通読か、行数の多い主要ファイルに限定か
  2. BEM 改名時の見た目回帰の確認手段 — 手動目視のチェックリストで足りるか
  3. 未使用型 export・テスト専用関数の保持意図の確認（D3）
