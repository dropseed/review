/**
 * Cheap deep-equality via JSON serialization. Suitable for plain data with
 * stable key ordering (e.g. backend payloads serialized identically each
 * call). Use to skip no-op store updates whose only effect would be replacing
 * a reference and re-rendering subscribers.
 */
export function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
