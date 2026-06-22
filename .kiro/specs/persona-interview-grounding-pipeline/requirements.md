# Requirements Document

## Project Description (Input)
ペルソナ取材フローの再設計：Gemini Search Groundingを使った仮説検証型リサーチ。現状はTavilyツールを使ったシングルコールだが、①ステレオタイプでドラフト信念を生成→②Gemini Pro のネイティブ検索で各項目を検証→③ギャップを踏まえて信念を修正、という仮説検証型パイプラインに再設計する。Tavilyは不要になる。

## Introduction

本仕様は、logotope のペルソナ取材パイプライン（`interview-agent.ts`）を仮説検証型に再設計するための要件を定義する。現行はTavilyツールをLLMに渡してシングルコールでリサーチ・インタビュー・信念生成を行うが、LLMがステレオタイプで穴を埋めてしまい、根拠のないペルソナが生成される問題がある。新設計では「ステレオタイプ仮説を立ててから批判的に検証する」アプローチをとる。検証フェーズでは仮説を「確認」するのではなく「反証」しようとする姿勢で情報を探すことで確証バイアスを避け、Gemini Pro のネイティブ Google Search Grounding によって実態との差異を積極的に発見する。

## Boundary Context

- **In scope**: `interview-agent.ts` の仮説検証型パイプラインへの再設計、Gemini Search Grounding の導入、Tavilyの廃止、ソースURL取得方法の変更（グラウンディングメタデータから取得）
- **Out of scope**: ペルソナ生成（`persona-generator.ts`）・討論エージェント（`persona-agent.ts`）への変更、フロントエンドUIの大幅変更、Firestoreのデータ構造変更
- **Adjacent expectations**: `InterviewOutput` 型の互換性を維持し、`personas.svelte.ts` および `Phase3Interviews.svelte` が既存のインターフェースで動作し続けること

## Requirements

### Requirement 1: ドラフト信念生成フェーズ

**Objective:** As a 取材パイプライン, I want ペルソナ情報だけを使って初期信念ドキュメントのドラフトを生成できること, so that 後続の検証フェーズで「何を確認すべきか」が明確になる

#### Acceptance Criteria
1. The 取材パイプライン shall ペルソナの属性情報（氏名・年齢・職業・立場・背景・関心事）とテーマタイトルのみを入力として、信念ドキュメントの6項目（立場と根拠・核心的主張・懸念事項・価値観・妥協点・変化の可能性）を含むドラフトを生成する
2. When ドラフト生成フェーズを実行するとき, the 取材パイプライン shall 外部検索を行わず、LLMの知識のみで生成する
3. The 取材パイプライン shall ドラフトの各項目を、後続の検証クエリ生成に使える粒度で構造化して保持する
4. If ドラフト生成が失敗したとき, the 取材パイプライン shall エラーを上位に伝播し、以降のフェーズを実行しない

### Requirement 2: グラウンディング検証フェーズ

**Objective:** As a 取材パイプライン, I want ドラフト信念の各項目をGemini Pro のGoogle Search Grounding で実際の情報と照合できること, so that ステレオタイプに頼らず根拠ある信念が形成される

#### Acceptance Criteria
1. The 取材パイプライン shall Gemini Pro の `useSearchGrounding: true` オプションを使い、ドラフト信念の各要素を批判的に検証する
2. When Gemini がグラウンディング検索を実行するとき, the 取材パイプライン shall 「このステレオタイプは本当か、実態は異なる可能性がないか」という反証的な問いを起点に検索が行われるようプロンプトで明示的に指示する
3. The 取材パイプライン shall ドラフト信念の各項目に対して、それを否定・修正しうる情報を優先的に探すよう検証フェーズのプロンプトを設計する
4. The 取材パイプライン shall グラウンディングレスポンスのメタデータから参照URLとタイトルを抽出し、`sources[]` として保持する
5. If グラウンディング検索結果が得られなかったとき, the 取材パイプライン shall エラーを返し、ステレオタイプのドラフトをそのまま出力しない

### Requirement 3: ギャップ記録フェーズ

**Objective:** As a 取材パイプライン, I want 検証結果とドラフトのギャップを独立したデータとして記録できること, so that 最終信念生成の入力として明示的に使用できる

#### Acceptance Criteria
1. The 取材パイプライン shall グラウンディングで得た実際の情報をドラフト信念の各項目と照合し、「ステレオタイプが正しかった点」「実態と異なった点」「ステレオタイプでは見えていなかった点」を構造化して記録する
2. The 取材パイプライン shall ドラフト信念とギャップ記録を、それぞれ独立した中間データとして保持する
3. The 取材パイプライン shall ドラフト信念を直接書き換えず、ギャップ記録をドラフトとは分離して管理する

### Requirement 4: 最終信念・取材記録の生成フェーズ（新規生成）

**Objective:** As a 取材パイプライン, I want ドラフト信念とギャップ記録の両方を入力として最終信念をゼロから生成できること, so that ステレオタイプのノイズを引き継がずに根拠ある信念ドキュメントが得られる

#### Acceptance Criteria
1. The 取材パイプライン shall ドラフト信念とギャップ記録を参照情報として渡し、最終 `initialBelief` をドラフトの構造に依存せずゼロから生成する
2. The 取材パイプライン shall 最終 `initialBelief` がステレオタイプ的な一般論ではなく、このペルソナ固有の経験・葛藤・価値観を反映した内容になるよう生成する
3. The 取材パイプライン shall 最終 `initialBelief` に基づき、1000字以上の仮想取材記録（`interviewRecord`）をゼロから生成する
4. The 取材パイプライン shall 最終生成フェーズにドラフトを「出発点」としてではなく「比較参照」として扱うことをプロンプトで明示的に指示する

### Requirement 5: 出力インターフェースと検証過程の可視化

**Objective:** As a 管理者, I want 取材パイプラインが最終成果に加えて検証過程（ドラフト信念・検証ギャップ）も出力し、`Phase3Interviews.svelte` で段階的に表示されること, so that 「ステレオタイプ仮説→検証→最終信念」で何が起きたかを追跡できる

#### Acceptance Criteria
1. The 取材パイプライン shall `InterviewOutput` 型に最終成果（`interviewRecord: string`, `initialBelief: string`, `sources: SearchSource[]`）に加え、中間データ（`draftBelief: DraftBelief`, `verificationReport: string`）を含めて出力する
2. The 取材パイプライン shall `SearchSource` の各エントリに `query: string`・`summary: string`・`results: SearchResult[]` を含める
3. When グラウンディングメタデータからURLを取得するとき, the 取材パイプライン shall `SearchResult` の `{ title, url }` 形式に変換して格納する
4. The 取材パイプライン shall `researchSummary` フィールドを出力しない（現行の廃止済み仕様を維持する）
5. The フロントエンド（`personas.svelte.ts`）shall 中間データ（`draftBelief`・`verificationReport`）を Firestore の `interview` に永続化する
6. The 取材結果UI（`Phase3Interviews.svelte`）shall ①ドラフト信念→②検証ギャップ＋参照元→③最終信念→取材記録の順に段階表示する
7. When Markdown文字列（`initialBelief`・`verificationReport`・`interviewRecord`）を表示するとき, the UI shall marked でHTML化し DOMPurify でサニタイズしてから描画する

### Requirement 6: フォールバックとエラー耐性

**Objective:** As a 取材パイプライン, I want 各フェーズで障害が発生しても可能な範囲で処理を継続できること, so that 一部のペルソナ取材失敗が全体を止めない

#### Acceptance Criteria
1. If グラウンディング機能が利用不可のとき, the 取材パイプライン shall エラーを返し、ステレオタイプのドラフトをそのまま出力しない
2. If いずれかのフェーズでLLMエラーが発生したとき, the 取材パイプライン shall `Result` 型でエラーを返し、呼び出し元がリトライ可能にする
3. The 取材パイプライン shall Cloud Functions のタイムアウト（300秒）以内に完了するよう、各フェーズの処理時間を設計する
