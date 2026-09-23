/**
 * 【実行済みの記録。現行スキーマでは動作しない】
 * homePrefecture / nationality を持っていた時代の移行スクリプト。所在は country? / prefecture? の
 * 任意2項目へ改名済みで（topic-intent-fidelity）、この処理の対象データはもう存在しない。
 * 当時どの根拠で土地を確定したか（背景文の地名・手動確定）を残すために保存しており、再実行はしない。
 * 現行スキーマへの改名そのものは backfill-persona-location.ts が行う。
 *
 * Migration: 既存ペルソナへ居住都道府県を付与する。
 *
 * homePrefecture は姓の地域性を決める入力として新設したフィールド。既存ペルソナは姓を持つが
 * 居住地を構造として持たないため、背景文に既に書かれている土地を明示化して揃える。
 *
 * 実行方法:
 *   cd functions
 *   npx tsx src/scripts/backfill-persona-home-prefecture.ts [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 *
 * 確定値は推測ではなく、背景・関心事の記述に既に書かれている地名を都道府県へ正規化したもの。
 * 記述から判別できないペルソナは MANUAL_DECISIONS に根拠付きで載せる（自動導出で埋めない）。
 * 日本国外に暮らす人物は空文字（居住地が都道府県でないことを表す正しい値）。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PREFECTURES } from '../constants/surname-regions.js';
import type { PersonaForFirestore } from '../types/persona.types.js';

/** 背景文によく出る市区・地域名 → 都道府県。県名を書かず市名だけ書く記述を拾う */
const PLACE_TO_PREFECTURE: Record<string, string> = {
	札幌: '北海道',
	函館: '北海道',
	旭川: '北海道',
	青森: '青森県',
	弘前: '青森県',
	八戸: '青森県',
	盛岡: '岩手県',
	釜石: '岩手県',
	陸前高田: '岩手県',
	仙台: '宮城県',
	石巻: '宮城県',
	気仙沼: '宮城県',
	秋田: '秋田県',
	山形: '山形県',
	酒田: '山形県',
	福島: '福島県',
	郡山: '福島県',
	いわき: '福島県',
	水戸: '茨城県',
	宇都宮: '栃木県',
	前橋: '群馬県',
	高崎: '群馬県',
	さいたま: '埼玉県',
	川越: '埼玉県',
	千葉: '千葉県',
	船橋: '千葉県',
	柏: '千葉県',
	東京: '東京都',
	二三区: '東京都',
	世田谷: '東京都',
	杉並: '東京都',
	練馬: '東京都',
	新宿: '東京都',
	渋谷: '東京都',
	足立: '東京都',
	江戸川: '東京都',
	八王子: '東京都',
	横浜: '神奈川県',
	川崎: '神奈川県',
	相模原: '神奈川県',
	藤沢: '神奈川県',
	鎌倉: '神奈川県',
	新潟: '新潟県',
	長岡: '新潟県',
	富山: '富山県',
	金沢: '石川県',
	福井: '福井県',
	甲府: '山梨県',
	長野: '長野県',
	松本: '長野県',
	岐阜: '岐阜県',
	静岡: '静岡県',
	浜松: '静岡県',
	名古屋: '愛知県',
	豊田: '愛知県',
	津: '三重県',
	四日市: '三重県',
	大津: '滋賀県',
	京都: '京都府',
	大阪: '大阪府',
	堺: '大阪府',
	東大阪: '大阪府',
	神戸: '兵庫県',
	姫路: '兵庫県',
	尼崎: '兵庫県',
	奈良: '奈良県',
	和歌山: '和歌山県',
	鳥取: '鳥取県',
	松江: '島根県',
	岡山: '岡山県',
	倉敷: '岡山県',
	広島: '広島県',
	福山: '広島県',
	山口: '山口県',
	下関: '山口県',
	徳島: '徳島県',
	高松: '香川県',
	松山: '愛媛県',
	高知: '高知県',
	福岡: '福岡県',
	北九州: '福岡県',
	佐賀: '佐賀県',
	長崎: '長崎県',
	佐世保: '長崎県',
	熊本: '熊本県',
	大分: '大分県',
	別府市: '大分県',
	宮崎: '宮崎県',
	鹿児島: '鹿児島県',
	那覇: '沖縄県',
	沖縄: '沖縄県',
	宜野湾: '沖縄県',
	名護: '沖縄県'
};

/**
 * 背景の記述から自動では判別できなかったペルソナの確定値。根拠をコメントに残す。
 * dry-run の「判別できず」一覧を見て、記述を確認した上で登録する。
 */
export const MANUAL_DECISIONS: Record<string, string> = {
	// 徳仁・「皇居・宮殿および赤坂御用地内の御所に暮らす」。皇居は東京都千代田区
	'-hAl4nd5JpfSGH1KUzh5n': '東京都'
};

type Row = { topicId: string; personaId: string; name: string; prefecture: string; reason: string };

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');

	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const snap = await db.collectionGroup('personas').get();
	const resolved: Row[] = [];
	const unresolved: Array<{ ref: string; name: string; background: string }> = [];

	for (const doc of snap.docs) {
		const persona = doc.data() as PersonaForFirestore;
		const topicId = doc.ref.parent.parent!.id;
		const decided = decide(persona, doc.id);
		if (decided === null) {
			unresolved.push({
				ref: `${topicId}/${doc.id}`,
				name: persona.name,
				background: (persona.background ?? '').slice(0, 120)
			});
			continue;
		}
		resolved.push({ topicId, personaId: doc.id, name: persona.name, ...decided });
	}

	console.log(
		`ペルソナ ${snap.size}体 / 確定 ${resolved.length}体 / 判別できず ${unresolved.length}体\n`
	);
	for (const row of resolved) {
		console.log(`  ${row.name}\t→ ${row.prefecture || '(国外)'}\t[${row.reason}]`);
	}
	if (unresolved.length > 0) {
		console.log('\n--- 判別できず（MANUAL_DECISIONS へ根拠付きで登録する）---');
		for (const row of unresolved) console.log(`  ${row.ref}\t${row.name}\t${row.background}`);
	}

	if (!apply) {
		console.log('\n(dry-run: 書き込みなし。--apply で反映)');
		return;
	}
	if (unresolved.length > 0) {
		throw new Error(
			'判別できないペルソナが残っています。MANUAL_DECISIONS を埋めてから --apply してください'
		);
	}

	const batch = db.batch();
	for (const row of resolved) {
		batch.update(db.doc(`topics/${row.topicId}/personas/${row.personaId}`), {
			prefecture: row.prefecture
		});
	}
	await batch.commit();
	console.log(`\n${resolved.length}体を更新しました`);
};

/** 確定値と根拠を返す。判別できなければ null */
const decide = (
	persona: PersonaForFirestore,
	personaId: string
): { prefecture: string; reason: string } | null => {
	const manual = MANUAL_DECISIONS[personaId];
	if (manual !== undefined) return { prefecture: manual, reason: '手動確定' };

	// 日本国外に暮らす人物。居住地が都道府県でないことを空文字で表す
	if (persona.country && !persona.country.includes('日本')) {
		return { prefecture: '', reason: `国 ${persona.country}` };
	}

	const prose = `${persona.background ?? ''}\n${persona.interests ?? ''}\n${persona.occupation ?? ''}`;
	const byPrefecture = PREFECTURES.find((prefecture) => prose.includes(prefecture));
	if (byPrefecture) return { prefecture: byPrefecture, reason: `記述に「${byPrefecture}」` };

	// 「○○県」表記でない県名（例: 「新潟の農家」）
	const byBareName = PREFECTURES.find((prefecture) =>
		prose.includes(prefecture.replace(/[都道府県]$/, ''))
	);
	if (byBareName)
		return { prefecture: byBareName, reason: `記述に「${byBareName.replace(/[都道府県]$/, '')}」` };

	const place = Object.keys(PLACE_TO_PREFECTURE).find((name) => prose.includes(name));
	if (place) return { prefecture: PLACE_TO_PREFECTURE[place], reason: `記述に「${place}」` };

	return null;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
