import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type QueryResult<T> = { data: T; error: PostgrestError | null; count?: number | null };

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
    ilike: jest.fn(() => builder),
    or: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    not: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    range: jest.fn(() => Promise.resolve(result)),
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

/** For services that call only `.rpc(name, args)`, nothing else (e.g. lib/services/availability.ts). */
export function createRpcMockSupabase<T>(result: QueryResult<T>) {
  const client = {
    rpc: jest.fn(() => Promise.resolve(result)),
  };
  return client as unknown as SupabaseClient<Database>;
}

export function postgrestError(code: string, message = "mock error"): PostgrestError {
  return { code, message, details: "", hint: "", name: "PostgrestError" } as PostgrestError;
}

/**
 * Per-table variant for services that query several tables in one call
 * (e.g. `getVenueDetail` reads venue_marketplace, courts, venue_amenities,
 * and amenities). Each key's value is either a single result reused for
 * every call against that table, or an array consumed one call at a time
 * (for a table queried more than once per service call with different
 * expected results).
 */
export function createTableMockSupabase(
  tables: Record<string, QueryResult<unknown> | QueryResult<unknown>[]>,
  rpcResults?: Record<string, QueryResult<unknown>>
) {
  const cursors: Record<string, number> = {};
  const client = {
    from: jest.fn((table: string) => {
      const entry = tables[table];
      if (!entry) {
        throw new Error(`createTableMockSupabase: no mock result configured for table "${table}"`);
      }
      if (Array.isArray(entry)) {
        const index = cursors[table] ?? 0;
        cursors[table] = index + 1;
        return createQueryBuilder(entry[Math.min(index, entry.length - 1)]);
      }
      return createQueryBuilder(entry);
    }),
    rpc: jest.fn((fn: string) => {
      const entry = rpcResults?.[fn];
      if (!entry) {
        throw new Error(`createTableMockSupabase: no mock rpc result configured for function "${fn}"`);
      }
      return Promise.resolve(entry);
    }),
  };
  return client as unknown as SupabaseClient<Database>;
}
