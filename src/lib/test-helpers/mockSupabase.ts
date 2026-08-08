import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type QueryResult<T> = { data: T; error: PostgrestError | null };

/**
 * Minimal chainable stand-in for the Supabase query builder. Every
 * filter/modifier method returns the same object so `.eq().eq()` chains
 * work, and the object is itself "thenable" so `await` resolves at
 * whatever point the real code stops chaining — same as the real
 * PostgrestFilterBuilder.
 */
export function createQueryBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    single: jest.fn(() => Promise.resolve(result)),
    then: (
      onfulfilled?: ((value: QueryResult<T>) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

export function createMockSupabase<T>(result: QueryResult<T>) {
  const client = {
    from: jest.fn(() => createQueryBuilder(result)),
  };
  return client as unknown as SupabaseClient<Database>;
}

export function postgrestError(code: string, message = "mock error"): PostgrestError {
  return { code, message, details: "", hint: "", name: "PostgrestError" } as PostgrestError;
}
