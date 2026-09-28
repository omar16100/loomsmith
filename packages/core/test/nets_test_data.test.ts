import { describe, expect, it } from "vitest";
import { active_matings, derive_nets } from "../src/derive/nets.ts";
import { derive_test_data, is_excluded_endpoint, type TestBoundary, type TestData } from "../src/derive/test_data.ts";
import { build_index } from "../src/model/doc_index.ts";
import { validate_structure } from "../src/validate/structural.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { connector, contact, small_doc, spec, to_contact, to_splice, wire } from "./helpers/entities.ts";
import type { LoomDocument, Wire } from "../src/schema/document.ts";

const doc = build_synthetic_milestone();

describe("nets", () => {
  it("joins wires through splices and connected matings", () => {
    expect(derive_nets(doc, { harness_ids: null, mating_states: {}, default_mating_state: "connected" })).toEqual([
      {
        net_id: "contact:j1_k1",
        endpoint_keys: ["contact:j1_k1", "contact:j2_k1", "contact:j3_k1", "contact:x1_k1", "contact:x2_k1", "splice:s1"],
        wire_ids: ["w1", "w2", "w3", "w7"],
      },
      { net_id: "contact:j1_k2", endpoint_keys: ["contact:j1_k2", "ground_point:g1"], wire_ids: ["w4"] },
      {
        net_id: "contact:j1_k3",
        endpoint_keys: ["contact:j1_k3", "contact:j2_k2", "contact:j3_k2", "contact:x1_k2", "contact:x2_k2"],
        wire_ids: ["w5", "w6", "w8"],
      },
    ]);
  });

  it("keeps harnesses apart when their mating is disconnected", () => {
    const nets = derive_nets(doc, { harness_ids: null, mating_states: { m_x1_x2: "disconnected" }, default_mating_state: "connected" });
    expect(nets.map((net) => net.net_id)).toEqual(["contact:j1_k1", "contact:j1_k2", "contact:j1_k3", "contact:j3_k1", "contact:j3_k2"]);
  });

  it("does not let a mating id shadow an inherited Object property and defeat the default mating state", () => {
    const base = small_doc();
    const with_mating: LoomDocument = {
      ...base,
      contacts: [...base.contacts, contact("j1", "2"), contact("j2", "2")],
      matings: [{ id: "constructor", connector_a: "j1", connector_b: "j2", cavity_map: [{ cavity_a: "j1_c2", cavity_b: "j2_c2" }] }],
    };
    const nets = derive_nets(with_mating, { harness_ids: null, mating_states: {}, default_mating_state: "connected" });
    expect(nets.map((net) => net.endpoint_keys)).toContainEqual(["contact:j1_k2", "contact:j2_k2"]);
  });

  it("never overflows the call stack on a long chain of wires, regardless of endpoint order", () => {
    const pad = (i: number) => String(i).padStart(6, "0");
    const n = 12000;
    const wires: Wire[] = [];
    for (let i = n; i > 0; i -= 1) {
      wires.push({
        id: `wc${pad(i)}`,
        harness_id: "h1",
        label: `WC${pad(i)}`,
        ends: [{ kind: "splice", splice_id: `sc${pad(i)}` }, { kind: "splice", splice_id: `sc${pad(i - 1)}` }],
        spec: { cross_section_mm2: null, designation: null, base_colour: null, stripe_colours: [], insulation: null },
        route: null,
        allowances: { end_a: { datum: null, beyond_datum_mm: null }, end_b: { datum: null, beyond_datum_mm: null }, service_loop_mm: null },
      });
    }
    const long_chain: LoomDocument = { ...small_doc(), wires };
    expect(() => derive_nets(long_chain, { harness_ids: null, mating_states: {}, default_mating_state: "connected" })).not.toThrow();
  });

  it("activates a mating only when it is connected and both connectors are in scope", () => {
    const index = build_index(doc);
    const ids = (harness_ids: string[] | null, state: "connected" | "disconnected") =>
      active_matings(doc, index, harness_ids, { m_x1_x2: state }, "disconnected").map((m) => m.id);
    expect(ids(null, "connected")).toEqual(["m_x1_x2"]);
    expect(ids(["h_engine", "h_body"], "connected")).toEqual(["m_x1_x2"]);
    expect(ids(["h_engine"], "connected")).toEqual([]);
    expect(ids(null, "disconnected")).toEqual([]);
  });
});

const bench = (overrides: Partial<TestBoundary> = {}): TestBoundary => ({
  harness_ids: ["h_engine"], mating_states: {}, excluded_connector_ids: [], include_srs: false, ...overrides,
});

function bench_data(target: LoomDocument, boundary: TestBoundary): TestData {
  const result = derive_test_data(target, boundary);
  if (!result.ok) throw new Error(`boundary refused: ${result.problems.map((p) => `${p.code}:${p.id}`).join(", ")}`);
  return result.data;
}

const problem_codes = (target: LoomDocument, boundary: TestBoundary) => {
  const result = derive_test_data(target, boundary);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.id]);
};

describe("bench test data", () => {
  it("builds continuity and isolation checks for one harness", () => {
    const data = bench_data(doc, bench({ harness_ids: ["h_engine"] }));
    expect(data.nets).toEqual([
      { net_id: "contact:j1_k1", points: ["J1:1", "J2:1", "X1:1"] },
      { net_id: "contact:j1_k2", points: ["G1", "J1:2"] },
      { net_id: "contact:j1_k3", points: ["J1:3", "J2:2", "X1:2"] },
    ]);
    expect(data.continuity).toEqual([
      { net_id: "contact:j1_k1", from: "J1:1", to: "J2:1" },
      { net_id: "contact:j1_k1", from: "J1:1", to: "X1:1" },
      { net_id: "contact:j1_k2", from: "G1", to: "J1:2" },
      { net_id: "contact:j1_k3", from: "J1:3", to: "J2:2" },
      { net_id: "contact:j1_k3", from: "J1:3", to: "X1:2" },
    ]);
    expect(data.isolation).toEqual([
      { net_a: "contact:j1_k1", net_b: "contact:j1_k2", point_a: "J1:1", point_b: "G1" },
      { net_a: "contact:j1_k1", net_b: "contact:j1_k3", point_a: "J1:1", point_b: "J1:3" },
      { net_a: "contact:j1_k2", net_b: "contact:j1_k3", point_a: "G1", point_b: "J1:3" },
    ]);
    expect(data.excluded_net_ids).toEqual([]);
    expect(data.excluded_points).toEqual([]);
    expect(data.untestable_net_ids).toEqual([]);
  });

  it("hides mated connectors and excludes whole SRS circuits by default", () => {
    const data = bench_data(doc, bench({ harness_ids: ["h_engine", "h_body"], mating_states: { m_x1_x2: "connected" } }));
    expect(data.nets).toEqual([{ net_id: "contact:j1_k2", points: ["G1", "J1:2"] }]);
    expect(data.continuity).toEqual([{ net_id: "contact:j1_k2", from: "G1", to: "J1:2" }]);
    expect(data.isolation).toEqual([]);
    expect(data.excluded_net_ids).toEqual(["contact:j1_k1", "contact:j1_k3"]);
    expect(data.excluded_points).toEqual(["J1:1", "J1:3", "J2:1", "J2:2", "J3:1", "J3:2"]);
    expect(data.untestable_net_ids).toEqual([]);
  });

  it("never tests SRS circuits on a body-only bench", () => {
    const data = bench_data(doc, bench({ harness_ids: ["h_body"] }));
    expect(data.nets).toEqual([]);
    expect(data.isolation).toEqual([]);
    expect(data.excluded_points).toEqual(["J3:1", "J3:2", "X2:1", "X2:2"]);
  });

  it("includes SRS circuits only when asked", () => {
    const data = bench_data(doc, bench({ harness_ids: ["h_body"], include_srs: true }));
    expect(data.nets).toEqual([
      { net_id: "contact:j3_k1", points: ["J3:1", "X2:1"] },
      { net_id: "contact:j3_k2", points: ["J3:2", "X2:2"] },
    ]);
  });

  it("refuses a connected mating that has only one side on the bench (the path would reach SRS J3)", () => {
    const result = derive_test_data(doc, bench({ harness_ids: ["h_engine"], mating_states: { m_x1_x2: "connected" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([{ code: "mating_crosses_boundary", id: "m_x1_x2", message: expect.stringContaining("m_x1_x2") }]);
  });

  it("refuses unknown mating, connector and harness ids instead of ignoring them", () => {
    expect(problem_codes(doc, bench({ mating_states: { m_x1_x2_typo: "connected" } }))).toEqual([["unknown_mating", "m_x1_x2_typo"]]);
    expect(problem_codes(doc, bench({ mating_states: { m_typo: "disconnected" } }))).toEqual([["unknown_mating", "m_typo"]]);
    expect(problem_codes(doc, bench({ excluded_connector_ids: ["j99"] }))).toEqual([["unknown_connector", "j99"]]);
    expect(problem_codes(doc, bench({ harness_ids: ["h_engine", "h_enigne"] }))).toEqual([["unknown_harness", "h_enigne"]]);
  });

  it("reports every boundary problem, sorted by code then id", () => {
    const boundary = bench({
      harness_ids: ["h_zz", "h_engine", "h_aa", "h_zz"],
      mating_states: { m_b: "connected", m_a: "disconnected" },
      excluded_connector_ids: ["c_x"],
    });
    expect(problem_codes(doc, boundary)).toEqual([
      ["unknown_connector", "c_x"],
      ["unknown_harness", "h_aa"],
      ["unknown_harness", "h_zz"],
      ["unknown_mating", "m_a"],
      ["unknown_mating", "m_b"],
    ]);
  });

  it("refuses a structurally invalid document", () => {
    const base = small_doc();
    const broken: LoomDocument = { ...base, connectors: [...base.connectors, connector("j9", "nope", "J9", ["1"])] };
    const result = derive_test_data(broken, bench({ harness_ids: ["h1"] }));
    expect(result).toEqual({
      ok: false,
      problems: [{ code: "structural_errors", id: null, message: expect.stringContaining("1 structural error") }],
    });
  });

  it("refuses an in-scope wire that reaches an SRS connector of a harness outside the boundary", () => {
    const srs_j9 = { ...connector("j9", "h_body", "J9", ["1"]), safety_class: "srs" as const };
    const reaching: LoomDocument = {
      ...doc,
      connectors: [...doc.connectors, srs_j9],
      contacts: [...doc.contacts, contact("j9", "1")],
      wires: [...doc.wires, wire("w9", "h_engine", "W9", [to_splice("s1"), to_contact("j9", "1")], spec(0.5, "R"), null)],
    };
    expect(problem_codes(reaching, bench({ harness_ids: ["h_engine"] }))).toEqual([["structural_errors", null]]);
  });

  it("excludes an endpoint on an SRS or listed connector whatever harness that connector is in", () => {
    const index = build_index(doc);
    const engine_only = bench({ harness_ids: ["h_engine"] });
    expect(is_excluded_endpoint(index, engine_only, "contact:j3_k1")).toBe(true);
    expect(is_excluded_endpoint(index, { ...engine_only, include_srs: true }, "contact:j3_k1")).toBe(false);
    expect(is_excluded_endpoint(index, { ...engine_only, include_srs: true, excluded_connector_ids: ["x2"] }, "contact:x2_k1")).toBe(true);
    expect(is_excluded_endpoint(index, engine_only, "contact:j1_k1")).toBe(false);
    expect(is_excluded_endpoint(index, engine_only, "splice:s1")).toBe(false);
  });

  it("lists a net hidden by connected matings as untestable instead of dropping it", () => {
    const base = small_doc();
    const jumper: LoomDocument = {
      ...base,
      connectors: [...base.connectors, connector("j3", "h1", "J3", ["1"]), connector("j4", "h1", "J4", ["1"])],
      contacts: [...base.contacts, contact("j3", "1"), contact("j4", "1")],
      matings: [
        { id: "m_a", connector_a: "j1", connector_b: "j3", cavity_map: [{ cavity_a: "j1_c1", cavity_b: "j3_c1" }] },
        { id: "m_b", connector_a: "j2", connector_b: "j4", cavity_map: [{ cavity_a: "j2_c1", cavity_b: "j4_c1" }] },
      ],
    };
    expect(validate_structure(jumper)).toEqual([]);
    const data = bench_data(jumper, bench({ harness_ids: ["h1"], mating_states: { m_a: "connected", m_b: "connected" } }));
    expect(data.nets).toEqual([]);
    expect(data.excluded_net_ids).toEqual([]);
    expect(data.untestable_net_ids).toEqual(["contact:j1_k1"]);
  });
});
