import { AppError, type ErrorCode } from "../../_shared/errors.ts";

// Three small assertions, so the tests need no package beyond the two the function itself uses.

export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function stable(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
  );
}

export function assertEquals(actual: unknown, expected: unknown, message = ""): void {
  if (stable(actual) !== stable(expected)) {
    throw new Error(`${message}\n  expected: ${stable(expected)}\n  actual:   ${stable(actual)}`);
  }
}

// Runs `work` (sync or async) and demands an AppError with this code, and this reason if one is given.
export async function expectAppError(
  work: () => unknown,
  code: ErrorCode,
  reason?: string,
): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof AppError)) throw new Error(`expected AppError ${code}, got ${String(error)}`);
    if (error.code !== code) throw new Error(`expected ${code}, got ${error.code} (${error.reason})`);
    if (reason !== undefined && error.reason !== reason) {
      throw new Error(`expected reason "${reason}", got "${error.reason}"`);
    }
    return error;
  }
  throw new Error(`expected AppError ${code}, but nothing was thrown`);
}
