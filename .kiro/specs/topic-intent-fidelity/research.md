# Research & Design Decisions: topic-intent-fidelity

## Summary

- **Feature**: `topic-intent-fidelity`
- **Discovery Scope**: Extension（既存の生成パイプラインへの拡張。新規外部依存なし・新規ランタイムなし）
- **Key Findings**:
  - テーマの意図（`description` / `sourceContents`）の**供給は既に一本化されており、配線も済んでいる**。欠けているのは消費側だけで、ステークホルダー生成とペルソナ生成の2段が受け取った `TopicContext` のうち `factBase` しか読んでいない。
  - `description` の整形は `chapter-agent` / `interview-agent` / `intro-outro-agent` に**3箇所重複**し、見出しと重みづけが揃っていない（「方向性（最優先）」vs「詳細説明」）。共有されているのは `formatFactBaseSection` だけ。
  - ステークホルダーが持つ5項目のうち**下流へ届いているのは `role` と `engagementLevel` の2つだけ**。`reason` / `mainInterests` / `minorityLevel` は生成・永続されるだけで誰も読んでいない。立場を表示する画面も現存しない。
  - 当事者性は `engagementLevel`（専門・意識）へ押し込まれており（「専門家・**当事者層**（high）」）、専門家ではないが当事者性は最高、という人物を置ける場所が型に無い。
  - ペルソナの場所は `homePrefecture: string`（都道府県専用・国外は空文字）と `nationality: string` が併存し、国外のペルソナは場所が空のまま残る。`nationality` を読んでいるのはアバターの服装判断のみ。

## Research Log

### 意図の供給経路と消費の実態

- **Context**: R1（意図をキャスト決定段へ届ける）が配線の問題か消費の問題かを切り分ける。
- **Sources Consulted**: `pipeline/topics/topic-context.ts`、`pipeline/personas/persona-chain.ts`、`agents/*.ts`、`utils/prompt-formatters.ts`
- **Findings**:
  - `getTopicContext` が唯一の BE 権威経路として `description` / `sourceContents` / `factBase` を返す。`persona-chain.ts:61-62, 86-87` は両段へ `topicContext` を渡している。**配線は完成している。**
  - `stakeholder-agent.ts:31` と `persona-generator-agent.ts:76` は `formatFactBaseSection(topicContext?.factBase)` のみを呼び、他2項目を捨てている。
  - `fact-research-agent` は `TopicContext` を経由せず `title` / `description` を直接引数で受ける（`factBase` を作る段であり、まだ `factBase` が存在しないため）。独自見出し【この討論で掘り下げたい論点・観点】を持つ。
- **Implications**: R1 は2ファイルのプロンプトで機械的に満たせる。ただし R1.3（段ごとに取捨する分岐を持たない）を素直に満たすには、3箇所の重複を共有へ畳む判断が要る。`fact-research-agent` は呼び出し契約が異なるため本 spec の境界外。

### 当事者性・少数性・専門性の3軸

- **Context**: R2.6（3軸を独立に扱う）が既存の型でどう扱われているかを確認する。
- **Sources Consulted**: `types/stakeholder.types.ts`、`agents/stakeholder-agent.ts:39`、`agents/persona-generator-agent.ts:85`、全コードベースの `minorityLevel` 参照
- **Findings**:
  - 既存の軸は `minorityLevel` と `engagementLevel` の2つ。当事者性の軸は無い。
  - ステークホルダー生成のプロンプトは「専門家・**当事者層**（high）だけに偏らせないこと」と書き、ペルソナ生成は専門・意識:低 の説明で「生活者・**当事者**の目線から」と書く。同じ語が high と low の双方に現れ、軸として成立していない。
  - `minorityLevel` は全コードベースで型定義とテスト固定値からしか参照されない。プロンプト・画面・下流のいずれにも流れていない。
  - `engagementLevel` は型上 optional（`engagementLevel?`）だが、zod スキーマは required。`persona-generator-agent.ts:68` に未設定時「中」へ落とすフォールバックがあり、実データでは到達しない欠損分岐になっている。
- **Implications**: 当事者性は独立した第3軸として追加する。`minorityLevel` は軸が無意味なのではなく配線が欠けているだけなので、同時に配線する。`engagementLevel` の optional は必須化して欠損分岐を消す（CLAUDE.md「欠損データを許容する分岐を残さない」）。

### 所在（居住地）の型と下流での参照

- **Context**: R3（舞台から国籍・所在を決める）と R4.2（所在が欠落しない）の影響範囲を測る。
- **Sources Consulted**: `types/persona.types.ts`、`src/lib/models/persona/persona.types.ts`、`agents/interview-agent.ts`、`avatar/avatar-prompt.ts`、`utils/prompt-formatters.ts`、FE コンポーネント
- **Findings**:
  - `homePrefecture: string` は必須で「日本国外に暮らす人物は空文字」。国外の所在を持つ場所が無い。
  - 取材の【ペルソナ情報】は 氏名・年齢・職業・立場・背景・関心事 のみ。**所在・国籍を渡していない**。
  - 討論の `formatPersonas` は ID・名前・立場のみ。
  - アバターは `nationality` を服装判断の材料として渡すが、顔を描かない黒シルエットのため民族的特徴は出力に現れない。
  - FE `PersonaItem.svelte` は name / age / role / background のみを表示・編集する。所在・国籍は画面に出ない。
  - 公開表示型は `nationality` を持ち込まないことを `src/tests/models/persona/persona.types.test.ts:213` と `published-article.test.ts:334` が機械的に検査している。
- **Implications**: 所在モデルを変更しても**下流の実挙動への影響は小さい**。追随が必要なのは FE ミラー型とテスト固定値のみ。移行は `personas` サブコレクションに対して必要（討論・記事で読まれ続けるため）。

### 姓の割り当てと外国人氏名

- **Context**: R4.1（国籍の傾向に沿った氏名）を語彙テーブル化すべきかを判断する。
- **Sources Consulted**: `constants/surname-regions.ts` 冒頭コメント、`constants/japanese-surnames.ts`（7,783行・自動生成）、`scripts/build-surname-tables.ts`、`pipeline/personas/surname-assignment.ts`
- **Findings**:
  - 設計根拠が明文化されている — 「姓は文脈判断の要らない『語彙から引くだけ』の要素だが、**LLM に選ばせると分布が極端に狭くなり、珍しい姓が生成のたびに再出現する**。姓の決定は LLM から取り上げてここへ集約する」。
  - 日本人姓のテーブルは、全国頻度ランキング（人口推計付き・上位5000）・mecab-ipadic の人名見出し語・全国町字名という**全数に近い公開データ**の積から機械生成されている。
  - 外国人の姓名は現在この扱いを受けておらず、LLM がカタカナで自由に返す。
- **Implications**: 同じ分布の狭まりが国籍別にも起きる蓋然性は高い。ただし国籍は有界でなく、日本人姓と同等のデータ源を全国籍について用意できない。**本 spec では LLM 任せのままとし、実測してから後続で判断する**（下記 Design Decisions）。

### 既存の移行・検証の前例

- **Context**: 型変更に伴う移行と、R5（再現可能な検証）の実装形を既存パターンに合わせる。
- **Sources Consulted**: `scripts/backfill-persona-home-prefecture.ts`、`scripts/build-surname-tables.ts`、`scripts/inspect-persona-names.ts`、`pipeline/personas/verify-persona-naming.ts`、`pipeline/debate/verify-engagement-model.ts`、`avatar/verify-avatar-generation.ts`、`.kiro/steering/spec-dependencies.md`
- **Findings**:
  - backfill は dry-run 既定（`--apply` で書き込み）、自動導出できない対象は `MANUAL_DECISIONS` に根拠付きで列挙、という型が確立している。
  - 検証ハーネスは「本番と同一の関数を呼び、Firestore へ書かない」という型が3箇所で共通している。
  - `verify-persona-naming.ts` は立場リストをハードコードしており、**ステークホルダー段を呼んでいない**。検査項目も日本人の命名に閉じている。
- **Implications**: 移行・検証とも既存の型をなぞれる。検証ハーネスはテーマ文からステークホルダー生成を含めて通す形へ作り替える必要がある。

### ステークホルダー永続データの移行要否

- **Context**: `Stakeholder` にフィールドを追加したとき、既存の `topics/{id}/stakeholders/0` を移行すべきかを判断する。
- **Sources Consulted**: `pipeline/personas/persona-chain.ts`、`pipeline/personas/enqueue-persona-step.ts`、`pipeline/personas/personas.ts`、FE `src/lib/stores/stakeholders.svelte.ts`
- **Findings**:
  - `stakeholders/0` を読むのは `runPersonasStage` のみ。`stepKind: 'personas'` は `stakeholders` 段からしか enqueue されず（`advancePersonaChain`）、両段は同一 run 内で連続する。再生成時は `discardStakeholders` で破棄される。
  - したがって**新コードが古い形の `stakeholders/0` を読む経路が無い**。
  - FE には立場を表示する画面が無い（`persona-generation-consolidation` で `StakeholderItem` が撤去され、store と型だけが残っている）。
- **Implications**: ステークホルダーの backfill は不要。ペルソナ（`personas` サブコレクション）の backfill は必要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: プロンプトのみ拡張 | 2ファイルの文言を足し、型は据え置き | 影響範囲が最小。効果を単一変数で観測できる | 国外の所在が構造として残らず、「日本人は構造で所在を持つ／外国人は自然文に書くだけ」の非対称が固定される | CLAUDE.md「欠損データを許容する分岐を残さない」に反する |
| B: 所在を任意項目として持つ | 立場に `country?` / `prefecture?` を持たせ、ペルソナが引き継ぐ | 所在が構造として残る。姓の地域性の入力が確定する | 型変更と移行が発生する | 移行の前例が揃っている |
| C: A と B の2段階 | A を先行させ、実測後に B | 効果を切り分けて観測できる | **立場の所在とペルソナの所在は同一の変更の表裏で、切り分けると中途半端な構造が残る** | gap-analysis で推奨したが、下記 Decision で修正 |

**選定: B（一括）。** ただし「外国人氏名の語彙テーブル化」だけは実測依存のため本 spec の外に出す（下記 Decision 参照）。

## Design Decisions

### Decision: 「問われていること」は自然文のまま渡し、解釈の結果を出力させる

- **Context**: R2 の選定基準は「その討論で問われていること」への当事者性だが、`description` は自由記述で、複数の問いを含むことも問いの形で書かれないこともある。
- **Alternatives Considered**:
  1. 問いを明示的に取り出す段（LLM 呼び出し）を新設する
  2. `description` を自然文のまま渡し、ステークホルダー生成のプロンプトで選定基準として解釈させる
- **Selected Approach**: 2。加えて、解釈の結果を `stakeReason`（この立場が問いに対してどう当事者か）として**各立場に出力させる**。
- **Rationale**: 新しい段は LLM 呼び出し・失敗点・二重解釈を増やす。`chapter-agent` は既に `description` を自然文のまま「方向性（最優先）」として使い、論点がその方向に沿うことを確認できている。問いの抽出段は論点生成と責務が重複する。出力させることで、解釈が外れたときに人が読んで気づける（R5.4）。
- **Trade-offs**: 問いの解釈が LLM 内部で完結するため、外れたときの原因が `stakeReason` の文面からしか分からない。ただし現状は解釈の手がかりが一切無い状態なので、後退はしない。
- **Follow-up**: 検証ハーネスの出力に `stakeReason` を必ず含め、人手確認の一次材料にする。

### Decision: `TopicContext` の整形を共有し、見出しは最も強い形へ統一する

- **Context**: R1.3（段ごとに取捨する分岐を持たない）と R6.5（章立ての最優先扱いを維持）を同時に満たす必要がある。
- **Alternatives Considered**:
  1. 各段が自前で整形し続ける（重複5箇所へ拡大）
  2. 共有整形を作り、重みを引数で切り替える
  3. 共有整形を作り、全段で同一文言に統一する
- **Selected Approach**: 3。`utils/prompt-formatters.ts` に `formatTopicContextSection` を置き、見出しは `chapter-agent` の【テーマの方向性（最優先）】へ統一する。
- **Rationale**: 2 は「段ごとの分岐」をコードに戻すことになり R1.3 の趣旨に反する。統一先を最も強い形にするのは、R1.4 がキャスト決定段でも「既定の生成方針より優先」を要求しているため。取材・導入締めで方向性が最優先であっても不都合は無い。
- **Trade-offs**: `interview-agent` / `intro-outro-agent` のプロンプト文言が変わるため、既存テストの期待値更新が必要。
- **Follow-up**: `fact-research-agent` は `TopicContext` を経由しない別契約のため対象外とし、design の Out of Boundary に明記する。

### Decision: 所在は国・都道府県の任意項目として持つ（2026-09-23 依頼者決定）

- **Context**: 舞台の判定をステークホルダー段が持つ（依頼者決定）。その保持形を決める。
- **Alternatives Considered**:
  1. `role` 文字列に織り込む
  2. 国を表す専用の値（ISO 3166-1 alpha-2 のコード等）と地域を分けて持つ
  3. 自由記述の地域を一つの属性（`region: string`）として持ち、粒度はテーマが要求するものに従わせる
  4. 国（自由記述）と都道府県（47件の enum）を、それぞれ任意項目として持つ
- **Selected Approach**: 4。`country?` / `prefecture?` を立場が持ち、ペルソナが引き継ぐ。`nationality` は `country` へ改名して残す。
- **Rationale**: 依頼者の判断。3 は**採用しない経路**である（一度その形で設計した）。破棄の理由は、姓の地域性が壊れること — 自由記述にすると「日本」「関西」「那覇市」が都道府県として読めず、`normalizePrefecture` の照合に落ちて全国姓へ縮退する。現行の仕組みが機能していたのはプロンプトが都道府県の正式表記を強制していたからで、自由記述化はその前提を外す。都道府県を独立の任意項目にすれば、有限集合なので生成スキーマの enum で直接受け取れ、正規化そのものが不要になる。2 は国を表す値が `nationality` と二重になる（4 では `nationality` 自体が `country` になるので二重化しない）。1 は自然文の解析が脆い。
- **Trade-offs**: `prefecture` は日本にのみ対応する項目なので、構造としては非対称になる。ただし本 spec が正す対象は「日本を既定とし海外を例外扱いすること」と「海外の立場を日本の相当職へ翻案すること」であって、任意項目の非対称ではない。未設定のまま成立する海外ペルソナは、既定でも翻案でもない。R4.2 の文言はこの判断に合わせて改訂した。
- **Follow-up**: 所在の文字列を解釈する処理（正規化・部分一致・都道府県判定）がコードに増えていないことを、実装時に確認する。

### Decision: `nationality` は `country` へ改名して残す

- **Context**: `nationality` は既存フィールドで、読み手はアバターの服装判断のみ（`avatar-prompt.ts:42`）。
- **Alternatives Considered**:
  1. 撤廃し、複合的な来歴は `background` の自然文に委ねる
  2. 所在の国の項目（`country`）へ改名して残す
- **Selected Approach**: 2。
- **Rationale**: 上の決定で所在が国と都道府県の任意項目になったことで、`nationality` が持っていた値は**そのまま `country` の値である**。撤廃は、同じ意味の項目を新設しながら既存の値を捨てることになり、移行で国外ペルソナの所在が空になる。改名なら情報が失われず、アバターの服装判断も入力を失わない。1 は**採用しない経路**（所在を自由記述の `region` 1本にする設計と対で検討したもので、その前提ごと破棄した）。
- **Trade-offs**: 「米国で研究する中国籍の人物」のように国籍と居住国が異なる来歴は `country` 1項目では表せない。これは項目を増やさず `background` の自然文が受け持つ（定型で表そうとすると整合規則を後付けすることになる）。
- **Follow-up**: `country` を持たない人物でアバタープロンプトの括弧書きが空にならないことを確認する。

### Decision: 日本人の名前決定に地域性を反映する仕組みは生かす

- **Context**: 国別の制御を最小化する一方で、姓の地域性は残すべきか。
- **Selected Approach**: 生かす。`assignSurnames` と姓テーブル・地域区分は無変更で使い、入力を `homePrefecture` から `prefecture` へ替えるだけにする。都道府県が決まっていない人物は、県を限定せず全国の語彙から姓を引く（既存の `assignSurnames('')` の経路）。姓そのものを LLM に選ばせる経路は持たない。
- **Rationale**: 依頼者の指示。加えて `surname-regions.ts` の設計根拠 — 沖縄県民の立場を代弁する人物が全国的な姓を持つのは名前が立場を裏切っている状態 — が、本仕様の主眼（立場の代弁）に直結する。日本人かどうかだけの判定に落とすと、この地域性が失われる。
- **Trade-offs**: `prefecture` という日本に依存した項目が1つ残る。姓テーブルを引くために不可避で、これを唯一の国依存の構造とする（判定処理としては、enum で受けることにより `normalizePrefecture` が経路から外れ、コード側の国依存の分岐は無くなる）。
- **Follow-up**: 姓の決定主体の分岐（`familyName` の空・非空）は既存のまま変えない。**「基本的には日本人」の撤去と一緒に「日本語の姓名の人物は `familyName` を空で返す」という指示を落とさないこと** — 落とすと姓が LLM の創作に戻る。

### Decision: 当事者性・少数性はペルソナへ永続しない

- **Context**: `engagementLevel` は立場からペルソナへ引き継がれ永続している。`stakeLevel` / `minorityLevel` も同様にすべきか。
- **Alternatives Considered**:
  1. 3軸すべてをペルソナへ引き継ぎ永続する
  2. 当事者性・少数性は立場にのみ持ち、ペルソナ生成の入力として使う
- **Selected Approach**: 2。
- **Rationale**: `engagementLevel` が永続されているのは討論の意欲評価が読むからである。当事者性・少数性の読み手は現時点でペルソナ生成しかなく、永続すれば `minorityLevel` と同じ死蔵を1つ増やすことになる。発言機会への波及は本 spec の境界外（別途判断）。
- **Trade-offs**: 将来、討論が当事者性を読む設計になったとき、ペルソナへの引き継ぎを追加する変更が必要になる。
- **Follow-up**: その判断をする spec が現れたら、立場から引き継ぐ形を追加する。

### Decision: 外国人氏名の語彙テーブル化は本 spec で行わない

- **Context**: 日本人姓では「LLM に選ばせると分布が狭まる」ことが観測済みで、同じ問題が国籍別にも起きうる。
- **Alternatives Considered**:
  1. 主要国籍について姓名テーブルを構築する
  2. プロンプト指示のみで満たし、実測してから判断する
- **Selected Approach**: 2。R4.1 はプロンプト指示で満たし、`inspect-persona-names.ts` を国籍別の分布が見える形へ拡張して実測できる状態にする。
- **Rationale**: 国籍は有界でなく、日本人姓のような全数に近いデータ源を全国籍について用意できない。どの国籍を対象にするかはテーマ次第で、先に決められない。分布が実際に狭まるかを測ってから、対象国籍を絞って構築するのが順序として正しい。
- **Trade-offs**: 本 spec の完了時点では外国人氏名の再出現リスクが残る。
- **Follow-up**: 実測で分布の狭まりが確認されたら後続 spec を立てる。測れる状態にすること自体は本 spec の責務に含める。

### Decision: gap-analysis の2段階案を一括実施へ修正する

- **Context**: gap-analysis は Option C（プロンプト先行 → 型変更を後続）を推奨した。
- **Selected Approach**: 一括実施（Option B）へ修正する。切り離すのは「外国人氏名の語彙化」のみ。
- **Rationale**: 立場の所在とペルソナの所在は同一の変更の表裏であり、前者だけを入れると「立場は国を持つのにペルソナは都道府県専用の必須フィールドのままである」という中途半端な状態が残る。段階分けの目的は効果の切り分けだったが、この2つは切り分けても別々には観測できない。実測依存で本当に切り離すべきなのは外国人氏名の語彙化だけである。
- **Trade-offs**: 1回の変更で動く要素が増えるため、検証ハーネスでの確認が一度で複数観点に及ぶ。
- **Follow-up**: `tasks.md` で「プロンプトと型を入れた直後に検証ハーネスを走らせる」順序を明示し、観測の機会を確保する。

## Risks & Mitigations

- **プロンプト変更の効果が言葉づかいに依存し、一度で狙いどおりにならない** — 検証ハーネス（R5）を実装と同時に用意し、テーマを差し替えて複数回観測できる状態を先に作る。
- **「網羅」を弱めた結果、少数意見や生活者の立場が落ちる** — R2.5 として要件化済み。検証ハーネスの一覧出力に少数性・専門意識の分布を出し、射程を絞った後も幅が残っていることを人が確認する。
- **移行で既存ペルソナの所在が失われる** — `homePrefecture` → `prefecture`、`nationality` → `country` の改名で、値の解釈を伴わない。空文字だった項目は未設定にする。国外ペルソナの国は `country` として残るため捨てる値が無い。dry-run 既定は踏襲する。
- **見出し統一で取材・導入締めの出力が変わる** — 文言変更であり供給内容は同一。既存テストの期待値更新で検知できる。
- **都道府県が決まらないテーマで姓の地域性が働かない** — 県を限定せず全国の語彙から引く（R4.6）。これは縮退ではなく正しい挙動であり、姓が LLM の創作に落ちる経路は無い。`prefecture` は enum で受けるため表記ゆれ自体が起きない。

## References

- `.kiro/steering/conventions.md` — 使い捨てスクリプト禁止、機械的な件数制約を置かない、対立を煽らない
- `.kiro/steering/spec-dependencies.md` — 検証用と本番の実装を分けない、受け入れ基準を実装後に定義しない
- `.kiro/steering/product.md` — 声が届きにくい立場の可視化、多様性そのものを価値とする
- `CLAUDE.md` — 仕様を先に決めデータを合わせる、欠損データを許容する分岐を残さない
- `functions/src/constants/surname-regions.ts` — 姓の決定を LLM から取り上げた設計の根拠
