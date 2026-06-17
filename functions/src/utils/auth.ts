import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';

export const requireAuth = (request: CallableRequest): void => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
};
