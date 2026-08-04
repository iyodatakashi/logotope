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

- **意欲評価・気づき検出（`evaluateEngagement`）の Haiku 4.5 化は不採用（2026-08 に実データで検証）。** 単価は 68% 減（$0.0363→$0.0116/回）だが、①Haiku は score を系統的に約1点低く付ける（平均絶対差 1.00 に対し Sonnet 同士の揺れは 0.10）。閾値判定の一致率が「キューに積む/章を続ける（>=4）」で 30%（Sonnet 同士は 90%）まで落ち、キューが積まれず `quietStreak` が加算されて章が早期終了する＝討論の中身が痩せる。②気づきの検出数が約半分（Sonnet 19〜23/40 に対し Haiku 11/40）で、検出できた分も「改めて〜」など プロンプトが null にせよと指示した再認識を出す。気づきは討論と所感の主軸なので、この劣化は単価差で正当化できない。再検証は `functions/src/pipeline/debate/verify-engagement-model.ts`（本番の `evaluateEngagement` をモデルだけ差し替えて呼ぶ／Sonnet 2回でノイズ床を取る設計）。
- **意欲評価の実測単価は1回 $0.0201（Sonnet 5・標準価格・キャッシュが温まった状態）。** 討論1本の意欲評価は（ペルソナ数−1）×ターン数で、11人・98ターンの実例では 980 回＝**$20 前後**。トピック総額はこれを含めて $25 前後。
- **プロンプトキャッシュは正常に効いている（ヒット時 system 6,500 tok を全読み・書き込み 0）。TTL 切れも起きていない**（本番のターン間隔は中央値 60〜73秒、5分超は全トピックで 0%。`verify-engagement-model.ts` を `--topic` なしで実行すると出る）。**キャッシュはコスト削減の余地ではない。**
- **単価の内訳（実測・`--awareness-ratio 0` で偏りを外した16件平均）。** ユーザーメッセージ 5,071 tok が単価の8割で、system 側は既にキャッシュで 1/10。ユーザーメッセージの中身はほぼ3等分: 会話（直近8発言）31% / 蓄積された気づき 30% / 固定の指示文 27% / 論点 5% / 自分の直近発言5件 5% / 参加者一覧 1%。**固定の指示文（1,501字・毎回同一）と気づきは、可変の会話より後ろに置かれているため原理的にキャッシュできない**（キャッシュはプレフィックス一致）。この2つをキャッシュされるプレフィックス側へ移すと、情報を1文字も落とさずに安くなる。ただし配置変更は recency を変えるので A/B が要る。
- **気づきセクションは会話より前へ出し、独立したキャッシュ区切りを打つ（`cached-prefix` 配置・2026-08 採用）。** 気づきはターンごとには変わらず稀に1件増えるだけなので、増えた回だけ書き直しで済み、他の回は 1/10 単価で読める。30地点の A/B で、閾値判定（発言 >=3 / キュー >=4 / 章継続 >=4）はすべて 100% 一致（同一条件を2回走らせたノイズ床は 96.7%）、score 平均絶対差 0.03（床 0.07）、mode・intentSummary 100%、気づきの検出数も同一条件の揺れの範囲内で**劣化なし**。単価は $0.0208 → $0.0171（キャッシュが温まった状態、−18%）。気づきが増えた回は書き直しになるため実効は −12% 前後。旧配置（`inline`）は A/B の比較基準として `EngagementPromptLayout` に残してあり、本番では使わない。
- **score/mode の判定基準（923字）をキャッシュ側へ出す案（`cached-rubric`）は不採用（2026-08 検証）。** 削減は 9%（$0.01724→$0.01562）にとどまる一方、キューに積む/章を続ける判定の一致率が 90% とノイズ床（96.7%）を下回り、score 平均絶対差も 0.10（床 0.03）に増える。気づきの再現も 15/19 と baseline の 17〜18 を下回った。判定基準には「同意だけの発言しか浮かばないなら score を下げる」など、生成直前にあることで効いていた指示が含まれる。**固定文のうち「気づき検出ブロック」（573字）は生成直前が前提のため、そもそも動かさない。** 再検証は `--compare rubric`。
- **意欲評価の会話整形からペルソナ ID を落とした（2026-08 採用）。** `formatTurns` は各行を `[名前(役割)(ID:nanoid)]:` と整形するが、意欲評価が返すのは score/mode/intentSummary/awareness だけでペルソナ ID を出力しない（発言生成は `targetPersonaId` を返すが、対応表を【参加者一覧】として別に渡している）。1行26字 × 13行を毎回送っていた。30地点の A/B で質はノイズ床と同等以上（キュー/章継続 96.7% > 床 93.3%、本番で気づきが出た19地点の再現は 19/19 で ID 付き 17/19 を上回る）、単価は $0.01727 → $0.01665。`formatTurns` の既定は ID 付きのまま（発言生成の指名精度に影響させないため、意欲評価だけ `includePersonaIds: false`）。編集工程は独自の `formatTurnsWithIds` を使うので無関係。
- **「ID 表記が気づきの sourceTurnId を誤らせている」という疑いは、実測ではほぼ外れだった。** 序数の突合で気づきを破棄した件数は 90 呼び出し中 1 件のみ。気づき再現の差（17→19）は破棄由来ではなく揺れの範囲と見るべき。破棄は `console.warn` と `onAwarenessDropped` で可視化したので、今後は疑わずに数えられる。
- **全 LLM 呼び出しの使用量は `llm/usage-recorder.ts` が記録している。** `wrapLanguageModel` の middleware（`usageRecorder`）を `models.ts` の2箇所（sonnet / getPipelineModel の Gemini）と、provider から直に解決している3箇所（`withUsageRecording`：取材・事実調査・FC grounding）に挟んである。工程名は `llmTask('<工程>', fn)` で各エージェント関数を包んで付ける（AsyncLocalStorage なので `Promise.all` の並列でも正しく付く）。`[llm-usage]` の構造化ログ1行/生成で、ツールを回す発言生成はステップ数だけ発火する＝実コストがそのまま出る。集計の jq 例はファイル冒頭のコメント。**工程別コストを推測で語る前にこれを見ること。**
- **単価まわりで残っている手は「回数」だけ。** 意欲評価は（ペルソナ数−1）×ターン数で決まり、11人・98ターンで 980 回。単価はキャッシュ配置で $0.0208→$0.0171 まで下げ済みで、これ以上の配置変更は挙動が動く（上記）。中身を削る案（会話8→5発言など）は情報が減るため、質とのトレードオフになる。
- **検証ハーネスの落とし穴（再実行時に注意）。** Firestore から読める `persona.awarenesses` は討論**終了時点**の全件。過去ターンの再現でそのまま渡すと未来の気づきを見せることになり、プロンプトが実際より 34% 大きく出る（実測 7,439字 → 時点で切ると 5,546字）。`verify-engagement-model.ts` は `triggeredByTurnId` の全章通し順で時点フィルタしている。

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
