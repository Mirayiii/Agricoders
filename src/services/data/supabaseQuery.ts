import type { PostgrestError } from "@supabase/supabase-js";

export class DataError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** Unwraps a Supabase response for useQuery: returns data or throws, so React Query sees the error. */
export async function unwrap<T>(request: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new DataError(error.message, error.code);
  return data as T;
}

/** Same for head-only count queries. */
export async function unwrapCount(request: PromiseLike<{ count: number | null; error: PostgrestError | null }>): Promise<number> {
  const { count, error } = await request;
  if (error) throw new DataError(error.message, error.code);
  return count ?? 0;
}
