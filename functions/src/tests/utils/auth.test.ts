import { describe, it, expect } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../../utils/auth.js';
import type { CallableRequest } from 'firebase-functions/v2/https';

describe('requireAuth', () => {
  it('認証済みリクエストではエラーを throw しない', () => {
    const request = { auth: { uid: 'user-1', token: {} } } as unknown as CallableRequest;
    expect(() => requireAuth(request)).not.toThrow();
  });

  it('auth が未設定の場合は unauthenticated エラーを throw する', () => {
    const request = { auth: undefined } as unknown as CallableRequest;
    expect(() => requireAuth(request)).toThrow(HttpsError);
  });

  it('throw される HttpsError のコードは unauthenticated である', () => {
    const request = { auth: undefined } as unknown as CallableRequest;
    try {
      requireAuth(request);
      expect.fail('throw されるべきでした');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpsError);
      expect((e as HttpsError).code).toBe('unauthenticated');
    }
  });
});
