# Requirements Document

## Introduction
本機能は、ペルソナ関連の型ドメインを整理・統一する。現状、同名の `Persona` が functions と FE で別物になり（functions は永続形とランタイム形を1つの型に混在させ `interview` を `interviewRecord` に平坦化・`nationality` を持つ／FE は `PersonaForFirestore` から派生するが `nationality` を欠く）、公開描画用に狭い射影 `PublishedPersona` が並行して存在し、用途別に手で切り出した派生型（撤去済みの `PersonaForInterview` など）が増殖している。これらは保守しづらく、`PersonaPostItem.svelte` を Admin 画面と公開画面で共通の「発言アイテム」コンポーネントにする妨げになっている。

本 spec では、(1) ペルソナの永続形（`PersonaForFirestore`）を FE と functions で構造的に一致させ、ランタイム形 `Persona` をそこから派生させる、(2) 公開の `PublishedPersona` を廃し、Admin・公開が共通で用いる軽量な表示用ペルソナ型 `PersonaForDisplay` へ統合する、(3) Admin と公開で同一の発言アイテムコンポーネントへ渡せるよう、双方が各自の元データから `PersonaForDisplay` へ写像する設計にする（`role` を含む最小形・`Partial` 等での欠落許容）、(4) 具体的立場フィールド `specificRole` を `role` に改名して必須化し、非空を書き込み入口の検証（生成スキーマ・admin バリデーション）で保証して、散らばる `specificRole ?? stakeholderRole` の読み取り導出と「空欄→総称の自動置換」という推測困難な挙動を廃す（既存データは backfill で移行）、(5) 場当たりな派生型の増殖を止める。型定義だけでなく永続データ（フィールド改名）も含めて整理するが、ユーザーに見える振る舞いは変えない。

## Boundary Context
- **In scope**: ペルソナ型の永続形／ランタイム形の分離と FE↔functions の一致。公開 `PublishedPersona` の統一型への統合。Admin・公開共通の発言アイテムコンポーネントを支えるペルソナ型設計。`specificRole → role` の改名・必須化と既存データの backfill 移行。`nationality` などレイヤー間の非対称の解消。場当たり派生型の排除。永続データ（フィールド改名）を含めた整理。
- **Out of scope**: turn / debate など persona 以外のドメインの型分解（project-knowledge.md の type-domain-decomposition の残り）。生成・取材・アバターの品質やプロンプト内容の変更。ペルソナのステータス機構・生成・取材・討論・アバターの「見える振る舞い」の変更。本 spec が明示する改名・移行以外の Firestore 文書構造の変更。
- **Adjacent expectations**: `editorial.types.ts` が「FE の `*ForFirestore` は functions 側と一致させる」基準を示している。アバター生成は `genderPresentation` / `nationality` を使用する。公開読み取り（firestore.rules の personas 公開読み取り許可）は変更しない。「id で保持し描画時に解決」（`personaMap` / `personas`）という既存方針は維持する。

## Requirements

### Requirement 1: 永続形とランタイム形の分離（FE↔functions ミラー）
**Objective:** 開発者として、ペルソナの永続形（Firestore 形）とランタイム形を明確に分け、FE と functions で永続形を一致させたい。同名 `Persona` が別物になる型の意味のズレをなくすため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall ペルソナの永続形を `PersonaForFirestore` として定義し、Firestore に保存される文書構造と一致させる。
2. The ペルソナ型ドメイン shall FE と functions の `PersonaForFirestore` を、同一フィールド・同一意味で構造的に一致させる。
3. The ペルソナ型ドメイン shall ランタイムの `Persona` を `PersonaForFirestore` から派生させ、両者の差分を実行時変換（Timestamp→Date 等）に限定する。
4. Where 永続形のフィールドをランタイムで別表現にするとき（例: `interview` オブジェクトの `interviewRecord` への平坦化）, the ペルソナ型ドメイン shall その変換を型と写像の両方で明示し、暗黙の別型を生まない。

### Requirement 2: レイヤー間フィールドの一貫化（`nationality` の非対称解消）
**Objective:** 開発者として、片側のレイヤーにしか存在しないフィールド（`nationality` 等）の非対称をなくしたい。永続形が FE と functions で食い違う状態を解消するため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall Firestore に永続化されるフィールド（`nationality` を含む）を、永続形 `PersonaForFirestore` として FE・functions の双方で一貫して定義し、ランタイム `Persona` はそこから派生して保持する。
2. The ペルソナ型ドメイン shall `nationality` を表示用の `PersonaForDisplay` には含めない（描画に不要なため最小形に保つ）。
3. Where 永続化フィールドが一方のレイヤーの実行時に利用されないとき, the ペルソナ型ドメイン shall そのフィールドを永続形から暗黙に欠落させず、永続形（ミラー）に定義する。

### Requirement 3: 公開射影 `PublishedPersona` の統合
**Objective:** 開発者として、公開描画専用の狭い射影 `PublishedPersona` を廃し、共通の表示用ペルソナ型で公開記事を描画したい。並行する型の重複をなくすため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall 公開記事の話者ペルソナを、公開専用の `PublishedPersona` ではなく、Admin・公開が共通で用いる軽量な表示用ペルソナ型 `PersonaForDisplay` で表現する。
2. The ペルソナ型ドメイン shall `PublishedPersona` を廃止する。
3. The 公開記事ビュー shall ペルソナを記事あたり1回だけ id キーのマップで保持し、発言・気づき・所感からは id で参照する（現行方針を維持）。
4. When 公開ページがペルソナ由来の一部フィールドのみを必要とするとき, the 公開記事ビュー shall 管理専用フィールドを持つ重いランタイム `Persona` を公開ビューへ持ち込まず、`PersonaForDisplay` へ写像する（payload と型の純度を悪化させない）。

### Requirement 4: 共通発言アイテムコンポーネントを支える型
**Objective:** 開発者として、`PersonaPostItem.svelte` を Admin 画面と公開画面で共通の発言アイテムとして使いたい。管理用と公開用でペルソナ型が別物だと共通化できないため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall Admin 画面と公開画面の双方から同一の発言アイテムコンポーネントへ渡せる、単一の軽量な表示用ペルソナ型 `PersonaForDisplay` を提供する。
2. The 共通発言アイテムコンポーネント shall 描画に必要な最小フィールド（少なくとも `role`・`name`・話者解決に要する id・外見系フィールド）を `PersonaForDisplay` の型で要求する。
3. The ペルソナ型ドメイン shall Admin・公開の双方が、各自の元データ（ランタイム `Persona` / 公開読み取り）から `PersonaForDisplay` へ写像して発言コンポーネントへ渡せるようにする。
4. Where 呼び出し側が一部フィールドを持たないとき, the ペルソナ型ドメイン shall `PersonaForDisplay` の欠落し得るフィールドを `Partial` 等で許容し、コンポーネント側が既定へ縮退できるようにする。
5. The ペルソナ型ドメイン shall Admin 用と公開用に、互いに無関係な別個の表示用ペルソナ型を並存させない（`PersonaForDisplay` の1型に集約する）。

### Requirement 5: 役割フィールドの `role` への改名・必須化（入口検証で非空保証・導出とフォールバックの廃止）
**Objective:** 開発者として、具体的立場フィールド `specificRole` を `role` に改名して必須化し、散らばる `specificRole ?? stakeholderRole` の読み取り導出と「空欄→総称の自動置換」という推測困難な挙動を無くしたい。非空は書き込み入口の検証で保証し、表示は `role` を素直に映すため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall ペルソナの具体的立場フィールドを `specificRole` から `role` に改名する（FE・functions の永続形・ランタイム形の双方）。
2. The ペルソナ型ドメイン shall `role` を必須（非 optional）フィールドとして定義する。
3. When ペルソナを生成するとき, the ペルソナ生成 shall LLM に空の `role` を返させない（プロンプトで明示し、生成スキーマで空文字を弾く）。
4. When 編集者が `role` を空文字・空白のみで保存しようとするとき, the 編集 shall その保存をブロックし、`stakeholderRole` 等で自動的に置換しない。
5. The ペルソナ型ドメイン shall `role` の非空を、読み取り時フォールバックや書き込み時の総称置換ではなく、書き込み入口の検証（生成スキーマ・admin バリデーション）で保証する。
6. The ペルソナ型ドメイン shall 各コンポーネント・読み取り経路から `specificRole ?? stakeholderRole` の導出を廃し、`role` を直接用いる（空欄は空欄のまま表示し、総称へ自動置換しない）。
7. The ペルソナ型ドメイン shall 総称フィールド `stakeholderRole` を別概念として保持するが、`role` のフォールバックには用いない。

### Requirement 6: 場当たり派生型の排除
**Objective:** 開発者として、用途ごとに手で切り出した派生型（`PersonaForInterview` 等）の増殖を止めたい。保守性を保つため。

#### Acceptance Criteria
1. The ペルソナ型ドメイン shall 用途別に手で切り出した部分型を新設せず、統一型と `Pick` / `Partial` 等の型演算で表現する。
2. While 本 spec の整理を行う間, the ペルソナ型ドメイン shall `PersonaForInterview`（撤去済み）と同種の並行型を復活させない。

### Requirement 7: 見える振る舞いの不変・影響の明示
**Objective:** 開発者として、この整理でペルソナの「見える挙動」を変えたくない。永続フィールドの改名・移行は伴うが、ユーザーに見える結果は同じに保ちたい。

#### Acceptance Criteria
1. While 本 spec のリネーム・統合・移行を行う間, the ペルソナ型ドメイン shall ステータス機構・生成・取材・討論・アバターの見える振る舞い（表示される役割・名前・アバター等）を変えない。
2. The ペルソナ型ドメイン shall 永続形の実データの変更を、本 spec が明示する改名・移行（`specificRole → role` 等）に限定し、それ以外の文書構造は変えない。
3. When 公開ビューの型を統合するとき, the 公開記事ビュー shall 公開ページが配信するデータ量・内容への影響を design で明示的に扱う。

### Requirement 8: 既存ペルソナデータの移行（`specificRole → role`）
**Objective:** 開発者として、フィールド改名にあたり既存ペルソナ（公開済みを含む）を壊さず移行したい。移行中も役割表示を失わないため。

#### Acceptance Criteria
1. The 移行処理 shall 既存ペルソナ文書の `specificRole` の値を `role` へ移し、`specificRole` が欠落・空のものに限り一度だけ `stakeholderRole` を `role` に焼き込む（非空不変条件を満たすための移行専用の穴埋めであり、恒常的なフォールバックではない）。
2. The 移行処理 shall リポジトリに残る冪等な backfill（`functions/src/scripts/` にコミット）として実装し、使い捨てにしない。再実行しても二重変換しない。
3. While 移行の最中でも, the システム shall 公開記事・管理画面が役割表示を失わないようにする（初回デプロイは読み取り側の一時フォールバック `role ?? specificRole ?? stakeholderRole` を単一箇所に入れ、backfill 完了確認後に撤去して `role` 直参照へ統一する）。
