import { describe, it, expect } from "vitest";
import {
  isAppError,
  getErrorMessage,
  isRecoverable,
  getErrorType,
  parseCommandError,
  type AppError,
} from "./errors";

describe("isAppError", () => {
  it("returns true for valid AppError objects", () => {
    const gitError: AppError = {
      type: "Git",
      details: { message: "branch not found", operation: "checkout" },
    };
    expect(isAppError(gitError)).toBe(true);

    const storageError: AppError = {
      type: "Storage",
      details: { message: "disk full" },
    };
    expect(isAppError(storageError)).toBe(true);
  });

  it("returns false for non-object values", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError("error")).toBe(false);
    expect(isAppError(123)).toBe(false);
  });

  it("returns false for objects without type property", () => {
    expect(isAppError({ message: "error" })).toBe(false);
    expect(isAppError({})).toBe(false);
  });

  it("returns false for objects with invalid type", () => {
    expect(isAppError({ type: "InvalidType", details: {} })).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("handles Git errors", () => {
    const error: AppError = {
      type: "Git",
      details: { message: "branch not found", operation: "checkout" },
    };
    expect(getErrorMessage(error)).toBe("Git error: branch not found");
  });

  it("handles Storage errors", () => {
    const error: AppError = {
      type: "Storage",
      details: { message: "disk full" },
    };
    expect(getErrorMessage(error)).toBe("Storage error: disk full");
  });

  it("handles Classification errors", () => {
    const error: AppError = {
      type: "Classification",
      details: { message: "Claude CLI not found" },
    };
    expect(getErrorMessage(error)).toBe("Claude CLI not found");
  });

  it("handles NotFound errors", () => {
    const error: AppError = {
      type: "NotFound",
      details: { resource: "file.txt" },
    };
    expect(getErrorMessage(error)).toBe("Not found: file.txt");
  });

  it("handles PathTraversal errors", () => {
    const error: AppError = {
      type: "PathTraversal",
      details: { path: "../../../etc/passwd" },
    };
    expect(getErrorMessage(error)).toBe("Access denied: invalid path");
  });

  it("handles Error instances", () => {
    expect(getErrorMessage(new Error("test error"))).toBe("test error");
  });

  it("handles string errors", () => {
    expect(getErrorMessage("string error")).toBe("string error");
  });

  it("handles unknown errors", () => {
    expect(getErrorMessage({})).toBe("An unknown error occurred");
    expect(getErrorMessage(null)).toBe("An unknown error occurred");
  });
});

describe("isRecoverable", () => {
  it("returns true for recoverable error types", () => {
    const gitError: AppError = {
      type: "Git",
      details: { message: "fetch failed", operation: "fetch" },
    };
    expect(isRecoverable(gitError)).toBe(true);

    const storageError: AppError = {
      type: "Storage",
      details: { message: "disk full" },
    };
    expect(isRecoverable(storageError)).toBe(true);

    const classificationError: AppError = {
      type: "Classification",
      details: { message: "timeout" },
    };
    expect(isRecoverable(classificationError)).toBe(true);

    const ioError: AppError = {
      type: "Io",
      details: { message: "connection reset" },
    };
    expect(isRecoverable(ioError)).toBe(true);
  });

  it("returns false for non-recoverable error types", () => {
    const notFoundError: AppError = {
      type: "NotFound",
      details: { resource: "file.txt" },
    };
    expect(isRecoverable(notFoundError)).toBe(false);

    const pathTraversalError: AppError = {
      type: "PathTraversal",
      details: { path: "../" },
    };
    expect(isRecoverable(pathTraversalError)).toBe(false);

    const parseError: AppError = {
      type: "Parse",
      details: { message: "invalid JSON" },
    };
    expect(isRecoverable(parseError)).toBe(false);
  });

  it("returns true for non-structured errors", () => {
    expect(isRecoverable(new Error("error"))).toBe(true);
    expect(isRecoverable("error")).toBe(true);
  });
});

describe("getErrorType", () => {
  it("returns type for AppError", () => {
    const error: AppError = {
      type: "Git",
      details: { message: "error", operation: "fetch" },
    };
    expect(getErrorType(error)).toBe("Git");
  });

  it("returns name for Error instances", () => {
    expect(getErrorType(new Error("test"))).toBe("Error");
    expect(getErrorType(new TypeError("test"))).toBe("TypeError");
  });

  it("returns 'Error' for unknown types", () => {
    expect(getErrorType("string")).toBe("Error");
    expect(getErrorType({})).toBe("Error");
  });
});

describe("parseCommandError", () => {
  it("parses JSON AppError from string", () => {
    const jsonError = JSON.stringify({
      type: "Git",
      details: { message: "error", operation: "fetch" },
    });
    const parsed = parseCommandError(jsonError);
    expect(isAppError(parsed)).toBe(true);
    expect((parsed as AppError).type).toBe("Git");
  });

  it("returns string as-is if not valid JSON", () => {
    const error = "plain error message";
    expect(parseCommandError(error)).toBe("plain error message");
  });

  it("returns string as-is if JSON but not AppError", () => {
    const jsonNotAppError = JSON.stringify({ foo: "bar" });
    expect(parseCommandError(jsonNotAppError)).toBe(jsonNotAppError);
  });

  it("passes through AppError objects", () => {
    const error: AppError = {
      type: "Storage",
      details: { message: "error" },
    };
    expect(parseCommandError(error)).toBe(error);
  });

  it("handles Error instances", () => {
    expect(parseCommandError(new Error("test"))).toBe("test");
  });
});
