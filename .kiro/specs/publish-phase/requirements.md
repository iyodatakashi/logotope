# Requirements Document

## Introduction

編集フェーズの後に新しい「公開(publish)」フェーズを追加し、それに伴って StepNav の完了状態表示のねじれを解消する。

現状、トピックは単一の `(phase, phaseStatus)` カーソルだけを持ち、フェーズの完了は「`phase` が次へ前進したこと」で暗黙的に表現している。最終フェーズ「編集(editing)」には次がないため、編集が完了しても `phase` が `editing` のまま動かず、StepNav の「編集」ステップが永遠に current 表示のまま completed（チェック）にならない。

本仕様では、編集を最終フェーズから外して後ろに「公開」フェーズを新設する。これにより編集の完了は他の中間フェーズと同じ「承認して次へ前進」で表せるようになり、StepNav の最終フェーズだけの特別扱い（場当たり対応）を不要にする。あわせて、公開状態を明示的な `published` フラグでモデル化し、公開画面（公開 ON/OFF と最終成果物プレビュー）を追加する。

## Boundary Context

- **In scope**:
  - トピックへの `published: boolean` フラグ追加（FE/BE 両型）
  - フェーズ `publish` の追加（`editing` の直後、FE/BE 両定義で順序・値集合を一致）
  - 編集画面の「次に進む」による編集承認と `publish` フェーズへの前進
  - 公開画面（新ルート）：公開 ON/OFF スイッチ
  - StepNav の完了判定の是正（`progress` をステップキーで指定し、フェーズ完了状態を反映）
  - 公開中のコンテンツ変更操作のロック（閲覧は許可。公開コンテンツの完全性保護）
  - 既存の `publishedAt != null` による公開判定箇所の `published` フラグへの寄せ替え
- **Out of scope**:
  - 公開画面上での最終成果物プレビュー表示（公開閲覧ページの作成と重複するため、本仕様では扱わない）
  - `phaseStatus` のセマンティクス変更（公開 ON/OFF を `generated`/`not_started` に載せ替えない）
  - 各フェーズ画面内の再生成・編集操作そのものの仕様変更（ロックは遷移レベルで行い、画面内の操作は変えない）
- **Adjacent expectations**:
  - フェーズ定義は FE(`src/lib/models/phase/`) と BE(`functions/src/types/phase.types.ts`) の値集合・順序を一致させる既存規約に従う
  - 公開閲覧トップ（`src/routes/+page.svelte`）は「公開済みトピックのみ一覧表示」する既存挙動を維持する

## Requirements

### Requirement 1: 公開状態の明示的モデル化

**Objective:** 管理者として、公開状態を日時の有無に依存しない明示的なフラグで扱いたい。公開/非公開の真偽を一意に判定でき、公開日時（`publishedAt`）とは役割を分離できるようにするため。

#### Acceptance Criteria

1. The Topic モデル shall 公開状態を表す真偽値フィールド `published` をフロントエンド型（`Topic` / `TopicForFirestore`）とバックエンド型の両方に持つ。
2. The logotope shall トピックの公開/非公開の判定を、`publishedAt` の有無ではなく `published` フラグで行う。
3. When トピックが公開される、the logotope shall `published` を `true` にし、`publishedAt` にその時点の日時を記録する。
4. When トピックが非公開に戻される、the logotope shall `published` を `false` にし、`publishedAt`（最後に公開した日時の記録）は消さずに保持する。
5. The `publishedAt` shall 「公開日時の記録」の用途に限って使用され、公開状態の判定には使用されない。

### Requirement 2: 公開フェーズの追加とフェーズ定義の整合

**Objective:** 管理者として、編集の後に「公開」という独立したフェーズを持ちたい。編集フェーズを最終フェーズから外し、編集の完了を通常の前進で表せるようにするため。

#### Acceptance Criteria

1. The logotope shall フェーズ `publish` を、フェーズ進行順で `editing` の直後（末尾）に持つ。
2. The logotope shall フェーズの値集合と順序を、フロントエンド定義（`PHASE_DEFS` / `PhaseSlug`）とバックエンド定義（`functions/src/types/phase.types.ts`）の両方で一致させる。
3. Where `publish` フェーズが定義される、the logotope shall そのステップ名・状態別ラベル等の表示情報を既存フェーズと同じ枠組みで提供する。
4. The `editing` フェーズ shall 最終フェーズではなくなり、`publish` フェーズを次フェーズとして持つ。

### Requirement 3: 編集フェーズからの前進

**Objective:** 管理者として、編集画面で「次に進む」を押して編集を確定し公開フェーズへ進みたい。他の中間フェーズと同じ操作で編集を完了扱いにするため。

#### Acceptance Criteria

1. While 編集が完了状態（`phaseStatus` が `generated`）である、the 編集画面 shall 「次に進む」操作を活性化する。
2. When 編集画面で「次に進む」が実行される、the logotope shall 編集を承認して `phase` を `publish` へ前進させる。
3. When 編集が `publish` へ前進する、the logotope shall 前進後の `phaseStatus` を `not_started` にする。
4. When 編集の承認が完了する、the 管理アプリ shall 公開画面へ遷移する。
5. If 編集の承認処理が失敗する、then the 編集画面 shall エラーを表示し、フェーズを前進させない。

### Requirement 4: 公開画面

**Objective:** 管理者として、公開フェーズ用の画面で公開のON/OFFを切り替えたい。公開状態を制御するため。

#### Acceptance Criteria

1. Where `publish` フェーズが選択されている、the 管理アプリ shall 公開画面（新ルート）を表示する。
2. The 公開画面 shall 公開 ON/OFF を切り替えるスイッチを表示する。
3. When 公開スイッチが ON に切り替えられる、the logotope shall そのトピックを公開状態（`published = true`）にする。
4. When 公開スイッチが OFF に切り替えられる、the logotope shall そのトピックを非公開状態（`published = false`）にする。
5. While トピックが公開状態である、the 公開画面 shall スイッチを ON（公開中）として表示する。
6. While トピックが非公開状態である、the 公開画面 shall スイッチを OFF（非公開）として表示する。

### Requirement 5: StepNav の完了状態表示の是正

**Objective:** 管理者として、StepNav 上で完了したフェーズが正しく完了（チェック）表示されてほしい。とりわけ編集フェーズ完了後や公開後に、進捗が正しく可視化されるため。

#### Acceptance Criteria

1. The StepNav shall 各ステップの完了状態を、`currentPhase` の位置だけでなくフェーズの完了状態を反映して判定する。
2. The StepNav shall `progress` を、到達済みの最遠ステップのキー（ステップの `value`／phase キー）で指定し、可変な配列インデックスを外部参照キーとして用いない。
3. While 編集フェーズが完了して `publish` フェーズへ前進している、the StepNav shall 「編集」ステップを完了（チェック）表示にする。
4. Where 対象ステップが theme〜編集のいずれかである、the StepNav shall そのステップの完了を `phaseLogicalState`（`approved` または `generated`）で判定する。
5. While トピックが公開状態（`published = true`）である、the StepNav shall 「公開」ステップを完了（チェック）表示にする。
6. While トピックが非公開状態（`published = false`）である、the StepNav shall 「公開」ステップを未完了（current／upcoming）表示にする。
7. The StepNav shall 公開 ON/OFF を `phaseStatus` の `generated`/`not_started` に載せ替えず、`published` フラグを直接参照して公開ステップの完了を判定する。

### Requirement 6: 公開判定の単一真実化

**Objective:** 開発者として、アプリ全体で公開判定を単一の真実（`published`）に統一したい。判定源が `publishedAt` の有無と二重化して不整合が生じるのを防ぐため。

#### Acceptance Criteria

1. The 公開閲覧トップ（`src/routes/+page.svelte`） shall 一覧に表示するトピックの絞り込みを `published` フラグで行う。
2. The トピック一覧アイテム（`TopicListItem.svelte`） shall 公開/非公開の表示分岐を `published` フラグで行い、`publishedAt` は日時表示にのみ用いる。
3. The logotope shall 公開状態の判定に `publishedAt != null` を使用している既存箇所を残さない（すべて `published` フラグに寄せ替える）。

### Requirement 7: 既存トピックの後方互換

**Objective:** 管理者として、`published` フラグ導入前から存在するトピックが破綻なく扱われてほしい。フラグ未設定の既存データで公開判定や表示が壊れないようにするため。

#### Acceptance Criteria

1. If トピックの `published` フィールドが存在しない（未設定である）、then the logotope shall そのトピックを非公開（`published = false` 相当）として扱う。
2. While 既存トピックの `published` が未設定である、the StepNav および公開閲覧トップ shall エラーを起こさず未公開として一貫した表示を行う。

### Requirement 8: 公開中のコンテンツ凍結

**Objective:** 管理者として、公開中はコンテンツを変更する操作ができないようにしたい。再生成は旧データを処理開始時に即時削除するため、公開中に変更操作をすると公開コンテンツが空の状態で一般公開されてしまうのを防ぐため。閲覧は引き続きできること。

#### Acceptance Criteria

1. While トピックが公開状態（`published = true`）である、the 管理アプリ shall 到達済みフェーズ画面への遷移と閲覧を従来どおり許可する。
2. While トピックが公開状態である、the 各フェーズ画面 shall コンテンツを変更する操作（生成・再生成・編集・並べ替え・追加削除・タイトル編集等）を不活性化する。
3. While トピックが非公開状態である、the 各フェーズ画面 shall 変更操作を従来どおり許可する。
