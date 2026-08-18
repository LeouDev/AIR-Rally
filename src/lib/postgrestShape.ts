/**
 * A `.select()` built from a raw string (needed for a nested PostgREST
 * embed like `venues(name)`) can't be checked by TypeScript against the
 * hand-written type asserted onto its result — `as unknown as T[]` is
 * genuinely necessary there, but it also means a renamed or typo'd column
 * in that select string compiles cleanly and produces `undefined` in a
 * money total at runtime, silently.
 *
 * This closes that gap where it actually matters (the fields a caller
 * uses without a `?? fallback`): verifies the required keys exist and
 * aren't `undefined` before the cast is trusted, throwing a specific,
 * loud error identifying the row and field instead of continuing with a
 * value nobody will notice is wrong.
 */
export function assertRowShape<T extends Record<string, unknown>>(
  rows: unknown[],
  requiredKeys: (keyof T & string)[],
  context: string
): T[] {
  rows.forEach((row, index) => {
    if (row === null || typeof row !== "object") {
      throw new Error(`${context}: row ${index} is not an object (got ${typeof row}) — the select shape doesn't match what this code expects.`);
    }
    for (const key of requiredKeys) {
      if (!(key in row) || (row as Record<string, unknown>)[key] === undefined) {
        throw new Error(`${context}: row ${index} is missing "${key}" — a column may have been renamed or dropped from the select.`);
      }
    }
  });
  return rows as T[];
}
