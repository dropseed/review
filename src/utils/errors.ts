/**
 * Structured error type from the Rust backend.
 * This matches the AppError enum in src-tauri/src/error.rs.
 */
export type AppError =
  | { type: "Git"; details: { message: string; operation: string } }
  | { type: "Storage"; details: { message: string } }
  | { type: "Classification"; details: { message: string } }
  | { type: "NotFound"; details: { resource: string } }
  | { type: "PathTraversal"; details: { path: string } }
  | { type: "Io"; details: { message: string } }
  | { type: "Parse"; details: { message: string } };

/**
 * Type guard to check if an error is a structured AppError.
 */
export function isAppError(error: unknown): error is AppError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as Record<string, unknown>;

  if (typeof maybeError.type !== "string") {
    return false;
  }

  const validTypes = [
    "Git",
    "Storage",
    "Classification",
    "NotFound",
    "PathTraversal",
    "Io",
    "Parse",
  ];

  return validTypes.includes(maybeError.type);
}

/**
 * Get a user-friendly error message from any error type.
 * Handles AppError, Error, and string errors.
 */
export function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    switch (error.type) {
      case "Git":
        return `Git error: ${error.details.message}`;
      case "Storage":
        return `Storage error: ${error.details.message}`;
      case "Classification":
        return error.details.message;
      case "NotFound":
        return `Not found: ${error.details.resource}`;
      case "PathTraversal":
        return "Access denied: invalid path";
      case "Io":
        return `IO error: ${error.details.message}`;
      case "Parse":
        return `Parse error: ${error.details.message}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "An unknown error occurred";
}

/**
 * Check if an error is recoverable (user can retry or take action).
 */
export function isRecoverable(error: unknown): boolean {
  if (isAppError(error)) {
    switch (error.type) {
      case "Git":
      case "Storage":
      case "Classification":
      case "Io":
        return true;
      case "NotFound":
      case "PathTraversal":
      case "Parse":
        return false;
    }
  }

  // For non-structured errors, assume they're potentially recoverable
  return true;
}

/**
 * Get the error type for display purposes.
 */
export function getErrorType(error: unknown): string {
  if (isAppError(error)) {
    return error.type;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "Error";
}

/**
 * Parse an error response from a Tauri command.
 * Tauri may return errors as strings or as JSON.
 */
export function parseCommandError(error: unknown): AppError | string {
  if (typeof error === "string") {
    // Try to parse as JSON (structured AppError)
    try {
      const parsed = JSON.parse(error);
      if (isAppError(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON, return as-is
    }
    return error;
  }

  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred";
}
