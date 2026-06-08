import { httpsCallable } from 'firebase/functions';
import { functions } from '$lib/firebase.js';
import type { TopicSummary } from '$lib/types/index.js';

export async function listTopics(): Promise<TopicSummary[]> {
	const fn = httpsCallable<void, TopicSummary[]>(functions, 'listTopics');
	const result = await fn();
	return result.data;
}

export async function createTopic(title: string): Promise<{ topicId: string }> {
	const fn = httpsCallable<{ title: string }, { topicId: string }>(functions, 'createTopic');
	const result = await fn({ title });
	return result.data;
}

export async function getTopic(id: string): Promise<{ id: string; title: string; status: string }> {
	const fn = httpsCallable<{ id: string }, { id: string; title: string; status: string }>(functions, 'getTopic');
	const result = await fn({ id });
	return result.data;
}

export async function getStakeholders(topicId: string): Promise<unknown[]> {
	const fn = httpsCallable<{ topicId: string }, unknown[]>(functions, 'getStakeholders');
	const result = await fn({ topicId });
	return result.data;
}

export async function generateStakeholders(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generateStakeholders', { timeout: 310000 });
	await fn({ topicId });
}

export async function approveStakeholders(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'approveStakeholders');
	await fn({ topicId });
}

export async function getPersonas(topicId: string): Promise<unknown[]> {
	const fn = httpsCallable<{ topicId: string }, unknown[]>(functions, 'getPersonas');
	const result = await fn({ topicId });
	return result.data;
}

export async function generatePersonas(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generatePersonas', { timeout: 310000 });
	await fn({ topicId });
}

export async function approvePersonas(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'approvePersonas');
	await fn({ topicId });
}

export async function getInterviews(topicId: string): Promise<unknown[]> {
	const fn = httpsCallable<{ topicId: string }, unknown[]>(functions, 'getInterviews');
	const result = await fn({ topicId });
	return result.data;
}

export async function startInterviews(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startInterviews', { timeout: 600000 });
	await fn({ topicId });
}

export async function retryInterview(topicId: string, personaId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string; personaId: string }, unknown>(functions, 'retryInterview', { timeout: 310000 });
	await fn({ topicId, personaId });
}

export async function approveInterviews(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'approveInterviews');
	await fn({ topicId });
}

export async function getAdminDebate(topicId: string): Promise<{ id: string; turns: unknown[] }> {
	const fn = httpsCallable<{ topicId: string }, { id: string; turns: unknown[] }>(functions, 'getAdminDebate');
	const result = await fn({ topicId });
	return result.data;
}

export async function startDebate(topicId: string): Promise<{ debateSessionId: string }> {
	const fn = httpsCallable<{ topicId: string }, { debateSessionId: string }>(functions, 'startDebate', { timeout: 600000 });
	const result = await fn({ topicId });
	return result.data;
}

export async function resetDebate(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'resetDebate');
	await fn({ topicId });
}

export async function resetToPhase1(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'resetToPhase1');
	await fn({ topicId });
}

export async function resetToPhase2(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'resetToPhase2');
	await fn({ topicId });
}

export async function resetToPhase3(topicId: string): Promise<void> {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'resetToPhase3');
	await fn({ topicId });
}

export async function publishDebate(id: string): Promise<{ status: string; url: string }> {
	const fn = httpsCallable<{ id: string }, { status: string; url: string }>(functions, 'publishDebate');
	const result = await fn({ id });
	return result.data;
}
