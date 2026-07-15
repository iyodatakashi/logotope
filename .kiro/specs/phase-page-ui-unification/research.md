# Research & Design Decisions: phase-page-ui-unification

## Summary
- **Feature**: `phase-page-ui-unification`
- **Discovery Scope**: Extension（既存6画面のUI統一。新規依存なし・Functions 無変更）
- **Key Findings**:
  - 前提 spec `persona-generation-consolidation` は実装済みで、フェーズ集合は6値（`theme` / `fact-research` / `personas` / `chapters` / `debate` / `editing`）。`GeneratePersonaPage` は既に統一パターンへ移行済み（**本 spec の参照実装**であり変更不要）。
  - 統一の骨格・ボタン様式は既存 `PhasePanel`（actions/content/progress スニペット）と `@14ch/svelte-ui` の `Button`（variant/rounded/icon/loading/disabled）だけで表現でき、新規共通部品は不要。共通化してよいのは「操作ペイン3領域の `space-between` レイアウト CSS」のみ。
  - `nextPhase()` は「ドメインの phase 前進（成立・維持）」と「画面遷移の導出（不成立・撤去）」を兼ねている。画面遷移用途のみを各画面のリテラル直書きへ置換し、代替の共通機構は作らない。

## Research Log

### 前提 spec 完了に伴う要件影響（旧 Requirement 5 / 取材連鎖）
- **Context**: 本 spec の requirements 冒頭が「`persona-generation-consolidation` 完了後に要件を見直す」ことを条件にしていた。
- **Sources Consulted**: `.kiro/specs/persona-generation-consolidation/tasks.md`（1〜7.2 完了・残 7.3 実環境検証のみ）、`src/lib/models/phase/phase.constants.ts`（6フェーズ）、`GeneratePersonaPage.svelte`（統合済み）、git status（`StakeholderItem` / `StakeholderPersonaRow` 削除）。
- **Findings**:
  - ペルソナ画面は単一対象（生成→取材の一気通貫をサーバ側 1 操作 `startPersonaGeneration` で起動）になり、操作ペイン中央1スロットに収まる。
  - 取材はサーバ側連鎖に吸収済み。「取材する」状態分岐・単独の再取材・後続の連鎖 spec はいずれも不要。
- **Implications**: requirements を改訂済み（旧 Requirement 5 削除、6画面すべて同一骨格、中央が空になるのはテーマ設定のみ）。design も 6 画面を単一対象として扱う。

### `nextPhase()` の二役と撤去範囲
- **Context**: R2 が「画面遷移をフェーズ順から導出しない」ことを要求。
- **Findings**:
  - `advancePhase()`（`createTopic.svelte.ts`）は承認時に Firestore の `phase` を次へ進める処理で、`nextPhase()` に依存して**成立している**（残す）。
  - `phaseOrder()` はレイアウトの未到達フェーズ・リダイレクトガードで使われ、phase 単位で正しく機能している（残す）。
  - 画面側（Theme/FactResearch/Chapters/Debate）の `nextPhase(PHASE)` は「1フェーズ＝1画面」前提でしか成立せず、遷移先を各画面がリテラルで持つ形へ置換する。
- **Implications**: `phase.ts` の `nextPhase` export は維持。撤去は画面側の呼び出しのみ。`STEP_GROUPS`（`StepNav` 内 private・現状6ステップ1:1）は切り出さない。

### 承認失敗時の遷移（R3.4）と現行実装の欠陥
- **Context**: R3.4 が「承認失敗時は遷移せず操作ペインにエラー表示」を要求。
- **Findings**:
  - `ThemePage.handleForwardClick` / `FactResearchPage.handleForwardClick` は `try { await approve(); goto(...) } catch {}` でエラーを握りつぶす。さらに `ThemePage.approve` は内部 `catch` で `approveError` を立てるが再スローしないため、**失敗しても後続の `goto` が走り遷移してしまう**（R3.4 違反）。
  - リダイレクトガードとの整合: `approveX()` は Firestore `updateDoc` で latency compensation により `onSnapshot` へ即時反映されるため、`await approve()` 直後の `goto(next)` 時点で `phase` は前進済み。**新たな待ち合わせ機構は不要**。
- **Implications**: 各画面の forward ハンドラを「approve が throw→遷移せずエラー表示 / 成功時のみ goto」に統一する。approve 系は失敗を throw する（握りつぶさない）。

### `FactResearchPage` の生成ボタンが確認ダイアログを開く不整合
- **Context**: R4.7 は再生成のみ確認ダイアログを要求。
- **Findings**: 現行の `not_started`（初回生成）ボタンが `regenerateDialog.open()` を呼び、`generate()` は未使用のデッドコード。初回生成まで確認ダイアログを挟んでいる。
- **Implications**: 初回生成は `generate()` を直接呼ぶ（確認なし）。確認ダイアログは生成済み状態の再生成のみ。

### 討論の停止状態と単一スロット規則（決定済み）
- **Context**: R4.2「中央は1スロット・並置禁止」と、現行の討論 `stopped` が「再開する」＋「最初からやり直す」の2ボタンを並置している事実。
- **Findings**: 単一スロットを厳守するため、`stopped` は1ボタンに絞る必要がある。
- **決定（ユーザー）**: `stopped`＝「最初からやり直す」1つに統一。部分継続の「再開する」（`restartDebate`）は UI・モデルから撤去する。停止後の復旧は最初からの生成し直しに一本化。
- **Implications**: R5.2/R6.8/R7.2 を更新済み。`restartDebate` は `GeneratePersonaPage` ではなく `GenerateDebatePage`＋テストのみで使用のため FE から完全撤去可能（Functions ハンドラは範囲外で残置）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 各画面に直接書く（採用） | 6画面それぞれの `actions` スニペットを3領域へ書き換え、遷移先をリテラル直書き | structure.md「過度な共通化をしない」に合致。1画面調整が他へ波及しない | ボタン列挙が画面間で重複（許容） | 参照実装 `GeneratePersonaPage` と同型 |
| 共通 `PhaseActions` 部品 | 前/中央/次を props で受ける部品化 | 一見DRY | 中央の中身が画面ごとに全く異なり結局 snippet 渡し＋条件分岐。structure.md の禁止事項に抵触 | 却下 |
| 遷移解決ヘルパー（ステップ順テーブル） | 画面遷移を共通テーブルから導出 | 集中管理 | 成立しなくなった `nextPhase` 導出を別の場所で作り直すだけ。R8.3/R8.4 違反 | 却下（撤去が正） |

## Design Decisions

### Decision: 統一を各画面直書きで実現し、共通化は PhasePanel の3領域 CSS に限定する
- **Alternatives Considered**: 共通 `PhaseActions` 部品化 / 遷移解決ヘルパー新設。
- **Selected Approach**: 各画面の `actions` を「左＝前に戻る / 中央＝実行1スロット / 右＝次に進む」で素直に書く。3領域の `justify-content: space-between` レイアウトのみ共通化可（各画面ローカル CSS でも可）。
- **Rationale**: 中央領域の中身が画面ごとに全く異なるため部品化は条件分岐の温床になる。steering の「共通物を変えると他画面へ波及する」を避ける。
- **Trade-offs**: ボタン列挙の重複を受け入れる代わりに、画面独立性と可読性を得る。

### Decision: 画面遷移の `nextPhase()` 導出を撤去し、遷移先を各画面のリテラルにする
- **Selected Approach**: `goto(phasePath(topic.id, '<literal>'))` を各画面が直接持つ。`nextPhase()` は `advancePhase()` 専用に残す。`phaseOrder()` はガード用に残す。
- **Rationale**: フェーズ順と画面順は一致するが（現状6:6）、依存を断って「画面を見れば遷移先が分かる」不変条件を確立する（R2 の意図）。
- **Follow-up**: 画面遷移から `nextPhase` import を除去。`fact-research-lifecycle.test.ts` の意図を「ドメイン前進」に読み替えて書き換え。

### Decision: 承認＝前進を forward ハンドラに畳み、失敗時は遷移せずエラー表示
- **Selected Approach**: forward ハンドラが `isApproving` 制御・try/catch・エラー表示を所有。approve 系は失敗を throw。成功時のみ goto。
- **Rationale**: R3.2/R3.3/R3.4 を満たし、現行の握りつぶし（`catch {}`）と失敗時遷移バグを解消する。
- **Trade-offs**: なし（既存挙動の是正）。

### Decision: 中央スロットは状態→ボタン 1:1（討論の stopped は「最初からやり直す」のみ）
- **Selected Approach**: 各フェーズで `phaseLogicalState`（not_started/running/generated/stopped/approved）を単一ボタンへ写像する。討論は running→停止（outlined）を持ち、stopped/generated/approved はいずれも「最初からやり直す」（ghost/cached/確認）。
- **Rationale**: R4.2 の単一スロット規則を例外なく適用。「再開する」を撤去し復旧を最初からのやり直しに一本化（ユーザー決定）。
- **Trade-offs**: 部分継続（停止地点からの再開）は不可になるが、UI と復旧経路が単純化する。

## Risks & Mitigations
- 既存 page spec がボタン文言をアサートしており全面的に赤化する — tasks に spec 書き換えを明示的に含め、非退行を担保する。
- 討論 stopped の単一スロット化で復旧手段が「再開」のみになる — 設計レビューで stopped の扱いを確定する（Open Question）。
- 承認直後の `goto` がガードに弾かれる懸念 — latency compensation により phase は即時反映されるため現行のままで整合（新機構不要）。
- 廃止操作（`emptyApprove` / `singleChapterMode`）の撤去漏れ — File Structure Plan とテストで撤去を明示。

## References
- `.kiro/specs/phase-page-ui-unification/gap-analysis.md` — 現状調査・要件別ギャップ（統合前の記述を含むが UI 統一骨格・`nextPhase` 撤去方針は有効）
- `.kiro/specs/persona-generation-consolidation/` — 前提 spec（実装済み。ペルソナ画面の統一パターンの出所）
- `.kiro/steering/structure.md` — 過度な共通化の禁止・BEM・`@14ch/svelte-ui` 優先
