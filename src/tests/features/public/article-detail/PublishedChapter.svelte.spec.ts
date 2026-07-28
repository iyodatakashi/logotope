import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

import PublishedChapter from '$lib/features/public/article-detail/PublishedChapter.svelte';
import type { PublishedChapter as PublishedChapterModel } from '$lib/models/published/published-article/published-article.types';
import type { PersonaForDisplay } from '$lib/models/persona/persona.types';

// 話者名/肩書は turn に畳まず、personaId 参照＋personas Map で描画時に解決する（null はファシリテーター）。
const personas = new Map<string, PersonaForDisplay>([
	['p1', { id: 'p1', topicId: 't1', name: '一番目', role: '' }]
]);

const chapter: PublishedChapterModel = {
	index: 2,
	title: '章タイトル',
	turns: [
		{ id: 's1', personaId: 'p1', content: '最初の発言', awarenesses: [] },
		{ id: 's2', personaId: null, content: '次の発言', awarenesses: [] }
	]
};

describe('PublishedChapter', () => {
	it('section に安定な id と data-chapter-index を持つ（Req 1.4, 4.2, 4.3）', async () => {
		render(PublishedChapter, { chapter, personas });
		const section = document.querySelector('section.published-chapter');
		expect(section?.id).toBe('chapter-2');
		expect(section?.getAttribute('data-chapter-index')).toBe('2');
	});

	it('発言を発言順に描画する（Req 2.1）', async () => {
		render(PublishedChapter, { chapter, personas });
		const contents = Array.from(document.querySelectorAll('.post-item__content')).map(
			(el) => el.textContent
		);
		expect(contents).toEqual(['最初の発言', '次の発言']);
	});
});
