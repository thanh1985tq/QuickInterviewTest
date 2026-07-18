import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new HttpError(404, 'NOT_FOUND', `Route ${request.method} ${request.path} was not found`));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    void _next;
    const requestId = response.locals.requestId as string | undefined;
    if (error instanceof ZodError) {
      response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.issues, requestId },
      });
      return;
    }
    if (error instanceof HttpError) {
      if (error.status >= 500) logger.error({ err: error, requestId }, 'request failed');
      response.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
      return;
    }
    logger.error({ err: error, requestId, method: request.method, path: request.path }, 'unhandled request error');
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
    });
  };
}
