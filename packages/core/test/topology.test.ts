import { describe, expect, it } from "vitest";
import { analyse_route, cut_length, route_length } from "../src/derive/topology.ts";
import { build_index } from "../src/model/doc_index.ts";
import type { Wire } from "../src/schema/document.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";

const doc = build_synthetic_milestone();
const index = build_index(doc);
const w = (label: string): Wire => {
  const found = doc.wires.find((item) => item.label === label);
  if (!found) throw new Error(`no wire ${label}`);
  return found;
};

describe("routes and lengths", () => {
  it("follows segments in either direction", () => {
    expect(analyse_route(index, w("W3"))).toEqual({
      wire_id: "w3", status: "ok", start_node_id: "n_s1", end_node_id: "n_x1", node_path: ["n_s1", "n_b1", "n_x1"],
    });
  });

  it("sums known segments and allowances with a worst-case tolerance", () => {
    expect(route_length(index, w("W4"))).toEqual({ status: "known", nominal_mm: 380, tol_mm: 7, unknown_segment_ids: [] });
    expect(cut_length(index, w("W1"))).toEqual({ status: "known", nominal_mm: 460, tol_mm: 8, unknown_segment_ids: [] });
    expect(cut_length(index, w("W6"))).toEqual({ status: "known", nominal_mm: 910, tol_mm: 13, unknown_segment_ids: [] });
  });

  it("never guesses an unmeasured segment", () => {
    expect(cut_length(index, w("W5"))).toEqual({ status: "unknown", nominal_mm: null, tol_mm: null, unknown_segment_ids: ["seg_b1_x1"] });
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
