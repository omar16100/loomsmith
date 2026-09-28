import { describe, expect, it } from "vitest";
import { derive_bom } from "../src/derive/bom.ts";
import { derive_wire_list } from "../src/derive/wire_list.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { connector, part, small_doc, spec, unknown_part, wire } from "./helpers/entities.ts";

const doc = build_synthetic_milestone();

describe("wire list", () => {
  it("lists wires with end labels, colours and cut lengths", () => {
    const rows = derive_wire_list(doc);
    expect(rows.map((row) => row.wire_label)).toEqual(["W7", "W8", "W1", "W2", "W3", "W4", "W5", "W6"]);
    expect(rows[2]).toEqual({
      wire_id: "w1", harness_label: "ENGINE_SIDE", wire_label: "W1", from: "J1:1", to: "S1",
      cross_section_mm2: 0.5, designation: "0.5 mm2", colour: "R", route_status: "ok",
      cut_length: { status: "known", nominal_mm: 460, tol_plus_mm: 8, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [] },
    });
    expect(rows.find((row) => row.wire_label === "W5")?.colour).toBe("G-W");
    expect(rows.find((row) => row.wire_label === "W8")?.colour).toBe("UNKNOWN");
    expect(rows.find((row) => row.wire_label === "W7")).toMatchObject({ from: "X2:1", to: "J3:1", route_status: "unrouted" });
  });

  it("filters by harness", () => {
    expect(derive_wire_list(doc, { harness_ids: ["h_body"] }).map((row) => row.wire_label)).toEqual(["W7", "W8"]);
  });
});

describe("bill of materials", () => {
  it("counts parts and wire length, keeping unknowns visible", () => {
    const part_line = (category: string, part_id: string | null, part_number: string | null, description: string, quantity: number, identification: string) =>
      ({ category, part_id, part_number, description, quantity, known_quantity: quantity, unit: "pcs", unknown_quantity: 0, identification });
    // A wire line's quantity is null while any wire in it has an unknown cut length: a partial sum is never
    // presented as the total; known_quantity keeps the partial sum visible.
    const wire_line = (description: string, quantity: number | null, known_quantity: number, unknown_quantity: number) =>
      ({ category: "wire", part_id: null, part_number: null, description, quantity, known_quantity, unit: "mm", unknown_quantity, identification: "n/a" });
    expect(derive_bom(doc)).toEqual([
      part_line("housing", "p_housing_2", "SYN-H2", "2-way housing (synthetic)", 3, "identified"),
      part_line("housing", "p_housing_3", "SYN-H3", "3-way housing (synthetic)", 1, "identified"),
      part_line("housing", null, null, "UNIDENTIFIED housing", 1, "unknown"),
      part_line("terminal", "p_terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)", 2, "candidate"),
      part_line("terminal", "p_terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)", 9, "identified"),
      part_line("seal", "p_seal", "SYN-S1", "seal (synthetic)", 3, "identified"),
      part_line("splice", "p_splice", "SYN-SP1", "splice crimp (synthetic)", 1, "identified"),
      wire_line("0.5 mm2 G-W", null, 910, 1),
      wire_line("0.5 mm2 R", null, 460, 2),
      wire_line("0.85 mm2 B", null, 0, 1),
      wire_line("0.85 mm2 R", 490, 490, 0),
      wire_line("UNKNOWN mm2 UNKNOWN", null, 0, 1),
    ]);
  });

  it("does not merge a real part literally named 'unidentified' with the unidentified-part sentinel", () => {
    const base = small_doc();
    const real_unidentified = part("unidentified", "housing", "SYN-X1", "housing named unidentified (synthetic)");
    const doc_with_collision = {
      ...base,
      parts: [...base.parts, real_unidentified],
      connectors: [
        { ...base.connectors[0]!, housing: { part_id: "unidentified", identification: "unknown" as const, compatibility: "unknown" as const, procurement: "unknown" as const } },
        { ...base.connectors[1]!, housing: unknown_part },
      ],
    };
    const housing_lines = derive_bom(doc_with_collision).filter((line) => line.category === "housing");
    expect(housing_lines).toEqual([
      { category: "housing", part_id: null, part_number: null, description: "UNIDENTIFIED housing", quantity: 1, known_quantity: 1, unit: "pcs", unknown_quantity: 0, identification: "unknown" },
      { category: "housing", part_id: "unidentified", part_number: "SYN-X1", description: "housing named unidentified (synthetic)", quantity: 1, known_quantity: 1, unit: "pcs", unknown_quantity: 0, identification: "unknown" },
    ]);
  });

  it("keeps wire BOM lines with the same description but different cross-sections apart and in a stable order", () => {
    const base = small_doc();
    // Deliberately mismatched: the same nominal designation written on two different cross-sections (rare,
    // but valid data). w_a is routed (a known cut length), w_b is not (unknown_quantity), so the two resulting
    // lines are distinguishable even though they display the same description. The grouping key must still be
    // a total order independent of the wires' array order.
    const w_a = { ...wire("wa", "h1", "WA", base.wires[0]!.ends, spec(0.5, "R"), ["s1"]), spec: { ...spec(0.5, "R"), designation: "0.5" } };
    const w_b = { ...wire("wb", "h1", "WB", base.wires[0]!.ends, spec(0.75, "R"), null), spec: { ...spec(0.75, "R"), designation: "0.5" } };
    const forward = { ...base, wires: [w_a, w_b] };
    const reversed = { ...base, wires: [w_b, w_a] };
    const key = (line: { quantity: number | null; known_quantity: number; unknown_quantity: number }) => `${line.quantity}:${line.known_quantity}:${line.unknown_quantity}`;
    expect(derive_bom(forward).filter((l) => l.category === "wire").map(key)).toEqual(
      derive_bom(reversed).filter((l) => l.category === "wire").map(key),
    );
  });

  it("never counts a cut length of 0 or less as wire", () => {
    const base = small_doc();
    const short = { ...base, wires: base.wires.map((w) => ({ ...w, allowances: { ...w.allowances, end_a: { ...w.allowances.end_a, beyond_datum_mm: -600 } } })) };
    expect(derive_bom(short).find((line) => line.category === "wire")).toMatchObject({ quantity: null, known_quantity: 0, unknown_quantity: 1 });
  });
});
