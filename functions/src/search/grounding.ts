import type { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';

export type GroundingMetadata = NonNullable<
	GoogleGenerativeAIProviderMetadata['groundingMetadata']
>;

export type SearchResult = { title: string; url: string };
export type SearchSource = { query: string; summary: string; results: SearchResult[] };

export const extractSources = (
	groundingMetadata: GroundingMetadata,
	summary: string
): SearchSource[] => {
	const chunks = groundingMetadata.groundingChunks ?? [];
	if (chunks.length === 0) return [];

	const seen = new Set<string>();
	const results: SearchResult[] = [];
	for (const chunk of chunks) {
		if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
			seen.add(chunk.web.uri);
			results.push({ title: chunk.web.title ?? '', url: chunk.web.uri });
		}
	}

	const query = (groundingMetadata.webSearchQueries ?? []).join('; ');

	return [{ query, summary, results }];
};

const SOURCE_RESOLVE_TIMEOUT_MS = 5_000;

// グラウンディングの web.uri は vertexaisearch のリダイレクトURL（短命）のため、リダイレクト先の
// 実URL（フルURL）に解決する。記事本文は取得しない（全文取得＝OOMの原因）。title もフルURLにする。
// extractSources は集約1件の source しか返さないので、その results を並列解決する
// （HEADのみで body を読まないためメモリを食わず並列でよい）。
export const resolveSourceUrls = async (sources: SearchSource[]): Promise<SearchSource[]> => {
	const source = sources[0];
	if (!source) return [];
	const results = await Promise.all(
		source.results.map(async (result) => {
			const url = await resolveRedirectUrl(result.url);
			return { url, title: url };
		})
	);
	return [{ ...source, results }];
};

const resolveRedirectUrl = async (url: string): Promise<string> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SOURCE_RESOLVE_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			redirect: 'follow',
			signal: controller.signal
		});
		return response.url || url;
	} catch {
		return url;
	} finally {
		clearTimeout(timer);
	}
};
