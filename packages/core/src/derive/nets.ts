import { compare_strings } from "../model/canonical.ts";
import { build_index, cavity_key, endpoint_key, push_to, type DocIndex } from "../model/doc_index.ts";
import { in_scope } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";

export type MatingState = "connected" | "disconnected";

export interface NetOptions {
  harness_ids: readonly string[] | null;
  mating_states: Readonly<Record<string, MatingState>>;
  default_mating_state: MatingState;
}

export interface Net {
  net_id: string;
  endpoint_keys: string[];
  wire_ids: string[];
}

// Own-property lookup: a mating id equal to an inherited Object.prototype member name (e.g. "constructor")
// must not shadow the caller's default_mating_state with a prototype value.
export function mating_state(states: Readonly<Record<string, MatingState>>, id: string, fallback: MatingState): MatingState {
  return Object.hasOwn(states, id) ? states[id]! : fallback;
}

function make_union_find() {
  const parent = new Map<string, string>();
  // Iterative with path compression: a recursive find() can overflow the call stack on a long, unlucky
  // chain of unions (a harness with thousands of wires chained end to end).
  const find = (start: string): string => {
    let key = start;
    if (!parent.has(key)) parent.set(key, key);
    const path: string[] = [];
    while (true) {
      const up = parent.get(key)!;
      if (up === key) break;
      path.push(key);
      key = up;
    }
    const root = key;
    for (const step of path) parent.set(step, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const root_a = find(a);
    const root_b = find(b);
    if (root_a === root_b) return;
    if (root_a < root_b) parent.set(root_b, root_a);
    else parent.set(root_a, root_b);
  };
  return { find, union, keys: (): string[] => [...parent.keys()] };
}

export function derive_nets(doc: LoomDocument, options: NetOptions, index: DocIndex = build_index(doc)): Net[] {
  const uf = make_union_find();
  const scope_options = { harness_ids: options.harness_ids };
  const wires = doc.wires.filter((w) => in_scope(scope_options, w.harness_id));
  for (const w of wires) {
    const a = endpoint_key(w.ends[0]);
    const b = endpoint_key(w.ends[1]);
    if (a !== null) uf.find(a);
    if (b !== null) uf.find(b);
    if (a !== null && b !== null) uf.union(a, b);
  }
  for (const m of doc.matings) {
    if (mating_state(options.mating_states, m.id, options.default_mating_state) !== "connected") continue;
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (!a || !b || !in_scope(scope_options, a.harness_id) || !in_scope(scope_options, b.harness_id)) continue;
    for (const pair of m.cavity_map) {
      const contact_a = index.contacts_by_cavity.get(cavity_key(a.id, pair.cavity_a))?.[0];
      const contact_b = index.contacts_by_cavity.get(cavity_key(b.id, pair.cavity_b))?.[0];
      if (contact_a && contact_b) uf.union(`contact:${contact_a.id}`, `contact:${contact_b.id}`);
    }
  }
  const members = new Map<string, string[]>();
  for (const key of uf.keys()) push_to(members, uf.find(key), key);
  const wire_ids = new Map<string, string[]>();
  for (const w of wires) {
    const key = endpoint_key(w.ends[0]) ?? endpoint_key(w.ends[1]);
    if (key !== null) push_to(wire_ids, uf.find(key), w.id);
  }
  return [...members.entries()]
    .map(([root, keys]) => {
      const endpoint_keys = [...keys].sort();
      return { net_id: endpoint_keys[0] ?? root, endpoint_keys, wire_ids: [...(wire_ids.get(root) ?? [])].sort() };
    })
    .sort((x, y) => compare_strings(x.net_id, y.net_id));
}
