import { describe, expect, it } from "vitest";
import { cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { build_index } from "../src/model/doc_index.ts";
import { make_length } from "../src/model/make_length.ts";
import { validate_completeness } from "../src/validate/completeness.ts";
import { evidence_state, make_evidence, make_review, review_state } from "../src/validate/review_state.ts";
import { is_release_ready, validate } from "../src/validate/validate.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { apply_ok } from "./helpers/apply.ts";
import { connector, contact, identified, node, open_end, part, segment, small_doc, to_contact } from "./helpers/entities.ts";
import type { Evidence, LoomDocument } from "../src/schema/document.ts";
import type { Datum } from "../src/schema/primitives.ts";

// small_doc with every part identified and its segment measured: no completeness issue at all. `change` edits the
// document before the measurement evidence is recorded, so the evidence describes the changed value.
function complete_small_doc(change: (doc: LoomDocument) => LoomDocument = (doc) => doc): LoomDocument {
  const base = small_doc();
  const doc = change({
    ...base,
    parts: [part("p_housing", "housing", "SYN-H2", "2-way housing (synthetic)"), part("p_terminal", "terminal", "SYN-T1", "terminal (synthetic)")],
    connectors: base.connectors.map((c) => ({ ...c, housing: identified("p_housing") })),
    contacts: base.contacts.map((k) => ({ ...k, terminal: identified("p_terminal") })),
  });
  const measured = make_evidence(build_index(doc), { id: "e_s1_length", entity_id: "s1", field: "length", origin: "measured", source: null, note: null });
  return { ...doc, evidence: [...doc.evidence, measured] };
}

const build_codes = (doc: LoomDocument) => validate(doc, { level: "build", harness_ids: null }).map((issue) => `${issue.code}:${issue.entity_id}`);
const build_paths = (doc: LoomDocument) => validate(doc, { level: "build", harness_ids: null }).map((issue) => `${issue.code}:${issue.severity}:${issue.path}`);

describe("completeness validation", () => {
  it("lists exactly what blocks a build of the fixture", () => {
    const issues = validate(build_synthetic_milestone(), { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.entity_id}`)).toEqual([
      "M_ALLOWANCE_UNKNOWN:w4",
      "M_LENGTH_UNKNOWN:w3",
      "M_LENGTH_UNKNOWN:w5",
      "M_LENGTH_UNMEASURED:seg_b1_g1",
      "M_LENGTH_UNMEASURED:seg_b1_s1",
      "M_PART_UNIDENTIFIED:x2_k1",
      "M_PART_UNIDENTIFIED:x2_k2",
      "M_PART_UNIDENTIFIED:x2",
      "M_WIRE_SPEC_UNKNOWN:w8",
      "M_WIRE_UNROUTED:w7",
      "M_WIRE_UNROUTED:w8",
      "W_INFERRED_UNREVIEWED:w7",
      "W_LENGTH_OUTSIDE_ESTIMATE:seg_s1_j2",
      "W_REVIEW_STALE:w2",
    ]);
    expect(is_release_ready(issues)).toBe(false);
  });

  it("structural level ignores completeness", () => {
    expect(validate(build_synthetic_milestone(), { level: "structural", harness_ids: null })).toEqual([]);
  });

  it("scopes wire and part checks to the selected harnesses", () => {
    const errors = validate_completeness(build_synthetic_milestone(), { harness_ids: ["h_engine"] }).filter((i) => i.severity === "error");
    expect(errors.map((issue) => issue.entity_id)).toEqual(["w4", "w3", "w5", "seg_b1_g1", "seg_b1_s1"]);
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
    expect(validate_completeness(remeasured).map((issue) => `${issue.code}:${issue.entity_id}`)).toContain("M_LENGTH_UNMEASURED:seg_j1_b1");
  });

  it("accepts only current measured or documented evidence for a routed segment length", () => {
    const complete = complete_small_doc();
    const with_origin = (origin: Evidence["origin"]): LoomDocument => ({ ...complete, evidence: complete.evidence.map((e) => ({ ...e, origin })) });
    expect(build_codes(with_origin("documented"))).toEqual([]);
    expect(build_codes(with_origin("assumed"))).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    expect(build_codes(with_origin("inferred"))).toEqual(["M_LENGTH_UNMEASURED:s1", "W_INFERRED_UNREVIEWED:s1"]);
    const inferred = with_origin("inferred");
    const approved = { ...inferred, reviews: [make_review(inferred, build_index(inferred), { id: "r_s1_length", entity_id: "s1", field: "length", status: "approved" })] };
    expect(build_codes(approved)).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    expect(build_codes({ ...complete, evidence: [] })).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    const length = make_length({ nominal_mm: 505, tol_plus_mm: 5, datum_a: "connector_back_face", datum_b: "connector_back_face" });
    expect(build_codes({ ...complete, segments: complete.segments.map((s) => ({ ...s, length })) })).toEqual(["M_LENGTH_UNMEASURED:s1", "W_EVIDENCE_STALE:s1"]);
  });

  it("only asks to measure segments that a routed wire crosses", () => {
    const complete = complete_small_doc();
    const spare = {
      ...complete,
      nodes: [...complete.nodes, node("n_b1", "h1", "breakout", null)],
      segments: [...complete.segments, segment("s2", "h1", "n_j1", "n_b1", 100, 2)],
    };
    expect(validate(spare, { level: "build", harness_ids: null })).toEqual([]);
  });

  it("requires both datums on a routed segment", () => {
    const unmarked = complete_small_doc((doc) => ({ ...doc, segments: doc.segments.map((s) => ({ ...s, length: { ...s.length, datum_b: null } })) }));
    const issues = validate(unmarked, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_LENGTH_DATUM_UNKNOWN:error:segments/s1/length"]);
    expect(issues[0]?.message).toContain("node_b");
  });

  it("flags an allowance given from another datum than the route was measured to", () => {
    const shifted = complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, allowances: { ...w.allowances, end_a: { datum: "connector_mating_face" as const, beyond_datum_mm: -5 } } })),
    }));
    expect(build_paths(shifted)).toEqual(["M_ALLOWANCE_DATUM_MISMATCH:error:wires/w1/allowances/end_a/datum"]);
  });

  it("checks the datums where consecutive segments meet at the connector they pass", () => {
    const through_j3 = (s1_datum_at_j3: Datum | null, s2_datum_at_j3: Datum | null = "connector_back_face") => {
      const doc = complete_small_doc((doc) => ({
        ...doc,
        connectors: [...doc.connectors, { ...connector("j3", "h1", "J3", ["1"]), housing: identified("p_housing") }],
        nodes: [...doc.nodes, node("n_j3", "h1", "connector", "j3")],
        segments: [
          segment("s1", "h1", "n_j1", "n_j3", 200, 5, 0, ["connector_back_face", s1_datum_at_j3]),
          segment("s2", "h1", "n_j3", "n_j2", 300, 5, 0, [s2_datum_at_j3, "connector_back_face"]),
        ],
        wires: doc.wires.map((w) => ({ ...w, route: ["s1", "s2"] })),
      }));
      // s2 carries current measured evidence too, like s1, so each case below has exactly one blocker.
      const s2_measured = make_evidence(build_index(doc), { id: "e_s2_length", entity_id: "s2", field: "length", origin: "measured", source: null, note: null });
      return { ...doc, evidence: [...doc.evidence, s2_measured] };
    };
    expect(build_paths(through_j3("connector_mating_face"))).toEqual(["M_ROUTE_DATUM_MISMATCH:error:wires/w1/route"]);
    const s1_unmarked = validate(through_j3(null), { level: "build", harness_ids: null });
    expect(s1_unmarked.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_LENGTH_DATUM_UNKNOWN:error:segments/s1/length"]);
    expect(is_release_ready(s1_unmarked)).toBe(false);
    const s2_unmarked = validate(through_j3("connector_back_face", null), { level: "build", harness_ids: null });
    expect(s2_unmarked.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_LENGTH_DATUM_UNKNOWN:error:segments/s2/length"]);
    expect(is_release_ready(s2_unmarked)).toBe(false);
  });

  it("measures a same-node wire from one point on that node", () => {
    const jumper = (end_b: "connector_back_face" | "connector_mating_face") => complete_small_doc((doc) => ({
      ...doc,
      contacts: [...doc.contacts, { ...contact("j1", "2"), terminal: identified("p_terminal") }],
      wires: doc.wires.map((w) => ({ ...w, ends: [to_contact("j1", "1"), to_contact("j1", "2")] as typeof w.ends, route: [], allowances: { ...w.allowances, end_b: { datum: end_b, beyond_datum_mm: 20 } } })),
    }));
    const same_point = validate(jumper("connector_back_face"), { level: "build", harness_ids: null });
    expect(same_point).toEqual([]);
    const two_points = validate(jumper("connector_mating_face"), { level: "build", harness_ids: null });
    expect(two_points.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ALLOWANCE_DATUM_MISMATCH:error:wires/w1/allowances/end_b/datum"]);
    expect(is_release_ready(two_points)).toBe(false);
  });

  it("flags unknown allowances whatever the route status", () => {
    const unknown_beyond = (route: string[] | null) => complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, route, allowances: { ...w.allowances, end_b: { ...w.allowances.end_b, beyond_datum_mm: null } } })),
    }));
    const routed = validate(unknown_beyond(["s1"]), { level: "build", harness_ids: null });
    expect(routed.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ALLOWANCE_UNKNOWN:error:wires/w1/allowances"]);
    expect(routed[0]?.message).toContain("end_b.beyond_datum_mm");
    expect(validate(unknown_beyond(null), { level: "build", harness_ids: null }).map((issue) => issue.code)).toEqual(["M_ALLOWANCE_UNKNOWN", "M_WIRE_UNROUTED"]);
  });

  it("flags a cut length that is not positive", () => {
    const short = complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, allowances: { ...w.allowances, end_a: { ...w.allowances.end_a, beyond_datum_mm: -600 } } })),
    }));
    expect(build_paths(short)).toEqual(["M_CUT_LENGTH_NOT_POSITIVE:error:wires/w1/allowances"]);
  });

  it("warns when a length falls outside its estimate, without staling the length evidence", () => {
    const complete = complete_small_doc();
    const with_estimate = (min_mm: number, max_mm: number): LoomDocument => ({
      ...complete, segments: complete.segments.map((s) => ({ ...s, length_estimate: { min_mm, max_mm, method: "synthetic" } })),
    });
    const issues = validate(with_estimate(400, 450), { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["W_LENGTH_OUTSIDE_ESTIMATE:warning:segments/s1/length"]);
    expect(is_release_ready(issues)).toBe(true);
    expect(validate(with_estimate(500, 500), { level: "build", harness_ids: null })).toEqual([]);
  });
});
