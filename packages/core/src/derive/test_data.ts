import { build_index, type DocIndex } from "../model/doc_index.ts";
import { in_scope } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import { derive_nets, type MatingState } from "./nets.ts";

export interface TestBoundary {
  harness_ids: readonly string[];
  mating_states: Readonly<Record<string, MatingState>>;
  excluded_connector_ids: readonly string[];
  include_srs: boolean;
}

export interface TestNet {
  net_id: string;
  points: string[];
}

export interface ContinuityCheck {
  net_id: string;
  from: string;
  to: string;
}

export interface IsolationCheck {
  net_a: string;
  net_b: string;
  point_a: string;
  point_b: string;
}

export interface TestData {
  boundary: TestBoundary;
  nets: TestNet[];
  continuity: ContinuityCheck[];
  isolation: IsolationCheck[];
  excluded_net_ids: string[];
  excluded_points: string[];
}

export function derive_test_data(doc: LoomDocument, boundary: TestBoundary, index: DocIndex = build_index(doc)): TestData {
  const nets = derive_nets(doc, { harness_ids: boundary.harness_ids, mating_states: boundary.mating_states, default_mating_state: "disconnected" }, index);
  const scope_options = { harness_ids: boundary.harness_ids };
  const scope = (harness_id: string): boolean => in_scope(scope_options, harness_id);
  const mated = new Set<string>();
  for (const m of doc.matings) {
    if ((boundary.mating_states[m.id] ?? "disconnected") !== "connected") continue;
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (a && b && scope(a.harness_id) && scope(b.harness_id)) {
      mated.add(a.id);
      mated.add(b.id);
    }
  }
  const owner_of = (key: string) => {
    if (!key.startsWith("contact:")) return undefined;
    const k = index.contacts.get(key.slice("contact:".length));
    const owner = k ? index.connectors.get(k.connector_id) : undefined;
    return k && owner ? { contact: k, owner } : undefined;
  };
  const is_excluded_connector = (key: string): boolean => {
    const found = owner_of(key);
    if (!found || !scope(found.owner.harness_id)) return false;
    return boundary.excluded_connector_ids.includes(found.owner.id) || (found.owner.safety_class === "srs" && !boundary.include_srs);
  };
  const point_label = (key: string): string | null => {
    const found = owner_of(key);
    if (found) {
      const { contact: k, owner } = found;
      if (!scope(owner.harness_id) || mated.has(owner.id)) return null;
      return `${owner.label}:${owner.cavities.find((cavity) => cavity.id === k.cavity_id)?.label ?? k.cavity_id}`;
    }
    if (key.startsWith("ground_point:")) {
      const g = index.ground_points.get(key.slice("ground_point:".length));
      return g && scope(g.harness_id) ? g.label : null;
    }
    return null;
  };
  // A net that touches an excluded connector (SRS by default) is an excluded circuit: it gets no continuity or
  // isolation check at all, so no test voltage reaches it.
  const test_nets: TestNet[] = [];
  const excluded_net_ids: string[] = [];
  const excluded_points = new Set<string>();
  for (const net of nets) {
    const points = net.endpoint_keys.map(point_label).filter((p): p is string => p !== null).sort();
    if (net.endpoint_keys.some(is_excluded_connector)) {
      excluded_net_ids.push(net.net_id);
      for (const p of points) excluded_points.add(p);
      continue;
    }
    if (points.length > 0) test_nets.push({ net_id: net.net_id, points });
  }
  const continuity: ContinuityCheck[] = [];
  for (const net of test_nets) {
    const [first, ...rest] = net.points;
    if (first === undefined) continue;
    for (const to of rest) continuity.push({ net_id: net.net_id, from: first, to });
  }
  const isolation: IsolationCheck[] = [];
  test_nets.forEach((a, i) => {
    for (const b of test_nets.slice(i + 1)) {
      const point_a = a.points[0];
      const point_b = b.points[0];
      if (point_a !== undefined && point_b !== undefined) isolation.push({ net_a: a.net_id, net_b: b.net_id, point_a, point_b });
    }
  });
  return { boundary, nets: test_nets, continuity, isolation, excluded_net_ids, excluded_points: [...excluded_points].sort() };
}
