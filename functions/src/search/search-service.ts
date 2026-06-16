import { tavily } from '@tavily/core';
import { SEARCH_CONFIG } from '../constants/ai.constants.js';
import type { Result } from '../types/common.types.js';

export const isSearchAvailable = (): boolean => !!process.env.TAVILY_API_KEY;

export const executeSearch = async (query: string): Promise<Result<string, string>> => {
	try {
		const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
		const response = await client.search(query, {
			maxResults: SEARCH_CONFIG.MAX_RESULTS,
			searchDepth: 'basic'
		});

		const content = response.results.map((r) => `【${r.title}】\n${r.content}`).join('\n\n');

		console.log('[search] query succeeded:', query, `(${response.results.length} results)`);
		return { ok: true, value: content || '（検索結果なし）' };
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		console.error('[search] query failed:', query, err);
		return { ok: false, error };
	}
};
