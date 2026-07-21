/**
 * Migration: 既存ペルソナへ性自認（gender）と外見表現（genderPresentation）を付与する。
 *
 * 実行方法:
 *   cd functions
 *   npm run build && node lib/scripts/backfill-persona-gender.js [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 *
 * 確定値は推測ではなく、既存ペルソナの名前・家族構成・肩書の記述に既に書かれているものを
 * 明示化したもの。記述から判別できないペルソナは登録せず未設定のまま残し、管理画面から
 * 個別に設定する（判別できないものを推測で埋めない）。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type {
	PersonaGender,
	PersonaGenderPresentation
} from '../types/persona.types.js';

// 既存トピックには性自認と外見表現が乖離する事情のあるペルソナが無いため、両者は一致させる。
const PRESENTATION_OF: Record<PersonaGender, PersonaGenderPresentation> = {
	male: 'masculine',
	female: 'feminine',
	'non-binary': 'androgynous'
};

/**
 * personaId → 性自認。記述の根拠をコメントに残す（後から監査できるようにする）。
 * ここに載っていないペルソナは「記述から判別できなかった」ものとして未設定のまま残す。
 */
export const GENDER_DECISIONS: Record<string, PersonaGender> = {
	// 再審制度見直し法成立
	'LNG_BFbLEwamgNAfYOPAR': 'male', // 郷田照夫・「姉と二人暮らし」
	'P353-5P5LYsuNoQalBH4U': 'female', // 三笠恵子・「夫も弁護士」
	'vY93rHy9xZmBovZkVotjT': 'male', // 堅田信之・「妻と子ども2人」
	'J-ndJwZttQ_d8wnyN_TRR': 'female', // 椋田久美・「夫は広島で開業医」
	'1fz_H0cPjNY7jRaWJPpTj': 'male', // 上遠野雅彦・「妻と成人した子ども2人」
	'WBu8klen_5b953-yhRG7L': 'female', // 日高奈津美・「夫と娘一人」
	'ABAYaLkn-1Nx1St060TlZ': 'female', // 生井田敏子・「夫と二人暮らし」
	'9WwWDv56_tJeC7YnwKmHw': 'male', // 沖山亮太
	'DI-k6MXfkGV2UUsg39MFu': 'female', // 梶谷由美・「夫と子ども一人」
	'UZUs7WMruS4g0Fe4SDrRB': 'male', // 畝原健太・「妻と二人暮らし」
	'4cOajl7RsspU4Ktnn2l_U': 'female', // 別府さゆり・「夫の転勤」

	// 女性天皇を認めるべきか、認めないべきか
	'-hAl4nd5JpfSGH1KUzh5n': 'male', // 徳仁・天皇・「皇后および内親王」
	'y8O8zJt-d5jW6ASQFyOdd': 'female', // 敬宮英子・肩書に「女性皇族」
	'UMZopV3f8M1D0_pl-ZI9G': 'male', // 神田倫太郎・「妻と大学生の息子」
	'R5SiUaFW8MbVYNQKxa0HX': 'male', // 衣笠重信・「妻と娘2人」
	'HwWwcJWZcKA58qMrC6Nwo': 'female', // 郡司美奈子・「夫と暮らす」
	'rQCwyioiOtolpsd3gc6yN': 'female', // 三谷るみ・「夫と3歳の娘」
	'TMNKq64M8rtUC5FHByxNC': 'male', // 氷室大輔・「妻と息子2人」
	'ne49zBy4DaYQOigaC1V3p': 'female', // 垣内ゆき乃・「夫と2人暮らし」
	'koGHYQnSDOzlyOdfptQjx': 'male', // 早乙女泰造・「妻と2人暮らし」
	'Z9H_7s0uLxrbN15qXEin-': 'male', // 竹田恒之・肩書に「男系男子の血筋を引く民間人男性」
	'wlGsx8fr1FoLiu6jxkCCP': 'female', // 日向野彰子
	'BBrCnAVF0R45EK6f3p3S6': 'male', // 椎名恭一郎・「妻と2人暮らし」
	// 苅田真悠 — 中性的な名前・「パートナーと2人暮らし」で記述からは確定できなかったため、
	// 記述の読み取りではなく運用者の判断で確定した値。
	'S1DqHxbGY9DCvfJhDJ0_o': 'male'
};

type PersonaForBackfill = { id: string; gender?: string };

/** 確定していて、かつ未設定のペルソナにだけ書き込む内容を決める */
export const planGenderBackfill = (
	personas: PersonaForBackfill[],
	decisions: Record<string, PersonaGender | string> = GENDER_DECISIONS
): { id: string; gender: PersonaGender; genderPresentation: PersonaGenderPresentation }[] =>
	personas.flatMap((persona) => {
		const gender = decisions[persona.id] as PersonaGender | undefined;
		if (!gender || persona.gender) return [];
		return [{ id: persona.id, gender, genderPresentation: PRESENTATION_OF[gender] }];
	});

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const topics = await db.collection('topics').get();
	const undetermined: string[] = [];
	for (const topic of topics.docs) {
		const snap = await db.collection(`topics/${topic.id}/personas`).get();
		const personas = snap.docs.map((doc) => ({
			id: doc.id,
			name: doc.data().name as string,
			gender: doc.data().gender as string | undefined
		}));
		const plan = planGenderBackfill(personas);
		console.log(`${topic.id}: ${personas.length} personas, ${plan.length} to assign`);
		for (const entry of plan) {
			const name = personas.find((persona) => persona.id === entry.id)?.name;
			console.log(`  ${entry.id} (${name}) -> ${entry.gender} / ${entry.genderPresentation}`);
			if (apply) {
				await db.doc(`topics/${topic.id}/personas/${entry.id}`).update({
					gender: entry.gender,
					genderPresentation: entry.genderPresentation
				});
			}
		}
		for (const persona of personas) {
			if (!persona.gender && !GENDER_DECISIONS[persona.id]) {
				undetermined.push(`${topic.id}/${persona.id} (${persona.name})`);
			}
		}
	}

	// 判別できず未設定のまま残ったものを明示して、管理画面での設定漏れを防ぐ。
	console.log(`\n未設定のまま残ったペルソナ: ${undetermined.length}`);
	for (const entry of undetermined) console.log(`  ${entry}`);
	console.log(apply ? 'applied' : 'dry-run (pass --apply to write)');
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
