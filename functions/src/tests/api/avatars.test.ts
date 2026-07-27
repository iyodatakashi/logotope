/**
 * runAvatarCore / regenerateAvatar の統合テスト（本番生成経路の lifecycle）。
 * - 成功: エンジン ok → Storage 保存（正しいパス・image/png）→ avatarGeneratedAt 記録
 * - generation_failed: 保存せず avatarGeneratedAt 未設定のまま
 * - 開始時に旧 avatarGeneratedAt を即時削除する
 * - 例外は握りつぶす（throw しない）／persona 不在は no-op
 * - エンジンには genderPresentation/age/occupation のみ渡し gender は渡さない
 * - regenerateAvatar: 認証必須・引数検証・生成時刻の有無で成否を返す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const { holder, mockGenerate, mockSave, mockFile, mockRequireAuth } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	},
	mockGenerate: vi.fn(),
	mockSave: vi.fn().mockResolvedValue(undefined),
	mockFile: vi.fn(),
	mockRequireAuth: vi.fn()
}));

vi.mock('firebase-functions/v2/https', () => ({
	onCall: vi.fn((_opts: unknown, handler: unknown) => handler),
	HttpsError: class HttpsError extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	// 実行時に holder 経由で解決する（factory 評価時は holder.mock が未設定のため遅延させる）。
	FieldValue: { delete: () => holder.mock!.FieldValue.delete() },
	Timestamp: { now: () => 'TS' }
}));

vi.mock('firebase-admin/storage', () => ({
	getStorage: () => ({ bucket: () => ({ file: mockFile }) })
}));

vi.mock('../../avatar/avatar-engine.js', () => ({ generateAvatarAsset: mockGenerate }));
vi.mock('../../utils/auth.js', () => ({ requireAuth: mockRequireAuth }));

import { runAvatarCore, regenerateAvatar } from '../../api/avatars.js';

const TOPIC_ID = 't1';
const PERSONA_ID = 'p1';
const personaPath = `topics/${TOPIC_ID}/personas/${PERSONA_ID}`;
const persona = () => holder.mock!.store.get(personaPath);

const seedPersona = (extra: Record<string, unknown> = {}) =>
	holder.mock!.store.set(personaPath, {
		age: 42,
		occupation: '医師',
		role: '救急医',
		nationality: '日本',
		background: '地方の総合病院に勤務。',
		interests: 'ランニング',
		stakeholderRole: '医療従事者',
		gender: 'non-binary',
		genderPresentation: 'feminine',
		...extra
	});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
	mockSave.mockResolvedValue(undefined);
	mockFile.mockReturnValue({ save: mockSave });
});

describe('runAvatarCore — 成功', () => {
	it('エンジンで生成し Storage へ保存して avatarGeneratedAt を記録する', async () => {
		seedPersona();
		const asset = new Uint8Array([1, 2, 3]);
		mockGenerate.mockResolvedValueOnce({ ok: true, asset });

		await runAvatarCore(TOPIC_ID, PERSONA_ID);

		// 保存パスは表示側と同一（拡張子なし）・image/png
		expect(mockFile).toHaveBeenCalledWith(`topics/${TOPIC_ID}/avatars/${PERSONA_ID}`);
		const [buf, opts] = mockSave.mock.calls[0];
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect([...buf]).toEqual([1, 2, 3]);
		expect(opts).toMatchObject({ contentType: 'image/png' });
		// 生成時刻を記録
		expect(persona()?.avatarGeneratedAt).toBe('TS');
	});

	it('エンジンには外観と具体プロフィールを渡すが gender（性自認）は渡さない', async () => {
		seedPersona();
		mockGenerate.mockResolvedValueOnce({ ok: true, asset: new Uint8Array([0]) });

		await runAvatarCore(TOPIC_ID, PERSONA_ID);

		expect(mockGenerate).toHaveBeenCalledWith({
			age: 42,
			genderPresentation: 'feminine',
			occupation: '医師',
			specificRole: '救急医',
			nationality: '日本',
			background: '地方の総合病院に勤務。',
			interests: 'ランニング'
		});
		expect('gender' in mockGenerate.mock.calls[0][0]).toBe(false);
	});
});

describe('runAvatarCore — 未生成（保存せず時刻を残さない）', () => {
	it('generation_failed は保存せず未設定のまま残す', async () => {
		seedPersona({ avatarGeneratedAt: 'OLD' });
		mockGenerate.mockResolvedValueOnce({ ok: false, reason: 'generation_failed' });

		await runAvatarCore(TOPIC_ID, PERSONA_ID);

		expect(mockSave).not.toHaveBeenCalled();
		expect(persona()?.avatarGeneratedAt).toBeUndefined();
	});

	it('開始時に旧 avatarGeneratedAt を即時削除する（生成前に縮退させる）', async () => {
		seedPersona({ avatarGeneratedAt: 'OLD' });
		// 生成前の状態を捉えるため、エンジン呼び出し時点の Firestore を確認する。
		let atGenerate: unknown = 'unset';
		mockGenerate.mockImplementationOnce(async () => {
			atGenerate = persona()?.avatarGeneratedAt;
			return { ok: false, reason: 'generation_failed' };
		});

		await runAvatarCore(TOPIC_ID, PERSONA_ID);

		expect(atGenerate).toBeUndefined();
	});
});

describe('runAvatarCore — 失敗の握りつぶし', () => {
	it('エンジンが throw しても throw せず、時刻は未設定のまま', async () => {
		seedPersona({ avatarGeneratedAt: 'OLD' });
		mockGenerate.mockRejectedValueOnce(new Error('boom'));

		await expect(runAvatarCore(TOPIC_ID, PERSONA_ID)).resolves.toBeUndefined();
		expect(persona()?.avatarGeneratedAt).toBeUndefined();
	});

	it('保存が失敗しても throw しない', async () => {
		seedPersona();
		mockGenerate.mockResolvedValueOnce({ ok: true, asset: new Uint8Array([1]) });
		mockSave.mockRejectedValueOnce(new Error('storage down'));

		await expect(runAvatarCore(TOPIC_ID, PERSONA_ID)).resolves.toBeUndefined();
		// 保存前に時刻は書かない（保存成功後にだけ記録する）
		expect(persona()?.avatarGeneratedAt).toBeUndefined();
	});

	it('persona 不在は no-op（生成も保存もしない）', async () => {
		await runAvatarCore(TOPIC_ID, 'missing');
		expect(mockGenerate).not.toHaveBeenCalled();
		expect(mockSave).not.toHaveBeenCalled();
	});
});

describe('regenerateAvatar — onCall', () => {
	const call = regenerateAvatar as unknown as (req: unknown) => Promise<unknown>;
	const request = (data: unknown) => ({ data, auth: { uid: 'u1' } });

	it('認証のうえ再生成し、生成できたら generated:true を返す', async () => {
		seedPersona();
		mockGenerate.mockResolvedValueOnce({ ok: true, asset: new Uint8Array([9]) });

		const result = await call(request({ topicId: TOPIC_ID, personaId: PERSONA_ID }));

		expect(mockRequireAuth).toHaveBeenCalledOnce();
		expect(result).toEqual({ topicId: TOPIC_ID, personaId: PERSONA_ID, generated: true });
	});

	it('生成できなければ generated:false を返す（generation_failed）', async () => {
		seedPersona({ genderPresentation: 'neutral' });
		mockGenerate.mockResolvedValueOnce({ ok: false, reason: 'generation_failed' });

		const result = await call(request({ topicId: TOPIC_ID, personaId: PERSONA_ID }));

		expect(result).toMatchObject({ generated: false });
	});

	it('topicId/personaId が無ければ invalid-argument で弾く', async () => {
		await expect(call(request({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});
});
