import { compare_ids } from "../model/canonical.ts";
import { build_index, has_field, push_to, type DocIndex } from "../model/doc_index.ts";
import type { LoomDocument, PartKind, WireEnd } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { entity_path, sort_issues, type Issue } from "./issue.ts";

type Emit = (code: string, message: string, path: string, entity_id: string | null, hint: string) => void;

export function validate_structure(doc: LoomDocument, index: DocIndex = build_index(doc)): Issue[] {
  const issues: Issue[] = [];
  const emit: Emit = (code, message, path, entity_id, hint) => {
    issues.push({ code, level: "structural", severity: "error", message, path, entity_id, hint });
  };
  for (const id of index.duplicate_ids) emit("S_DUPLICATE_ID", `id ${id} is used by more than one entity`, id, id, "give every entity a unique id");
  check_harness_refs(doc, index, emit);
  check_part_uses(doc, index, emit);
  check_connectors_and_contacts(doc, index, emit);
  check_wires(doc, index, emit);
  check_topology(doc, index, emit);
  check_matings(doc, index, emit);
  check_evidence(doc, index, emit);
  check_labels(doc, emit);
  return sort_issues(issues);
}

function check_harness_refs(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const collection of ["connectors", "splices", "ground_points", "wires", "nodes", "segments"] as const) {
    for (const entity of doc[collection]) {
      if (!index.harnesses.has(entity.harness_id)) {
        emit("S_REF_MISSING", `harness ${entity.harness_id} not found`, entity_path(collection, entity.id, "harness_id"), entity.id, "create the harness or move the entity");
      }
    }
  }
}

function check_part_uses(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  const uses: Array<{ path: string; entity_id: string; use: PartUse; kind: PartKind }> = [];
  for (const c of doc.connectors) uses.push({ path: entity_path("connectors", c.id, "housing"), entity_id: c.id, use: c.housing, kind: "housing" });
  for (const k of doc.contacts) {
    uses.push({ path: entity_path("contacts", k.id, "terminal"), entity_id: k.id, use: k.terminal, kind: "terminal" });
    if (k.seal !== null) uses.push({ path: entity_path("contacts", k.id, "seal", "part"), entity_id: k.id, use: k.seal.part, kind: "seal" });
  }
  for (const s of doc.splices) uses.push({ path: entity_path("splices", s.id, "part"), entity_id: s.id, use: s.part, kind: "splice" });
  for (const u of uses) {
    if (u.use.part_id === null) {
      if (u.use.identification !== "unknown") {
        emit("S_PART_IDENTITY", `${u.kind} is ${u.use.identification} but has no part_id`, `${u.path}/part_id`, u.entity_id, "set part_id, or mark identification unknown");
      }
      continue;
    }
    const found = index.parts.get(u.use.part_id);
    if (!found) emit("S_REF_MISSING", `part ${u.use.part_id} not found`, `${u.path}/part_id`, u.entity_id, "add the part or clear part_id");
    else if (found.kind !== u.kind) {
      emit("S_PART_KIND", `part ${found.id} is a ${found.kind}, expected ${u.kind}`, `${u.path}/part_id`, u.entity_id, `reference a part of kind ${u.kind}`);
    }
  }
}

function check_connectors_and_contacts(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const c of doc.connectors) {
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const cavity of c.cavities) {
      const path = entity_path("connectors", c.id, "cavities", cavity.id);
      if (ids.has(cavity.id)) emit("S_DUPLICATE_CAVITY", `cavity id ${cavity.id} repeats in ${c.label}`, path, c.id, "use unique cavity ids");
      if (labels.has(cavity.label)) emit("S_DUPLICATE_LABEL", `cavity label ${cavity.label} repeats in ${c.label}`, path, c.id, "use unique cavity labels");
      ids.add(cavity.id);
      labels.add(cavity.label);
    }
  }
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner) {
      emit("S_REF_MISSING", `connector ${k.connector_id} not found`, entity_path("contacts", k.id, "connector_id"), k.id, "attach the contact to an existing connector");
      continue;
    }
    if (!owner.cavities.some((cavity) => cavity.id === k.cavity_id)) {
      emit("S_REF_MISSING", `cavity ${k.cavity_id} is not in ${owner.label}`, entity_path("contacts", k.id, "cavity_id"), k.id, "pick a cavity of the connector");
    }
  }
  for (const [key, list] of index.contacts_by_cavity) {
    for (const extra of [...list].sort(compare_ids).slice(1)) {
      emit("S_CAVITY_MULTIPLE_CONTACTS", `cavity ${key} holds more than one contact`, entity_path("contacts", extra.id), extra.id, "one contact per cavity; raise max_wire_ends for a double crimp");
    }
  }
  for (const k of doc.contacts) {
    const count = index.wire_ends_by_endpoint.get(`contact:${k.id}`)?.length ?? 0;
    if (count > k.max_wire_ends) {
      emit("S_CONTACT_OVERFILLED", `contact holds ${count} wire ends, max ${k.max_wire_ends}`, entity_path("contacts", k.id, "max_wire_ends"), k.id, "raise max_wire_ends only if the terminal is rated for it");
    }
  }
  for (const s of doc.splices) {
    const count = index.wire_ends_by_endpoint.get(`splice:${s.id}`)?.length ?? 0;
    if (count > s.max_wire_ends) {
      emit("S_SPLICE_OVERFILLED", `splice holds ${count} wire ends, max ${s.max_wire_ends}`, entity_path("splices", s.id, "max_wire_ends"), s.id, "use a larger splice or split the joint");
    }
  }
}

// undefined: the referenced entity is missing; null: nothing to compare (open end, or a problem reported elsewhere).
function end_harness_id(index: DocIndex, end: WireEnd): string | null | undefined {
  switch (end.kind) {
    case "contact": {
      const k = index.contacts.get(end.contact_id);
      if (!k) return undefined;
      return index.connectors.get(k.connector_id)?.harness_id ?? null;
    }
    case "splice":
      return index.splices.get(end.splice_id)?.harness_id;
    case "ground_point":
      return index.ground_points.get(end.ground_point_id)?.harness_id;
    case "open":
      return null;
  }
}

function check_wires(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const w of doc.wires) {
    w.ends.forEach((end, i) => {
      const path = entity_path("wires", w.id, "ends", i);
      const harness_id = end_harness_id(index, end);
      if (harness_id === undefined) {
        emit("S_REF_MISSING", `end ${i} of ${w.label} points to a missing ${end.kind}`, path, w.id, "attach the end to an existing contact, splice or ground point");
      } else if (harness_id !== null && harness_id !== w.harness_id) {
        emit("S_HARNESS_MISMATCH", `end ${i} of ${w.label} is in harness ${harness_id}`, path, w.id, "a wire and both of its ends belong to the same harness");
      }
    });
    w.route?.forEach((segment_id, i) => {
      const path = entity_path("wires", w.id, "route", i);
      const seg = index.segments.get(segment_id);
      if (!seg) emit("S_REF_MISSING", `segment ${segment_id} not found`, path, w.id, "route through existing segments");
      else if (seg.harness_id !== w.harness_id) emit("S_HARNESS_MISMATCH", `segment ${segment_id} is in harness ${seg.harness_id}`, path, w.id, "route through segments of the wire's harness");
    });
  }
}

function ref_harness(index: DocIndex, kind: "connector" | "splice" | "ground", ref_id: string): string | undefined {
  switch (kind) {
    case "connector":
      return index.connectors.get(ref_id)?.harness_id;
    case "splice":
      return index.splices.get(ref_id)?.harness_id;
    case "ground":
      return index.ground_points.get(ref_id)?.harness_id;
  }
}

function check_topology(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const n of doc.nodes) {
    const path = entity_path("nodes", n.id, "ref_id");
    if (n.kind === "connector" || n.kind === "splice" || n.kind === "ground") {
      if (n.ref_id === null) {
        emit("S_NODE_KIND", `${n.kind} node needs ref_id`, path, n.id, `point ref_id at a ${n.kind}`);
        continue;
      }
      const harness_id = ref_harness(index, n.kind, n.ref_id);
      if (harness_id === undefined) {
        if (index.by_id.has(n.ref_id)) emit("S_NODE_KIND", `ref_id ${n.ref_id} is not a ${n.kind}`, path, n.id, `point ref_id at a ${n.kind}`);
        else emit("S_REF_MISSING", `${n.kind} ${n.ref_id} not found`, path, n.id, "point ref_id at an existing entity");
      } else if (harness_id !== n.harness_id) {
        emit("S_HARNESS_MISMATCH", `node refers to an entity in harness ${harness_id}`, path, n.id, "nodes belong to the harness of what they locate");
      }
    } else if (n.ref_id !== null) {
      emit("S_NODE_KIND", `${n.kind} node must not have ref_id`, path, n.id, "clear ref_id");
    }
  }
  for (const [ref_id, list] of index.nodes_by_ref) {
    for (const extra of [...list].sort(compare_ids).slice(1)) {
      emit("S_NODE_DUPLICATE_REF", `more than one node refers to ${ref_id}`, entity_path("nodes", extra.id, "ref_id"), extra.id, "one node per connector, splice or ground point");
    }
  }
  for (const s of doc.segments) {
    for (const side of ["node_a", "node_b"] as const) {
      const found = index.nodes.get(s[side]);
      if (!found) emit("S_REF_MISSING", `node ${s[side]} not found`, entity_path("segments", s.id, side), s.id, "join existing nodes");
      else if (found.harness_id !== s.harness_id) emit("S_HARNESS_MISMATCH", `node ${found.id} is in harness ${found.harness_id}`, entity_path("segments", s.id, side), s.id, "join nodes of the segment's harness");
    }
    if (s.node_a === s.node_b) emit("S_SEGMENT_LOOP", "segment starts and ends at the same node", entity_path("segments", s.id), s.id, "a segment joins two different nodes");
  }
}

function check_matings(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  const matings_by_connector = new Map<string, string[]>();
  for (const m of doc.matings) {
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (!a) emit("S_REF_MISSING", `connector ${m.connector_a} not found`, entity_path("matings", m.id, "connector_a"), m.id, "mate existing connectors");
    if (!b) emit("S_REF_MISSING", `connector ${m.connector_b} not found`, entity_path("matings", m.id, "connector_b"), m.id, "mate existing connectors");
    if (m.connector_a === m.connector_b) {
      emit("S_MATING_INVALID", "a connector cannot mate with itself", entity_path("matings", m.id), m.id, "mate two different connectors");
    } else {
      push_to(matings_by_connector, m.connector_b, m.id);
    }
    push_to(matings_by_connector, m.connector_a, m.id);
    const used_a = new Set<string>();
    const used_b = new Set<string>();
    m.cavity_map.forEach((pair, i) => {
      const path = entity_path("matings", m.id, "cavity_map", i);
      if (a && !a.cavities.some((cavity) => cavity.id === pair.cavity_a)) emit("S_MATING_INVALID", `cavity ${pair.cavity_a} is not in ${a.label}`, path, m.id, "map cavities that exist");
      if (b && !b.cavities.some((cavity) => cavity.id === pair.cavity_b)) emit("S_MATING_INVALID", `cavity ${pair.cavity_b} is not in ${b.label}`, path, m.id, "map cavities that exist");
      if (used_a.has(pair.cavity_a) || used_b.has(pair.cavity_b)) emit("S_MATING_INVALID", "a cavity is mapped twice", path, m.id, "map each cavity once");
      used_a.add(pair.cavity_a);
      used_b.add(pair.cavity_b);
    });
  }
  for (const [connector_id, ids] of matings_by_connector) {
    if (ids.length > 1) emit("S_MATING_INVALID", `connector ${connector_id} is in ${ids.length} matings`, entity_path("connectors", connector_id), connector_id, "a connector mates with one counterpart");
  }
}

function check_evidence(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const e of doc.evidence) {
    if (!index.by_id.has(e.entity_id)) emit("S_REF_MISSING", `entity ${e.entity_id} not found`, entity_path("evidence", e.id, "entity_id"), e.id, "attach evidence to an existing entity");
    else if (!has_field(index, e.entity_id, e.field)) emit("S_FIELD_UNKNOWN", `${e.entity_id} has no field ${e.field}`, entity_path("evidence", e.id, "field"), e.id, "use a top-level field name of the entity");
    if (e.source !== null && !index.assets.has(e.source.asset_id)) {
      emit("S_REF_MISSING", `asset ${e.source.asset_id} not found`, entity_path("evidence", e.id, "source", "asset_id"), e.id, "add the asset to the manifest first");
    }
  }
  for (const r of doc.reviews) {
    if (!index.by_id.has(r.entity_id)) emit("S_REF_MISSING", `entity ${r.entity_id} not found`, entity_path("reviews", r.id, "entity_id"), r.id, "review an existing entity");
    else if (!has_field(index, r.entity_id, r.field)) emit("S_FIELD_UNKNOWN", `${r.entity_id} has no field ${r.field}`, entity_path("reviews", r.id, "field"), r.id, "use a top-level field name of the entity");
    if (r.revision > doc.revision) {
      emit("S_REVIEW_FUTURE_REVISION", `review revision ${r.revision} is ahead of the document's revision ${doc.revision}`, entity_path("reviews", r.id, "revision"), r.id, "reviews are recorded at or before the document's current revision");
    }
  }
  const positions = new Set<string>();
  for (const p of doc.view_positions) {
    if (!index.by_id.has(p.id)) emit("S_REF_MISSING", `entity ${p.id} not found`, entity_path("view_positions", p.id), p.id, "remove the position of a deleted entity");
    if (positions.has(p.id)) emit("S_DUPLICATE_ID", `view position ${p.id} is repeated`, entity_path("view_positions", p.id), p.id, "keep one position per entity");
    positions.add(p.id);
  }
}

function check_labels(doc: LoomDocument, emit: Emit): void {
  const harness_labels = new Set<string>();
  for (const h of [...doc.harnesses].sort(compare_ids)) {
    if (harness_labels.has(h.label)) emit("S_DUPLICATE_LABEL", `harness label ${h.label} is used twice`, entity_path("harnesses", h.id, "label"), h.id, "harness labels are unique");
    harness_labels.add(h.label);
  }
  const project_labels = new Set<string>();
  for (const collection of ["connectors", "splices", "ground_points"] as const) {
    for (const entity of [...doc[collection]].sort(compare_ids)) {
      if (project_labels.has(entity.label)) {
        emit("S_DUPLICATE_LABEL", `label ${entity.label} is used twice`, entity_path(collection, entity.id, "label"), entity.id, "connector, splice and ground point labels are unique per project");
      }
      project_labels.add(entity.label);
    }
  }
  const wire_labels = new Set<string>();
  for (const w of [...doc.wires].sort(compare_ids)) {
    const key = `${w.harness_id}/${w.label}`;
    if (wire_labels.has(key)) emit("S_DUPLICATE_LABEL", `wire label ${w.label} is used twice in its harness`, entity_path("wires", w.id, "label"), w.id, "wire labels are unique per harness");
    wire_labels.add(key);
  }
}
