import { summarizeChapter } from '../../agents/debate-digest-agent.js';
import { getChaptersByTopicId } from './chapter.js';
import { getBelief } from './awareness.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getTopicById } from '../topics/topics.js';
import type { Result, PipelineError } from '../../types/common.types.js';
import type {
	DebateDigest,
	ChapterDigest,
	PersonaDigest
} from '../../types/debate-digest.types.js';

// 討論を消費者中立に圧縮した DebateDigest を組み立てる。原本章と承認済みペルソナ（信念・気づき）を
// 読み、章ごとに summarizeChapter で圧縮する。イントロ・アウトロ固有の意図は混ぜない（将来の
// 事後コメント生成でも再利用できる形）。全章の要約成功でダイジェストを返し、1章でも失敗すれば
// エラーを返す（部分成功を許容しない）。Firestore には保存しない（呼び出し側でメモリ消費）。

export const buildDebateDigest = async (
	topicId: string
): Promise<Result<DebateDigest, PipelineError>> => {
	const [topic, chapters, personas] = await Promise.all([
		getTopicById(topicId),
		getChaptersByTopicId(topicId),
		getPersonasByTopicId(topicId)
	]);

	if (!topic) {
		return { ok: false, error: { code: 'NOT_FOUND', resource: `topic:${topicId}` } };
	}

	const selectedPersonas = personas.filter((persona) => persona.selected);

	const chapterDigests: ChapterDigest[] = [];
	for (const chapter of chapters) {
		const summary = await summarizeChapter({
			title: chapter.title,
			agenda: chapter.agenda,
			turns: chapter.turns,
			personas: selectedPersonas
		});
		if (!summary.ok) return summary;
		chapterDigests.push({
			title: chapter.title,
			agenda: chapter.agenda,
			summary: summary.value
		});
	}

	const personaDigests: PersonaDigest[] = selectedPersonas.map((persona) => ({
		personaId: persona.id,
		name: persona.name,
		stance: getBelief(persona),
		beliefShifts: (persona.awarenesses ?? []).map((awareness) => awareness.content)
	}));

	return {
		ok: true,
		value: {
			topicTitle: topic.title,
			chapters: chapterDigests,
			personas: personaDigests
		}
	};
};
