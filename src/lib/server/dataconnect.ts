import { initializeApp, getApps } from 'firebase/app';
import {
	getDataConnect,
	connectDataConnectEmulator,
	queryRef,
	executeQuery
} from 'firebase/data-connect';

const connectorConfig = {
	connector: 'logotope',
	service: 'logotope',
	location: 'asia-northeast1'
};

let _dc: ReturnType<typeof getDataConnect> | null = null;

function getDC() {
	if (_dc) return _dc;

	const projectId =
		(typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) ||
		process.env.VITE_FIREBASE_PROJECT_ID ||
		'demo-logotope';

	const app =
		getApps()[0] ||
		initializeApp({
			projectId,
			apiKey: 'placeholder',
			authDomain: `${projectId}.firebaseapp.com`
		});

	_dc = getDataConnect(app, connectorConfig);

	const emulatorHost =
		(typeof import.meta !== 'undefined' && import.meta.env?.VITE_DATA_CONNECT_EMULATOR_HOST) ||
		process.env.VITE_DATA_CONNECT_EMULATOR_HOST;

	if (emulatorHost || process.env.NODE_ENV !== 'production') {
		const host = emulatorHost || 'localhost';
		const port = parseInt(process.env.DATA_CONNECT_EMULATOR_PORT || '9399', 10);
		connectDataConnectEmulator(_dc, host, port);
	}

	return _dc;
}

export interface PublishedSessionRow {
	id: string;
	totalTurns: number | null;
	publishedAt: string;
	topic: { id: string; title: string };
}

export interface PersonaBeliefRow {
	id: string;
	version: number;
	content: string;
	changeType?: string | null;
	changeSummary?: string | null;
	triggeredByTurnId?: string | null;
}

export interface PersonaProfileRow {
	id: string;
	name: string;
	stakeholderRole: string;
	personaBeliefs_on_persona?: PersonaBeliefRow[];
}

export interface DebateTurnRow {
	id: string;
	turnIndex: number;
	speakerType: string;
	content: string;
	persona?: { id: string; name: string; stakeholderRole: string } | null;
	personaBeliefs_on_triggeredByTurn?: Array<{
		id: string;
		changeType?: string | null;
		changeSummary?: string | null;
		persona?: { id: string; name: string } | null;
	}>;
}

export interface PostDebateCommentRow {
	id: string;
	content: string;
	sortOrder: number;
	persona?: { id: string; name: string; stakeholderRole: string } | null;
}

export interface PublishedDebateDetailRow {
	id: string;
	totalTurns: number | null;
	publishedAt: string | null;
	topic: { id: string; title: string };
	debateTurns_on_session: DebateTurnRow[];
	postDebateComments_on_session: PostDebateCommentRow[];
	personaProfiles_on_topic?: PersonaProfileRow[];
}

export async function getPublishedDebates(): Promise<PublishedSessionRow[]> {
	const dc = getDC();
	const ref = queryRef(dc, 'GetPublishedDebates');
	const result = await executeQuery(ref);
	return ((result.data as { debateSessions: PublishedSessionRow[] }).debateSessions) ?? [];
}

export async function getPublishedDebateById(
	sessionId: string
): Promise<PublishedDebateDetailRow | null> {
	const dc = getDC();
	const ref = queryRef(dc, 'GetPublishedDebateById', { sessionId });
	const result = await executeQuery(ref);
	return (result.data as { debateSession: PublishedDebateDetailRow | null }).debateSession ?? null;
}

export async function getPersonaBeliefHistoryByTopicId(
	topicId: string
): Promise<PersonaProfileRow[]> {
	const dc = getDC();
	const ref = queryRef(dc, 'GetPersonaBeliefHistoryByTopicId', { topicId });
	const result = await executeQuery(ref);
	return (
		(result.data as { personaProfiles: PersonaProfileRow[] }).personaProfiles
	) ?? [];
}
