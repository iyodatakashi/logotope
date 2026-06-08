# Requirements Document

## Introduction
logotope 管理画面の UX 改善と、それを支えるバックエンドの整理。AIパイプラインの各フェーズ（ステークホルダー調査・ペルソナ生成・取材・討論生成）を順番に動かして検証できるシステムを作る。

## Boundary Context
- **In scope**: 管理画面ページ・各フェーズ画面・フェーズ別リセット API・進捗トラッキング設計・バックエンド共通ユーティリティ整理
- **Out of scope**: 公開閲覧ページ・Firebase Data Connect スキーマ変更
- **Adjacent expectations**: 既存ユニットテストがすべてパスし続けること

---

## Requirements

### 1. フェーズ0：トピック作成

**Objective:** 管理者として、討論テーマを入力して作成したい。

#### Acceptance Criteria
1. The logotope Admin shall トピック名入力欄と「作成する」ボタンを表示する
2. If トピック名が空欄または500文字超の場合, the logotope Admin shall バリデーションエラーを表示してボタンを無効化する
3. When トピックが作成された場合, the logotope Admin shall `/admin/topics/[id]` へ遷移する

---

### 2. 全フェーズ共通の画面構造

**Objective:** 管理者として、どのフェーズでも「今何が起きているか」を一貫した構造で把握したい。

#### Acceptance Criteria
1. The logotope Admin shall 各フェーズ画面が「処理中」「結果表示」「エラー」の3状態を持ち、Firestore `debate_progress/{topicId}` の `status` フィールドのリアルタイム購読値に基づいて状態を切り替える
2. When フェーズ画面がマウントされた場合, the logotope Admin shall 対応する AI 処理 API を自動的に呼び出して処理を開始する（ユーザーの手動操作は不要）
3. While 処理が進行中の場合, the logotope Admin shall 処理中メッセージとスピナーを表示する。「次のフェーズへ進む」ボタンは表示しない
4. When 処理が完了した場合, the logotope Admin shall 生成結果と「次のフェーズへ進む」ボタンを表示する
5. When API がエラーを返した場合, the logotope Admin shall エラーメッセージを表示する
6. The logotope Admin shall フェーズ2〜4の全状態（処理中・結果表示・エラー）で「前のフェーズに戻る」ボタンを常に表示する。フェーズ1には表示しない
7. When Firestore の `status` が変化した場合, the logotope Admin shall API レスポンスの完了を待たずに即座に対応するフェーズ画面へ切り替わる
8. The logotope Admin shall `actionLoading` フラグや `topic.status`（API取得値）をフェーズ表示の判定に使用しない

---

### 3. 各フェーズの結果表示内容

**Objective:** 管理者として、各フェーズの生成結果を確認したい。

#### Acceptance Criteria
1. The logotope Admin shall フェーズ1の結果表示でステークホルダー一覧（立場・スタンス・マイノリティ度・理由）を表示する
2. The logotope Admin shall フェーズ2の結果表示でペルソナ一覧（名前・年齢・職業・立場・スタンス・背景）を表示する
3. The logotope Admin shall フェーズ3の処理中画面でペルソナ別の取材状態（完了 / 取材中 / エラー）と全体進捗「N人中M人完了」を表示する。結果表示でペルソナ別の取材レコードと初期信念ドキュメントを折りたたみ展開で表示する
4. The logotope Admin shall フェーズ4の処理中画面で現在発言中のエージェント名とターン数進捗を表示する。結果表示で討論全文（発言者・立場・本文・信念変化マーカー）と討論後コメントを表示する
5. The logotope Admin shall フェーズ4の結果表示に「次のフェーズへ進む」の代わりに「公開する」ボタンを表示する

---

### 4. 前のフェーズに戻る

**Objective:** 管理者として、現フェーズ以降のデータをすべてクリアして前フェーズの結果表示に戻りたい。

#### Acceptance Criteria
1. When 「フェーズ1に戻る」が実行された場合, the logotope Functions shall ペルソナ・取材レコード・信念ドキュメント・討論セッション・ターン・コメントを削除し、Firestore 進捗ドキュメントをクリアして、ステータスを `surveying` に更新する
2. When 「フェーズ2に戻る」が実行された場合, the logotope Functions shall 取材レコード・信念ドキュメント・討論セッション・ターン・コメントを削除し、Firestore 進捗ドキュメントをクリアして、ステータスを `generating_personas` に更新する
3. When 「フェーズ3に戻る」が実行された場合, the logotope Functions shall 討論セッション・ターン・コメントを削除し、Firestore 進捗ドキュメントをクリアして、ステータスを `interviewing` に更新する
4. When リセット後に前フェーズ画面が表示された場合, the logotope Admin shall そのフェーズの結果表示状態（生成済みデータ一覧と「次のフェーズへ進む」ボタン）を表示する
5. If リセット対象データが存在しない場合, the logotope Functions shall エラーを返さずステータスのみ更新して完了とする

---

### 5. エラーと進捗の状態管理

**Objective:** 開発者として、Firestore にエラーを書き込む設計を廃止し、エラー情報が画面に残り続ける問題を根本から解消したい。

#### Acceptance Criteria
1. The logotope Functions shall Firestore 進捗ドキュメントに書き込むフィールドを `status`・`currentStep`・`completed`・`total`・`updatedAt` のみとする。`error` フィールドは書き込まない
2. The logotope Functions shall `ProgressTrackerService` から `setError` メソッドを削除する
3. The logotope Functions shall AI処理でエラーが発生した場合、エラーを Firestore に書き込まず、呼び出し元に `throw` して API レスポンスのエラーとして返す
4. The logotope Admin shall エラー表示を API 呼び出しの catch ブロックで受け取った例外メッセージのみから行う
5. When 新しい処理が開始された場合, the logotope Functions shall `ProgressTrackerService.updateStatus` が `currentStep`・`completed`・`total` をリセットした値で上書きする

---

### 6. バックエンドコード品質

**Objective:** 開発者として、コードの重複・密結合・散在した AI 設定を整理したい。

#### Acceptance Criteria
1. The logotope Functions shall `formatHistory` 関数を `functions/src/utils/` に集約し、`facilitator-agent.ts` と `persona-agent.ts` の重複実装を削除する
2. The logotope Functions shall AI モデル名と `max_tokens` を `functions/src/config/ai.ts` に集約し、各サービスが文字列リテラルを直接持たない形にする
3. The logotope Functions shall `FacilitatorAgentService`・`PersonaAgentService` のコンストラクタが `Anthropic` クライアントを省略可能な引数として受け取れるようにする
4. The logotope Functions shall `StakeholderAnalyzerService`・`PersonaGeneratorService`・`InterviewerService` のコンストラクタが `ProgressTrackerService` を省略可能な引数として受け取れるようにする
5. The logotope Functions shall 各 API ハンドラーの認証チェックを共通ヘルパーに集約する
6. When 既存のユニットテストスイートが実行された場合, the logotope Functions shall すべてのテストがパスする
