/** Errors that map cleanly onto HTTP responses without the routes knowing why. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details: unknown = null): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorised(message = 'Authentication required.'): AppError {
    return new AppError(401, 'unauthorised', message);
  }

  static forbidden(message = 'You do not have access to this record.'): AppError {
    return new AppError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found.'): AppError {
    return new AppError(404, 'not_found', message);
  }

  static conflict(code: string, message: string, details: unknown = null): AppError {
    return new AppError(409, code, message, details);
  }
}
