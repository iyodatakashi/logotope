# Requirements Document

## Project Description (Input)
章（Chapter）の `focusQuestion` を廃止し、論点運用を `discussionPoints` に一本化する。論点ずれ（drift）判定を「フォーカス問いからの逸脱」ではなく「いまアクティブな論点（最新の introduced な discussionPoint）からのずれ」で行うよう、判断の軸をアクティブ論点へ統一する。

## Introduction

現在、章は `title` / `focusQuestion` / `discussionPoints` の3フィールドを持つ。「章の先頭の問い」が `focusQuestion` と `discussionPoints[0]` に二重化しており（章導入は両方を切り口として渡している）、`title` を含めると「章は何か」を表す枠が3層あって役割が重複している。さらにファシリテーターの誘導アンカーと論点ずれ（drift）判定の基準が広い `focusQuestion` に置かれているため、会話が「フォーカス問いの傘の中」に留まったまま、いま実際に投げられている具体論点（アクティブ論点）からずれていても検出されにくい。

発言者プロンプトには既に「いま向き合う論点（最新の introduced な論点）」を注入済み（`introducedOrder` による追跡）だが、ファシリテーターの判断には同じアクティブ論点が渡っておらず、判断軸が非対称になっている。

本仕様は、`focusQuestion` を型・生成・永続化・表示から廃止し、`discussionPoints` を章の論点の単一の源泉とする。あわせて、誘導・drift・出尽くし（stall）・発言者フォーカス・章導入の各軸を「いまアクティブな論点」に一本化し、`focusQuestion` が担っていた「専門知識のない一般人が日常感覚で理解できる、well-formed な問いの形」を `discussionPoints` の生成側に移す。アクティブ論点が存在しない状況（論点を持たない章、全論点 addressed）では章の `title` を軸にフォールバックする。

## Boundary Context

- **In scope**:
  - 章データモデル（ランタイム型・永続スキーマ）からの `focusQuestion` 廃止と、`discussionPoints` への一本化
  - `discussionPoints` を「一般人が日常感覚で理解できる well-formed な問い」として生成する生成設計の変更
  - 誘導・drift・stall・発言者フォーカス・章導入の判断/文脈軸をアクティブ論点（最新の introduced）へ統一
  - 論点投入候補からアクティブ論点（introduced）を除外し、提示済み論点の再提示を防ぐ
  - アクティブ論点が存在しないときの `title` フォールバック
  - `focusQuestion` を表示・参照していた箇所（討論表示UI、ファクトチェックの focus スコープ補足、章導入）の代替
  - `focusQuestion` を保持する既存永続データの後方互換読み出し（依存せず動作する）
- **Out of scope**:
  - `introducedOrder` によるアクティブ論点追跡そのものの再設計（既実装を前提とする）
  - 論点 status 遷移（untouched / introduced / addressed）のアルゴリズム本体の変更（投入候補の選別を除く）
  - 介入クールダウン・話者選択・engagement スコアリングの再設計
  - 章のグルーピング／論点スコアリングのアルゴリズム本体（生成される論点の文言品質は対象、グルーピングのロジックは対象外）
  - 既存の公開済み討論データに対する一括バックフィル／マイグレーション
- **Adjacent expectations**:
  - 既実装の「アクティブ論点 = 最新 `introducedOrder` の introduced 論点」追跡と、発言者プロンプトへのアクティブ論点注入を再利用する
  - `chapter-type-unification`（型再構成）と整合し、`focusQuestion` 削除が将来の型統一と矛盾しないようにする

## Requirements

### Requirement 1: focusQuestion の廃止と discussionPoints への一本化

**Objective:** As a 討論パイプラインの設計者, I want 章の論点を `discussionPoints` の単一の源泉で表現する, so that `title` / `focusQuestion` / `discussionPoints` に分散していた「章の問い」の役割重複を解消できる

#### Acceptance Criteria

1. The 章データモデル shall 章を `title` と `discussionPoints` で表現し、`focusQuestion` フィールドを持たない
2. When 章を永続化する, the 章生成サービス shall `focusQuestion` を書き込まない
3. When 章を読み出す, the 討論オーケストレーター shall `discussionPoints` と `title` のみを章の軸として用いる
4. If 既存の永続データに `focusQuestion` が含まれている, then the 討論オーケストレーター shall それに依存せず、エラーを発生させずに `discussionPoints` と `title` のみで動作する
5. The 討論サービス shall 章内で `focusQuestion` を参照する判断・文脈・表示を一切持たない

### Requirement 2: discussionPoints を well-formed な問いとして生成

**Objective:** As a 討論コンテンツの編集者, I want 各論点が一般の閲覧者にも理解できる問いの形で生成される, so that `focusQuestion` が担っていた「日常感覚で理解できる入口」を失わない

#### Acceptance Criteria

1. When 章を生成する, the 章生成サービス shall 各論点を、専門知識のない一般人が日常感覚で理解できる問いの形で出力する
2. When 第1章を生成する, the 章生成サービス shall その論点を特に平易で日常的な表現にする
3. When 章を生成する, the 章生成サービス shall 意味的に重複する論点を1つに統合する（既存挙動を維持）
4. When 章を生成する, the 章生成サービス shall 特定のペルソナ名・発言を前提にしない汎用的な問いの形で論点を出力する

### Requirement 3: アクティブ論点を基準とした誘導と論点ずれ（drift）判定

**Objective:** As a 討論の閲覧者, I want ファシリテーターがいま投げられている具体論点からのずれを検出して引き戻す, so that フォーカス問いの傘の中に留まったまま論点から逸れる状態を捕捉できる

#### Acceptance Criteria

1. While アクティブ論点（最新の introduced 論点）が存在する, when 論点ずれを評価する, the ファシリテーターエージェント shall 会話が当該アクティブ論点からずれているかを判断基準とする
2. While アクティブ論点が存在する, the ファシリテーターエージェント shall 会話を当該アクティブ論点に関連するよう誘導する
3. If 会話がアクティブ論点からずれている, then the ファシリテーターエージェント shall アクティブ論点へ引き戻す介入を行う
4. While アクティブ論点が議論し尽くされておらず、本題に沿って新たに深まっている最中である, when 論点ずれを評価する, the ファシリテーターエージェント shall 介入を見送る

### Requirement 4: 出尽くし（stall）判定と論点投入のアクティブ論点整合

**Objective:** As a 討論コンテンツの編集者, I want 出尽くし判定と次論点の投入がアクティブ論点と整合する, so that 提示済みの論点が再提示されたり、いまの論点の出尽くしが見落とされたりしない

#### Acceptance Criteria

1. When 出尽くしを評価する, the ファシリテーターエージェント shall アクティブ論点について主要な意見・対立が出尽くしているかを判断基準とする
2. When 次に投入する論点の候補を提示する, the 討論オーケストレーター shall 既に introduced のアクティブ論点を候補から除外し、未提示（untouched）の論点のみを投入候補とする
3. If 投入可能な未提示論点が存在しない, then the ファシリテーターエージェント shall 新たな論点を投入せず、アクティブ論点への引き戻し・振り直しを行う
4. When 介入が未提示論点を1件投入する, the 討論オーケストレーター shall 当該論点を introduced に更新し、それを新たなアクティブ論点とする

### Requirement 5: 発言者への章フォーカス提供の一本化

**Objective:** As a 討論の閲覧者, I want 発言者がいまのアクティブ論点を理解した上で発言する, so that `focusQuestion` と重複しない一貫した文脈で論点に沿った発言になる

#### Acceptance Criteria

1. While アクティブ論点が存在する, when 発言者の発言を生成する, the ペルソナエージェント shall アクティブ論点を発言の文脈として提示する
2. The ペルソナエージェント shall 発言生成の文脈に `focusQuestion` を含めない
3. While アクティブ論点が存在しない, when 発言者の発言を生成する, the ペルソナエージェント shall 章の `title` を章の文脈として提示する

### Requirement 6: focusQuestion 依存箇所（章導入・ファクトチェック・表示）の代替

**Objective:** As a 討論コンテンツの編集者, I want `focusQuestion` を参照していた箇所が代替の軸で動作する, so that 章導入・ファクトチェック・表示が `focusQuestion` 廃止後も破綻しない

#### Acceptance Criteria

1. When 章の導入発言を生成する, the ファシリテーターエージェント shall 章の先頭の論点を導入の切り口として用い、同一の問いを二重に提示しない
2. When 発言のファクトチェックを行う, the ファクトチェックサービス shall `focusQuestion` の代わりにアクティブ論点または章の `title` を話題スコープの補足として用いる
3. When 章を表示する, the 討論表示UI shall `focusQuestion` を表示せず、章の `title` と `discussionPoints` を表示する

### Requirement 7: アクティブ論点が存在しないときのフォールバック

**Objective:** As a 討論パイプラインの設計者, I want 論点を持たない章や全論点が addressed の状態でも各機能が破綻しない, so that アクティブ論点不在でも誘導・判定・表示が一貫して動作する

#### Acceptance Criteria

1. While 章が `discussionPoints` を1件も持たない, the 討論オーケストレーター shall 章の `title` を章の軸として誘導・drift 判定・表示・発言者文脈に用いる
2. While 章の全論点が addressed である, when 論点ずれを評価する, the ファシリテーターエージェント shall アクティブ論点不在として扱い、章の `title` を基準にフォールバックする
3. If アクティブ論点も未提示論点も存在しない, then the ファシリテーターエージェント shall 新たな論点を投入せず、エラーを発生させずに評価を完了する
