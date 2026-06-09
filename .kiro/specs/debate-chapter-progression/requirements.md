# Requirements Document

## Introduction
討論の進行を「章立て構成」に改善する機能。現在の討論はファシリテーターが都度介入するだけで全体的な流れがなく、ダラダラ続きがちである。本機能では、討論開始前に複数の章（論点・テーマ）を自動生成し、章ごとに集中した討論を行い、適切な区切りで次の章へ移行することで、構造的で読みやすい討論コンテンツを生成する。

## Boundary Context
- **In scope**: 章の自動生成、章ごとの討論誘導、章の終了判定と遷移、章データのFirestore永続化、閲覧UIでの章別表示
- **Out of scope**: 管理者による章の手動定義・編集、章のリアルタイム追加・削除、章ごとの参加者制限
- **Adjacent expectations**: 既存の `DebateOrchestratorService` を章進行に対応させる。`FacilitatorAgentService` に章遷移プロンプトを追加する。

---

## Requirements

### Requirement 1: 章の自動生成
**Objective:** As a 管理者, I want 討論テーマとペルソナ情報から討論の章立てをAIが自動生成すること, so that 討論開始前に構造的な論点が決まり、ダラダラしない討論が実現できる。

#### Acceptance Criteria
1. When 討論が開始される, the Debate Orchestrator shall ファシリテーターAIを使って4〜6章の章立てを生成する（テーマ・ペルソナの立場を踏まえた論点）。
2. The Debate Orchestrator shall 各章に対して「章タイトル」と「討論フォーカス（その章で議論すべき問い）」を含む章データを生成する。
3. The Debate Orchestrator shall 生成した章リストを `topics/{topicId}/sessions/0` の `chapters` フィールドに保存する。
4. If 章生成に失敗した場合, the Debate Orchestrator shall フォールバックとして「導入」「核心的対立」「影響と懸念」「まとめ」の4章を使用して討論を継続する。

---

### Requirement 2: 章フォーカスを活かした討論誘導
**Objective:** As a 読者, I want 各章が一つの論点に集中した討論を展開すること, so that テーマの様々な側面が整理された形で理解できる。

#### Acceptance Criteria
1. While 討論が進行中, the Debate Orchestrator shall 現在の章タイトルと討論フォーカスをファシリテーター・各ペルソナエージェントのコンテキストに含めて渡す。
2. When ファシリテーターが発言を生成するとき, the Facilitator Agent shall 現在の章フォーカスに沿った誘導・問いかけを行う。
3. The Debate Orchestrator shall 各ターンにどの章のターンかを示す `chapterIndex` フィールドを付与して保存する。

---

### Requirement 3: 章の終了判定と章遷移
**Objective:** As a 読者, I want 各章が適切な長さで区切られ次の章へ移行すること, so that 討論に流れとテンポが生まれ読みやすいコンテンツになる。

#### Acceptance Criteria
1. While 現在の章のターン数が章あたり目標ターン数（デフォルト: `maxTurns / 章数`）に達したとき, the Debate Orchestrator shall ファシリテーターAIに対して章終了判定を要求する。
2. When ファシリテーターAIが「章終了」と判定したとき, the Facilitator Agent shall 現章の議論を要約し次章への橋渡しとなる遷移発言を生成する。
3. When 章遷移発言が生成されたとき, the Debate Orchestrator shall セッションの `currentChapterIndex` を次の章に更新する。
4. When 最終章の討論が終了したとき, the Debate Orchestrator shall 章進行フローから通常のクロージング生成へ移行する。
5. If 章あたりターン数が目標の150%に達しても章終了判定が出ない場合, the Debate Orchestrator shall 強制的に次の章へ遷移する。

---

### Requirement 4: 章データのFirestore永続化
**Objective:** As a システム, I want 章データがFirestoreに永続化されること, so that フロントエンドがリアルタイムで章の進行状況を把握できる。

#### Acceptance Criteria
1. The Debate Orchestrator shall `sessions/0` に以下のフィールドを含めて保存する: `chapters`（章リスト）、`currentChapterIndex`（現在の章番号）。
2. When `currentChapterIndex` が更新されたとき, the Debate Orchestrator shall `sessions/0` の `currentChapterIndex` フィールドをFirestoreに書き込む。
3. The Debate Orchestrator shall 各ターンの `chapterIndex` を `FieldValue.arrayUnion` でターンに含めて保存する。
4. The Debate Orchestrator shall `sessions/0.chapters` の各要素に `{ index, title, focusQuestion, startTurnIndex, endTurnIndex? }` の構造を使用する。

---

### Requirement 5: 閲覧UIでの章別表示
**Objective:** As a 読者, I want 公開された討論が章ごとに整理されて表示されること, so that 討論の流れを追いやすくなる。

#### Acceptance Criteria
1. When 討論閲覧ページ（`/debate/[id]`）が表示されたとき, the Debate Viewer shall 章ごとにターンをグループ化して、章タイトルを見出しとして表示する。
2. The Debate Viewer shall 各章の見出しに章番号・章タイトル・討論フォーカスを表示する。
3. While 討論が進行中（管理画面 Phase4）, the Phase4Debate コンポーネント shall 現在の章タイトルと進行状況（第N章/全M章）を表示する。
4. If セッションに `chapters` データが存在しない場合（旧データとの後方互換性）, the Debate Viewer shall 章見出しなしで従来通りにターンを連続表示する。
