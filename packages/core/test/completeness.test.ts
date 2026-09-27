import { describe, expect, it } from "vitest";
import { cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { build_index } from "../src/model/doc_index.ts";
import { validate_completeness } from "../src/validate/completeness.ts";
import { evidence_state, make_review, review_state } from "../src/validate/review_state.ts";
import { is_release_ready, validate } from "../src/validate/validate.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { apply_ok } from "./helpers/apply.ts";
import { to_contact } from "./helpers/entities.ts";

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
    expect(codes).toContain("W_REVIEW_REJECTED:seg_b1_x1");
  });

  it("marks evidence stale when the measured value changes", () => {
    const doc = build_synthetic_milestone();
    const measured = doc.evidence.find((e) => e.id === "e_seg_j1_b1_length");
    if (!measured) throw new Error("fixture evidence missing");
    expect(evidence_state(build_index(doc), measured)).toBe("current");
    const remeasured = apply_ok(doc, [cmd_update("segments", "seg_j1_b1", { length: { nominal_mm: 310, tol_mm: 5, datum: null } })], "b_remeasure");
    expect(validate_completeness(remeasured).map((issue) => `${issue.code}:${issue.entity_id}`)).toContain("W_EVIDENCE_STALE:seg_j1_b1");
  });
});
