import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

import PublishedChapter from '$lib/features/public/article-detail/PublishedChapter.svelte';
import type { PublishedChapter } from '$lib/models/published/published-article.types';

const chapter: PublishedChapter = {
	index: 2,
	title: '章タイトル',
	speeches: [
		{
			id: 's1',
			speakerType: 'persona',
			speakerName: '一番目',
			speakerRole: '',
			content: '最初の発言',
			awarenesses: []
		},
		{
			id: 's2',
			speakerType: 'facilitator',
			speakerName: 'ファシリテーター',
			speakerRole: '',
			content: '次の発言',
			awarenesses: []
		}
	]
};

describe('PublishedChapter', () => {
	it('section に安定な id と data-chapter-index を持つ（Req 1.4, 4.2, 4.3）', async () => {
		render(PublishedChapter, { chapter });
		const section = document.querySelector('section.published-chapter');
		expect(section?.id).toBe('chapter-2');
		expect(section?.getAttribute('data-chapter-index')).toBe('2');
	});

	it('発話を発話順に描画する（Req 2.1）', async () => {
		render(PublishedChapter, { chapter });
		const contents = Array.from(document.querySelectorAll('.published-awareness-button__content')).map(
			(el) => el.textContent
		);
		expect(contents).toEqual(['最初の発言', '次の発言']);
	});
});
