import { getAuth } from 'firebase-admin/auth';
import type { Request, Response, NextFunction } from 'express';

export async function verifyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    await getAuth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
