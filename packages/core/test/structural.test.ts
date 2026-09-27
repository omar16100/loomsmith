import { describe, expect, it } from "vitest";
import type { LoomDocument } from "../src/schema/document.ts";
import { validate_structure } from "../src/validate/structural.ts";
import {
  connector, contact, ground, harness, identified, node, open_end, part, segment, small_doc, spec, splice, to_contact, to_splice, wire,
} from "./helpers/entities.ts";

const find = (doc: LoomDocument, code: string) => validate_structure(doc).filter((issue) => issue.code === code);

describe("validate_structure", () => {
  it("accepts a valid document", () => {
    expect(validate_structure(small_doc())).toEqual([]);
  });

  it("flags a missing harness reference", () => {
    const doc = small_doc();
    const bad = { ...doc, connectors: [...doc.connectors, connector("j9", "nope", "J9", ["1"])] };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(
      expect.objectContaining({ path: "connectors/j9/harness_id", entity_id: "j9", severity: "error", level: "structural" }),
    );
  });

  it("flags a wire end pointing at a missing contact", () => {
    const doc = small_doc();
    const bad = { ...doc, wires: [...doc.wires, wire("w2", "h1", "W2", [to_contact("j1", "2"), open_end], spec(0.5, "R"), null)] };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(expect.objectContaining({ path: "wires/w2/ends/0", entity_id: "w2" }));
  });

  it("flags two contacts in one cavity", () => {
    const doc = small_doc();
    const bad = { ...doc, contacts: [...doc.contacts, { ...contact("j1", "1"), id: "j1_k1b" }] };
    expect(find(bad, "S_CAVITY_MULTIPLE_CONTACTS").map((issue) => issue.entity_id)).toEqual(["j1_k1b"]);
  });

  it("flags a contact holding more wire ends than allowed", () => {
    const doc = small_doc();
    const bad = { ...doc, wires: [...doc.wires, wire("w2", "h1", "W2", [to_contact("j1", "1"), to_contact("j2", "1")], spec(0.5, "R"), null)] };
    expect(find(bad, "S_CONTACT_OVERFILLED").map((issue) => issue.entity_id)).toEqual(["j1_k1", "j2_k1"]);
  });

  it("flags a wire whose end sits in another harness", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      harnesses: [...doc.harnesses, harness("h2", "SECOND")],
      contacts: [...doc.contacts, contact("j1", "2")],
      wires: [...doc.wires, wire("w3", "h2", "W3", [to_contact("j1", "2"), open_end], spec(0.5, "R"), null)],
    };
    expect(find(bad, "S_HARNESS_MISMATCH")).toContainEqual(expect.objectContaining({ path: "wires/w3/ends/0" }));
  });

  it("flags node kind errors and segment loops", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      nodes: [...doc.nodes, node("n_b", "h1", "breakout", "j1")],
      segments: [...doc.segments, segment("s2", "h1", "n_j1", "n_j1", 10)],
    };
    expect(find(bad, "S_NODE_KIND")).toContainEqual(expect.objectContaining({ path: "nodes/n_b/ref_id" }));
    expect(find(bad, "S_SEGMENT_LOOP")).toContainEqual(expect.objectContaining({ entity_id: "s2" }));
  });

  it("flags duplicate labels in the connector, splice and ground namespace", () => {
    const doc = small_doc();
    const bad = { ...doc, splices: [splice("sp1", "h1", "J1")] };
    expect(find(bad, "S_DUPLICATE_LABEL")).toContainEqual(expect.objectContaining({ path: "splices/sp1/label" }));
  });

  it("flags invalid matings", () => {
    const doc = small_doc();
    const bad = { ...doc, matings: [{ id: "m1", connector_a: "j1", connector_b: "j2", cavity_map: [{ cavity_a: "j1_c9", cavity_b: "j2_c1" }] }] };
    expect(find(bad, "S_MATING_INVALID")).toContainEqual(expect.objectContaining({ path: "matings/m1/cavity_map/0" }));
  });

  it("flags a cavity id repeated within one connector", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      connectors: doc.connectors.map((c) => (c.id === "j1" ? { ...c, cavities: [...c.cavities, { id: "j1_c1", label: "3" }] } : c)),
    };
    expect(validate_structure(bad)).toEqual([
      expect.objectContaining({ code: "S_DUPLICATE_CAVITY", path: "connectors/j1/cavities/j1_c1", entity_id: "j1", severity: "error" }),
    ]);
  });

  it("flags a second node referring to the same connector", () => {
    const doc = small_doc();
    const bad = { ...doc, nodes: [...doc.nodes, node("n_j1b", "h1", "connector", "j1")] };
    expect(validate_structure(bad)).toEqual([
      expect.objectContaining({ code: "S_NODE_DUPLICATE_REF", path: "nodes/n_j1b/ref_id", entity_id: "n_j1b" }),
    ]);
  });

  it("flags a connector mated with itself", () => {
    const doc = small_doc();
    const bad = { ...doc, matings: [{ id: "m_self", connector_a: "j1", connector_b: "j1", cavity_map: [{ cavity_a: "j1_c1", cavity_b: "j1_c2" }] }] };
    expect(validate_structure(bad)).toEqual([
      expect.objectContaining({ code: "S_MATING_INVALID", path: "matings/m_self", entity_id: "m_self", message: "a connector cannot mate with itself" }),
    ]);
  });

  it("flags a connector that appears in two matings", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      connectors: [...doc.connectors, connector("j3", "h1", "J3", ["1"])],
      matings: [
        { id: "m1", connector_a: "j1", connector_b: "j2", cavity_map: [{ cavity_a: "j1_c2", cavity_b: "j2_c2" }] },
        { id: "m2", connector_a: "j1", connector_b: "j3", cavity_map: [{ cavity_a: "j1_c1", cavity_b: "j3_c1" }] },
      ],
    };
    expect(validate_structure(bad)).toEqual([
      expect.objectContaining({ code: "S_MATING_INVALID", path: "connectors/j1", entity_id: "j1", message: "connector j1 is in 2 matings" }),
    ]);
  });

  it("flags an id reused across collections", () => {
    const doc = small_doc();
    const bad = { ...doc, ground_points: [ground("j1", "h1", "G1")] };
    expect(find(bad, "S_DUPLICATE_ID").map((issue) => issue.entity_id)).toEqual(["j1"]);
  });

  it("flags a part of the wrong kind", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      parts: [part("p_seal", "seal", "SYN-S1", "seal (synthetic)")],
      connectors: doc.connectors.map((c) => (c.id === "j1" ? { ...c, housing: identified("p_seal") } : c)),
    };
    expect(find(bad, "S_PART_KIND")).toContainEqual(expect.objectContaining({ path: "connectors/j1/housing/part_id" }));
  });

  it("flags evidence that points at a missing asset", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      evidence: [{
        id: "e1", entity_id: "w1", field: "spec", origin: "documented" as const, value_json: "{}",
        source: { asset_id: "a_missing", page_index: 0, bbox: null }, note: null,
      }],
    };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(expect.objectContaining({ path: "evidence/e1/source/asset_id" }));
  });

  it("flags an identified part use without a part id", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      connectors: doc.connectors.map((c) => (c.id === "j1" ? { ...c, housing: { ...c.housing, identification: "identified" as const } } : c)),
    };
    expect(find(bad, "S_PART_IDENTITY")).toContainEqual(expect.objectContaining({ path: "connectors/j1/housing/part_id" }));
  });

  it("flags repeated view positions and reviews of unknown fields", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      view_positions: [{ id: "n_j1", x: 0, y: 0 }, { id: "n_j1", x: 5, y: 5 }],
      reviews: [{ id: "r1", entity_id: "w1", field: "spec.cross_section_mm2", status: "approved" as const, reviewed_value_json: "0.5", revision: 0 }],
    };
    expect(find(bad, "S_DUPLICATE_ID")).toContainEqual(expect.objectContaining({ path: "view_positions/n_j1" }));
    expect(find(bad, "S_FIELD_UNKNOWN")).toContainEqual(expect.objectContaining({ path: "reviews/r1/field" }));
  });

  it("flags a review dated after the document's current revision", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      revision: 0,
      reviews: [{ id: "r_future", entity_id: "w1", field: "label", status: "approved" as const, reviewed_value_json: "\"W1\"", revision: 100 }],
    };
    expect(find(bad, "S_REVIEW_FUTURE_REVISION")).toContainEqual(expect.objectContaining({ path: "reviews/r_future/revision", entity_id: "r_future" }));
  });

  it("flags a splice holding more wire ends than its capacity", () => {
    const doc = small_doc();
    const ends = (i: number) => wire(`ws${i}`, "h1", `WS${i}`, [to_splice("sp1"), open_end], spec(0.5, "R"), null);
    const bad = { ...doc, splices: [{ ...splice("sp1", "h1", "SP1"), max_wire_ends: 2 }], wires: [...doc.wires, ends(1), ends(2), ends(3)] };
    expect(find(bad, "S_SPLICE_OVERFILLED").map((issue) => issue.entity_id)).toEqual(["sp1"]);
  });

  it("flags wire routes through missing or foreign segments", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      harnesses: [...doc.harnesses, harness("h2", "SECOND")],
      nodes: [...doc.nodes, node("n_h2a", "h2", "breakout", null), node("n_h2b", "h2", "breakout", null)],
      segments: [...doc.segments, segment("s_h2", "h2", "n_h2a", "n_h2b", 10)],
      wires: [...doc.wires, wire("w4", "h1", "W4", [open_end, open_end], spec(0.5, "R"), ["s_missing", "s_h2"])],
    };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(expect.objectContaining({ path: "wires/w4/route/0" }));
    expect(find(bad, "S_HARNESS_MISMATCH")).toContainEqual(expect.objectContaining({ path: "wires/w4/route/1" }));
  });
});
