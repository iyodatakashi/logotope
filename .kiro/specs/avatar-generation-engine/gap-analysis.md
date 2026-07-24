# 実装ギャップ分析: avatar-generation-engine

> 対象: `.kiro/specs/avatar-generation-engine/requirements.md`（未承認）
> 前提: 先行フィジビリ `persona-avatar-image-generation` の validation（成功パターン）を引き継ぐ。

## 分析サマリー

- **配管はほぼ揃っている**。編集ベースのプロンプト・後処理・seed・検証ハーネスは既に functions 内にコード化済みで、`postprocess.py`／モデルクライアント等も再利用可。**新規に発明する必要があるものは少ない**。
- **最大の未成立点は「一度も 2.5 で実生成・検証されていない」こと**（Req 7）。コードが動いても品質が出るかは未証明で、これが本エンジン成立の唯一のゲートかつ最大リスク。
- **本質的な設計ギャップは2つ**：(a) 本番で1ペルソナに髪型/体型/ポーズ/どの seed を割り当てるかの戦略が無い（フィジビリは CASES 手書き）、(b) 検証コードと本番コードが別実装のまま（Req 1.4 は同一実装を要求）。
- **命名・重複の整合**（male/female→masculine/feminine、AgeBand→Generation、HAIR_CATALOG/後処理定数の二重定義）は既知で機械的。design で決着させれば impl は機械作業。
- 推奨アプローチは **Option C（共有エンジン module ＋ avatars.ts は薄いラッパ）**。Req 1.4「検証と本番を同一実装」がこれをほぼ強制する。

## 1. 現状調査

### 既存資産（再利用可能）
| 資産 | 役割 | 状態 |
|---|---|---|
| `functions/src/avatar/avatar-prompt.ts` | 編集ベースのプロンプト組み立て（`buildAvatarPrompt`） | 掃除済み・再利用可 |
| `functions/src/avatar/avatar-postprocess.ts` | `toAsset`（輝度→アルファ・0.92・接地・256透過PNG） | 決定的・再利用可 |
| `functions/src/avatar/avatar-seeds.ts` | seed taxonomy＋定数 | 越権編集で半改変（要復旧/再実施） |
| `functions/src/avatar/avatar-variation.ts` | 髪型/体型/ポーズ カタログ | 越権編集で半改変（同上） |
| `functions/src/avatar/seeds/*.png`（40枚） | 編集元 seed アンカー（on-style・全10バケット） | 資産・無傷（`male/female` 命名） |
| `functions/src/scripts/build-avatar-seeds.ts` | シート4分割→正規化→seed生成 | `SOURCE_DIR` が移動済み sheets を指し**破損中** |
| `functions/src/scripts/verify-avatar-generation.ts` | 実生成＋枠測定の検証ハーネス | `MODEL='gemini-3.1-flash-image'`（Req は 2.5） |
| `scripts/avatar-generation/postprocess.py` | 後処理のゴールデン参照 | 0.92/接地・再利用可 |
| `scripts/avatar-generation/gemini-image-client.ts` | モデル呼び出し（file添付） | 3.1 ハードコード・2.5化で再利用可 |
| `scripts/avatar-generation/generate.ts` / `run-generation.ts` | 生成オーケストレーション骨格 | 再利用可（呼ぶ prompt を差し替え） |
| `scripts/avatar-generation/variation-spec.ts` | 機械可読カタログ・命名 | HAIR_CATALOG が functions 側と重複 |
| `avatar-materials/*.png`（ルート・10枚） | seed の元素材 | 無傷 |

### 統合面（本番接続点）
- `functions/src/api/avatars.ts` … `runAvatarCore`（生成→後処理→Storage `topics/{topicId}/avatars/{personaId}`→`avatarGeneratedAt`）、`regenerateAvatar`（onCall）。**現状は text-only 生成＝置換対象**。
- `functions/src/pipeline/personas/persona-chain.ts:160` … avatar ステップで `runAvatarCore` を呼ぶ。
- `functions/src/index.ts:15` … `regenerateAvatar` を export。
- `functions/src/constants/ai.constants.ts:19` … `AVATAR_IMAGE_MODEL='gemini-3.1-flash-image'`。
- `functions/src/types/persona.types.ts` … `age`・`genderPresentation`（masculine/feminine/neutral）・`gender`（性自認）。
- `src/lib/sharedComponents/PersonaAvatar.svelte` … 表示（現状は白背景PNGの輝度マスク再着色）。**本仕様スコープ外だが Req 6.4 の独立着色と関連**。

### 規約（structure/tech/testing より）
- Functions は TypeScript strict・ESM（`.js` 拡張子付き import）・アロー関数・省略名禁止。
- テストは `functions/src/tests/` にソース構造をミラー（同一ディレクトリ禁止）。Vitest。AI生成はモック。
- 既存の後処理テスト `functions/src/tests/avatar/avatar-postprocess.test.ts` がゴールデン等価性を担保。

## 2. 要件 → 資産マップ（ギャップ: Missing / Unknown / Constraint）

| Req | 必要な技術要素 | 対応資産 | ギャップ |
|---|---|---|---|
| 1 再現可能コード | 手法一式を実行可能に・数値をコードに・入出力分離・検証=本番同一 | prompt/postprocess/seeds/verify | **Constraint**: 検証と本番が別実装（Req 1.4 未達）。**Constraint**: 0.92/256 が avatar-seeds.ts と avatar-postprocess.ts に二重定義 |
| 2 シード生成 | シート4分割→0.92/接地→256 | build-avatar-seeds.ts | **Constraint**: `SOURCE_DIR` が移動済み sheets を指し破損。`avatar-materials/` へ要修正 |
| 3 編集ベース＋可変軸 | seed添付・軸を指定値で制御・白髪ストローク | avatar-prompt.ts / avatar-variation.ts | **Missing**: 本番で1ペルソナに髪型/体型/ポーズ/アングル/メガネの値を**どう決めるか**（フィジビリは CASES 手書き。persona はこれらを持たない） |
| 4 スケール一貫 | ズーム+目線固定・後処理での自動正規化不採用 | avatar-prompt.ts（35.4%＋相対）/ postprocess | 充足（コード化済み） |
| 5 スタイル基準 | 様式の合否項目 | acceptance-checklist（先行）/ avatar-prompt | **Unknown**: 合否判定はコード化されていない（人＋一部機械）。design で判定手順を定義 |
| 6 後処理・アセット・独立着色・命名 | 輝度→アルファ・256透過・2色独立・命名 | avatar-postprocess.ts | **Constraint**: 独立着色の**表示側**（PersonaAvatar.svelte）はスコープ外。**Unknown**: 本番の保存命名は `personaId`（既存）で、フィジビリの `{ageBandCode}_{gender}_{serial}` とは別モデル |
| 7 受け入れ＋検証 | 2.5で実生成し合否・再現性記録 | verify-avatar-generation.ts | **Missing**: 実行未了（0回）。**Constraint**: verify の MODEL が 3.1（→2.5）。GEMINI_API_KEY・人の目視が必要 |
| 全体 | 破棄経路を継がない | — | **Constraint**: `scripts/prompt-builder.ts`（text-only）と avatars.ts の text-only 経路が残存。前者はフィジビリ記録として保全（不採用・非削除）、後者は本番なので置換で消す |
| 全体 | neutral | — | **Constraint/Unknown**: seed 無し（後回し）。ただし本番が `genderPresentation=neutral` を受けた時の挙動が未定 |

## 3. 実装アプローチ

### Option A: avatars.ts を拡張（既存に手法を埋め込む）
`runAvatarCore` の text-only 部分を、seed選択＋`buildAvatarPrompt`＋file添付＋`toAsset` に差し替える。
- ✅ 既存の Storage/retry/`avatarGeneratedAt`/パイプライン配線をそのまま活用、新規ファイル最小
- ✅ 表面積が小さい
- ❌ **Req 1.4「検証=本番同一」を満たしにくい**（verify が別実装のまま乖離しうる）
- ❌ 生成ロジックが API ハンドラに混在

### Option B: 新規エンジン module に全部出す
生成一式（seed選択・プロンプト・model呼び出し・後処理）を新 module に集約し、avatars.ts も verify もそれを呼ぶだけにする。
- ✅ 関心の分離・単体テスト容易
- ✅ Req 1.4 を素直に満たす
- ❌ avatars.ts の本番固有処理（Firestore読み・Storage保存・lifecycle）まで動かすと過剰

### Option C: ハイブリッド（推奨）
**共有エンジン module**（`build prompt → select seed → generate → postprocess`）を1本作り、`runAvatarCore` は「persona 読み・engine 呼び出し・Storage保存・`avatarGeneratedAt`・retry」を担当、**offline verify は同じ engine を呼ぶ**。
- ✅ Req 1.4「検証と本番を同一実装」を構造で保証（乖離不能）
- ✅ 本番固有（Firestore/Storage）と純粋生成（engine）を分離
- ✅ 既存 avatars.ts の配線・Storage を温存
- ❌ engine の入出力インターフェース設計が要る（persona → 生成入力の写像を明示）

## 4. 工数・リスク

- **工数: M〜L（1〜2週間目安）**。配管は再利用でき新規発明は少ないが、seed選択＋可変軸戦略の設計、共有エンジン化、命名/重複整合、2.5検証の反復が積み上がる。
- **リスク: Medium〜High**。
  - **High**: 編集ベース手法が**一度も実検証されていない**。2.5で枠転写・様式・軸適合が安定しなければ、プロンプト反復（最悪は手法見直し）が発生。
  - **Medium**: 本番の可変軸割り当て戦略が未定（persona スキーマ変更の要否含む）。
  - **Low**: 命名/重複/破損パス修正は機械的。

## 5. design へ引き継ぐ推奨と Research Needed

### 推奨アプローチ
- **Option C（共有エンジン module ＋ avatars.ts 薄ラッパ ＋ verify も同 engine）**。
- design の Components に必ず落とす（steering `spec-dependencies.md` 準拠）:
  - 使う入力アセット（`seeds/`）とその**選択規則**（persona → 世代×外見表現→バケット→どの index）
  - **固定するパラメータ**（0.92/接地・256・影しきい値36・顔高45%）を**単一定義**に
  - **可変にするパラメータ**（髪型/体型/ポーズ/アングル/メガネ）の**割り当て源**
  - **合否ゲート**（機械: 枠。人: 様式・顔非描写・軸適合）
  - 破棄リスト（text-only prompt-builder / avatars.ts text-only 経路）＝継がない

### Research Needed（design で決着させる）
1. **2.5 検証の実行**（Req 7・最重要ゲート）: 実生成→枠転写・様式・再現性を確認。GEMINI_API_KEY＋人の目視が要る。
2. **本番の可変軸割り当て戦略**（Req 3）: 髪型/体型/ポーズ/アングル/メガネと「4枚中どの seed」を、ランダムか personaId 安定ハッシュか persona スキーマ追加か。再現性（Req 1）との整合。
3. **neutral 受領時の挙動**（スコープ外だが本番は受けうる）: masc/fem へマップか、生成スキップか。
4. **命名・重複の一本化方針**（Req 1.2）: male/female→masculine/feminine（seedファイル40枚＋importer）、AgeBand→Generation、HAIR_CATALOG 単一化、後処理定数 単一化。
5. **破棄経路の扱い**: フィジビリコード（scripts/avatar-generation）は**削除せず記録として保全**。text-only は「再利用しない」だけ。消してよいのは本番 avatars.ts の text-only 経路のみ。
6. **（スコープ外・要フラグ）表示側の独立着色**（Req 6.4）: PersonaAvatar.svelte の現行輝度マスク方式とアルファ資産の整合は後続。

### 前提として要る復旧（design 開始前・最小限）
- 越権で半改変した `avatar-seeds.ts` / `avatar-variation.ts` を一貫状態へ戻す（または design 決定に合わせて作り直す前提で放置）。
- `build-avatar-seeds.ts` の `SOURCE_DIR` を `avatar-materials/` へ（seed 再生成が必要になった時に効く）。
