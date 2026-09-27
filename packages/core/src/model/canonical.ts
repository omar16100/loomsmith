import { collection_names, type CollectionName, type LoomDocument } from "../schema/document.ts";

export function compare_strings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compare_ids(a: { id: string }, b: { id: string }): number {
  return compare_strings(a.id, b.id);
}

export function sort_keys_deep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_keys_deep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sort_keys_deep(record[key]);
    return out;
  }
  return value;
}

export function canonical_json(value: unknown): string {
  return JSON.stringify(sort_keys_deep(value));
}

// Collections are unordered sets: sort by id. Arrays inside entities (ends, route, cavities, stripes) keep their order.
export function canonicalize_document(doc: LoomDocument): LoomDocument {
  const out: LoomDocument = { ...doc };
  const writable = out as unknown as Record<CollectionName, unknown>;
  for (const name of collection_names) {
    writable[name] = [...doc[name]].sort(compare_ids);
  }
  return out;
}

export function to_canonical_file(doc: LoomDocument): string {
  return JSON.stringify(sort_keys_deep(canonicalize_document(doc)), null, 2) + "\n";
}
