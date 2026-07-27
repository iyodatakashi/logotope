import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	EditorialForFirestore,
	EditorialStatus,
	Narration,
	ImpressionForFirestore,
	Impression
} from '$lib/models/editorial/editorial.types';

// 統合保存 editorial/outputs（導入・締め・所感）を購読し、記事要素を進捗ステータス付きで公開する。
// 導入/締め/所感を1ドキュメントに集約した唯一のストア（旧 intro/outro・所感の各ストアはこれに統合済み）。
// ステータス欠落の既存データは完了（finished）として正規化し（過去の run で処理済みのため。成否は内容から算出）、
// ドキュメント自体が無い場合の既定は生成待ち（pending）にする（Req 7.1, 7.2）。
export const createEditorialStore = (topicId: string) => {
	const pending = (): Narration => ({ status: 'pending', draft: null, final: null });

	// status 欠落は finished に backfill（既存ドキュメント要素は処理済みとみなす）。
	const normalizeStatus = (status: EditorialStatus | undefined): EditorialStatus =>
		status ?? 'finished';

	const normalizeNarration = (part: Partial<Narration> | undefined): Narration =>
		part
			? { status: normalizeStatus(part.status), draft: part.draft ?? null, final: part.final ?? null }
			: { status: 'finished', draft: null, final: null };

	const toImpressions = (
		map: Record<string, ImpressionForFirestore> | undefined
	): Impression[] =>
		Object.entries(map ?? {})
			.map(([personaId, part]) => ({
				personaId,
				sortOrder: part.sortOrder,
				status: normalizeStatus(part.status),
				draft: part.draft ?? null,
				final: part.final ?? null
			}))
			.sort((a, b) => a.sortOrder - b.sortOrder);

	let intro = $state<Narration>(pending());
	let outro = $state<Narration>(pending());
	let impressions = $state<Impression[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'editorial', 'outputs'), (snap) => {
			if (!snap.exists()) {
				// ドキュメント自体が無い＝未開始。生成待ちを既定にする。
				intro = pending();
				outro = pending();
				impressions = [];
				isLoaded = true;
				return;
			}
			const data = snap.data() as Partial<EditorialForFirestore>;
			intro = normalizeNarration(data.intro);
			outro = normalizeNarration(data.outro);
			// 永続形（personaId キーのマップ）は境界でフロント用 Impression 配列に変換して保持する。
			impressions = toImpressions(data.impressions);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get intro() {
			return intro;
		},
		get outro() {
			return outro;
		},
		get impressions() {
			return impressions;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};

export type EditorialStore = ReturnType<typeof createEditorialStore>;
