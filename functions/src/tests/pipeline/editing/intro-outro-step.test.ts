import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBuildInput, mockBuildNarration, mockFinalize } = vi.hoisted(() => ({
	mockBuildInput: vi.fn(),
	mockBuildNarration: vi.fn(),
	mockFinalize: vi.fn()
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
vi.mock('../../../pipeline/editing/editing-lifecycle.js', () => ({ finalizeEditingRun: mockFinalize }));

import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import { runIntroOutroStep } from '../../../pipeline/editing/intro-outro-step.js';

const EDITORIAL_PATH = 'topics/t1/editorial/0';
const base = () => ({
	intro: { draft: null, final: null },
	outro: { draft: null, final: null },
	impressions: {}
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(EDITORIAL_PATH, base());
	vi.clearAllMocks();
	mockBuildInput.mockResolvedValue({ ok: true, value: { digest: {}, topicContext: {} } });
	mockFinalize.mockResolvedValue('generated');
});

const editorial = () => holder.mock!.store.get(EDITORIAL_PATH) as ReturnType<typeof base>;

describe('runIntroOutroStep', () => {
	it('導入・締めを生成→整えして editorial の intro/outro へ draft/final を書き、finalize を返す', async () => {
		mockBuildNarration.mockImplementation(async (kind: 'intro' | 'outro') =>
			kind === 'intro'
				? { draft: '導入原本', final: '導入編集後' }
				: { draft: '締め原本', final: '締め編集後' }
		);

		const result = await runIntroOutroStep('t1', 'r1');

		expect(editorial().intro).toEqual({ draft: '導入原本', final: '導入編集後' });
		expect(editorial().outro).toEqual({ draft: '締め原本', final: '締め編集後' });
		expect(mockFinalize).toHaveBeenCalledWith('t1', 'r1');
		expect(result).toBe('generated');
	});

	it('ダイジェスト構築が失敗しても intro/outro を書かず finalize へ到達する（best-effort）', async () => {
		mockBuildInput.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND' } });

		await runIntroOutroStep('t1', 'r1');

		expect(mockBuildNarration).not.toHaveBeenCalled();
		expect(editorial().intro).toEqual({ draft: null, final: null });
		expect(mockFinalize).toHaveBeenCalledWith('t1', 'r1');
	});

	it('既に原本のある要素は二重生成しない（run 内リトライ保護・Req 5.2）', async () => {
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { draft: '既存導入', final: '既存導入編集後' },
			outro: { draft: null, final: null },
			impressions: {}
		});
		mockBuildNarration.mockResolvedValue({ draft: '締め原本', final: '締め編集後' });

		await runIntroOutroStep('t1', 'r1');

		// intro はスキップ、outro のみ生成
		expect(mockBuildNarration).toHaveBeenCalledTimes(1);
		expect(mockBuildNarration).toHaveBeenCalledWith('outro', expect.anything());
		expect(editorial().intro).toEqual({ draft: '既存導入', final: '既存導入編集後' });
	});
});
