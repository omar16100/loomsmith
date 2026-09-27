import { compare_strings } from "../model/canonical.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { in_scope } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import { validate_structure } from "../validate/structural.ts";
import { active_matings, derive_nets, mating_state, type MatingState } from "./nets.ts";

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
  // Nets that are neither excluded nor probeable (every endpoint is in a mated connector or is a splice):
  // listed so the operator sees them, never silently dropped.
  untestable_net_ids: string[];
}

export type BoundaryProblemCode = "unknown_harness" | "unknown_mating" | "unknown_connector" | "mating_crosses_boundary" | "structural_errors";

export interface BoundaryProblem {
  code: BoundaryProblemCode;
  id: string | null;
  message: string;
}

// Fail closed: any boundary problem means no test data at all, so a typo or a half-scoped mating can never
// yield an isolation check whose path physically reaches an SRS circuit.
export type TestDataResult = { ok: true; data: TestData } | { ok: false; problems: BoundaryProblem[] };

function check_boundary(doc: LoomDocument, boundary: TestBoundary, index: DocIndex): BoundaryProblem[] {
  const problems: BoundaryProblem[] = [];
  const structural = validate_structure(doc, index);
  if (structural.length > 0) {
    problems.push({ code: "structural_errors", id: null, message: `document has ${structural.length} structural error(s); fix them before deriving test data` });
  }
  for (const id of new Set(boundary.harness_ids)) {
    if (!index.harnesses.has(id)) problems.push({ code: "unknown_harness", id, message: `harness ${id} is not in the document` });
  }
  for (const id of Object.keys(boundary.mating_states)) {
    if (!index.matings.has(id)) problems.push({ code: "unknown_mating", id, message: `mating ${id} is not in the document` });
  }
  for (const id of new Set(boundary.excluded_connector_ids)) {
    if (!index.connectors.has(id)) problems.push({ code: "unknown_connector", id, message: `excluded connector ${id} is not in the document` });
  }
  const scope_options = { harness_ids: boundary.harness_ids };
  for (const m of doc.matings) {
    if (mating_state(boundary.mating_states, m.id, "disconnected") !== "connected") continue;
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (!a || !b || in_scope(scope_options, a.harness_id) === in_scope(scope_options, b.harness_id)) continue;
    const [inside, outside] = in_scope(scope_options, a.harness_id) ? [a, b] : [b, a];
    problems.push({
      code: "mating_crosses_boundary",
      id: m.id,
      message: `mating ${m.id} is connected but joins ${inside.label} inside the boundary to ${outside.label} in harness ${outside.harness_id} outside it`,
    });
  }
  return problems.sort((x, y) => compare_strings(x.code, y.code) || compare_strings(x.id ?? "", y.id ?? ""));
}

// An endpoint on an excluded connector (listed, or SRS unless include_srs) excludes its whole net, whichever
// harness that connector is in: scope never weakens SRS protection.
export function is_excluded_endpoint(index: DocIndex, boundary: TestBoundary, key: string): boolean {
  if (!key.startsWith("contact:")) return false;
  const k = index.contacts.get(key.slice("contact:".length));
  const owner = k ? index.connectors.get(k.connector_id) : undefined;
  if (!owner) return false;
  return boundary.excluded_connector_ids.includes(owner.id) || (owner.safety_class === "srs" && !boundary.include_srs);
}

export function derive_test_data(doc: LoomDocument, boundary: TestBoundary, index: DocIndex = build_index(doc)): TestDataResult {
  const problems = check_boundary(doc, boundary, index);
  if (problems.length > 0) return { ok: false, problems };
  const nets = derive_nets(doc, { harness_ids: boundary.harness_ids, mating_states: boundary.mating_states, default_mating_state: "disconnected" }, index);
  const scope_options = { harness_ids: boundary.harness_ids };
  const scope = (harness_id: string): boolean => in_scope(scope_options, harness_id);
  const mated = new Set<string>();
  for (const m of active_matings(doc, index, boundary.harness_ids, boundary.mating_states, "disconnected")) {
    mated.add(m.connector_a);
    mated.add(m.connector_b);
  }
  const point_label = (key: string): string | null => {
    if (key.startsWith("contact:")) {
      const k = index.contacts.get(key.slice("contact:".length));
      const owner = k ? index.connectors.get(k.connector_id) : undefined;
      if (!k || !owner || !scope(owner.harness_id) || mated.has(owner.id)) return null;
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
  const untestable_net_ids: string[] = [];
  for (const net of nets) {
    const points = net.endpoint_keys.map(point_label).filter((p): p is string => p !== null).sort();
    if (net.endpoint_keys.some((key) => is_excluded_endpoint(index, boundary, key))) {
      excluded_net_ids.push(net.net_id);
      for (const p of points) excluded_points.add(p);
      continue;
    }
    if (points.length > 0) test_nets.push({ net_id: net.net_id, points });
    else untestable_net_ids.push(net.net_id);
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
  const data = { boundary, nets: test_nets, continuity, isolation, excluded_net_ids, excluded_points: [...excluded_points].sort(), untestable_net_ids };
  return { ok: true, data };
}
