import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../pipeline/editing/editing-lifecycle.js', () => ({
	isEditingActive: vi.fn()
}));
vi.mock('../../../pipeline/editing/editing-step.js', () => ({
	readRawChapters: vi.fn(),
	runChapterEditStep: vi.fn(),
	runCommentsEditStep: vi.fn()
}));
vi.mock('../../../pipeline/editing/intro-closing-step.js', () => ({
	runIntroClosingStep: vi.fn()
}));
vi.mock('../../../pipeline/editing/enqueue-editing-step.js', () => ({
	enqueueEditingStep: vi.fn()
}));

import { isEditingActive } from '../../../pipeline/editing/editing-lifecycle.js';
import {
	readRawChapters,
	runChapterEditStep,
	runCommentsEditStep
} from '../../../pipeline/editing/editing-step.js';
import { runIntroClosingStep } from '../../../pipeline/editing/intro-closing-step.js';
import { enqueueEditingStep } from '../../../pipeline/editing/enqueue-editing-step.js';
import { advanceEditing } from '../../../pipeline/editing/editing-orchestrator.js';

const mockIsActive = vi.mocked(isEditingActive);
const mockReadChapters = vi.mocked(readRawChapters);
const mockRunChapter = vi.mocked(runChapterEditStep);
const mockRunComments = vi.mocked(runCommentsEditStep);
const mockRunIntroClosing = vi.mocked(runIntroClosingStep);
const mockEnqueue = vi.mocked(enqueueEditingStep);

const twoChapters = [{ chapterIndex: 0 }, { chapterIndex: 1 }] as never;

beforeEach(() => {
	vi.clearAllMocks();
	mockIsActive.mockResolvedValue(true);
	mockRunChapter.mockResolvedValue('completed');
	mockRunIntroClosing.mockResolvedValue(undefined);
	mockReadChapters.mockResolvedValue(twoChapters);
});

describe('advanceEditing', () => {
	it('停止ゲート（世代不一致・非稼働）なら何も実行しない', async () => {
		mockIsActive.mockResolvedValueOnce(false);
		await advanceEditing({ topicId: 't1', runId: 'r1', stepKind: 'chapter', chapterIndex: 0 });
		expect(mockRunChapter).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it('章編集後、次章があれば次章ステップを投入する', async () => {
		await advanceEditing({ topicId: 't1', runId: 'r1', stepKind: 'chapter', chapterIndex: 0 });
		expect(mockRunChapter).toHaveBeenCalledWith('t1', 0, 'r1');
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'r1',
			stepKind: 'chapter',
			chapterIndex: 1
		});
	});

	it('最終章の後は intro-closing ステップを投入する', async () => {
		await advanceEditing({ topicId: 't1', runId: 'r1', stepKind: 'chapter', chapterIndex: 1 });
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'r1',
			stepKind: 'intro-closing',
			chapterIndex: -1
		});
	});

	it('intro-closing ステップは best-effort 実行後にコメントステップを投入する', async () => {
		await advanceEditing({
			topicId: 't1',
			runId: 'r1',
			stepKind: 'intro-closing',
			chapterIndex: -1
		});
		expect(mockRunIntroClosing).toHaveBeenCalledWith('t1', 'r1');
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'r1',
			stepKind: 'comments',
			chapterIndex: -1
		});
		// finalize（comments）は実行しない
		expect(mockRunComments).not.toHaveBeenCalled();
	});

	it('検証不合格（failed）の章でも後続ステップへ連鎖する', async () => {
		mockRunChapter.mockResolvedValueOnce('failed');
		await advanceEditing({ topicId: 't1', runId: 'r1', stepKind: 'chapter', chapterIndex: 0 });
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'r1',
			stepKind: 'chapter',
			chapterIndex: 1
		});
	});

	it('コメントステップは編集ランを確定し、次を投入しない', async () => {
		mockRunComments.mockResolvedValueOnce('generated');
		await advanceEditing({ topicId: 't1', runId: 'r1', stepKind: 'comments', chapterIndex: -1 });
		expect(mockRunComments).toHaveBeenCalledWith('t1', 'r1');
		expect(mockEnqueue).not.toHaveBeenCalled();
	});
});
