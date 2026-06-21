# Requirements Document

## Project Description (Input)
討論Aの LLM 呼び出し待ち中に「討論Aを停止→討論Bを開始」が行われた場合、討論AのLLMレスポンスが返ってきた時点では討論Bが実行中のため `isDebateActive` が true を返してしまう。その結果、討論Aのターンが Firestore に書き込まれ、A と B が並走する状態になる。実行IDにより実行の世代を管理し、旧世代のターン書き込みをブロックする。

## Introduction

討論パイプラインの各ターンは「LLM呼び出し → レスポンス受信 → Firestore書き込み」の順に処理される。この LLM 呼び出し待ちの間に「討論A停止 → 討論B開始」が行われると、討論AのLLMレスポンスが返ってきた時点では討論Bが実行中となっており、`isDebateActive` は true を返す。これにより討論Aのターンが Firestore に書き込まれ、討論A・Bが並走する状態が発生する（競合状態）。この spec は「実行ID（runId）による世代管理」でこの競合を解決する要件を定義する。

## Boundary Context

- **対象**: 討論ターンの Firestore への書き込み処理
- **対象外**: 旧 Cloud Function invocation の強制終了・キャンセル（Cloud Tasks の仕様上不可）
- **対象外**: ターンの読み取り処理・ファシリテーター発言（副作用が小さいため）
- **前提**: Firestore の `topics/{topicId}` ドキュメントが世代の正となる（インメモリ変数ではなく Firestore が信頼の源）

## Requirements

### Requirement 1: 実行IDの発行

**Objective:** 討論の管理者として、討論の開始・再起動のたびに一意の実行IDが発行されることで、各実行を区別できるようにしたい。

#### Acceptance Criteria
1. When 討論が開始される, the 討論パイプライン shall 一意の実行ID（nanoid）を生成し、`topics/{topicId}` ドキュメントの `runId` フィールドに保存する
2. When 討論が再起動される, the 討論パイプライン shall 新しい一意の実行IDを生成し、Firestore の `runId` フィールドを上書きする
3. The 討論パイプライン shall 実行IDを呼び出し元に返し、後続の処理で参照できるようにする

---

### Requirement 2: 実行IDのタスク間引き継ぎ

**Objective:** 討論の管理者として、チャプター処理タスクが自分の実行IDを知ることで、自分が現行世代かどうかを判断できるようにしたい。

#### Acceptance Criteria
1. When 討論の開始・再起動が実行される, the 討論パイプライン shall Cloud Tasks のペイロードに実行IDを含めてチャプタータスクをエンキューする
2. When チャプタータスクが次の章のタスクをエンキューする, the 討論パイプライン shall 同一の実行IDを次のタスクのペイロードに引き継ぐ
3. The 討論パイプライン shall 実行IDをチャプター処理のメモリ内状態（DebateState）に保持し、ターン生成全体を通じて参照できるようにする

---

### Requirement 3: ターン書き込み前の世代照合

**Objective:** 討論の管理者として、旧世代の実行がターンを Firestore に書き込まないことで、再起動後に旧ターンが混入しないようにしたい。

#### Acceptance Criteria
1. While ペルソナターンの LLM 生成が完了した後・Firestore への書き込みの前, the 討論パイプライン shall Firestore の `runId` とタスクが保持する `runId` を照合する
2. If 照合した結果 `runId` が一致しない, then the 討論パイプライン shall ターンを Firestore に書き込まず、以降のターン生成処理をすべて打ち切り、当該チャプター処理を中止する
3. If タスクが保持する `runId` が存在しない（レガシーまたは移行期のタスク）, then the 討論パイプライン shall 世代照合をスキップしターン書き込みを許可する
4. If Firestore の `runId` フィールドが存在しない, then the 討論パイプライン shall 世代照合をスキップしターン書き込みを許可する

---

### Requirement 4: 再起動による旧世代のブロック

**Objective:** 討論の管理者として、再起動後に旧世代の並走が自動的に停止することで、二重書き込みが発生しないようにしたい。

#### Acceptance Criteria
1. When 討論Aの LLM 呼び出し待ち中に討論Aが停止され討論Bが開始された後、討論AのLLMレスポンスが返ってくる, the 討論パイプライン shall 世代照合の失敗により討論Aのターンを Firestore に書き込まない
2. While 旧世代の実行（討論A）と新世代の実行（討論B）が一時的に並走している間, the 討論パイプライン shall 旧世代のターンが Firestore に混入しないことを保証する
3. The 討論パイプライン shall 世代照合の失敗を理由にチャプター処理を中止する際、エラーをスローせず正常終了（null 返却）とする
