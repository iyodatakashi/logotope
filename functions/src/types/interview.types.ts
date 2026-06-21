export type Interview = {
	id: string;
	personaId: string;
	interviewRecord: string;
	status: string;
	errorMessage?: string | null;
	completedAt?: string | null;
};
