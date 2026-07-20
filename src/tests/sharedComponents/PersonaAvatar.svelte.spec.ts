import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';

describe('PersonaAvatar', () => {
	it('src・silhouetteColor・backgroundColor が対応する描画変数へ反映される（Req 5.1）', async () => {
		render(PersonaAvatar, {
			src: '/avatar-test.png',
			silhouetteColor: 'var(--blue-600)',
			backgroundColor: 'var(--blue-100)'
		});

		const root = document.querySelector('.persona-avatar') as HTMLElement;
		const image = document.querySelector('.persona-avatar__image') as HTMLElement;

		expect(root.style.getPropertyValue('--persona-avatar-background-color')).toBe('var(--blue-100)');
		expect(image.style.getPropertyValue('--persona-avatar-silhouette-color')).toBe('var(--blue-600)');
		expect(image.style.getPropertyValue('--persona-avatar-src')).toBe('url(/avatar-test.png)');
	});
});
