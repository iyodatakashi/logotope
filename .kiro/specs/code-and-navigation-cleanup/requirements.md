# Requirements Document

## Project Description (Input)
リファクタリングを行う。無駄なコード（未使用・重複コード）の削除と、不自然な画面遷移の改善を目的とする。

## Introduction
logotope は開発の過程で、未使用のコード・重複した実装・廃止判断済みのデータアクセス・場当たり的に追加された画面遷移が蓄積している。本仕様は、外部から見た機能を変えずにこれらの負債を解消し、コードベースの保守性と管理画面・公開画面の操作体験を改善するリファクタリングを定義する。

## Boundary Context
- **In scope**: 未使用コード・重複コードの削除/統合、廃止判断済みの `progress/{topicId}` コレクション参照の撲滅、デモ用ルートの整理、管理画面のフェーズ別URL・ステップナビゲーションへの再構築（リセット操作の分離を含む）、その他画面遷移の改善、リファクタリング後の非回帰確認
- **Out of scope**: 新機能の追加、UIの視覚的リデザイン、Firestoreスキーマの新規変更（progress 撲滅を除く）、AIパイプラインのロジック変更
- **Adjacent expectations**: `architecture-refactoring`・`firestore-collection-consolidation` スペックで実施済みの構成を前提とし、それらを巻き戻さない

## Requirements

### Requirement 1: 未使用コードの削除
**Objective:** As a 開発者, I want 未使用のコード・ファイル・ルートが削除されている状態, so that コードベースの見通しが良くなり保守コストが下がる

#### Acceptance Criteria
1. The logotope コードベース shall どこからも参照されていないコンポーネント・関数・型定義・エクスポートを含まない
2. The logotope フロントエンド shall 本番機能から到達できないデモ用ルート（`/demo`, `/demo/playwright` など）を本番ビルドに含まない
3. When 未使用コードの削除を行う, the 開発者 shall 削除対象が実際に未参照であることを検索により確認してから削除する
4. If 一見未使用だが将来の利用が明確に予定されているコードが見つかった場合, the 開発者 shall 削除せずその根拠を記録する

### Requirement 2: 廃止判断済み progress コレクション参照の撲滅
**Objective:** As a 開発者, I want 不要と判断済みの `progress/{topicId}` コレクションへの参照が完全に除去されている状態, so that 廃止済みデータモデルへの依存が残らない

#### Acceptance Criteria
1. The Firebase Functions shall `progress/{topicId}` コレクションへの読み書きを行わない
2. The logotope フロントエンド shall `progress/{topicId}` コレクションを参照する型定義・コンポーネントを含まない
3. When 進捗表示が必要な画面が progress コレクションに依存していた場合, the logotope フロントエンド shall 既存の `topics/{topicId}/sessions/0` 等の正規データソースから同等の進捗情報を取得する
4. The 討論生成パイプライン shall progress コレクション撲滅後も従来どおり進捗をユーザーに提示できる

### Requirement 3: 重複コードの統合
**Objective:** As a 開発者, I want 同一の責務を持つ重複した実装が一つに統合されている状態, so that 修正漏れによる不整合が起きない

#### Acceptance Criteria
1. The logotope コードベース shall 同一ロジックの重複実装（フォーマット処理・Firestoreアクセス・状態管理パターンなど）を単一の共有実装に統合している
2. When 重複実装を統合する, the 開発者 shall 統合後の実装が統合前の各呼び出し箇所の挙動を維持していることを確認する
3. The logotope フロントエンド shall カスタム実装より `@14ch/svelte-ui` の既存コンポーネントを優先して使用している

### Requirement 4: 管理画面のフェーズ別ナビゲーション
**Objective:** As a 管理者, I want 討論生成の各フェーズが個別のURLを持ちステップナビゲーションで行き来できる構造, so that 現在地を見失わず、過去フェーズの確認と再実行を安全に区別して行える

現状は `/admin/debate/[id]` の単一ページ内で `status` の値により表示を切り替えており、URLとフェーズが対応せず、「前のフェーズに戻る」ボタンが実際にはデータ破棄を伴うリセットを兼ねているため分かりにくい。これを一般的なステップナビゲーションに再構築する。

#### Acceptance Criteria
1. The 管理画面 shall 討論生成の各フェーズ（ステークホルダー調査・ペルソナ生成・取材・討論）をそれぞれ個別のURLで提供する
2. The 管理画面 shall 全フェーズと現在位置を示すステップナビゲーションを各フェーズページに表示する
3. When 管理者がステップナビゲーションから到達済みの過去フェーズを選択する, the 管理画面 shall データを変更せずに該当フェーズの内容を閲覧できる状態で表示する
4. If 管理者がトピックの進行状況より先のフェーズURLに直接アクセスした場合, the 管理画面 shall 現在進行中のフェーズへリダイレクトする
5. The 管理画面 shall フェーズ間の移動（閲覧）とデータ破棄を伴う再実行（リセット）を別個の操作として提供する
6. When 管理者がリセット操作を実行する, the 管理画面 shall 破棄されるデータを明示した確認ステップを提示し、承諾後にのみリセットを実行する
7. When ブラウザの戻る・進む操作が行われる, the 管理画面 shall フェーズ間を通常のページ遷移として移動しデータを破棄しない

### Requirement 5: その他の画面遷移改善
**Objective:** As a 管理者・閲覧者, I want 操作の流れに沿った自然な画面遷移, so that 迷わずに目的の操作・閲覧を完了できる

#### Acceptance Criteria
1. When 管理者がテーマを新規作成する, the 管理画面 shall 作成完了後にそのテーマの管理ページへ遷移する
2. When 未認証ユーザーが `/admin/**` にアクセスする, the 管理画面 shall ログインページへ誘導し、ログイン成功後に元のページへ戻す
3. The logotope フロントエンド shall すべての画面から論理的な親画面（一覧・ダッシュボード等）へ戻る導線を提供する
4. If 存在しないトピックIDのページにアクセスした場合, the logotope フロントエンド shall 「見つからない」旨を表示し読み込み中表示のまま放置しない
5. While ページデータの読み込み中, the logotope フロントエンド shall ローディング状態を表示し未初期化のコンテンツを露出しない
6. The logotope フロントエンド shall アプリ内の画面遷移をクライアントサイドナビゲーション（`goto` 等）で統一しフルページリロードを発生させない

### Requirement 6: 非回帰の保証
**Objective:** As a 開発者, I want リファクタリング後も既存機能が動作している確証, so that 安全に変更をリリースできる

#### Acceptance Criteria
1. When リファクタリングが完了する, the logotope コードベース shall フロントエンド・Functions 双方のビルドと型チェックを警告なく通過する
2. When リファクタリングが完了する, the logotope コードベース shall 既存のユニットテスト・E2Eテストをすべて通過する
3. The 公開画面（トップ・討論閲覧） shall リファクタリング前と同一のコンテンツ・URLで閲覧できる
4. The 管理画面 shall リファクタリング前と同一の管理操作（テーマ作成・ペルソナ承認・討論生成・公開）を実行できる
