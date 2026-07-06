import { getFirestore } from 'firebase-admin/firestore';
import { evaluateEngagement } from '../../agents/persona-agent.js';
import { appendAwareness } from './awareness.js';
import type { Engagement, DebateState } from '../../types/debate.types.js';
import type { ChapterEntry } from '../../types/chapter.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

/**
 * 傾聴で検出した気づき（Engagement.awareness）を話者選択の前に永続する。
 * appendAwareness は渡した persona の in-memory awarenesses も同一参照で更新するため、
 * 同一ターンで選ばれた話者の発言生成が直前の気づきを反映できる。
 * best-effort（永続に失敗しても評価・討論は継続する）。
 */
const persistDetectedAwareness = async (
	topicId: string,
	personas: Persona[],
	engagements: Engagement[],
	turnId: string
): Promise<void> => {
	for (const engagement of engagements) {
		if (!engagement.awareness) continue;
		const persona = personas.find((candidate) => candidate.id === engagement.personaId);
		if (!persona) continue;
		try {
			await appendAwareness({ topicId, persona, turnId, awareness: engagement.awareness });
		} catch (err) {
			console.error(`[awareness] append failed for ${persona.id}: ${err}`);
		}
	}
};

/**
 * 各ペルソナの意欲評価を engagements ドキュメントの history.<turnId> に保存する。
 * mergeFields で当該ターンのエントリだけを更新し、既存の queuedIntents 等は壊さない。
 */
const saveEngagements = async (params: {
	topicId: string;
	chapterId: string;
	turnId: string;
	engagements: Array<{
		personaId: string;
		score: number;
		mode: 'opinion' | 'fact' | 'none' | 'question';
		intentSummary?: string;
	}>;
}): Promise<void> => {
	for (const engagement of params.engagements) {
		const ref = db().doc(
			`topics/${params.topicId}/chapters/${params.chapterId}/engagements/${engagement.personaId}`
		);
		const entry: Record<string, unknown> = { score: engagement.score, mode: engagement.mode };
		if (engagement.intentSummary !== undefined) entry.intentSummary = engagement.intentSummary;
		await ref.set(
			{ history: { [params.turnId]: entry } },
			{ mergeFields: [`history.${params.turnId}`] }
		);
	}
};

/**
 * 同一 turnId で既に永続された意欲評価を読み、再利用できる形（score/mode、question は intentSummary）
 * なら Engagement として返す。未永続・不十分・読み取り失敗は null（呼び出し側が従来評価にフォールバック）。
 * awareness は再利用しない（初回評価時に永続済みのため null で返し、同一ターンでの再検出を避ける）。
 */
const readReusableEngagement = async (
	topicId: string,
	chapterId: string,
	personaId: string,
	turnId: string
): Promise<Engagement | null> => {
	try {
		const snap = await db()
			.doc(`topics/${topicId}/chapters/${chapterId}/engagements/${personaId}`)
			.get();
		const history = snap.get('history') as
			| Record<string, { score?: unknown; mode?: unknown; intentSummary?: unknown }>
			| undefined;
		const entry = history?.[turnId];
		if (!entry) return null;
		const { score, mode, intentSummary } = entry;
		if (typeof score !== 'number') return null;
		if (mode !== 'opinion' && mode !== 'fact' && mode !== 'none' && mode !== 'question')
			return null;
		// question は intentSummary が無いと発言生成に使えない → 再利用に不十分としてフォールバック
		if (mode === 'question' && typeof intentSummary !== 'string') return null;
		return {
			personaId,
			score,
			mode,
			intentSummary: typeof intentSummary === 'string' ? intentSummary : undefined,
			awareness: null
		};
	} catch {
		return null;
	}
};

export const evaluateEngagements = async ({
	topicId,
	chapterId,
	personas,
	state,
	chapterTurns
}: {
	topicId: string;
	chapterId: string;
	personas: Persona[];
	state: DebateState;
	chapterTurns: ReadonlyArray<DebateTurn>;
}): Promise<Engagement[]> => {
	// 直前話者は連続発言させないため評価対象から外す（必要なら後で個別フォールバック評価する）
	const assessTargets = personas.filter((persona) => persona.id !== state.lastSpeakerId);
	const turnId = chapterTurns[chapterTurns.length - 1]?.id ?? '';
	// 同一ターン状態（同一 turnId）に評価が既に永続されていれば LLM 再評価せず再利用する（2.2）。
	// 未永続（新規ターン状態）・永続値が不十分なペルソナは従来どおり評価する。線形進行では毎ターン
	// turnId が変わるため通常は全評価。ステップ再実行・リトライで同一 turnId を再処理する場合のみ省く。
	const engagements = await Promise.all(
		assessTargets.map(async (persona) => {
			const reused = turnId
				? await readReusableEngagement(topicId, chapterId, persona.id, turnId)
				: null;
			if (reused) return reused;
			const otherPersonaNames = personas
				.filter((otherPersona) => otherPersona.id !== persona.id)
				.map((otherPersona) => otherPersona.name);
			return evaluateEngagement(persona, [...chapterTurns], otherPersonaNames, personas);
		})
	);
	await saveEngagements({
		topicId,
		chapterId,
		turnId,
		engagements: engagements.map((engagement) => ({
			personaId: engagement.personaId,
			score: engagement.score,
			mode: engagement.mode,
			intentSummary: engagement.intentSummary
		}))
	});
	// 傾聴で検出した気づきを話者選択の前に永続する（同一ターンの発言に反映させる・3.1/3.3）
	await persistDetectedAwareness(topicId, personas, engagements, turnId);
	return engagements;
};

/** engagements に含まれない話者（直前話者など）を個別評価してフォールバックする */
export const evaluateEngagementWithFallback = async ({
	topicId,
	personaId,
	personas,
	chapterTurns,
	engagements = []
}: {
	topicId: string;
	personaId: string;
	personas: Persona[];
	chapterTurns: ReadonlyArray<DebateTurn>;
	engagements?: Engagement[];
}): Promise<Engagement> => {
	// 一括評価の結果に含まれていればそれを使う（再評価を避ける。気づきは evaluateEngagements で永続済み）
	const fromList = engagements.find((engagement) => engagement.personaId === personaId);
	if (fromList) return fromList;
	const persona = personas.find((candidate) => candidate.id === personaId);
	// ペルソナが見つからない異常系は中間値 score=2 を返して処理を継続させる
	if (!persona) return { personaId, mode: 'opinion' as const, score: 2 };
	const otherPersonaNames = personas
		.filter((otherPersona) => otherPersona.id !== personaId)
		.map((otherPersona) => otherPersona.name);
	const engagement = await evaluateEngagement(
		persona,
		[...chapterTurns],
		otherPersonaNames,
		personas
	);
	// フォールバック評価で新たに検出した気づきも話者選択の前に永続する
	const turnId = chapterTurns[chapterTurns.length - 1]?.id ?? '';
	await persistDetectedAwareness(topicId, personas, [engagement], turnId);
	return engagement;
};

/** 破棄した各章の engagements サブコレクションを削除する */
export const deleteChapterEngagements = async (
	topicId: string,
	chapters: ChapterEntry[]
): Promise<void> => {
	for (const chapter of chapters) {
		const engSnap = await db()
			.collection(`topics/${topicId}/chapters/${chapter.id}/engagements`)
			.get();
		for (const engDoc of engSnap.docs) {
			await engDoc.ref.delete();
		}
	}
};
