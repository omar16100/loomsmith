import { compare_strings } from "../model/canonical.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument, WireEnd, WireSpec } from "../schema/document.ts";
import { analyse_route, cut_length, type LengthValue, type RouteStatus } from "./topology.ts";

export interface WireListRow {
  wire_id: string;
  harness_label: string;
  wire_label: string;
  from: string;
  to: string;
  cross_section_mm2: number | null;
  designation: string | null;
  colour: string;
  route_status: RouteStatus;
  cut_length: LengthValue;
}

export function end_label(index: DocIndex, end: WireEnd): string {
  switch (end.kind) {
    case "contact": {
      const k = index.contacts.get(end.contact_id);
      const owner = k ? index.connectors.get(k.connector_id) : undefined;
      if (!k || !owner) return `MISSING(${end.contact_id})`;
      return `${owner.label}:${owner.cavities.find((cavity) => cavity.id === k.cavity_id)?.label ?? k.cavity_id}`;
    }
    case "splice":
      return index.splices.get(end.splice_id)?.label ?? `MISSING(${end.splice_id})`;
    case "ground_point":
      return index.ground_points.get(end.ground_point_id)?.label ?? `MISSING(${end.ground_point_id})`;
    case "open":
      return "OPEN";
  }
}

export function colour_code(spec: WireSpec): string {
  return spec.base_colour === null ? "UNKNOWN" : [spec.base_colour, ...spec.stripe_colours].join("-");
}

export function derive_wire_list(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): WireListRow[] {
  return doc.wires
    .filter((w) => in_scope(options, w.harness_id))
    .map((w) => ({
      wire_id: w.id,
      harness_label: index.harnesses.get(w.harness_id)?.label ?? w.harness_id,
      wire_label: w.label,
      from: end_label(index, w.ends[0]),
      to: end_label(index, w.ends[1]),
      cross_section_mm2: w.spec.cross_section_mm2,
      designation: w.spec.designation,
      colour: colour_code(w.spec),
      route_status: analyse_route(index, w).status,
      cut_length: cut_length(index, w),
    }))
    .sort((a, b) => compare_strings(a.harness_label, b.harness_label) || compare_strings(a.wire_label, b.wire_label));
}
