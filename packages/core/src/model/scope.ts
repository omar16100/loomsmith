export interface ScopeOptions {
  readonly harness_ids: readonly string[] | null;
}

// Shared default used across many call sites: frozen so no caller can mutate it and change every other
// caller's "all harnesses" behaviour out from under them.
export const all_harnesses: ScopeOptions = Object.freeze({ harness_ids: null });

export function in_scope(options: ScopeOptions, harness_id: string): boolean {
  return options.harness_ids === null || options.harness_ids.includes(harness_id);
}
