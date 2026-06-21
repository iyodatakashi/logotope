# Requirements Document

## Introduction

現在のチャプター生成パイプライン（`functions/src/agents/chapter-agent.ts`）は、generalIssues と personaIssues を生成した後、プロンプト指示で章数を「3〜4章」と固定的に誘導している。これにより、論点の多寡にかかわらず常に4章程度が生成される問題がある。

本スペックでは、生成した論点（issue）を**個別にスコアリングして選別**し、生き残った論点をグループ化してチャプターに変換する。グループ化された論点はそのままチャプターの discussionPoints となるため、スコアリングの単位（論点）と最終構造（チャプターにぶら下がる論点）が一致し、チャプターの中身の品質を直接コントロールできる。チャプター数は「生き残った論点のクラスタ数」として内容に応じて自然に決まる。

## Boundary Context

- **In scope**: `functions/src/agents/chapter-agent.ts` 内の章生成ロジック（`generateChapters` 関数）
- **Out of scope**: フロントエンド表示、Firestoreへの書き込み処理（`chapter-generator.ts`）、ペルソナ・討論パイプライン
- **Adjacent expectations**: `chapter-generator.ts` が呼び出す `generateChapters` の戻り値インターフェース（`Chapter[]` + `generalIssues` + `personaIssues`）は変更しない。呼び出し側への影響なし。

## Requirements

### Requirement 1: 論点の一括スコアリング

**Objective:** As a システム管理者, I want 生成された全論点（generalIssues + personaIssues）が個別にスコアリングされること, so that チャプターの discussionPoints となる論点を、その価値に基づいて選別できる

#### Acceptance Criteria

1. When `generateChapters` が呼ばれ generalIssues と personaIssues が生成された後, the Chapter Generation Service shall 全論点を1回のAI呼び出しにまとめて渡し、各論点に 0〜10 のスコアと採点理由（`reason`）を付与する独立したステップを実行する
2. The Chapter Generation Service shall 各論点が general 由来か persona 由来かの区別を保持したままスコアリングする
3. The Chapter Generation Service shall スコアリングの評価軸として「ペルソナ間の対立が生まれやすいか」「専門知識のない一般人が関心を持てるか」「討論を深める価値があるか」を使用する
4. The Chapter Generation Service shall スコア分布が偏らないようプロンプトで制約を設ける。具体的には「全論点のスコアを高くしない」「必ず低スコア（5以下）の論点を含めること（全論点が高品質な場合を除く）」を指示する
5. If 論点のスコアリングが全体を孤立評価ではなく相対評価で行えるよう, the Chapter Generation Service shall 全論点を同一プロンプト内に提示し、論点同士を比較した上でスコアを決定させる

### Requirement 2: スコアによる論点の選別

**Objective:** As a システム管理者, I want スコアが閾値以上の論点のみが採用されること, so that 価値の低い論点がチャプターの discussionPoints に残らない

#### Acceptance Criteria

1. The Chapter Generation Service shall スコア 7 以上の論点を採用論点とする
2. If スコア 7 以上の論点が1つも存在しない場合, the Chapter Generation Service shall スコア最上位の論点を最低1つ採用し、採用論点ゼロを防ぐ
3. While 採用論点を確定する間, the Chapter Generation Service shall general 由来の論点が少なくとも1つ採用されるよう保証する（第1章を general 由来で構成するため）

> 採用論点が少数に収束した場合、結果として1チャプターになることは許容する（論点が収束しているテーマでは1章が妥当）。

### Requirement 3: 採用論点のグループ化とチャプター化

**Objective:** As a システム管理者, I want 採用された論点が意味的に類似したものごとにグループ化され、各グループがチャプターになること, so that チャプター数が論点のクラスタ数として内容に応じて自然に決まる

#### Acceptance Criteria

1. When 採用論点が確定した後, the Chapter Generation Service shall 採用論点を意味的に近いものごとにグループ化し、各グループを1チャプターに変換するステップを実行する
2. The Chapter Generation Service shall 各チャプターに「章タイトル」「フォーカス問い」を生成し、採用論点をそのチャプターに割り当てる（この段階の論点は再構成前の素材として保持する）
3. The Chapter Generation Service shall チャプター数の上限を 5 とし、グループ数が 5 を超える場合は意味的に近いグループを統合して 5 以内に収める
4. While 採用論点が収束している場合, the Chapter Generation Service shall グループ数が1になることを許容し、結果として1チャプターを生成してよい

### Requirement 4: チャプターごとの論点の再構成

**Objective:** As a システム管理者, I want 各チャプターに割り当てられた採用論点が、そのチャプター単位で discussionPoints として作り直されること, so that 別々に選ばれた採用論点同士の意味的な重複が統合され、各チャプターに過不足のない論点が並ぶ

#### Acceptance Criteria

1. When チャプターのグループ化・生成が完了した後, the Chapter Generation Service shall 各チャプターを対象に、割り当てられた採用論点を素材として discussionPoints を作り直すステップを実行する
2. The Chapter Generation Service shall 割り当てられた採用論点に意味的な重複がある場合、それらを1つの論点に統合する
3. The Chapter Generation Service shall 作り直し後の各チャプターの discussionPoints を 3〜5 件に収める（素材が不足する場合はチャプターのタイトル・フォーカス問いに沿って補い、過剰な場合は統合・取捨する）
4. The Chapter Generation Service shall 作り直した論点を、特定のペルソナ名・発言を前提にしない汎用的な問いの形で生成する

### Requirement 5: 既存の章構成品質の維持

**Objective:** As a システム管理者, I want グルーピング・スコアリング導入後も既存の章構成品質制約が維持されること, so that 第1章の親しみやすさや章の進行性といった既存の設計品質が損なわれない

#### Acceptance Criteria

1. The Chapter Generation Service shall 第1章には general 由来の論点を割り当て、固有名詞・専門用語をタイトルとフォーカス問いに含めないよう指示する
2. The Chapter Generation Service shall 章を追うごとに専門性・対立の鋭さが段階的に増すよう章の順序を整列させる指示をプロンプトに含める
3. The Chapter Generation Service shall discussionPoints の記述において特定のペルソナ名・発言を前提にした記述を禁止し、誰に向けても問いかけられる汎用的な問いの形に変換する
4. The Chapter Generation Service shall 「誰でも感覚的に答えられる入口 → 具体的な事例・比較 → 深いジレンマ・価値観の対立」の進行原則を維持する

### Requirement 6: パイプラインの構造とインターフェース互換性

**Objective:** As a 開発者, I want スコアリング・グループ化・補完ステップが既存パイプラインに最小限の変更で組み込まれること, so that `chapter-generator.ts` 側の変更が不要で、呼び出しコントラクトが維持される

#### Acceptance Criteria

1. The Chapter Generation Service shall `generateChapters` 関数の引数シグネチャ（`topicTitle`, `personas`, `topicContext`）を変更しない
2. The Chapter Generation Service shall `generateChapters` 関数の戻り値型（`{ chapters: Chapter[], generalIssues: string[], personaIssues: string[] }`）を変更しない
3. The Chapter Generation Service shall 既存の「issue生成（general + persona 並列）」の後に「スコアリング・選別」「グループ化・チャプター化」「論点補完」を順に挿入する（AI呼び出し: issue生成2回並列 → スコアリング1回 → チャプター化1回 → 論点補完1回）
4. If スコアリング・チャプター化・論点補完のいずれかのAI呼び出しが失敗した場合, the Chapter Generation Service shall `{ code: 'AI_API_ERROR', message, retryable: true }` を返す既存のエラーハンドリング構造を踏襲する
