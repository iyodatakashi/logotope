import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBuildInput, mockBuildNarration, mockFinalize, mockSweep } = vi.hoisted(() => ({
	mockBuildInput: vi.fn(),
	mockBuildNarration: vi.fn(),
	mockFinalize: vi.fn(),
	mockSweep: vi.fn()
}));

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => holder.mock!.firestore }));
vi.mock('../../../pipeline/editing/element-builders.js', () => ({
	buildIntroOutroInput: mockBuildInput,
	buildNarrationPart: mockBuildNarration
}));
vi.mock('../../../pipeline/editing/editing-lifecycle.js', () => ({
	finalizeEditingRun: mockFinalize,
	finalizePendingEditorialElements: mockSweep
}));

import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import { runIntroOutroStep } from '../../../pipeline/editing/intro-outro-step.js';

const EDITORIAL_PATH = 'topics/t1/editorial/0';
const base = () => ({
	intro: { status: 'pending', draft: null, final: null },
	outro: { status: 'pending', draft: null, final: null },
	impressions: {}
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(EDITORIAL_PATH, base());
	vi.clearAllMocks();
	mockBuildInput.mockResolvedValue({ ok: true, value: { digest: {}, topicContext: {} } });
	mockFinalize.mockResolvedValue('generated');
	// build は writer 経由で段階書き込みする本物の責務。ここでは finish で完了確定を代行する。
	mockBuildNarration.mockImplementation(async (kind: 'intro' | 'outro', _input, writer) => {
		await writer.finish(
			kind === 'intro'
				? { draft: '導入原本', final: '導入編集後' }
				: { draft: '締め原本', final: '締め編集後' }
		);
	});
});

const editorial = () => holder.mock!.store.get(EDITORIAL_PATH) as ReturnType<typeof base>;

describe('runIntroOutroStep', () => {
	it('導入・締めを build（段階書き込み）で intro/outro へ書き、終端スイープの後 finalize を返す', async () => {
		const result = await runIntroOutroStep('t1', 'r1');

		expect(editorial().intro).toEqual({ status: 'finished', draft: '導入原本', final: '導入編集後' });
		expect(editorial().outro).toEqual({ status: 'finished', draft: '締め原本', final: '締め編集後' });
		expect(mockSweep).toHaveBeenCalledWith('t1'); // 終端スイープ
		expect(mockFinalize).toHaveBeenCalledWith('t1', 'r1');
		expect(result).toBe('generated');
	});

	it('ダイジェスト構築が失敗しても intro/outro を書かず、スイープ→finalize へ到達する（best-effort）', async () => {
		mockBuildInput.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND' } });

		await runIntroOutroStep('t1', 'r1');

		expect(mockBuildNarration).not.toHaveBeenCalled();
		// 未生成のまま（未完了要素の確定は終端スイープの責務）
		expect(editorial().intro).toEqual({ status: 'pending', draft: null, final: null });
		expect(mockSweep).toHaveBeenCalledWith('t1');
		expect(mockFinalize).toHaveBeenCalledWith('t1', 'r1');
	});

	it('既に原本のある要素は二重生成しない（run 内リトライ保護・Req 5.2）', async () => {
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'finished', draft: '既存導入', final: '既存導入編集後' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});

		await runIntroOutroStep('t1', 'r1');

		// intro はスキップ、outro のみ生成
		expect(mockBuildNarration).toHaveBeenCalledTimes(1);
		expect(mockBuildNarration).toHaveBeenCalledWith('outro', expect.anything(), expect.anything());
		expect(editorial().intro).toEqual({ status: 'finished', draft: '既存導入', final: '既存導入編集後' });
	});
});
