import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';
import { firebaseConfig } from '$lib/firebase-config';

describe('PersonaAvatar', () => {
	it('生成済みアバターは配色キー由来の色と Storage 画像URLを描画変数へ反映する（Req 5.1）', async () => {
		render(PersonaAvatar, {
			persona: { id: 'p1', topicId: 't1', colorKey: 'blue', avatarGeneratedAt: new Date(1000) }
		});

		const root = document.querySelector('.persona-avatar') as HTMLElement;
		const image = document.querySelector('.persona-avatar__image') as HTMLElement;

		expect(root.style.getPropertyValue('--persona-avatar-background-color')).toBe(
			'var(--blue-100-transparent)'
		);
		expect(image.style.getPropertyValue('--persona-avatar-silhouette-color')).toBe('var(--blue-600)');

		// パスは id/topicId から導出、avatarGeneratedAt はキャッシュバスター（v=）。
		const path = encodeURIComponent('topics/t1/avatars/p1');
		const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${path}?alt=media&v=1000`;
		expect(image.style.getPropertyValue('--persona-avatar-src')).toBe(`url(${url})`);
	});

	it('ペルソナはあるがアバター未生成（avatarGeneratedAt なし）は既定へ縮退せず空にする（シルエットを描かない）', async () => {
		render(PersonaAvatar, { persona: { id: 'p1', topicId: 't1', colorKey: 'blue' } });

		// 枠は残るが、中の人型（マスク画像）は描画しない。
		expect(document.querySelector('.persona-avatar')).not.toBeNull();
		expect(document.querySelector('.persona-avatar__image')).toBeNull();
	});

	it('persona 不在（ファシリテーター等の話者）は既定アバターを表示する（空にはしない）', async () => {
		render(PersonaAvatar, { persona: null });

		const root = document.querySelector('.persona-avatar') as HTMLElement;
		// 配色キー欠落は無彩色の base へ倒す。
		expect(root.style.getPropertyValue('--persona-avatar-background-color')).toBe(
			'var(--base-100-transparent)'
		);
		// アバター未生成の「空」とは区別し、既定アバター（マスク画像）を描画する。
		expect(document.querySelector('.persona-avatar__image')).not.toBeNull();
	});
});
