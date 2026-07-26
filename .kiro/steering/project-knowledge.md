# Project Knowledge（技術事実・決定・spec 計画）

このプロジェクト固有の技術的事実・落とし穴・方針決定・今後の spec 計画。コードや git 履歴から自明でない知識を集約したもの。

## インフラ・デプロイ

- **Firebase エミュレータは使わず、本番 Cloud Functions（asia-northeast1）に直結している。** フロントは `VITE_USE_EMULATOR=true` のときだけ localhost に繋ぐ設定だが、実運用では本番直結で動作確認する。functions/ の TypeScript を変更したら `tsc` ビルドだけでは本番に反映されない — `firebase deploy --only functions` が必要。「エミュレータ再起動で済む」と案内しない。
  - **デプロイは絶対に Claude 側で実行しない。** ユーザーが自分でやる。Claude はコマンドを案内するだけ。
- **`onTaskDispatched`（Cloud Tasks 起動、例 `runChapter`）の実質タイムアウト上限は 30 分（1800 秒）。** 関数側 `timeoutSeconds` を 60 分にしても、Cloud Tasks の dispatch deadline が 30 分でディスパッチ失敗扱い＋リトライを投げるため超えられない。`onCall`/`onRequest`（HTTP 系）は最大 60 分（3600 秒）で別物。steering の tech.md「Functions v2 最大 60 分」は HTTP 系の話でタスク系には当てはまらない。長時間化は最大 1800 秒まで、それ以上は処理分割（チェックポイント化）が必要。
- **公開 SSR 読み取り（`$lib/firebase-public` / `publicDb`）は SSR(Node) 実行時に必ず本番 Firestore を読む。** エミュレータ接続は `typeof window !== 'undefined'` ガードでクライアント限定のため、サーバ側にエミュレータ経路は無い。未認証 SSR の `where('published','==',true)` が通るには**本番にデプロイ済みの firestore.rules** の公開読み取り許可が必要。デプロイは手動なので、リポの firestore.rules と本番デプロイ済み rules がズレると `permission-denied` になる（`firebase deploy --only firestore:rules` で解消）。permission-denied が出たら**まずデプロイ済み rules ≠ リポ rules を疑う**。

## LLM・モデル

- **新しい Claude モデル採用時、`@ai-sdk/anthropic` の能力表（`getModelCapabilities`）が未対応だと `maxOutputTokens: 4096` ＋ `supportsStructuredOutput: false` の保守的デフォルトに落ちる。** 症状: 出力が長い `generateObject` だけが決定論的に `No object generated: response did not match schema.`（4096 で切り詰め→JSON 破損）。出力が短い呼び出しは通るので「間欠的」に見えるが実際は出力長依存。対処: provider を最新 3.x にパッチ更新（例 `claude-sonnet-5` は `@ai-sdk/anthropic@3.0.96` で解消）、または `models.ts` の middleware で `maxOutputTokens` を明示。新モデル切替時は `node_modules/@ai-sdk/anthropic/dist/index.js` の `getModelCapabilities` に載っているか確認する。
- **ペルソナ生成（発言・所感）は全ペルソナ Claude Sonnet に一本化。** ペルソナ人格ごとのモデル使い分け（`llmType` / `PERSONA_MODELS` / `getPersonaModel` のプロバイダ分岐）は形骸化していたため撤去した。fact-check・取材・ステークホルダー分析など「タスク単位で Gemini を使う必然がある箇所」（`PIPELINE_MODELS` の Gemini 系）は対象外で現状維持。spec: `per-persona-model-selection`。

## ファクトチェック

- **討論インライン FC の Phase1 grounding は `gemini-2.5-flash` を採用（2026-07 に pro vs flash を A/B 検証して確定）。** pro→flash の品質劣化は実データ上ほぼ無く、pro のレイテンシ/コストを正当化できない。
- **一番大きな知見: ファクトチェックの品質はモデル差より「非決定性」が支配的。** 同一モデル・同一入力でも run 間で拾う指摘が大きく揺れる。→ 品質レバーはモデル格上げでなく**決定性・再現性の改善**（grounding 複数回の和集合/投票など）。ただし遅延・コスト増と引き換えなので別判断。
- 再検証手法: 実ターンは `topics/{id}/chapters/{id}` の `turns[]` に埋め込み（persona / `factCheck.status==='checked'` で抽出）。`checkContent(content, context)` はほぼ純関数なので同一入力で両モデル再実行して findings を突き合わせられる。currentDate は `turn.createdAt` で当時再現。claim を完全一致比較すると切り出しズレを誤計上するので目視裁定が要る。

## 討論設計の方針

- **討論後コメント（原本 `postDebateComments/0`）の「生成そのもの」を討論ライフサイクルから切り離すのが正しい方針。** 現状は `step.ts` の `persistPostDebateComments` が討論ループ終端に埋まり、`phaseStatus: running→generated` 遷移とコメント生成が不可分。目標は、討論の `generated` 完了をターン生成だけで成立させ、コメント生成を別トリガー（編集開始時・独立ボタン・別フェーズ等）へ移すこと。`post-debate-editorial-pass` spec で切り離したのは「編集パス（`editedPostDebateComments`）」であって原本生成ではない点に注意。

## spec 計画・ロードマップ

- **belief-awareness-remodel（上流）＋ debate-llm-cost-reduction（下流）** に討論効率化を分割済み。上流はペルソナ信念モデルを「固定の初期信念＋awareness（気づき）の追記」へ進化（reception＋self、検出は engagement 傾聴段階・消費は generateTurn、非破壊追記、最終信念は永続しない、既存データはクリア＝移行なし、改修前出力との一致は求めない）。下流はスコープを**プロンプトキャッシュ＋engagement 冗長削減の2軸**に縮小（30% 削減目標は撤廃、品質最優先）。キャッシュは anthropic 経路のみ、`messages` の `role:'system'` に `providerOptions.anthropic.cacheControl:{type:'ephemeral'}` を付ける（`system` 文字列渡しはキャッシュ不発）。対象は `evaluateEngagement`＋`generateTurn`。修正は persona-agent.ts / engagement.ts / step.ts の3ファイル。
- **プロンプトの見出し形式を【】から Markdown（`##`）へ統一する spec を後日作成予定**（未着手）。現状は【】が支配的慣習で一部 Markdown が併用され混在。個別ファイルでの場当たり変更でなく横断 spec でまとめて行う。それまで各 agent の見出しは【】のまま触らない。
- **type-domain-decomposition（FE＋functions 横断）を将来実施予定**（per-chapter-store-refactor 完了後）。Firestore は collection/doc 単位で分解済みなのに型ファイルが混在（FE `models/session/session.types.ts`、functions `debate.types.ts` に永続型もランタイム型も混在）。型を Firestore のドメイン分割にミラーし、`debate.types.ts` には「永続化されない討論オーケストレーションのランタイム型」だけを残す。turn は独立ファイル（`turn.types.ts`）にする決定。
