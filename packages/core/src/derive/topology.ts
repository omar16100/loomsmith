import { datum_node_kind } from "../model/datums.ts";
import type { DocIndex } from "../model/doc_index.ts";
import type { Segment, Wire, WireEnd } from "../schema/document.ts";
import type { Datum } from "../schema/primitives.ts";

export type RouteStatus = "unrouted" | "open_end" | "missing_endpoint_node" | "not_contiguous" | "ok";

export interface RouteAnalysis {
  wire_id: string;
  status: RouteStatus;
  start_node_id: string | null;
  end_node_id: string | null;
  node_path: string[];
}

export type LengthStatus = "known" | "unknown" | "unavailable";

export interface LengthValue {
  status: LengthStatus;
  nominal_mm: number | null;
  // Worst case along the route: the sum of every crossed segment's band on that side, null if any is unknown.
  tol_plus_mm: number | null;
  tol_minus_mm: number | null;
  unknown_segment_ids: string[];
}

export interface CutLengthValue extends LengthValue {
  // Unknown allowance fields ("end_a.datum", "end_b.beyond_datum_mm", "service_loop_mm").
  unknown_allowances: string[];
  // Everything check_route_datums found, as text ("s1 at n_j2: datum unknown").
  datum_problems: string[];
}

export interface RouteEndDatums {
  end_a: Datum | null;
  end_b: Datum | null;
}

export interface DatumCheck {
  // Crossed segment ends with no datum ("seg_b1_x1 at n_b1").
  unknown_ends: string[];
  // Nodes where consecutive segments were measured to different points ("n_j3: s1 measured to ..., s2 from ...").
  join_conflicts: string[];
  // Wire ends whose allowance is given from another point than the route has there.
  allowance_conflicts: Array<{ side: "end_a" | "end_b"; message: string }>;
}

export function round_mm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function endpoint_node_id(index: DocIndex, end: WireEnd): string | null {
  let ref_id: string | null;
  switch (end.kind) {
    case "contact":
      ref_id = index.contacts.get(end.contact_id)?.connector_id ?? null;
      break;
    case "splice":
      ref_id = end.splice_id;
      break;
    case "ground_point":
      ref_id = end.ground_point_id;
      break;
    case "open":
      return null;
  }
  if (ref_id === null) return null;
  return index.nodes_by_ref.get(ref_id)?.[0]?.id ?? null;
}

export function analyse_route(index: DocIndex, wire: Wire): RouteAnalysis {
  const result = (status: RouteStatus, start: string | null, finish: string | null, node_path: string[]): RouteAnalysis => ({
    wire_id: wire.id, status, start_node_id: start, end_node_id: finish, node_path,
  });
  if (wire.route === null) return result("unrouted", null, null, []);
  if (wire.ends[0].kind === "open" || wire.ends[1].kind === "open") return result("open_end", null, null, []);
  const start = endpoint_node_id(index, wire.ends[0]);
  const finish = endpoint_node_id(index, wire.ends[1]);
  if (start === null || finish === null) return result("missing_endpoint_node", start, finish, []);
  let current = start;
  const node_path = [start];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (seg && seg.node_a === current) current = seg.node_b;
    else if (seg && seg.node_b === current) current = seg.node_a;
    else return result("not_contiguous", start, finish, node_path);
    node_path.push(current);
  }
  return result(current === finish ? "ok" : "not_contiguous", start, finish, node_path);
}

const unavailable: LengthValue = { status: "unavailable", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [] };

const add_band = (sum: number | null, value: number | null): number | null => (sum === null || value === null ? null : sum + value);
const round_band = (value: number | null): number | null => (value === null ? null : round_mm(value));

export function route_length(index: DocIndex, wire: Wire): LengthValue {
  if (analyse_route(index, wire).status !== "ok" || wire.route === null) return { ...unavailable, unknown_segment_ids: [] };
  let nominal = 0;
  let tol_plus: number | null = 0;
  let tol_minus: number | null = 0;
  const unknown: string[] = [];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (!seg) continue;
    if (seg.length.nominal_mm === null) unknown.push(seg.id);
    else nominal += seg.length.nominal_mm;
    tol_plus = add_band(tol_plus, seg.length.tol_plus_mm);
    tol_minus = add_band(tol_minus, seg.length.tol_minus_mm);
  }
  if (unknown.length > 0) return { status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: unknown };
  return { status: "known", nominal_mm: round_mm(nominal), tol_plus_mm: round_band(tol_plus), tol_minus_mm: round_band(tol_minus), unknown_segment_ids: [] };
}

// The datum of a segment at one of its nodes, whichever direction the segment is stored in.
const datum_at = (seg: Segment, node_id: string): Datum | null => (seg.node_a === node_id ? seg.length.datum_a : seg.length.datum_b);

// The datum the route was measured to at each wire end. null for a route that is not ok; a same-node route ([])
// has no segment, so no datum at either end.
export function route_end_datums(index: DocIndex, wire: Wire): RouteEndDatums | null {
  const analysis = analyse_route(index, wire);
  if (analysis.status !== "ok" || wire.route === null) return null;
  const first = index.segments.get(wire.route[0] ?? "");
  const last = index.segments.get(wire.route[wire.route.length - 1] ?? "");
  const start = analysis.node_path[0];
  const finish = analysis.node_path[analysis.node_path.length - 1];
  return {
    end_a: first && start !== undefined ? datum_at(first, start) : null,
    end_b: last && finish !== undefined ? datum_at(last, finish) : null,
  };
}

// Every measurement point along the route must be known, consecutive segments must meet at the same point, and each
// wire end's allowance must be given from the point the route has there; otherwise the sum leaves out, or counts
// twice, the distance between two points. Datums are never converted. null for a route that is not ok.
export function check_route_datums(index: DocIndex, wire: Wire): DatumCheck | null {
  const analysis = analyse_route(index, wire);
  if (analysis.status !== "ok" || wire.route === null) return null;
  const check: DatumCheck = { unknown_ends: [], join_conflicts: [], allowance_conflicts: [] };
  const path = analysis.node_path;
  const given = { end_a: wire.allowances.end_a.datum, end_b: wire.allowances.end_b.datum };
  if (wire.route.length === 0) {
    // A same-node wire: route length 0, so both ends must be given from one point on that node.
    const here = path[0] === undefined ? undefined : index.nodes.get(path[0]);
    for (const side of ["end_a", "end_b"] as const) {
      const datum = given[side];
      if (here && datum !== null && datum_node_kind[datum] !== here.kind) {
        check.allowance_conflicts.push({ side, message: `${side}: ${datum} is not a point on ${here.kind} node ${here.id}` });
      }
    }
    if (check.allowance_conflicts.length === 0 && given.end_a !== null && given.end_b !== null && given.end_a !== given.end_b) {
      check.allowance_conflicts.push({ side: "end_b", message: `end_b: allowance from ${given.end_b}, end_a from ${given.end_a} at the same node` });
    }
    return check;
  }
  let previous: { segment_id: string; datum: Datum | null } | null = null;
  for (const [i, segment_id] of wire.route.entries()) {
    const seg = index.segments.get(segment_id);
    const from = path[i];
    const to = path[i + 1];
    if (!seg || from === undefined || to === undefined) continue;
    const leaving = datum_at(seg, from);
    const reaching = datum_at(seg, to);
    if (leaving === null) check.unknown_ends.push(`${seg.id} at ${from}`);
    if (reaching === null) check.unknown_ends.push(`${seg.id} at ${to}`);
    if (previous !== null && previous.datum !== null && leaving !== null && previous.datum !== leaving) {
      check.join_conflicts.push(`${from}: ${previous.segment_id} measured to ${previous.datum}, ${seg.id} from ${leaving}`);
    }
    previous = { segment_id: seg.id, datum: reaching };
  }
  const measured = route_end_datums(index, wire);
  for (const side of ["end_a", "end_b"] as const) {
    const at_end = measured?.[side] ?? null;
    const datum = given[side];
    if (datum !== null && at_end !== null && datum !== at_end) {
      check.allowance_conflicts.push({ side, message: `${side}: route measured to ${at_end}, allowance from ${datum}` });
    }
  }
  return check;
}

// check_route_datums as text for CutLengthValue. An allowance with no datum is reported by unknown_allowances.
export function datum_problems(index: DocIndex, wire: Wire): string[] {
  const check = check_route_datums(index, wire);
  if (check === null) return [];
  return [...check.unknown_ends.map((end) => `${end}: datum unknown`), ...check.join_conflicts, ...check.allowance_conflicts.map((conflict) => conflict.message)];
}

export function unknown_allowances(wire: Wire): string[] {
  const a = wire.allowances;
  const missing: string[] = [];
  for (const side of ["end_a", "end_b"] as const) {
    if (a[side].datum === null) missing.push(`${side}.datum`);
    if (a[side].beyond_datum_mm === null) missing.push(`${side}.beyond_datum_mm`);
  }
  if (a.service_loop_mm === null) missing.push("service_loop_mm");
  return missing;
}

// Cut length = route length + wire beyond the datum at both ends + service loop. Allowances add no tolerance.
export function cut_length(index: DocIndex, wire: Wire): CutLengthValue {
  const route = route_length(index, wire);
  const missing = unknown_allowances(wire);
  if (route.status === "unavailable") return { ...route, unknown_allowances: missing, datum_problems: [] };
  const problems = datum_problems(index, wire);
  const { end_a, end_b, service_loop_mm } = wire.allowances;
  if (
    route.status === "unknown" || route.nominal_mm === null || missing.length > 0 || problems.length > 0 ||
    end_a.beyond_datum_mm === null || end_b.beyond_datum_mm === null || service_loop_mm === null
  ) {
    return { status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: route.unknown_segment_ids, unknown_allowances: missing, datum_problems: problems };
  }
  const nominal_mm = round_mm(route.nominal_mm + end_a.beyond_datum_mm + end_b.beyond_datum_mm + service_loop_mm);
  return { ...route, nominal_mm, unknown_allowances: [], datum_problems: [] };
}
