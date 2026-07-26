/**
 * 討論ダイジェストのキャッシュ再利用・無効化の統合テスト（editing-pass-regeneration-efficiency / R5）。
 * 本物の buildIntroOutroInput・digest-cache-repository・clearEditedArtifact を最小インメモリ Firestore 上で
 * 通しで動かし、buildDebateDigest（重い前処理）は一度きりで、上流変更後にだけ作り直されることを検証する。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';

const { holder, mockBuildDigest, mockGetTopicContext } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	},
	mockBuildDigest: vi.fn(),
	mockGetTopicContext: vi.fn()
}));

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => holder.mock!.firestore }));
vi.mock('../../../pipeline/debate/debate-digest.js', () => ({ buildDebateDigest: mockBuildDigest }));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({ getTopicContext: mockGetTopicContext }));

import { buildIntroOutroInput } from '../../../pipeline/editing/editorial-builders.js';
import { clearEditedArtifact } from '../../../pipeline/editing/edited-repository.js';

const digest = { topicTitle: 'テーマ', chapters: [], personas: [] };

beforeEach(() => {
	holder.mock = createFirestoreMock();
	vi.clearAllMocks();
	mockBuildDigest.mockResolvedValue({ ok: true, value: digest });
	mockGetTopicContext.mockResolvedValue({ topic: 'ctx' });
});

describe('討論ダイジェストのキャッシュ再利用・無効化', () => {
	it('個別再生成の連打でもダイジェスト構築は一度きりで、以降は保存済みを再利用する（R5.1, R5.4）', async () => {
		await buildIntroOutroInput('t1'); // miss → 構築＋保存
		await buildIntroOutroInput('t1'); // hit → 再利用
		await buildIntroOutroInput('t1'); // hit → 再利用

		expect(mockBuildDigest).toHaveBeenCalledTimes(1);
		expect(holder.mock!.store.get('topics/t1/editorial/digest')).toEqual(digest);
	});

	it('上流変更（clearEditedArtifact 経由）でキャッシュが無効化され、次回に作り直される（R5.3）', async () => {
		await buildIntroOutroInput('t1'); // 構築＋保存
		expect(mockBuildDigest).toHaveBeenCalledTimes(1);

		await clearEditedArtifact('t1'); // 討論/ペルソナ/章/fact 変更・編集ラン開始の中央無効化点
		expect(holder.mock!.store.has('topics/t1/editorial/digest')).toBe(false);

		await buildIntroOutroInput('t1'); // miss → 作り直し
		expect(mockBuildDigest).toHaveBeenCalledTimes(2);
	});
});
