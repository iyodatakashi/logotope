import { httpsCallable } from 'firebase/functions';
import { functions } from '$lib/firebase.js';
import type { StakeholderDoc } from '$lib/models/topic/topic.types.js';

export interface PersonaData {
	stakeholderRole: string;
	name: string;
	nationality?: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	stanceDirection: string;
	llmType?: string;
}

export interface PersonaForInterview {
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	background: string;
	interests: string;
}

export const generateStakeholders = async (title: string): Promise<{ stakeholders: StakeholderDoc[] }> => {
	const fn = httpsCallable<{ title: string }, { stakeholders: StakeholderDoc[] }>(
		functions,
		'generateStakeholders',
		{ timeout: 310000 }
	);
	const result = await fn({ title });
	return result.data;
};

export const generatePersonas = async (
	title: string,
	stakeholders: StakeholderDoc[]
): Promise<{ personas: PersonaData[] }> => {
	const fn = httpsCallable<
		{ title: string; stakeholders: StakeholderDoc[] },
		{ personas: PersonaData[] }
	>(functions, 'generatePersonas', { timeout: 310000 });
	const result = await fn({ title, stakeholders });
	return result.data;
};

export const runInterview = async (
	topicTitle: string,
	persona: PersonaForInterview
): Promise<{ researchSummary: string; initialBelief: string }> => {
	const fn = httpsCallable<
		{ topicTitle: string; persona: PersonaForInterview },
		{ researchSummary: string; initialBelief: string }
	>(functions, 'runInterview', { timeout: 310000 });
	const result = await fn({ topicTitle, persona });
	return result.data;
};

export const startDebate = async (topicId: string): Promise<void> => {
	const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startDebate', {
		timeout: 600000
	});
	await fn({ topicId });
};
