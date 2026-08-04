export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ZONE_RESTRICTED'
  | 'CLEARANCE_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_KEY'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'POLICY_VIOLATION'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ZONE_RESTRICTED: 403,
  // 403 like the others, but a *separate code*, because the client's next move
  // is completely different. ZONE_RESTRICTED means stop — you will never be
  // allowed here. CLEARANCE_REQUIRED means you are entitled and one step short:
  // enter your code. A console that cannot tell these apart either nags people
  // who can never succeed, or silently swallows a prompt the founder needed.
  CLEARANCE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_KEY: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  // 423 Locked, not 403: the caller is entitled and the request was right — the
  // door is shut and will open by itself. A 403 tells a client to stop trying
  // forever, which is exactly wrong for a lockout with a countdown.
  LOCKED: 423,
  POLICY_VIOLATION: 403,
  INTERNAL: 500,
};

export interface ApiErrorDetail {
  field?: string;
  message: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.expose = this.status < 500;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details?: ApiErrorDetail[]): ApiError {
    return new ApiError('BAD_REQUEST', message, details);
  }
  static validation(message = 'Validation failed', details?: ApiErrorDetail[]): ApiError {
    return new ApiError('VALIDATION_FAILED', message, details);
  }
  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }
  static zoneRestricted(zone: string): ApiError {
    return new ApiError('ZONE_RESTRICTED', `Zone ${zone} is restricted for your role`, [
      { field: 'zone', message: zone },
    ]);
  }
  /**
   * Entitled, but not presently proven present.
   *
   * `reason` is carried in the details so the console can render the right
   * screen without re-deriving the rule: prompt for the code, or send the
   * founder to issue one first.
   */
  static clearanceRequired(message: string, reason: string): ApiError {
    return new ApiError('CLEARANCE_REQUIRED', message, [{ message, reason }]);
  }
  static notFound(what = 'Resource'): ApiError {
    return new ApiError('NOT_FOUND', `${what} not found`);
  }
  static conflict(message = 'Conflicting state'): ApiError {
    return new ApiError('CONFLICT', message);
  }
  static duplicate(field: string): ApiError {
    return new ApiError('DUPLICATE_KEY', `${field} already exists`, [
      { field, message: 'must be unique' },
    ]);
  }
  /**
   * A temporary, self-clearing refusal. Carries the instant it lifts so a
   * console can render a countdown rather than guessing.
   */
  static locked(message: string, meta?: Record<string, unknown>): ApiError {
    return new ApiError('LOCKED', message, meta ? [{ message, ...meta }] : []);
  }
  static policy(message: string): ApiError {
    return new ApiError('POLICY_VIOLATION', message);
  }
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError('INTERNAL', message);
  }

  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
