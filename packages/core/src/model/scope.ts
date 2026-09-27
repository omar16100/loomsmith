export interface ScopeOptions {
  harness_ids: readonly string[] | null;
}

export const all_harnesses: ScopeOptions = { harness_ids: null };

export function in_scope(options: ScopeOptions, harness_id: string): boolean {
  return options.harness_ids === null || options.harness_ids.includes(harness_id);
}
