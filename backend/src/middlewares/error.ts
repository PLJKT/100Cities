import { Request, Response, NextFunction } from 'express';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: { code: err.code || 'INTERNAL', message: err.message || 'Server error' } });
}
