import { analyse_route, route_length } from "../derive/topology.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { entity_path, sort_issues, type Issue, type IssueSeverity } from "./issue.ts";
import { evidence_state, latest_review, review_state } from "./review_state.ts";

type Emit = (code: string, severity: IssueSeverity, message: string, path: string, entity_id: string, hint: string) => void;

export function validate_completeness(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): Issue[] {
  const issues: Issue[] = [];
  const emit: Emit = (code, severity, message, path, entity_id, hint) => {
    issues.push({ code, level: "completeness", severity, message, path, entity_id, hint });
  };
  check_wires(doc, index, options, emit);
  check_parts(doc, index, options, emit);
  check_reviews(doc, index, emit);
  return sort_issues(issues);
}

function check_wires(doc: LoomDocument, index: DocIndex, options: ScopeOptions, emit: Emit): void {
  for (const w of doc.wires) {
    if (!in_scope(options, w.harness_id)) continue;
    w.ends.forEach((end, i) => {
      if (end.kind === "open") emit("M_WIRE_END_OPEN", "error", `${w.label} end ${i} is not terminated`, entity_path("wires", w.id, "ends", i), w.id, "attach the end to a contact, splice or ground point");
    });
    if (w.spec.cross_section_mm2 === null || w.spec.base_colour === null) {
      emit("M_WIRE_SPEC_UNKNOWN", "error", `${w.label} has an unknown size or colour`, entity_path("wires", w.id, "spec"), w.id, "measure or look up the wire size and colour");
    }
    const route_path = entity_path("wires", w.id, "route");
    switch (analyse_route(index, w).status) {
      case "unrouted":
        emit("M_WIRE_UNROUTED", "error", `${w.label} has no physical route`, route_path, w.id, "route the wire through measured bundle segments");
        break;
      case "missing_endpoint_node":
        emit("M_ENDPOINT_NODE_MISSING", "error", `an end of ${w.label} has no topology node`, route_path, w.id, "add a node for each connector, splice and ground point on the loom");
        break;
      case "not_contiguous":
        emit("M_ROUTE_NOT_CONTIGUOUS", "error", `the route of ${w.label} does not join its two ends`, route_path, w.id, "list segments in order from end A to end B");
        break;
      case "ok": {
        const length = route_length(index, w);
        if (length.status === "unknown") {
          emit("M_LENGTH_UNKNOWN", "error", `${w.label} crosses unmeasured segment(s) ${length.unknown_segment_ids.join(", ")}`, route_path, w.id, "measure the listed bundle segments");
        }
        break;
      }
      case "open_end":
        break;
    }
  }
}

function check_parts(doc: LoomDocument, index: DocIndex, options: ScopeOptions, emit: Emit): void {
  const check = (use: PartUse, what: string, owner_label: string, path: string, entity_id: string): void => {
    if (use.identification !== "identified") {
      emit("M_PART_UNIDENTIFIED", "error", `${what} part of ${owner_label} is ${use.identification}`, path, entity_id, "identify the manufacturer part number");
    }
  };
  for (const c of doc.connectors) {
    if (in_scope(options, c.harness_id)) check(c.housing, "housing", c.label, entity_path("connectors", c.id, "housing"), c.id);
  }
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner || !in_scope(options, owner.harness_id)) continue;
    check(k.terminal, "terminal", owner.label, entity_path("contacts", k.id, "terminal"), k.id);
    if (k.seal !== null) check(k.seal.part, "seal", owner.label, entity_path("contacts", k.id, "seal", "part"), k.id);
  }
  for (const s of doc.splices) {
    if (in_scope(options, s.harness_id)) check(s.part, "splice", s.label, entity_path("splices", s.id, "part"), s.id);
  }
}

function check_reviews(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const e of doc.evidence) {
    if (evidence_state(index, e) === "stale") {
      emit("W_EVIDENCE_STALE", "warning", `${e.entity_id}.${e.field} changed after this ${e.origin} evidence was recorded`, entity_path("evidence", e.id), e.entity_id, "record evidence for the new value or revert it");
      continue;
    }
    if (e.origin === "inferred" && review_state(doc, index, e.entity_id, e.field) !== "approved") {
      emit("W_INFERRED_UNREVIEWED", "warning", `${e.entity_id}.${e.field} is inferred and not approved`, entity_path("evidence", e.id), e.entity_id, "check the value against its source and approve it");
    }
  }
  for (const r of doc.reviews) {
    if (latest_review(doc, r.entity_id, r.field)?.id === r.id && review_state(doc, index, r.entity_id, r.field) === "stale") {
      emit("W_REVIEW_STALE", "warning", `${r.entity_id}.${r.field} changed after it was reviewed`, entity_path("reviews", r.id), r.entity_id, "review the new value");
    }
  }
}
