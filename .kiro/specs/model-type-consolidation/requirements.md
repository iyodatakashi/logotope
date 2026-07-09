# Requirements Document

## Introduction

フロント（`src/lib/models` を中心に、`stores` / `features` との境界を含む）**および functions（`functions/src/types`）**の型定義を、直近の turn/chapter 系整理で確立した方針に沿って網羅的に整える。同一ドメインの型が複数ファイルに散在・重複・死蔵し、ドメイン/永続型を表示用に加工した「似て非なる型」が混入している状態を解消し、各型の責務境界（ドメイン/永続型は intrinsic な値＋id 参照のみ、表示派生は描画時に解決）をそろえる。さらに、同一概念の型は FE と functions で同じ考え方で責務境界をそろえる。

本作業は**純粋な型の配置・重複・責務の整理**であり、型の意味・データ形・UI 出力・生成/永続の挙動は変えない。turn 系（`Turn` / `EditedTurn` / `TurnForEditing` を `turn.types.ts` に集約、`DisplayTurn` 廃止）と chapter 系（`EditedChapter*` を `chapter.types.ts` に集約）は本方針の適用例として既に着手済みで、これを FE の models 全体および functions の types 全体へ拡張する。

## Boundary Context

- **In scope**: `src/lib/models` 配下のフロント型定義の集約・重複除去・死型削除・責務境界の統一。`stores` / `features` 境界で型に畳み込まれた表示派生（ラベル解決・JOIN・差分算出）の描画時解決化。コンポーネント（`.svelte`）内に独自定義されたデータ型の `models` への一元化。**functions（`functions/src/types`）の型定義**への同一方針（集約・重複除去・死型削除・責務境界の統一）の適用と、同一概念の FE/functions 整合。
- **Out of scope**: 型の意味・データ形・UI 出力・生成/永続の挙動の変更。新機能。Firestore へ実際に書き込む永続形（`*ForFirestore`）の**構造**の変更（`*ForFirestore` の役割・命名は維持。配置や重複整理は対象）。
- **Adjacent expectations**: フロントと functions の永続型一致方針は従来どおり。表示（render）は FE のみの概念で、functions には「描画時解決」を適用しない（不要な派生を型に畳まない責務境界のみ適用）。steering `structure.md`「`models/` はドメインデータ・永続化に限る／過度な共通化をしない」に準拠する。

## Requirements

### Requirement 1: 対象の網羅的な棚卸し
**Objective:** 開発者として、整理対象を漏れなく把握したい。網羅的に適用し、見落としをなくすため。

#### Acceptance Criteria
1. The 型整理作業 shall `src/lib/models` 配下の全型ファイル、`stores` / `features` で構築される表示用の型派生（`.map` / `$derived` によるオブジェクト組み立て）、および `functions/src/types` 配下の全型ファイルを走査し、対象候補を一覧化する。
2. The 型整理作業 shall 各候補を「散在→集約」「表示用もどき型」「重複→一本化」「死型→削除」「責務境界違反」のいずれかに分類して提示する。
3. If ある型・型ファイル・フォルダの参照が存在しない, then the 型整理作業 shall それを死型候補として記録する。
4. The 型整理作業 shall 各候補について、整理対象か「正当な派生（doc id / マップキーの materialize、Timestamp→Date の実差）」かの判定根拠を添える。

### Requirement 2: 同一ドメイン型の集約
**Objective:** 開発者として、同一ドメインの型を1つの凝集した型ファイルにまとめたい。探索性と一貫性を高めるため。

#### Acceptance Criteria
1. The モデル型定義 shall 同一ドメイン概念の型（永続形・実行時形・表示派生の土台）を、そのドメインの単一の型ファイルに集約する。
2. Where あるドメインの型が複数のフォルダ/ファイルに散在している, the モデル型定義 shall それらを当該ドメインの型ファイルへ統合し、空になったフォルダを廃止する。
3. When 型を別ファイルへ移動する, the 型整理作業 shall 参照元の import をすべて新しい配置へ更新し、旧パスへの参照を残さない。

### Requirement 3: 表示用もどき型の排除（描画時解決）
**Objective:** 開発者として、ドメイン/永続型を表示用に加工した別型を作らないようにしたい。責務境界を保ち二重定義を防ぐため。

#### Acceptance Criteria
1. The モデル型定義 shall 解決済みの話者ラベル（personaId から導出した name / role 等）を型に保持しない。
2. The モデル型定義 shall 横断アノテーション（awareness / engagement など id で JOIN する派生）を型に畳み込まない。
3. The モデル型定義 shall 算出結果（原本↔編集後の差分など）を型に事前計算して持たない。
4. While 表示に上記の派生が必要, the 表示コンポーネント shall それらを描画時に id 参照または算出で解決する。

### Requirement 4: 実質同一な型の一本化
**Objective:** 開発者として、実質同一の型を1つに統合したい。冗長さと乖離リスクを排すため。

#### Acceptance Criteria
1. If `XForFirestore` と対応するドメイン型が Timestamp 差も無く完全一致する, then the モデル型定義 shall それらを単一の型に一本化する。
2. If `Omit<..., K> & { K: ... }` 等の再宣言が元と同一で無意味化している, then the モデル型定義 shall それを簡約する。
3. The 型整理作業 shall 一本化にあたり functions 側の永続型（`*ForFirestore`）には変更を加えない。

### Requirement 5: 死型の削除
**Objective:** 開発者として、統合で置き換わって使われなくなった型を消したい。誤用と混乱を防ぐため。

#### Acceptance Criteria
1. If ある型・型ファイル・フォルダの参照がフロント全体で存在しない, then the モデル型定義 shall それを削除する。
2. When 死型を削除する, the 型整理作業 shall その死型に言及する残存コメント（旧名参照など）も整理する。

### Requirement 6: 責務境界の統一
**Objective:** 開発者として、全型の責務境界をそろえたい。ドメインと表示の混在をなくすため。

#### Acceptance Criteria
1. The ドメイン/永続型（FE・functions とも） shall intrinsic な値と id 参照のみを持ち、解決済みラベル・JOIN・算出結果を持たない。
2. The 表示コンポーネント（FE） shall ラベル解決・JOIN・算出を描画時に行う。
3. The 討論画面と編集画面 shall 同一の責務境界（話者は id 参照のまま、派生は描画時解決）で表示要素を扱う。
4. Where 同一概念の型が FE と functions の双方にある, the システム shall 両者の責務境界を同じ考え方でそろえる。

### Requirement 7: 型定義の models 一元化（コンポーネント内独自型の排除）
**Objective:** 開発者として、アプリで扱うデータ型を `models` に一元化したい。コンポーネントごとの独自定義による重複・不整合をなくし、共通モデルへ寄せるため。

#### Acceptance Criteria
1. The システム shall アプリ内で扱う**データ形**の型を `src/lib/models` に定義し、コンポーネント（`.svelte`）や store 内に独自のデータ型定義（`type` / `interface`、および名前付きにすべき派生形）を持たない。
2. When コンポーネント/store がデータ型を必要とする, the コンポーネント/store shall `models` の共通型を import して用いる。
3. Where 描画のために名前付きの型が必要（描画時解決で不要にならない場合）, the システム shall その型を `models` に定義し、特定コンポーネント/store に閉じさせない。
4. The コンポーネントの Props（UI 入力契約） shall models 一元化の対象外とし、コンポーネントにインライン（`let { … }: { … } = $props()`）または局所定義で書いてよい。ただしそのフィールド型には `models` の型を用い、Props に独自の**データ**型を内包しない。
5. The システム shall Props 型を `models` に定義しない（Props はコンポーネント固有の契約であり共通モデルではない）。

### Requirement 8: functions 型への同一方針の適用と FE との整合
**Objective:** 開発者として、functions 側の型も同じ考え方で責務境界をそろえたい。同一概念が FE と functions で食い違わないようにするため。

#### Acceptance Criteria
1. The functions 型定義 shall FE と同じ整理方針（同一概念の集約・重複一本化・死型削除・責務境界の統一）を `functions/src/types` に適用する。
2. The functions 型定義 shall 永続書き込み境界の `*ForFirestore`（実際に Firestore へ書き込む形）を役割として維持する（削除・改名の対象にしない）。
3. Where 同一概念の型が FE と functions の双方に存在する, the システム shall 両者の責務境界（intrinsic な値＋id 参照のみ、解決済みラベル・JOIN・算出結果は保持しない）を同じ考え方でそろえる。
4. Where render（描画）が無い（functions 側）, the システム shall 「表示用もどき型の排除・描画時解決」(Requirement 3) を適用対象外とし、代わりに「生成/永続に不要な派生を型に畳まない」責務境界のみを適用する。

### Requirement 9: 振る舞いの不変と検証
**Objective:** 運用者として、整理で挙動が壊れないことを保証したい。純粋なリファクタに留めるため。

#### Acceptance Criteria
1. When 整理を適用する, the システム shall 型の意味・データ形・UI 出力・生成/永続の挙動を変えない。
2. The コードベース shall 整理後も FE の型チェック（`svelte-check`）と functions の型チェック（`tsc`）を 0 error で通す。
3. The コードベース shall 整理後も FE・functions の既存テストを全て green に保つ。
4. The 型整理作業 shall Firestore へ実際に書き込む永続形（`*ForFirestore`）の構造は変更せず、配置・重複・死型・責務境界のみを整える。
