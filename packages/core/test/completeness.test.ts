import { describe, expect, it } from "vitest";
import { cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { build_index } from "../src/model/doc_index.ts";
import { make_length } from "../src/model/make_length.ts";
import { validate_completeness } from "../src/validate/completeness.ts";
import { evidence_state, make_review, review_state } from "../src/validate/review_state.ts";
import { is_release_ready, validate } from "../src/validate/validate.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { apply_ok } from "./helpers/apply.ts";
import { connector, contact, identified, node, open_end, part, segment, small_doc, to_contact } from "./helpers/entities.ts";
import type { LoomDocument } from "../src/schema/document.ts";

// small_doc with every part identified: a document with no completeness issue at all.
function complete_small_doc(): LoomDocument {
  const base = small_doc();
  return {
    ...base,
    parts: [part("p_housing", "housing", "SYN-H2", "2-way housing (synthetic)"), part("p_terminal", "terminal", "SYN-T1", "terminal (synthetic)")],
    connectors: base.connectors.map((c) => ({ ...c, housing: identified("p_housing") })),
    contacts: base.contacts.map((k) => ({ ...k, terminal: identified("p_terminal") })),
  };
}

describe("completeness validation", () => {
  it("lists exactly what blocks a build of the fixture", () => {
    const issues = validate(build_synthetic_milestone(), { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.entity_id}`)).toEqual([
      "M_LENGTH_UNKNOWN:w3",
      "M_LENGTH_UNKNOWN:w5",
      "M_PART_UNIDENTIFIED:x2_k1",
      "M_PART_UNIDENTIFIED:x2_k2",
      "M_PART_UNIDENTIFIED:x2",
      "M_WIRE_SPEC_UNKNOWN:w8",
      "M_WIRE_UNROUTED:w7",
      "M_WIRE_UNROUTED:w8",
      "W_INFERRED_UNREVIEWED:w7",
      "W_REVIEW_STALE:w2",
    ]);
    expect(is_release_ready(issues)).toBe(false);
  });

  it("structural level ignores completeness", () => {
    expect(validate(build_synthetic_milestone(), { level: "structural", harness_ids: null })).toEqual([]);
  });

  it("scopes wire and part checks to the selected harnesses", () => {
    const errors = validate_completeness(build_synthetic_milestone(), { harness_ids: ["h_engine"] }).filter((i) => i.severity === "error");
    expect(errors.map((issue) => issue.entity_id)).toEqual(["w3", "w5"]);
  });

  it("tracks approval separately from origin and invalidates it on change", () => {
    const doc = build_synthetic_milestone();
    const index = build_index(doc);
    expect(review_state(doc, index, "w1", "spec")).toBe("approved");
    expect(review_state(doc, index, "w2", "spec")).toBe("stale");
    expect(review_state(doc, index, "w7", "ends")).toBe("unreviewed");

    const approved = apply_ok(doc, [
      cmd_insert("reviews", make_review(doc, index, { id: "r_w7_ends", entity_id: "w7", field: "ends", status: "approved" })),
    ], "b_approve_w7");
    expect(validate_completeness(approved).map((issue) => issue.code)).not.toContain("W_INFERRED_UNREVIEWED");

    const changed = apply_ok(approved, [cmd_update("wires", "w7", { ends: [to_contact("j3", "1"), to_contact("x2", "1")] })], "b_swap_w7");
    expect(review_state(changed, build_index(changed), "w7", "ends")).toBe("stale");
    const codes = validate_completeness(changed).map((issue) => `${issue.code}:${issue.entity_id}`);
    expect(codes).toContain("W_EVIDENCE_STALE:w7");
    expect(codes).toContain("W_REVIEW_STALE:w7");
  });

  it("flags a rejected review as blocking, not silently release-ready", () => {
    const doc = build_synthetic_milestone();
    const index = build_index(doc);
    const rejected = apply_ok(doc, [
      cmd_insert("reviews", make_review(doc, index, { id: "r_seg_b1_x1", entity_id: "seg_b1_x1", field: "length", status: "rejected" })),
    ], "b_reject_seg_b1_x1");
    const codes = validate_completeness(rejected).map((issue) => `${issue.code}:${issue.entity_id}`);
    expect(codes).toContain("M_REVIEW_REJECTED:seg_b1_x1");
  });

  it("blocks release on a rejected review even when nothing else is missing", () => {
    const complete = complete_small_doc();
    expect(validate(complete, { level: "build", harness_ids: null })).toEqual([]);
    const review = make_review(complete, build_index(complete), { id: "r_w1_spec", entity_id: "w1", field: "spec", status: "rejected" });
    const issues = validate({ ...complete, reviews: [review] }, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.entity_id}`)).toEqual(["M_REVIEW_REJECTED:error:w1"]);
    expect(is_release_ready(issues)).toBe(false);
  });

  it("flags an open wire end", () => {
    const complete = complete_small_doc();
    const open = { ...complete, wires: complete.wires.map((w) => ({ ...w, ends: [w.ends[0], open_end] as typeof w.ends })) };
    const issues = validate(open, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_WIRE_END_OPEN:error:wires/w1/ends/1"]);
  });

  it("flags a wire end whose connector has no topology node", () => {
    const complete = complete_small_doc();
    const no_node = {
      ...complete,
      connectors: [...complete.connectors, { ...connector("j3", "h1", "J3", ["1"]), housing: identified("p_housing") }],
      contacts: [...complete.contacts, { ...contact("j3", "1"), terminal: identified("p_terminal") }],
      wires: complete.wires.map((w) => ({ ...w, ends: [w.ends[0], to_contact("j3", "1")] as typeof w.ends })),
    };
    const issues = validate(no_node, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ENDPOINT_NODE_MISSING:error:wires/w1/route"]);
  });

  it("flags a route that does not join the wire's two ends", () => {
    const complete = complete_small_doc();
    const detour = {
      ...complete,
      nodes: [...complete.nodes, node("n_b1", "h1", "breakout", null)],
      segments: [...complete.segments, segment("s2", "h1", "n_j1", "n_b1", 100, 2)],
      wires: complete.wires.map((w) => ({ ...w, route: ["s2"] })),
    };
    const issues = validate(detour, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ROUTE_NOT_CONTIGUOUS:error:wires/w1/route"]);
  });

  it("marks evidence stale when the measured value changes", () => {
    const doc = build_synthetic_milestone();
    const measured = doc.evidence.find((e) => e.id === "e_seg_j1_b1_length");
    if (!measured) throw new Error("fixture evidence missing");
    expect(evidence_state(build_index(doc), measured)).toBe("current");
    const remeasured = apply_ok(doc, [cmd_update("segments", "seg_j1_b1", { length: make_length({ nominal_mm: 310, tol_plus_mm: 5, datum_a: "connector_back_face", datum_b: "breakout_centre" }) })], "b_remeasure");
    expect(validate_completeness(remeasured).map((issue) => `${issue.code}:${issue.entity_id}`)).toContain("W_EVIDENCE_STALE:seg_j1_b1");
  });
});
