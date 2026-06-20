import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState, Engagement, SpeakerSelection, QueuedIntent } from '../../../types/debate.types.js';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ set: mockSet });
const mockGetDocs = vi.fn();
const mockCollectionGet = vi.fn();
const mockCollection = vi.fn().mockReturnValue({ get: mockCollectionGet });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, collection: mockCollection })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
}));

vi.mock('../../../pipeline/debate/speaker-selection.js', () => ({
	shouldQueue: vi.fn((e: Engagement) => e.score >= 4),
}));

vi.mock('../../../constants/debate.constants.js', () => ({
	INTENT_EXPIRY_TURNS: 3,
}));

import {
	loadQueuedIntents,
	expireQueuedIntents,
	addQueuedIntents,
	consumeQueuedIntent,
} from '../../../pipeline/debate/queued-intents.js';

const makeState = (overrides?: Partial<DebateState>): DebateState => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	pairConversationTurns: 0,
	discussionPoints: [],
	...overrides,
});

const makeEngagement = (personaId: string, score: number): Engagement => ({
	personaId,
	score,
	mode: 'opinion',
	intentSummary: '発言したい',
});

const makeSpeakerSelection = (personaId: string): SpeakerSelection => ({
	personaId,
	reason: 'score',
});

describe('loadQueuedIntents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('チャプタースコープのコレクション topics/{topicId}/chapters/{chapterId}/engagements を参照する', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [] });

		await loadQueuedIntents('topic1', 'ch1');

		expect(mockCollection).toHaveBeenCalledWith('topics/topic1/chapters/ch1/engagements');
	});

	it('ドキュメントが存在しない（新チャプター）場合は空 Map を返す', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [] });

		const result = await loadQueuedIntents('topic1', 'ch1');

		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(0);
	});

	it('ドキュメントの queuedIntents フィールドを各 personaId のキーで Map に格納する', async () => {
		const qi1: QueuedIntent[] = [{ triggerTurnId: 't1', intentSummary: '言いたい' }];
		mockCollectionGet.mockResolvedValue({
			docs: [
				{ id: 'persona1', data: () => ({ queuedIntents: qi1, history: {} }) },
				{ id: 'persona2', data: () => ({ history: {} }) },
			],
		});

		const result = await loadQueuedIntents('topic1', 'ch1');

		expect(result.get('persona1')).toEqual(qi1);
		expect(result.get('persona2')).toBeUndefined();
	});

	it('旧パス topics/{topicId}/engagements を参照しない', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [] });

		await loadQueuedIntents('topic1', 'ch1');

		const collectionPaths = mockCollection.mock.calls.map((c: string[]) => c[0]);
		expect(collectionPaths.every((p: string) => !p.includes('topics/topic1/engagements'))).toBe(true);
	});
});

describe('addQueuedIntents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('チャプタースコープのパス topics/{topicId}/chapters/{chapterId}/engagements/{personaId} に書き込む', async () => {
		const state = makeState();
		const engagements = [makeEngagement('p1', 5)];
		const speakerSelection = makeSpeakerSelection('p2');

		await addQueuedIntents({
			topicId: 'topic1',
			chapterId: 'ch1',
			state,
			engagements,
			speakerSelection,
			triggerTurnId: 't1',
		});

		const docPaths = mockDoc.mock.calls.map((c: string[]) => c[0]);
		expect(docPaths.some((p: string) => p === 'topics/topic1/chapters/ch1/engagements/p1')).toBe(true);
		expect(docPaths.some((p: string) => p.includes('topics/topic1/engagements/p1'))).toBe(false);
	});

	it('queuedIntents フィールドのみを mergeFields で更新し history を上書きしない', async () => {
		const state = makeState();
		const engagements = [makeEngagement('p1', 5)];
		const speakerSelection = makeSpeakerSelection('p2');

		await addQueuedIntents({
			topicId: 'topic1',
			chapterId: 'ch1',
			state,
			engagements,
			speakerSelection,
			triggerTurnId: 't1',
		});

		const setCall = mockSet.mock.calls[0];
		expect(setCall[1]).toEqual({ merge: true });
	});
});

describe('expireQueuedIntents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('チャプタースコープのパス topics/{topicId}/chapters/{chapterId}/engagements/{personaId} に書き込む', async () => {
		const qi: QueuedIntent = { triggerTurnId: 't0', intentSummary: '言いたい' };
		const state = makeState({
			turns: [
				{ id: 't0', speakerType: 'persona', personaId: 'p2', content: '', speechMode: 'opinion', createdAt: '' },
				{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '', speechMode: 'opinion', createdAt: '' },
				{ id: 't2', speakerType: 'persona', personaId: 'p2', content: '', speechMode: 'opinion', createdAt: '' },
				{ id: 't3', speakerType: 'persona', personaId: 'p1', content: '', speechMode: 'opinion', createdAt: '' },
				{ id: 't4', speakerType: 'persona', personaId: 'p2', content: '', speechMode: 'opinion', createdAt: '' },
			],
			queuedIntents: new Map([['p1', [qi]]]),
		});

		await expireQueuedIntents({ topicId: 'topic1', chapterId: 'ch1', state });

		const docPaths = mockDoc.mock.calls.map((c: string[]) => c[0]);
		if (docPaths.length > 0) {
			expect(docPaths.some((p: string) => p.includes('topics/topic1/chapters/ch1/engagements'))).toBe(true);
			expect(docPaths.some((p: string) => p === 'topics/topic1/engagements/p1')).toBe(false);
		}
	});
});

describe('consumeQueuedIntent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('チャプタースコープのパス topics/{topicId}/chapters/{chapterId}/engagements/{personaId} に書き込む', async () => {
		const queuedEntries: QueuedIntent[] = [
			{ triggerTurnId: 't1', intentSummary: '最初' },
			{ triggerTurnId: 't2', intentSummary: '次' },
		];
		const state = makeState({ queuedIntents: new Map([['p1', queuedEntries]]) });

		await consumeQueuedIntent({ topicId: 'topic1', chapterId: 'ch1', state, personaId: 'p1', queuedEntries });

		const docPaths = mockDoc.mock.calls.map((c: string[]) => c[0]);
		expect(docPaths.some((p: string) => p === 'topics/topic1/chapters/ch1/engagements/p1')).toBe(true);
		expect(docPaths.some((p: string) => p === 'topics/topic1/engagements/p1')).toBe(false);
	});

	it('queuedEntries が空または undefined の場合は Firestore に書き込まない', async () => {
		const state = makeState();

		await consumeQueuedIntent({ topicId: 'topic1', chapterId: 'ch1', state, personaId: 'p1', queuedEntries: [] });
		await consumeQueuedIntent({ topicId: 'topic1', chapterId: 'ch1', state, personaId: 'p1', queuedEntries: undefined });

		expect(mockSet).not.toHaveBeenCalled();
	});
});
