const TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 10_000;

export const fetchAndExtractText = async (
	url: string,
	maxChars = DEFAULT_MAX_CHARS
): Promise<string | null> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;

		const html = await response.text();
		const text = extractText(html);
		return text.slice(0, maxChars);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
};

const extractText = (html: string): string => {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
};
