# Requirements Document

## Project Description (Input)
コード全体のリファクタリング

## Introduction

logotope のコードベース全体（フロントエンド `src/` と Firebase Functions `functions/src/`）を、steering（`.kiro/steering/`）に定めた規約・設計原則に整合させるリファクタリングを行う。

本リファクタリングは外部から観測可能な挙動を一切変えない。目的は、規約違反（命名・関数記法・型の置き場所・関数の並び順・スタイル記法・テスト配置）の解消、重複コード・デッドコードの削減、および責務配置の一貫性回復であり、機能追加・仕様変更は含まない。

あわせて、コード全体を読む機会を活かし、仕様面の不備・不整合（実装間の矛盾、明白なバグ、解釈が分かれるエッジケース）を検出して報告する。挙動変更を伴うため修正自体は本仕様の範囲外とし、報告をもって後続の意思決定（別 spec 化・個別修正）につなげる。なお、steering 等のドキュメントが古いだけの乖離は仕様不備として扱わない（コードを正とする）。

## Boundary Context

- **In scope**: `src/` と `functions/src/` の既存コードの内部品質改善（命名、関数記法、型・ロジックの置き場所、関数の並び順、CSS 記法、テスト配置、重複・デッドコードの整理）。リファクタリング後の検証（型チェック・lint・テスト・ビルド）。リファクタリング過程で発見した仕様面の不備・不整合の記録と報告。章ファクトチェック機能の削除（Requirement 8）と討論チェーンの世代照合の導入（Requirement 9）— いずれもユーザー決定による挙動変更の例外。
- **Out of scope**: 機能追加・挙動変更・UI/UX 変更（章FC削除と討論チェーン世代照合を除く）。発見した仕様不備・バグの修正（報告まで。修正は挙動変更を伴うため本 spec では行わない）。Firestore スキーマ・セキュリティルールの変更（章FC削除に伴う factCheck ルール削除を除く）。プロンプト見出しの【】→ Markdown 統一（別 spec として計画済み）。型のドメイン分割再構成および `*Doc` → `*ForFirestore` の一括移行（type-domain-decomposition / chapter-type-unification として別途計画済み）。依存ライブラリの更新（ただし日付整形統一のための dayjs 新規導入は in scope）。
- **Adjacent expectations**: 別途計画済みの型再構成 spec・プロンプト統一 spec と作業範囲が重ならないよう、本 spec では型の「置き場所」の是正（models / types への配置）までを扱い、型の分割・改名は扱わない。

## Requirements

### Requirement 1: 挙動の保全

**Objective:** As a 運用者, I want リファクタリングの前後で外部から観測可能な挙動が変わらないこと, so that 公開ページ・管理画面・AI パイプラインの動作を維持したまま内部品質だけを改善できる

#### Acceptance Criteria

1. The リファクタリング作業 shall 明示的な例外（Requirement 8: 章FC削除、Requirement 9: 世代照合）を除き、公開ページ・管理画面の表示・操作、Firebase Functions の入出力、および Firestore に永続されるデータの形を変更しない。
2. When リファクタリングの各単位が完了する, the リファクタリング作業 shall 既存のユニットテストがすべて成功することを確認する。
3. If 既存テストの修正が必要になる場合, the リファクタリング作業 shall その修正をインポートパス・識別子名の追従、および明示的な例外（Requirement 8・9）への追従に限定し、それ以外でテストが検証する振る舞いを変更しない。
4. The リファクタリング作業 shall 明示的な例外（Requirement 8・9）を除き、機能追加・仕様変更・パフォーマンス目的の書き換えを含まない。

### Requirement 2: コーディング規約への準拠

**Objective:** As a 開発者, I want コード全体が tech.md のコーディング規約に一致していること, so that どのファイルを開いても同じ書き方で読め、レビュー・修正のコストが下がる

#### Acceptance Criteria

1. The コードベース shall 理由のある例外を除き、関数をアロー関数（`const foo = () => {}`）で定義する。
2. The コードベース shall 省略された変数名・引数名（例: `ts`、`t`、`d`、`def`）を持たず、意味の伝わる名前を使用する。
3. The コードベース shall `any` 型を使用せず、型が判明しない箇所では `unknown` とナローイングを使用する。
4. The コードベース shall TypeScript strict mode の型チェックをエラーなしで通過する。

### Requirement 3: コード配置と責務の一貫性

**Objective:** As a 開発者, I want ロジック・型がプロジェクトの配置原則どおりの場所にあること, so that 「どこに何があるか」を構造から予測でき、変更箇所を探すコストが下がる

#### Acceptance Criteria

1. The フロントエンド shall Firestore への読み書きおよび Cloud Functions 呼び出し（httpsCallable）を、その操作が属するエンティティの状態管理ファイル（`src/lib/stores/` のシングルトンストア、または `src/lib/models/` の createXXX インスタンス）に置き、UI コンポーネントから直接呼び出さない。シングルトンかインスタンスかは操作の性質（コレクション横断か、特定インスタンス固有か）で決める。
2. The フロントエンド shall フロントエンドの型定義を `src/lib/models/` 配下に置き、Functions 側の型定義を `functions/src/types/` 配下に置く。
3. The フロントエンド shall UI 操作のオーケストレーション（画面遷移・画面アクション）を `models/` 配下に置かず、feature・コンポーネントの近くに置く。
4. The コードベース shall ファイル内の関数を「呼び出し元が先、呼び出し先が後」のトップダウン順に並べ、Firestore ヘルパー・インフラ層の関数をファイル末尾にまとめる。
5. The `*.types.ts` ファイル shall 型定義と型ガードのみを含み、変換関数を含まない。

### Requirement 4: 過度な共通化の解消と重複・デッドコードの削減

**Objective:** As a 開発者, I want 不要なコードと不適切な抽象が取り除かれていること, so that 1画面の調整が他画面に波及せず、読む必要のないコードが残らない

#### Acceptance Criteria

1. When 複数画面の分岐を吸収している共通コンポーネント・中央ディスパッチャが見つかる, the リファクタリング作業 shall structure.md の基準（「この共通物を変えると意図しない他画面に影響するか」）に照らして判定し、該当する場合は各画面へ分解する。
2. The コードベース shall どこからも参照されていないエクスポート・ファイル・コンポーネントを含まない。
3. The リファクタリング作業 shall 画面に依存しない真に共通な処理に限りヘルパー関数への集約を行い、画面依存の重複は共通化せず許容する。
4. The コードベース shall 日付の整形処理を dayjs に統一し、`getFullYear()` 等による手書きの文字列組み立てや `toLocaleDateString` を日付整形に使用しない。
5. When 日付整形を dayjs へ置き換える, the リファクタリング作業 shall 置き換え前後で出力される文字列を同一に保つ。

### Requirement 5: スタイル記法の統一

**Objective:** As a 開発者, I want コンポーネントの CSS が BEM 記法に統一されていること, so that クラス名からコンポーネントと構造を特定できる

#### Acceptance Criteria

1. The Svelte コンポーネント shall クラス名を BEM 記法（Block・Element `__`・Modifier `--`）で記述する。
2. The Svelte コンポーネント shall Block 名をコンポーネントの PascalCase 名を kebab-case に変換した名前とする。
3. The `+page.svelte` / `+layout.svelte` shall 場所を表す接頭辞 + `-page` / `-layout` 形式の Block 名を持つ。

### Requirement 6: テスト配置規約への準拠

**Objective:** As a 開発者, I want テストファイルが testing.md の配置・命名規約に一致していること, so that ソースとテストの対応が構造から分かる

#### Acceptance Criteria

1. The テストファイル shall ソースと同一ディレクトリに置かれず、`src/tests/`・`functions/src/tests/` 配下にソース構造をミラーして配置される。
2. The テストファイル shall 種別に応じた命名（`*.test.ts`・`*.svelte.spec.ts`・`*.integration.test.ts`）に従う。
3. The フロントエンドのテスト shall インポートに `$lib/` エイリアスを使用し、相対パスを使用しない。

### Requirement 7: 仕様面の不備・不整合の検出と報告

**Objective:** As a 運用者, I want リファクタリング過程で見つかった仕様面の不備・不整合が漏れなく記録・報告されること, so that 挙動を変えずにリファクタリングを進めつつ、仕様課題を後続の意思決定（別 spec 化・個別修正）につなげられる

#### Acceptance Criteria

1. When 同一の概念・データに対して画面間・モジュール間で矛盾する扱い（不整合な条件分岐・重複した真実の源・食い違う表示や判定）を発見する, the リファクタリング作業 shall それを仕様不整合として該当箇所とともに記録する。
2. When 仕様の意図に明白に反する実装（バグ）や、未定義のまま実装ごとに解釈が分かれているエッジケースを発見する, the リファクタリング作業 shall それを記録する。
3. When リファクタリング全体が完了する, the リファクタリング作業 shall 記録した仕様不備・不整合を一覧レポートとして提示する。
4. The リファクタリング作業 shall 記録した仕様不備・不整合に対する挙動変更を伴う修正を本仕様の範囲では行わず、対応方針の判断をユーザーに委ねる。
5. The リファクタリング作業 shall steering・仕様書ドキュメント自体の陳腐化（実装は正しくドキュメントが古いだけの乖離）を仕様不備として扱わず、報告対象としない。

### Requirement 8: 章ファクトチェック機能の削除

**Objective:** As a 運用者, I want 章単位ファクトチェック機能が削除されること, so that 発言の正確性担保がインラインファクトチェック（生成時のその場修正）に一本化され、指摘の真実源が分裂しない

インラインFC（発言生成時の検証・その場修正・`turn.factCheck` 埋め込み）で正確性は十分担保されており、章FC（管理者実行の事後一括検証・別ドキュメントへの指摘記録）は不要とのユーザー判断による。機能削除のため挙動変更を伴うが、本 spec の例外として明示的に in scope とする。

#### Acceptance Criteria

1. The コードベース shall 章単位ファクトチェックの実行経路（`runFactCheck` / `runFactCheckTask` エンドポイント、`checkChapter`・`checkTurn`、結果ドキュメント `chapters/{id}/factCheck/result` へのリポジトリ）を含まない。
2. The 管理画面 shall 章ファクトチェックの実行 UI・結果表示（factCheck ストア、FactCheckFindings 表示、編集画面での章FC指摘の突合表示）を含まない。
3. The リファクタリング作業 shall インラインファクトチェック（`checkContent`・correction-worthiness 判定・`verifyAndReviseDraft`・`turn.factCheck` 埋め込み・編集の保護判定）の挙動を変更しない。
4. The リファクタリング作業 shall 削除により不要となる `firestore.rules` の factCheck ルールを削除する（セキュリティルール変更禁止の例外）。
5. If 既存トピックに保存済みの章FC結果ドキュメントが存在する, the リファクタリング作業 shall その一括データ削除を行わない（コード削除のみ。残存データは参照されなくなる）。

### Requirement 9: 討論チェーンの世代照合（旧世代ゾンビチェーンの解消）

**Objective:** As a 運用者, I want 討論の restart 後に旧世代のタスクチェーンが即座に停止すること, so that 破棄される結果のための LLM 実行コストが発生せず、旧世代タスクが新世代の章状態へ副作用を与えない

restart 中に飛行していた旧世代タスクが「フル LLM 実行 → トランザクション棄却 → 再エンキュー」を章完了まで繰り返す問題（chain-structure-findings A-1）の解消。挙動変更を伴うが、ユーザー決定により本 spec の例外として in scope とする。

#### Acceptance Criteria

1. When Cloud Tasks から討論ステップ（open / turn / summary / closing / comments）が起動される, the 討論パイプライン shall タスクの runId をトピックの現行 runId と照合し、不一致の場合は LLM 呼び出し・状態変更・再エンキューのいずれも行わず終了する。
2. When ターン追記が世代不一致（generation_mismatch）で棄却される, the 討論パイプライン shall その棄却理由を呼び出し元まで伝播し、当該チェーンを resume しない。
3. When ターン追記が並走敗者（index_mismatch）で棄却される, the 討論パイプライン shall 従来どおり最新状態から次ステップを再導出して継続する。
4. The 討論パイプライン shall 本変更において、単一世代内の正常なターン生成・章完了・コメント生成・早期終了の挙動を変更しない。

### Requirement 10: リファクタリング完了の検証

**Objective:** As a 運用者, I want リファクタリング全体の完了が機械的に検証できること, so that 規約準拠と挙動保全を主観に頼らず確認できる

#### Acceptance Criteria

1. When リファクタリング全体が完了する, the コードベース shall 型チェック・ESLint・Prettier チェックをエラーなしで通過する。
2. When リファクタリング全体が完了する, the コードベース shall フロントエンドのビルドと Functions のビルドの両方に成功する。
3. When リファクタリング全体が完了する, the コードベース shall 既存のユニットテストすべてに成功する。
