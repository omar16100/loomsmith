import { create_empty_document } from "../../src/model/empty_document.ts";
import type {
  Connector, Contact, GroundPoint, Harness, LoomDocument, Part, PartKind, Segment, Splice, TopologyNode, Wire, WireEnd, WireSpec,
} from "../../src/schema/document.ts";
import type { PartUse } from "../../src/schema/primitives.ts";

export const unknown_part: PartUse = { part_id: null, identification: "unknown", compatibility: "unknown", procurement: "unknown" };

export function identified(part_id: string): PartUse {
  return { part_id, identification: "identified", compatibility: "compatible", procurement: "available" };
}

export function candidate(part_id: string): PartUse {
  return { part_id, identification: "candidate", compatibility: "unknown", procurement: "unknown" };
}

export function harness(id: string, label: string): Harness {
  return { id, label };
}

export function part(id: string, kind: PartKind, part_number: string, description: string): Part {
  return { id, kind, manufacturer: "SYNTHETIC", part_number, description };
}

// Cavity ids are `${connector_id}_c${label}`, contact ids are `${connector_id}_k${label}`.
export function connector(id: string, harness_id: string, label: string, cavity_labels: string[], housing: PartUse = unknown_part): Connector {
  return {
    id, harness_id, label, face_view: "wire_entry", housing_gender: null, safety_class: null, housing,
    cavities: cavity_labels.map((cavity_label) => ({ id: `${id}_c${cavity_label}`, label: cavity_label })),
  };
}

export function contact(
  connector_id: string,
  cavity_label: string,
  options: { terminal?: PartUse; seal?: PartUse | null; max_wire_ends?: number } = {},
): Contact {
  return {
    id: `${connector_id}_k${cavity_label}`,
    connector_id,
    cavity_id: `${connector_id}_c${cavity_label}`,
    contact_gender: null,
    terminal: options.terminal ?? unknown_part,
    seal: options.seal ? { part: options.seal, quantity: 1 } : null,
    max_wire_ends: options.max_wire_ends ?? 1,
  };
}

export function splice(id: string, harness_id: string, label: string, part_use: PartUse = unknown_part): Splice {
  return { id, harness_id, label, part: part_use, max_wire_ends: 4 };
}

export function ground(id: string, harness_id: string, label: string): GroundPoint {
  return { id, harness_id, label };
}

export function node(id: string, harness_id: string, kind: TopologyNode["kind"], ref_id: string | null): TopologyNode {
  return { id, harness_id, kind, ref_id };
}

export function segment(id: string, harness_id: string, node_a: string, node_b: string, nominal_mm: number | null, tol_mm: number | null = null): Segment {
  return { id, harness_id, node_a, node_b, length: { nominal_mm, tol_mm, datum: null } };
}

export function spec(cross_section_mm2: number | null, base_colour: string | null, stripe_colours: string[] = []): WireSpec {
  return {
    cross_section_mm2,
    designation: cross_section_mm2 === null ? null : `${cross_section_mm2} mm2`,
    base_colour,
    stripe_colours,
    insulation: null,
  };
}

export function wire(id: string, harness_id: string, label: string, ends: [WireEnd, WireEnd], wire_spec: WireSpec, route: string[] | null): Wire {
  return { id, harness_id, label, ends, spec: wire_spec, route, allowances: { end_a_mm: 20, end_b_mm: 20, service_mm: 0 } };
}

export const to_contact = (connector_id: string, cavity_label: string): WireEnd => ({ kind: "contact", contact_id: `${connector_id}_k${cavity_label}` });
export const to_splice = (splice_id: string): WireEnd => ({ kind: "splice", splice_id });
export const to_ground = (ground_point_id: string): WireEnd => ({ kind: "ground_point", ground_point_id });
export const open_end: WireEnd = { kind: "open" };

// A small, structurally valid document built directly (no commands): two connectors, one routed wire.
export function small_doc(): LoomDocument {
  return {
    ...create_empty_document("doc1", "SMALL"),
    harnesses: [harness("h1", "MAIN")],
    connectors: [connector("j1", "h1", "J1", ["1", "2"]), connector("j2", "h1", "J2", ["1", "2"])],
    contacts: [contact("j1", "1"), contact("j2", "1")],
    nodes: [node("n_j1", "h1", "connector", "j1"), node("n_j2", "h1", "connector", "j2")],
    segments: [segment("s1", "h1", "n_j1", "n_j2", 500, 5)],
    wires: [wire("w1", "h1", "W1", [to_contact("j1", "1"), to_contact("j2", "1")], spec(0.5, "R"), ["s1"])],
  };
}
