import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError, ZodIssue } from "zod";
import { config } from "../config";
import { logger } from "../config/logger";
import { ApiResponse, ApiError } from "../types";

// Extended error response interface
interface ErrorResponse extends ApiResponse {
  code?: string;
  retryable?: boolean;
  timestamp: string;
  requestId?: string;
  stack?: string;
  retryAfter?: number;
  maxRetries?: number;
  upgradeUrl?: string;
  creditsNeeded?: number;
  correlationId?: string;
  suggestions?: string[];
}

// Extended error interface for errors with code property
interface ErrorWithCode extends Error {
  code?: string;
}

export class AppError extends Error implements ApiError {
  public statusCode: number;
  public isOperational: boolean;
  public errors?: any[];
  public code?: string;
  public retryable?: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    errors?: any[],
    code?: string,
    retryable: boolean = false
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;
    this.code = code;
    this.retryable = retryable;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle different error types (rate limit error handling removed)
const handlePrismaError = (
  error: Prisma.PrismaClientKnownRequestError
): AppError => {
  switch (error.code) {
    case "P2002":
      const field = (error.meta?.target as string[]) || ["field"];
      return new AppError(
        `${field[0]} already exists`,
        409,
        true,
        undefined,
        'DUPLICATE_ENTRY'
      );

    case "P2025":
      return new AppError(
        "Record not found",
        404,
        true,
        undefined,
        'RECORD_NOT_FOUND'
      );

    case "P2003":
      return new AppError(
        "Invalid reference - referenced record does not exist",
        400,
        true,
        undefined,
        'INVALID_REFERENCE'
      );

    case "P2014":
      return new AppError(
        "Invalid relation",
        400,
        true,
        undefined,
        'INVALID_RELATION'
      );

    case "P2021":
      return new AppError(
        "Table does not exist",
        500,
        false,
        undefined,
        'TABLE_NOT_FOUND'
      );

    case "P2022":
      return new AppError(
        "Column does not exist",
        500,
        false,
        undefined,
        'COLUMN_NOT_FOUND'
      );

    case "P1001":
      return new AppError(
        "Database connection failed",
        503,
        false,
        undefined,
        'DATABASE_CONNECTION_FAILED',
        true
      );

    case "P1008":
      return new AppError(
        "Database operation timed out",
        504,
        false,
        undefined,
        'DATABASE_TIMEOUT',
        true
      );

    case "P1017":
      return new AppError(
        "Database server has closed the connection",
        503,
        false,
        undefined,
        'DATABASE_CONNECTION_LOST',
        true
      );

    default:
      logger.error("Unhandled Prisma error", {
        code: error.code,
        message: error.message,
        meta: error.meta
      });
      return new AppError(
        "Database operation failed",
        500,
        false,
        undefined,
        'DATABASE_ERROR',
        true
      );
  }
};

const handleValidationError = (error: ZodError): AppError => {
  const errors = error.errors.map((err: ZodIssue) => ({
    field: err.path.join("."),
    message: err.message,
    code: err.code,
    value: 'input' in err ? err.input : undefined
  }));

  return new AppError(
    "Validation failed",
    400,
    true,
    errors,
    'VALIDATION_ERROR'
  );
};

const handleJWTError = (error: Error): AppError => {
  if (error.name === "JsonWebTokenError") {
    return new AppError(
      "Invalid authentication token",
      401,
      true,
      undefined,
      'INVALID_TOKEN'
    );
  }

  if (error.name === "TokenExpiredError") {
    return new AppError(
      "Authentication token has expired",
      401,
      true,
      undefined,
      'TOKEN_EXPIRED'
    );
  }

  if (error.name === "NotBeforeError") {
    return new AppError(
      "Authentication token is not yet valid",
      401,
      true,
      undefined,
      'TOKEN_NOT_ACTIVE'
    );
  }

  return new AppError(
    "Authentication failed",
    401,
    true,
    undefined,
    'AUTH_ERROR'
  );
};

const handleOpenAIError = (error: ErrorWithCode): AppError => {
  if (error.code === 'insufficient_quota') {
    return new AppError(
      "AI service quota exceeded. Please try again later.",
      503,
      true,
      undefined,
      'AI_QUOTA_EXCEEDED',
      true
    );
  }

  if (error.code === 'rate_limit_exceeded') {
    return new AppError(
      "AI service rate limit exceeded. Please try again in a moment.",
      429,
      true,
      undefined,
      'AI_RATE_LIMITED',
      true
    );
  }

  if (error.code === 'context_length_exceeded') {
    return new AppError(
      "Content too long for AI processing. Please try with shorter content.",
      413,
      true,
      undefined,
      'CONTENT_TOO_LONG'
    );
  }

  if (error.code === 'invalid_request_error') {
    return new AppError(
      "Invalid request to AI service",
      400,
      true,
      undefined,
      'AI_INVALID_REQUEST'
    );
  }

  return new AppError(
    "AI service is currently unavailable. Please try again later.",
    503,
    true,
    undefined,
    'AI_SERVICE_ERROR',
    true
  );
};

const handleNetworkError = (error: ErrorWithCode): AppError => {
  if (error.code === 'ECONNREFUSED') {
    return new AppError(
      "Service temporarily unavailable",
      503,
      false,
      undefined,
      'SERVICE_UNAVAILABLE',
      true
    );
  }

  if (error.code === 'ENOTFOUND') {
    return new AppError(
      "Service endpoint not found",
      503,
      false,
      undefined,
      'SERVICE_NOT_FOUND',
      true
    );
  }

  if (error.code === 'ETIMEDOUT') {
    return new AppError(
      "Request timed out",
      504,
      false,
      undefined,
      'REQUEST_TIMEOUT',
      true
    );
  }

  return new AppError(
    "Network error occurred",
    503,
    false,
    undefined,
    'NETWORK_ERROR',
    true
  );
};

// Comprehensive error handler (rate limit handling removed)
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let appError: AppError;
  const requestId = req.headers['x-request-id'] || 'unknown';

  // Handle different error types
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    appError = handlePrismaError(error);
  } else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    appError = new AppError(
      "Database error occurred",
      500,
      false,
      undefined,
      'DATABASE_UNKNOWN_ERROR',
      true
    );
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    appError = new AppError(
      "Database initialization failed",
      500,
      false,
      undefined,
      'DATABASE_INIT_ERROR',
      true
    );
  } else if (error instanceof ZodError) {
    appError = handleValidationError(error);
  } else if (error.name?.includes('JWT') || error.name?.includes('Token')) {
    appError = handleJWTError(error);
  } else if (error.message?.includes('OpenAI') || (error as ErrorWithCode).code?.startsWith('openai')) {
    appError = handleOpenAIError(error as ErrorWithCode);
  } else if ((error as ErrorWithCode).code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes((error as ErrorWithCode).code!)) {
    appError = handleNetworkError(error as ErrorWithCode);
  } else {
    // Enhanced unhandled error logging
    logger.error("Unhandled error", {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: (error as ErrorWithCode).code,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId,
      timestamp: new Date().toISOString(),
      body: req.method !== 'GET' ? req.body : undefined,
      query: req.query,
      params: req.params
    });

    appError = new AppError(
      config.server.nodeEnv === "production"
        ? "Internal server error"
        : error.message,
      500,
      false,
      undefined,
      'INTERNAL_ERROR',
      false
    );
  }

  // Enhanced error logging with context
  if (appError.isOperational) {
    logger.warn("Operational error", {
      message: appError.message,
      statusCode: appError.statusCode,
      code: appError.code,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId,
      retryable: appError.retryable,
      timestamp: new Date().toISOString()
    });
  } else {
    logger.error("System error", {
      message: appError.message,
      statusCode: appError.statusCode,
      code: appError.code,
      stack: appError.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      requestId,
      timestamp: new Date().toISOString()
    });
  }

  // Enhanced error response
  const response: ErrorResponse = {
    success: false,
    error: appError.message,
    code: appError.code,
    retryable: appError.retryable,
    timestamp: new Date().toISOString(),
    requestId: requestId as string
  };

  // Include validation errors in development or for client errors
  if (config.server.nodeEnv === "development" || appError.statusCode < 500) {
    if (appError.errors) {
      response.data = { errors: appError.errors };
    }

    if (config.server.nodeEnv === "development") {
      response.stack = appError.stack;
    }
  }

  // Add retry information for retryable errors (no rate limit specific logic)
  if (appError.retryable) {
    response.retryAfter = getRetryAfter(appError.statusCode);
    response.maxRetries = 3;
  }

  // Handle specific error codes with custom responses
  if (appError.code === 'INSUFFICIENT_CREDITS') {
    response.upgradeUrl = `${config.server.apiBaseUrl}/upgrade`;
    response.creditsNeeded = 1;
  }

  // Add correlation ID for error tracking
  if (req.headers['x-correlation-id']) {
    response.correlationId = req.headers['x-correlation-id'] as string;
  }

  res.status(appError.statusCode).json(response);
};

// 404 handler with suggestions
export const notFoundHandler = (req: Request, res: Response) => {
  const response: ErrorResponse = {
    success: false,
    error: `Route ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
    timestamp: new Date().toISOString(),
    suggestions: getSuggestions(req.originalUrl)
  };

  logger.warn("Route not found", {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString()
  });

  res.status(404).json(response);
};

// Get retry delay based on status code
function getRetryAfter(statusCode: number): number {
  switch (statusCode) {
    case 503: // Service unavailable
      return 30; // 30 seconds
    case 504: // Gateway timeout
      return 10; // 10 seconds
    default:
      return 5; // 5 seconds
  }
}

// Get route suggestions for 404 errors
function getSuggestions(url: string): string[] {
  const suggestions: string[] = [];

  // Common API endpoints
  const commonEndpoints = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/me',
    '/api/summary/generate',
    '/api/summary',
    '/api/user/profile',
    '/api/health'
  ];

  // Find similar endpoints
  commonEndpoints.forEach(endpoint => {
    if (levenshteinDistance(url, endpoint) < 3) {
      suggestions.push(endpoint);
    }
  });

  return suggestions.slice(0, 3); // Limit to 3 suggestions
}

// Simple Levenshtein distance calculation
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  const n = str2.length;
  const m = str1.length;

  if (n === 0) return m;
  if (m === 0) return n;

  for (let i = 0; i <= m; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= n; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[m][n];
}

// Async error handler wrapper with timeout
export const catchAsync = (fn: Function, timeout: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      next(new AppError(
        "Request timeout",
        504,
        true,
        undefined,
        'REQUEST_TIMEOUT',
        true
      ));
    }, timeout);

    Promise.resolve(fn(req, res, next))
      .then(() => {
        clearTimeout(timeoutId);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        next(error);
      });
  };
};

// Health check for error handler
export const healthCheck = (req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      errorHandler: 'active',
      version: '1.0.0'
    }
  };

  res.json(response);
};