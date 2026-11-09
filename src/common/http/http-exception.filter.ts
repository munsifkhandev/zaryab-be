import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

const errors: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Invalid request.'],
  401: ['UNAUTHORIZED', 'Authentication required.'],
  403: ['FORBIDDEN', 'This action is not permitted.'],
  404: ['NOT_FOUND', 'Resource not found.'],
  409: ['CONFLICT', 'The request conflicts with the current state.'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding.'],
  422: ['VALIDATION_ERROR', 'Request validation failed.'],
  429: ['RATE_LIMITED', 'Too many requests. Please try again later.'],
  500: ['INTERNAL_ERROR', 'An unexpected error occurred.'],
  503: ['SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.'],
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const [code, message] = errors[status] ?? ['HTTP_ERROR', 'The request could not be completed.'];
    const requestId: unknown = res.locals.requestId;
    if (status >= 500) {
      // Exception messages/stacks may contain connection strings or submitted secrets.
      this.logger.error({ event: 'http_error', requestId, statusCode: status, code });
    }
    if (res.headersSent) return;
    res.status(status).json({
      success: false,
      error: { code, message, details: [] },
      meta: { requestId },
    });
  }
}
