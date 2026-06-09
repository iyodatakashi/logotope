import { httpsCallable } from 'firebase/functions';
import { functions } from '$lib/firebase.js';

export const generateStakeholders = async (topicId: string): Promise<void> => {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generateStakeholders', {
		timeout: 310000
	});
	await fn({ topicId });
};

export const generatePersonas = async (topicId: string): Promise<void> => {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generatePersonas', {
		timeout: 310000
	});
	await fn({ topicId });
};

export const runInterview = async (topicId: string, personaId: string): Promise<void> => {
	const fn = httpsCallable<{ topicId: string; personaId: string }, unknown>(
		functions,
		'runInterview',
		{ timeout: 310000 }
	);
	await fn({ topicId, personaId });
};

export const startDebate = async (topicId: string): Promise<void> => {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startDebate', {
		timeout: 600000
	});
	await fn({ topicId });
};
