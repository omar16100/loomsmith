import { describe, expect, it } from "vitest";
import { derive_nets } from "../src/derive/nets.ts";
import { derive_test_data } from "../src/derive/test_data.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { contact, small_doc } from "./helpers/entities.ts";
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
        allowances: { end_a_mm: 0, end_b_mm: 0, service_mm: 0 },
      });
    }
    const long_chain: LoomDocument = { ...small_doc(), wires };
    expect(() => derive_nets(long_chain, { harness_ids: null, mating_states: {}, default_mating_state: "connected" })).not.toThrow();
  });
});

describe("bench test data", () => {
  it("builds continuity and isolation checks for one harness", () => {
    const data = derive_test_data(doc, { harness_ids: ["h_engine"], mating_states: {}, excluded_connector_ids: [], include_srs: false });
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
  });

  it("hides mated connectors and excludes whole SRS circuits by default", () => {
    const data = derive_test_data(doc, {
      harness_ids: ["h_engine", "h_body"], mating_states: { m_x1_x2: "connected" }, excluded_connector_ids: [], include_srs: false,
    });
    expect(data.nets).toEqual([{ net_id: "contact:j1_k2", points: ["G1", "J1:2"] }]);
    expect(data.continuity).toEqual([{ net_id: "contact:j1_k2", from: "G1", to: "J1:2" }]);
    expect(data.isolation).toEqual([]);
    expect(data.excluded_net_ids).toEqual(["contact:j1_k1", "contact:j1_k3"]);
    expect(data.excluded_points).toEqual(["J1:1", "J1:3", "J2:1", "J2:2", "J3:1", "J3:2"]);
  });

  it("never tests SRS circuits on a body-only bench", () => {
    const data = derive_test_data(doc, { harness_ids: ["h_body"], mating_states: {}, excluded_connector_ids: [], include_srs: false });
    expect(data.nets).toEqual([]);
    expect(data.isolation).toEqual([]);
    expect(data.excluded_points).toEqual(["J3:1", "J3:2", "X2:1", "X2:2"]);
  });

  it("includes SRS circuits only when asked", () => {
    const data = derive_test_data(doc, { harness_ids: ["h_body"], mating_states: {}, excluded_connector_ids: [], include_srs: true });
    expect(data.nets).toEqual([
      { net_id: "contact:j3_k1", points: ["J3:1", "X2:1"] },
      { net_id: "contact:j3_k2", points: ["J3:2", "X2:2"] },
    ]);
  });
});
