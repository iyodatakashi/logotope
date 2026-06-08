const FUNCTIONS_BASE =
	typeof import.meta !== 'undefined' && import.meta.env?.VITE_FUNCTIONS_BASE
		? import.meta.env.VITE_FUNCTIONS_BASE
		: '';

export function buildAuthHeaders(token: string | null): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return headers;
}

export async function authFetch(
	path: string,
	token: string | null,
	init?: RequestInit
): Promise<Response> {
	return fetch(`${FUNCTIONS_BASE}${path}`, {
		...init,
		headers: { ...buildAuthHeaders(token), ...(init?.headers as Record<string, string>) }
	});
}
