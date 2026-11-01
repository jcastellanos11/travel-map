export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  const known = error instanceof HttpError;
  return Response.json({
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'Unexpected server error',
      requestId,
    },
  }, { status: known ? error.status : 500 });
}

export function secureResponse(response: Response, requestId: string): Response {
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return response;
}
