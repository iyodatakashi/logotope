# Implementation Plan

- [ ] 1. (P) ペルソナ語り口スタイルガイドの実装
- [x] 1.1 属性から語り口指針を生成する `buildSpeechStyleGuide` 純粋関数を追加する
  - ペルソナの年齢・職業キーワードから経験レベル（若手/中堅/ベテラン）を推定し、対応する語り口パターン（口語体・業界語・経験談）を記述する
  - `stakeholderRole` から権威レベルを推定し、上位地位は断言的・謙遜なし、下位地位は遠慮がち・疑問形を指示する
  - `gender` フィールドが存在する場合のみ微細な語り口差を加え、ない場合はスキップする
  - 出力は必ず3〜5行以内の自然言語テキストとし、特定の立場への誘導を含まない
  - 関数単体でテスト可能な純粋関数として実装され、属性が変われば語り口指針も変わることを確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - _Boundary: persona-agent.ts_

- [x] 1.2 スタイルガイドをシステムプロンプトとツール定義に統合する
  - `buildPersonaSystemPrompt` 内で `buildSpeechStyleGuide` を呼び出し、「発言スタイルの厳守事項」セクションの先頭にペルソナ固有の語り口指針を配置する
  - `TURN_TOOL` の `content` フィールド説明にも一行でスタイル要約を追記し、LLMがツール定義からも語り口を意識できるようにする
  - 若手ペルソナと経営者ペルソナのプロンプト内容を比較して語り口指針が明確に異なることを確認できる
  - _Requirements: 2.1, 2.5_

- [ ] 2. (P) ファシリテーターエージェントの改善
- [x] 2.1 (P) `selectNextSpeaker` に直前発言者除外機能を追加する
  - 関数シグネチャに `excludePersonaId?: string` 引数を追加する
  - プロンプトに「直前の発言者（指名で明示）は他に候補がある限り選ばないこと」を追記する
  - `personas.length === 1` の場合は除外ルールを無視することをプロンプトで明示する
  - 呼び出し箇所がない状態でも既存動作を変えず、引数未指定時は従来通り動作する
  - _Requirements: 1.1, 1.3_
  - _Boundary: facilitator-agent.ts_

- [x] 2.2 (P) `evaluateIntervention` に累計発言数を渡せるよう拡張する
  - 関数シグネチャに `speakCount: Map<string, number>` 引数を追加する
  - プロンプトに各ペルソナの累計発言数を列挙し、「発言数が少なく現在の論点との関連性が高い人を優先してinviteせよ」と指示する
  - `shouldIntervene=false` を返す場合も含め、既存の topic_shift・close 動作に影響しないことを確認できる
  - _Requirements: 3.4_
  - _Boundary: facilitator-agent.ts_

- [ ] 3. オーケストレーターの討論制御ロジック改善
- [x] 3.1 `DebateState` に連続発言防止・介入制御用フィールドを追加する
  - `lastSpeakerId: string | undefined`（連続発言防止用）を追加し、初期値を `undefined` とする
  - `consecutiveDirectExchanges: number`（直接やりとりの連続回数）を追加し、初期値を `0` とする
  - `lastFacilitatorTurnIndex: number`（最後のファシリテーター発言ターン番号）を追加し、初期値を `0` とする
  - `resume()` のステート再構築で `lastFacilitatorTurnIndex` を既存ターン履歴から再計算する（`speakerType === 'facilitator'` の最大 `turnIndex`）
  - 型定義に追加後に `tsc` がエラーなく通る
  - _Requirements: 1.1, 1.4, 3.1, 3.2_
  - _Depends: 2.1_

- [x] 3.2 `shouldEvaluateIntervention` 純粋関数を実装する
  - 緊急沈黙チェック: `silenceMap` の最大値が `personas.length` を超える場合は `true` を返す（最優先）
  - 直接やりとり継続チェック: `consecutiveDirectExchanges >= 2` かつ `lastFacilitatorTurnIndex` から `interventionInterval * 2` 以内の場合は `false` を返す
  - 区切り検出: `consecutiveDirectExchanges === 0`（直接指名なしのターン）の場合は `true` を返す
  - 最大間隔超過: `currentTurnIndex - lastFacilitatorTurnIndex >= interventionInterval` の場合は `true` を返す
  - すべての条件に該当しない場合は `false` を返す
  - 各ブランチを分離してユニットテスト可能な純粋関数として実装される
  - _Requirements: 3.1, 3.2, 3.5, 3.6_
  - _Depends: 3.1_

- [x] 3.3 `evaluateParticipationBalance` 純粋関数を実装する
  - 全ペルソナの `speakCount` 平均を計算し、平均の50%以下の累計発言数のペルソナを抽出して返す
  - 全員均等な場合は空配列を返し、空配列のときは介入評価を呼ばない
  - 討論開始直後（全員0回）は平均0のため全員が候補になるが、`lastFacilitatorTurnIndex === 0` の場合は上位の `shouldEvaluateIntervention` がfalseを返すので実質スキップされる
  - 1ペルソナ・複数ペルソナ均等・偏りありの各パターンで期待する出力を返すことを確認できる
  - _Requirements: 3.3_
  - _Depends: 3.1_

- [x] 3.4 `executeDebate` ループを新制御ロジックで組み直す
  - 発言者選択: `lastAddressedPersonaId` が存在する場合はそれを使い `consecutiveDirectExchanges++`、存在しない場合は `selectNextSpeaker(history, personas, silenceMap, state.lastSpeakerId)` を呼び `consecutiveDirectExchanges = 0` にリセットする
  - 介入評価: `shouldEvaluateIntervention` で評価要否を判定し、trueの場合のみ `evaluateParticipationBalance` で発言不足ペルソナを確認してから `evaluateIntervention(history, personas, state.speakCount)` を呼ぶ
  - ファシリテーター介入（topic_shift・invite）が発生した場合は `lastFacilitatorTurnIndex = currentTurnIndex` と `consecutiveDirectExchanges = 0` をセットする
  - 各ターン後に `state.lastSpeakerId = persona.id` を更新する
  - `silenceThreshold` を固定値から `personas.length` の動的値に変更する
  - 同一ペルソナが連続して `savedTurn.personaId` に現れず、介入評価が固定間隔ではなく状態に応じて実行されることを確認できる
  - _Requirements: 1.2, 1.4, 3.1, 3.2, 3.3, 3.5, 3.6_
  - _Depends: 3.2, 3.3, 2.1, 2.2_

- [x] 3.5 討論終了条件とデフォルトオプションを更新する
  - `DEFAULT_OPTIONS.maxTurns` を `200` に変更してセーフティネット専用にする
  - ファシリテーターの `close` 判断＋全ペルソナ `minTurnsPerPersona` 達成が主終了条件であることは既存ロジックのままとし、コメントで意図を明確にする
  - `maxTurns=200` でビルドが通り、従来の終了ロジックが壊れていないことを確認できる
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 3.4_

- [x] 4. テストとビルド検証
- [x] 4.1 (P) `shouldEvaluateIntervention` と `evaluateParticipationBalance` の単体テストを書く
  - `shouldEvaluateIntervention`: 緊急沈黙・直接やりとり継続・区切り・最大間隔超過の各パターンで期待するbooleanを返すことを検証する
  - `evaluateParticipationBalance`: 発言数均等・偏りあり・1名の各ケースで期待するペルソナリストを返すことを検証する
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_
  - _Boundary: debate-orchestrator.ts tests_

- [x]* 4.2 (P) `buildSpeechStyleGuide` の単体テストを書く
  - 若手・ベテラン・経営者ペルソナの属性を入力したとき、各カテゴリに対応するキーワードがスタイルガイドテキストに含まれることを検証する
  - `gender` フィールドありとなしの両パターンで例外なく動作することを検証する
  - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7, 2.8_
  - _Boundary: persona-agent.ts tests_

- [x] 4.3 Functions ビルドと型チェックを通す
  - `npm run build` がエラーなく完了する
  - 変更した全ファイルに TypeScript 型エラーがない
  - _Depends: 4.1_
