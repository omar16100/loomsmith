import type { DocIndex } from "../model/doc_index.ts";
import type { Wire, WireEnd } from "../schema/document.ts";

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
  tol_mm: number | null;
  unknown_segment_ids: string[];
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

const unavailable: LengthValue = { status: "unavailable", nominal_mm: null, tol_mm: null, unknown_segment_ids: [] };

export function route_length(index: DocIndex, wire: Wire): LengthValue {
  if (analyse_route(index, wire).status !== "ok" || wire.route === null) return { ...unavailable, unknown_segment_ids: [] };
  let nominal = 0;
  let tol: number | null = 0;
  const unknown: string[] = [];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (!seg) continue;
    if (seg.length.nominal_mm === null) unknown.push(seg.id);
    else nominal += seg.length.nominal_mm;
    tol = tol === null || seg.length.tol_mm === null ? null : tol + seg.length.tol_mm;
  }
  if (unknown.length > 0) return { status: "unknown", nominal_mm: null, tol_mm: null, unknown_segment_ids: unknown };
  return { status: "known", nominal_mm: round_mm(nominal), tol_mm: tol === null ? null : round_mm(tol), unknown_segment_ids: [] };
}

export function cut_length(index: DocIndex, wire: Wire): LengthValue {
  const route = route_length(index, wire);
  if (route.status !== "known" || route.nominal_mm === null) return route;
  const a = wire.allowances;
  return { ...route, nominal_mm: round_mm(route.nominal_mm + a.end_a_mm + a.end_b_mm + a.service_mm) };
}
