import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions';

initializeApp();
setGlobalOptions({
	maxInstances: 10,
	timeoutSeconds: 60,
	region: 'asia-northeast1',
	secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY']
});

export { generateFactResearch } from './api/fact-research.js';
export { startPersonaGeneration, runPersonaStep } from './api/personas.js';
export { regenerateAvatar } from './api/avatars.js';
export { runInterview } from './api/interviews.js';
export { generateChapters } from './api/chapters.js';
export { startDebate, restartDebate, resetDebate, runStep } from './api/debates.js';
export { fetchSourceContents } from './api/source-contents.js';
export { startEditing, runEditingStep, regenerateArticleElement } from './api/editing.js';
