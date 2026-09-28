import { describe, expect, it } from "vitest";
import { datum_node_kind, default_datum } from "../src/model/datums.ts";
import { make_length } from "../src/model/make_length.ts";
import { datum_schema, length_schema } from "../src/schema/primitives.ts";

describe("make_length", () => {
  it("defaults to never short: minus tolerance 0, everything else unknown", () => {
    expect(make_length({ nominal_mm: 300 })).toEqual({
      nominal_mm: 300, tol_plus_mm: null, tol_minus_mm: 0, datum_a: null, datum_b: null, note: null,
    });
  });

  it("keeps an explicit unknown minus tolerance unknown", () => {
    expect(make_length({ nominal_mm: 300, tol_minus_mm: null }).tol_minus_mm).toBeNull();
  });

  it("produces a value the schema accepts", () => {
    const length = make_length({ nominal_mm: null, tol_plus_mm: 5, datum_a: "ground_stud_centre", note: "to stud centre" });
    expect(length_schema.safeParse(length).success).toBe(true);
  });
});

describe("datums", () => {
  it("gives every datum exactly one node kind", () => {
    expect(Object.keys(datum_node_kind).sort()).toEqual([...datum_schema.options].sort());
  });

  it("defaults every node kind to a datum on that kind", () => {
    for (const [kind, datum] of Object.entries(default_datum)) expect(datum_node_kind[datum]).toBe(kind);
  });
});
