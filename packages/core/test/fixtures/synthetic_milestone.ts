import { cmd_insert, cmd_update } from "../../src/commands/builders.ts";
import { build_index } from "../../src/model/doc_index.ts";
import { create_empty_document } from "../../src/model/empty_document.ts";
import type { LoomDocument } from "../../src/schema/document.ts";
import type { Datum } from "../../src/schema/primitives.ts";
import { make_evidence, make_review } from "../../src/validate/review_state.ts";
import { apply_ok } from "../helpers/apply.ts";
import {
  candidate, connector, contact, ground, harness, identified, node, part, segment, spec, splice,
  to_contact, to_ground, to_splice, unknown_part, wire,
} from "../helpers/entities.ts";

// sha256 of the text "loomsmith synthetic fixture asset"; the asset itself does not exist.
export const synthetic_asset_sha256 = "2482dd3f269bca15de96089d4caa5fccb1675ff10d978cf9acfb24f17bc2af32";

// Synthetic, not a real vehicle. Covers: splice, repeated colours, unmeasured segment, unknown wire spec,
// double-wire termination (J1:3), base/stripe colours, terminal/seal quantities, a mating across two
// harnesses, schematic-only wires, an SRS connector, inferred evidence and a stale approval.
export function build_synthetic_milestone(): LoomDocument {
  const E = "h_engine";
  const B = "h_body";
  const at_connector: Datum = "connector_back_face";
  const at_breakout: Datum = "breakout_centre";
  const at_splice: Datum = "splice_centre";
  const at_ground: Datum = "ground_stud_centre";
  const terminal = identified("p_terminal");
  const seal = identified("p_seal");
  let doc = create_empty_document("doc_synthetic_milestone", "SYNTHETIC MILESTONE (not a real vehicle)");
  doc = apply_ok(doc, [
    cmd_insert("harnesses", harness(E, "ENGINE_SIDE")),
    cmd_insert("harnesses", harness(B, "BODY_SIDE")),
    cmd_insert("parts", part("p_housing_3", "housing", "SYN-H3", "3-way housing (synthetic)")),
    cmd_insert("parts", part("p_housing_2", "housing", "SYN-H2", "2-way housing (synthetic)")),
    cmd_insert("parts", part("p_terminal", "terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)")),
    cmd_insert("parts", part("p_seal", "seal", "SYN-S1", "seal (synthetic)")),
    cmd_insert("parts", part("p_splice", "splice", "SYN-SP1", "splice crimp (synthetic)")),
    cmd_insert("connectors", connector("j1", E, "J1", ["1", "2", "3"], identified("p_housing_3"))),
    cmd_insert("connectors", connector("j2", E, "J2", ["1", "2"], identified("p_housing_2"))),
    cmd_insert("connectors", { ...connector("x1", E, "X1", ["1", "2"], identified("p_housing_2")), housing_gender: "male" }),
    cmd_insert("connectors", { ...connector("x2", B, "X2", ["1", "2"], unknown_part), housing_gender: "female" }),
    cmd_insert("connectors", { ...connector("j3", B, "J3", ["1", "2"], identified("p_housing_2")), safety_class: "srs" }),
    cmd_insert("contacts", contact("j1", "1", { terminal, seal })),
    cmd_insert("contacts", contact("j1", "2", { terminal, seal })),
    cmd_insert("contacts", contact("j1", "3", { terminal, seal, max_wire_ends: 2 })),
    cmd_insert("contacts", contact("j2", "1", { terminal })),
    cmd_insert("contacts", contact("j2", "2", { terminal })),
    cmd_insert("contacts", contact("x1", "1", { terminal })),
    cmd_insert("contacts", contact("x1", "2", { terminal })),
    cmd_insert("contacts", contact("x2", "1", { terminal: candidate("p_terminal") })),
    cmd_insert("contacts", contact("x2", "2", { terminal: candidate("p_terminal") })),
    cmd_insert("contacts", contact("j3", "1", { terminal })),
    cmd_insert("contacts", contact("j3", "2", { terminal })),
    cmd_insert("splices", splice("s1", E, "S1", identified("p_splice"))),
    cmd_insert("ground_points", ground("g1", E, "G1")),
    cmd_insert("nodes", node("n_j1", E, "connector", "j1")),
    cmd_insert("nodes", node("n_j2", E, "connector", "j2")),
    cmd_insert("nodes", node("n_x1", E, "connector", "x1")),
    cmd_insert("nodes", node("n_s1", E, "splice", "s1")),
    cmd_insert("nodes", node("n_g1", E, "ground", "g1")),
    cmd_insert("nodes", node("n_b1", E, "breakout", null)),
    cmd_insert("segments", segment("seg_j1_b1", E, "n_j1", "n_b1", 300, 5, 0, [at_connector, at_breakout])),
    cmd_insert("segments", segment("seg_b1_s1", E, "n_b1", "n_s1", 120, 3, 1, [at_breakout, at_splice])),
    cmd_insert("segments", segment("seg_s1_j2", E, "n_s1", "n_j2", 450, 5, 0, [at_splice, at_connector])),
    cmd_insert("segments", segment("seg_b1_x1", E, "n_b1", "n_x1", null, null, 0, [at_breakout, at_connector])),
    cmd_insert("segments", segment("seg_b1_g1", E, "n_b1", "n_g1", 80, 2, 0, [at_breakout, at_ground])),
    cmd_insert("wires", wire("w1", E, "W1", [to_contact("j1", "1"), to_splice("s1")], spec(0.5, "R"), ["seg_j1_b1", "seg_b1_s1"])),
    cmd_insert("wires", wire("w2", E, "W2", [to_splice("s1"), to_contact("j2", "1")], spec(0.5, "R"), ["seg_s1_j2"])),
    cmd_insert("wires", wire("w3", E, "W3", [to_splice("s1"), to_contact("x1", "1")], spec(0.5, "R"), ["seg_b1_s1", "seg_b1_x1"])),
    cmd_insert("wires", wire("w4", E, "W4", [to_contact("j1", "2"), to_ground("g1")], spec(0.85, "B"), ["seg_j1_b1", "seg_b1_g1"])),
    cmd_insert("wires", wire("w5", E, "W5", [to_contact("j1", "3"), to_contact("x1", "2")], spec(0.5, "G", ["W"]), ["seg_j1_b1", "seg_b1_x1"])),
    cmd_insert("wires", wire("w6", E, "W6", [to_contact("j1", "3"), to_contact("j2", "2")], spec(0.5, "G", ["W"]), ["seg_j1_b1", "seg_b1_s1", "seg_s1_j2"])),
    cmd_insert("wires", wire("w7", B, "W7", [to_contact("x2", "1"), to_contact("j3", "1")], spec(0.5, "R"), null)),
    cmd_insert("wires", wire("w8", B, "W8", [to_contact("x2", "2"), to_contact("j3", "2")], spec(null, null), null)),
    cmd_insert("matings", {
      id: "m_x1_x2",
      connector_a: "x1",
      connector_b: "x2",
      cavity_map: [{ cavity_a: "x1_c1", cavity_b: "x2_c1" }, { cavity_a: "x1_c2", cavity_b: "x2_c2" }],
    }),
    cmd_insert("assets", {
      id: "a_diagram",
      sha256: synthetic_asset_sha256,
      media_type: "application/pdf",
      blob_ref: "synthetic://fixture/diagram.pdf",
      title: "synthetic diagram placeholder (no real content)",
    }),
    cmd_insert("view_positions", { id: "n_j1", x: 0, y: 0 }),
    cmd_insert("view_positions", { id: "n_b1", x: 300, y: 0 }),
  ], "b_build");
  // Evidence and reviews record the value they describe, so they are added once the entities exist.
  const index = build_index(doc);
  doc = apply_ok(doc, [
    cmd_insert("evidence", make_evidence(index, {
      id: "e_w7_ends",
      entity_id: "w7",
      field: "ends",
      origin: "inferred",
      source: { asset_id: "a_diagram", page_index: 0, bbox: [100, 200, 300, 220] },
      note: "synthetic example of an LLM-inferred connection",
    })),
    cmd_insert("evidence", make_evidence(index, {
      id: "e_seg_j1_b1_length", entity_id: "seg_j1_b1", field: "length", origin: "measured", source: null, note: "synthetic tape measurement",
    })),
    cmd_insert("reviews", make_review(doc, index, { id: "r_w1_spec", entity_id: "w1", field: "spec", status: "approved" })),
    cmd_insert("reviews", make_review(doc, index, { id: "r_w2_spec", entity_id: "w2", field: "spec", status: "approved" })),
  ], "b_review");
  doc = apply_ok(doc, [cmd_update("wires", "w2", { spec: spec(0.85, "R") })], "b_resize_w2");
  return doc;
}
