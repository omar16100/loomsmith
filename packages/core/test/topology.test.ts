import { describe, expect, it } from "vitest";
import { analyse_route, check_route_datums, cut_length, route_end_datums, route_length, unknown_allowances } from "../src/derive/topology.ts";
import { build_index } from "../src/model/doc_index.ts";
import type { LoomDocument, Wire } from "../src/schema/document.ts";
import type { Datum } from "../src/schema/primitives.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { connector, contact, node, segment, small_doc, spec, to_contact, wire } from "./helpers/entities.ts";

const doc = build_synthetic_milestone();
const index = build_index(doc);
const w = (label: string): Wire => {
  const found = doc.wires.find((item) => item.label === label);
  if (!found) throw new Error(`no wire ${label}`);
  return found;
};

// small_doc: one 500 mm segment J1 back face to J2 back face (plus 5, minus 0), W1 with 20 mm beyond each back face.
const cut = (doc: LoomDocument) => cut_length(build_index(doc), doc.wires[0]!);
const measured_at_j1 = (datum: Datum, nominal_mm: number, beyond_datum_mm: number): LoomDocument => {
  const base = small_doc();
  return {
    ...base,
    segments: base.segments.map((s) => ({ ...s, length: { ...s.length, nominal_mm, datum_a: datum } })),
    wires: base.wires.map((item) => ({ ...item, allowances: { ...item.allowances, end_a: { datum, beyond_datum_mm } } })),
  };
};

describe("routes and lengths", () => {
  it("follows segments in either direction", () => {
    expect(analyse_route(index, w("W3"))).toEqual({
      wire_id: "w3", status: "ok", start_node_id: "n_s1", end_node_id: "n_x1", node_path: ["n_s1", "n_b1", "n_x1"],
    });
  });

  it("sums known segments and allowances with worst-case plus and minus bands", () => {
    expect(route_length(index, w("W4"))).toEqual({ status: "known", nominal_mm: 380, tol_plus_mm: 7, tol_minus_mm: 0, unknown_segment_ids: [] });
    expect(cut_length(index, w("W1"))).toEqual({
      status: "known", nominal_mm: 460, tol_plus_mm: 8, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [],
    });
    expect(cut_length(index, w("W6"))).toEqual({
      status: "known", nominal_mm: 910, tol_plus_mm: 13, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [],
    });
  });

  it("never guesses an unmeasured segment", () => {
    expect(cut_length(index, w("W5"))).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: ["seg_b1_x1"], unknown_allowances: [], datum_problems: [],
    });
  });

  it("loses a tolerance band when any crossed segment's band on that side is unknown", () => {
    const base = small_doc();
    const two = {
      ...base,
      nodes: [...base.nodes, node("n_b1", "h1", "breakout", null)],
      segments: [segment("s1", "h1", "n_j1", "n_b1", 200, 4, null), segment("s2", "h1", "n_b1", "n_j2", 300, 6, 2)],
      wires: base.wires.map((item) => ({ ...item, route: ["s1", "s2"] })),
    };
    expect(route_length(build_index(two), two.wires[0]!)).toEqual({
      status: "known", nominal_mm: 500, tol_plus_mm: 10, tol_minus_mm: null, unknown_segment_ids: [],
    });
  });

  it("gives the same cut length whichever datum the length was measured to", () => {
    // The J1 mating face is 25 mm past its back face and the conductor ends 20 mm past the back face. Each pair of
    // (route length, wire beyond the datum) describes the same wire.
    expect(cut(measured_at_j1("connector_back_face", 500, 20)).nominal_mm).toBe(540);
    expect(cut(measured_at_j1("connector_mating_face", 525, -5)).nominal_mm).toBe(540);
    const base = small_doc();
    const looped = { ...base, wires: base.wires.map((item) => ({ ...item, allowances: { ...item.allowances, service_loop_mm: 100 } })) };
    expect(cut(looped).nominal_mm).toBe(640);
  });

  it("requires consecutive segments to meet at the same point, whichever way they are stored", () => {
    // The route passes connector J3: s1 is measured to J3's mating face, s2 from its back face, so the distance between
    // the two faces is in neither segment.
    const base = small_doc();
    const through_j3 = (s1_datum_at_j3: Datum | null, reverse_s2: boolean): LoomDocument => {
      const s2 = segment("s2", "h1", "n_j3", "n_j2", 300, 5, 0, ["connector_back_face", "connector_back_face"]);
      const stored = reverse_s2 ? { ...s2, node_a: s2.node_b, node_b: s2.node_a, length: { ...s2.length, datum_a: s2.length.datum_b, datum_b: s2.length.datum_a } } : s2;
      return {
        ...base,
        connectors: [...base.connectors, connector("j3", "h1", "J3", ["1"])],
        nodes: [...base.nodes, node("n_j3", "h1", "connector", "j3")],
        segments: [segment("s1", "h1", "n_j1", "n_j3", 200, 5, 0, ["connector_back_face", s1_datum_at_j3]), stored],
        wires: base.wires.map((item) => ({ ...item, route: ["s1", "s2"] })),
      };
    };
    for (const reverse_s2 of [false, true]) {
      const gap = through_j3("connector_mating_face", reverse_s2);
      expect(check_route_datums(build_index(gap), gap.wires[0]!)?.join_conflicts).toEqual(["n_j3: s1 measured to connector_mating_face, s2 from connector_back_face"]);
      expect(cut(gap)).toMatchObject({ status: "unknown", nominal_mm: null, datum_problems: ["n_j3: s1 measured to connector_mating_face, s2 from connector_back_face"] });
      // An internal end with no datum is just as unknown as an outer one.
      expect(cut(through_j3(null, reverse_s2))).toMatchObject({ status: "unknown", nominal_mm: null, datum_problems: ["s1 at n_j3: datum unknown"] });
      expect(cut(through_j3("connector_back_face", reverse_s2)).nominal_mm).toBe(540);
    }
  });

  it("measures a same-node wire from one point on that node", () => {
    const base = small_doc();
    const jumper = (end_b: Datum): LoomDocument => ({
      ...base,
      contacts: [...base.contacts, contact("j1", "2")],
      wires: [{ ...wire("w9", "h1", "W9", [to_contact("j1", "1"), to_contact("j1", "2")], spec(0.5, "R"), []), allowances: { end_a: { datum: "connector_back_face", beyond_datum_mm: 20 }, end_b: { datum: end_b, beyond_datum_mm: 20 }, service_loop_mm: 10 } }],
    });
    expect(cut(jumper("connector_back_face"))).toMatchObject({ status: "known", nominal_mm: 50 });
    expect(cut(jumper("connector_mating_face")).datum_problems).toEqual(["end_b: allowance from connector_mating_face, end_a from connector_back_face at the same node"]);
    expect(cut(jumper("splice_centre")).datum_problems).toEqual(["end_b: splice_centre is not a point on connector node n_j1"]);
  });

  it("reads each wire end's datum whichever way round the segment is stored, and never converts datums", () => {
    const doc = measured_at_j1("connector_mating_face", 525, -5);
    const s1 = doc.segments[0]!;
    const reversed = { ...doc, segments: [{ ...s1, node_a: s1.node_b, node_b: s1.node_a, length: { ...s1.length, datum_a: s1.length.datum_b, datum_b: s1.length.datum_a } }] };
    expect(route_end_datums(build_index(reversed), reversed.wires[0]!)).toEqual({ end_a: "connector_mating_face", end_b: "connector_back_face" });
    expect(cut(reversed).nominal_mm).toBe(540);
    const wrong = { ...reversed, wires: reversed.wires.map((item) => ({ ...item, allowances: { ...item.allowances, end_a: { datum: "connector_back_face" as const, beyond_datum_mm: -5 } } })) };
    expect(cut(wrong)).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [], unknown_allowances: [],
      datum_problems: ["end_a: route measured to connector_mating_face, allowance from connector_back_face"],
    });
    const base = small_doc();
    const unmarked = { ...base, segments: base.segments.map((s) => ({ ...s, length: { ...s.length, datum_b: null } })) };
    expect(cut(unmarked)).toMatchObject({ status: "unknown", datum_problems: ["s1 at n_j2: datum unknown"] });
  });

  it("never treats an unknown allowance as 0", () => {
    const base = small_doc();
    const w1 = { ...base.wires[0]!, allowances: { end_a: { datum: null, beyond_datum_mm: 20 }, end_b: { datum: "connector_back_face" as const, beyond_datum_mm: null }, service_loop_mm: 0 } };
    expect(unknown_allowances(w1)).toEqual(["end_a.datum", "end_b.beyond_datum_mm"]);
    expect(cut_length(build_index(base), w1)).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [], unknown_allowances: ["end_a.datum", "end_b.beyond_datum_mm"], datum_problems: [],
    });
  });

  it("reports unrouted, broken and node-less routes as unavailable", () => {
    expect(analyse_route(index, w("W7")).status).toBe("unrouted");
    expect(cut_length(index, w("W7")).status).toBe("unavailable");
    expect(analyse_route(index, { ...w("W2"), route: ["seg_b1_g1"] }).status).toBe("not_contiguous");
    const without_node = build_index({ ...doc, nodes: doc.nodes.filter((n) => n.id !== "n_j2") });
    expect(analyse_route(without_node, w("W2")).status).toBe("missing_endpoint_node");
  });

  it("reports open ends", () => {
    const open: Wire = { ...w("W1"), ends: [{ kind: "open" }, w("W1").ends[1]] };
    expect(analyse_route(index, open).status).toBe("open_end");
  });
});
