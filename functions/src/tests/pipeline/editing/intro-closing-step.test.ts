import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateDigest } from '../../../types/debate-digest.types.js';

vi.mock('../../../pipeline/debate/debate-digest.js', () => ({
	buildDebateDigest: vi.fn()
}));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn()
}));
vi.mock('../../../agents/intro-closing-agent.js', () => ({
	generateIntro: vi.fn(),
	generateClosing: vi.fn()
}));
vi.mock('../../../pipeline/editing/edited-repository.js', () => ({
	writeEditedIntroClosing: vi.fn()
}));

import { buildDebateDigest } from '../../../pipeline/debate/debate-digest.js';
import { getTopicContext } from '../../../pipeline/topics/topic-context.js';
import { generateIntro, generateClosing } from '../../../agents/intro-closing-agent.js';
import { writeEditedIntroClosing } from '../../../pipeline/editing/edited-repository.js';
import { runIntroClosingStep } from '../../../pipeline/editing/intro-closing-step.js';

const mockBuildDigest = vi.mocked(buildDebateDigest);
const mockGetTopicContext = vi.mocked(getTopicContext);
const mockGenerateIntro = vi.mocked(generateIntro);
const mockGenerateClosing = vi.mocked(generateClosing);
const mockWrite = vi.mocked(writeEditedIntroClosing);

const digest: DebateDigest = { topicTitle: 'テーマ', chapters: [], personas: [] };

beforeEach(() => {
	vi.clearAllMocks();
	mockBuildDigest.mockResolvedValue({ ok: true, value: digest });
	mockGetTopicContext.mockResolvedValue({ description: 'desc' });
	mockGenerateIntro.mockResolvedValue({ ok: true, value: 'イントロ本文' });
	mockGenerateClosing.mockResolvedValue({ ok: true, value: 'クロージング本文' });
	mockWrite.mockResolvedValue(undefined);
});

describe('runIntroClosingStep', () => {
	it('ダイジェスト成功＋両生成成功で intro/closing を保存する', async () => {
		await runIntroClosingStep('t1', 'r1');
		expect(mockWrite).toHaveBeenCalledWith('t1', {
			intro: 'イントロ本文',
			closing: 'クロージング本文'
		});
	});

	it('片方の生成失敗時は成功側を保持し失敗側を null で保存する', async () => {
		mockGenerateClosing.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'down', retryable: true }
		});
		await runIntroClosingStep('t1', 'r1');
		expect(mockWrite).toHaveBeenCalledWith('t1', { intro: 'イントロ本文', closing: null });
	});

	it('ダイジェスト失敗時は両方 null で保存し、生成を呼ばない', async () => {
		mockBuildDigest.mockResolvedValueOnce({
			ok: false,
			error: { code: 'NOT_FOUND', resource: 'topic:t1' }
		});
		await runIntroClosingStep('t1', 'r1');
		expect(mockGenerateIntro).not.toHaveBeenCalled();
		expect(mockGenerateClosing).not.toHaveBeenCalled();
		expect(mockWrite).toHaveBeenCalledWith('t1', { intro: null, closing: null });
	});

	it('生成が両方失敗しても例外を投げず両 null で保存する', async () => {
		mockGenerateIntro.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'x', retryable: true }
		});
		mockGenerateClosing.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'y', retryable: true }
		});
		await expect(runIntroClosingStep('t1', 'r1')).resolves.toBeUndefined();
		expect(mockWrite).toHaveBeenCalledWith('t1', { intro: null, closing: null });
	});

	it('予期せぬ例外（読み取り失敗など）でも throw せず null で保存する', async () => {
		mockBuildDigest.mockRejectedValueOnce(new Error('firestore down'));
		await expect(runIntroClosingStep('t1', 'r1')).resolves.toBeUndefined();
		expect(mockWrite).toHaveBeenCalledWith('t1', { intro: null, closing: null });
	});
});
