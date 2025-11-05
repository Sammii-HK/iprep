/**
 * Error handling utilities for production
 */

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with ID ${id} not found` : `${resource} not found`,
      404,
      'NOT_FOUND'
    );
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
  }
}

/**
 * Handle API errors consistently
 */
export function handleApiError(error: unknown): {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
} {
  // Don't log sensitive errors in production
  const isProduction = process.env.NODE_ENV === 'production';

  if (error instanceof AppError) {
    if (!isProduction) {
      console.error('AppError:', error.message, error.details);
    }
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      details: isProduction ? undefined : error.details,
    };
  }

  if (error instanceof Error) {
    // Log unexpected errors
    console.error('Unexpected error:', error.message, error.stack);
    return {
      statusCode: 500,
      message: isProduction
        ? 'An unexpected error occurred'
        : error.message,
      code: 'INTERNAL_ERROR',
    };
  }

  return {
    statusCode: 500,
    message: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
  };
}

/**
 * Safe JSON parsing with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error('JSON parse error:', error);
    return fallback;
  }
}
