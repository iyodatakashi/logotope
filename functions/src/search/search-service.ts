import { tavily } from '@tavily/core';
import { SEARCH_CONFIG } from '../constants/ai.constants.js';
import type { SearchResult } from '../types/search.types.js';

export class SearchService {
	private readonly apiKey: string | undefined;

	constructor() {
		this.apiKey = process.env.TAVILY_API_KEY;
	}

	isAvailable(): boolean {
		return !!this.apiKey;
	}

	async executeSearch(query: string): Promise<SearchResult> {
		try {
			const client = tavily({ apiKey: this.apiKey });
			const response = await client.search(query, {
				maxResults: SEARCH_CONFIG.MAX_RESULTS,
				searchDepth: 'basic'
			});

			const content = response.results.map((r) => `【${r.title}】\n${r.content}`).join('\n\n');

			console.log('[search] query succeeded:', query, `(${response.results.length} results)`);
			return { ok: true, content: content || '（検索結果なし）' };
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			console.error('[search] query failed:', query, err);
			return { ok: false, error };
		}
	}
}
