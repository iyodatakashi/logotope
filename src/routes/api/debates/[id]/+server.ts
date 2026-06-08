import { json, error } from '@sveltejs/kit';
import {
	getPublishedDebateById,
	getPersonaBeliefHistoryByTopicId
} from '$lib/server/dataconnect.js';
import type {
	PublishedDebateDetail,
	PersonaSummaryForViewer,
	PublishedTurn,
	BeliefChangeTrigger,
	PublishedComment
} from '$lib/types/index.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	const session = await getPublishedDebateById(id);
	if (!session || !session.publishedAt) {
		error(404, 'Debate not found');
	}

	const personaProfiles = await getPersonaBeliefHistoryByTopicId(session.topic.id);

	const personas: PersonaSummaryForViewer[] = personaProfiles.map((p) => ({
		id: p.id,
		name: p.name,
		role: p.stakeholderRole,
		beliefHistory: (p.personaBeliefs_on_persona ?? []).map((b) => ({
			version: b.version,
			content: b.content,
			...(b.changeType ? { changeType: b.changeType as 'opinion_change' | 'partial_acceptance' } : {}),
			...(b.changeSummary ? { changeSummary: b.changeSummary } : {}),
			...(b.triggeredByTurnId ? { triggeredByTurnId: b.triggeredByTurnId } : {})
		}))
	}));

	const turns: PublishedTurn[] = session.debateTurns_on_session
		.sort((a, b) => a.turnIndex - b.turnIndex)
		.map((t) => {
			const beliefChangesTriggered: BeliefChangeTrigger[] = (
				t.personaBeliefs_on_triggeredByTurn ?? []
			)
				.filter((b) => b.changeType)
				.map((b) => ({
					personaId: b.persona?.id ?? '',
					personaName: b.persona?.name ?? '',
					changeType: b.changeType as 'opinion_change' | 'partial_acceptance',
					changeSummary: b.changeSummary ?? ''
				}));

			return {
				id: t.id,
				turnIndex: t.turnIndex,
				speakerType: t.speakerType as 'facilitator' | 'persona',
				speakerName: t.persona?.name ?? 'ファシリテーター',
				speakerRole: t.persona?.stakeholderRole ?? '',
				content: t.content,
				beliefChangesTriggered
			};
		});

	const postDebateComments: PublishedComment[] = session.postDebateComments_on_session
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((c) => ({
			personaId: c.persona?.id ?? '',
			personaName: c.persona?.name ?? '',
			personaRole: c.persona?.stakeholderRole ?? '',
			content: c.content
		}));

	const detail: PublishedDebateDetail = {
		id: session.id,
		topicTitle: session.topic.title,
		personas,
		turns,
		postDebateComments
	};

	return json(detail);
};
