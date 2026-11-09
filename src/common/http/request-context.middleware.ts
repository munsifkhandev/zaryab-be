import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthRequest } from '../../modules/auth/auth.types.js';

const logger = new Logger('HTTP');

export function requestContext(req: Request, res: Response, next: NextFunction) {
  // Generate locally so clients cannot forge or inject log correlation identifiers.
  const requestId = randomUUID();
  const started = performance.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    const route: unknown = req.route?.path;
    logger.log({
      event: 'http_request',
      requestId,
      method: req.method,
      actorId: (req as AuthRequest).auth?.user.id,
      // Route templates avoid logging tokens, search terms and personal data in URLs.
      route: typeof route === 'string' ? route : 'unmatched',
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    });
  });
  next();
}
