import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions';

initializeApp();
setGlobalOptions({ maxInstances: 10, timeoutSeconds: 60, region: 'asia-northeast1', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'] });

export { generateStakeholders } from './api/stakeholders.js';
export { generatePersonas } from './api/personas.js';
export { runInterview } from './api/interviews.js';
export { generateChapters, startDebate, runChapter } from './api/debates.js';
