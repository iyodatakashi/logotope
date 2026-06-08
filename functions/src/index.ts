import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions';

initializeApp();
setGlobalOptions({ maxInstances: 10, timeoutSeconds: 60, region: 'asia-northeast1', secrets: ['ANTHROPIC_API_KEY'] });

export { createTopic, listTopics, getTopic } from './api/topics.js';
export { getStakeholders, generateStakeholders, approveStakeholders } from './api/stakeholders.js';
export { getPersonas, generatePersonas, approvePersonas } from './api/personas.js';
export { getInterviews, startInterviews, retryInterview, approveInterviews } from './api/interviews.js';
export { getAdminDebate, startDebate, publishDebate, resetDebate } from './api/debates.js';
export { resetToPhase1, resetToPhase2, resetToPhase3 } from './api/resets.js';
