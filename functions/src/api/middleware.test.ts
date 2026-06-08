import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(),
}));

import { verifyAuth } from './middleware.js';
import { getAuth } from 'firebase-admin/auth';

function mockReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Partial<Request>;
}

function mockRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const mockNext: NextFunction = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('verifyAuth', () => {
  it('calls next() when token is valid', async () => {
    vi.mocked(getAuth).mockReturnValue({
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'user-1' }),
    } as ReturnType<typeof getAuth>);

    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    await verifyAuth(req as Request, res as unknown as Response, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = mockReq();
    const res = mockRes();
    await verifyAuth(req as Request, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when token verification fails', async () => {
    vi.mocked(getAuth).mockReturnValue({
      verifyIdToken: vi.fn().mockRejectedValue(new Error('invalid token')),
    } as ReturnType<typeof getAuth>);

    const req = mockReq('Bearer invalid-token');
    const res = mockRes();
    await verifyAuth(req as Request, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
