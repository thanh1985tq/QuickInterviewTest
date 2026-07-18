import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const validRequestId = /^[A-Za-z0-9._-]{1,100}$/;

export const requestId: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-request-id');
  const id = supplied && validRequestId.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = id;
  response.setHeader('X-Request-Id', id);
  next();
};
