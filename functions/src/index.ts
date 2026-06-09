import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions';

initializeApp();
setGlobalOptions({ maxInstances: 10, timeoutSeconds: 60, region: 'asia-northeast1', secrets: ['ANTHROPIC_API_KEY'] });

export { generateStakeholders } from './api/stakeholders.js';
export { generatePersonas } from './api/personas.js';
export { runInterview } from './api/interviews.js';
export { startDebate } from './api/debates.js';
