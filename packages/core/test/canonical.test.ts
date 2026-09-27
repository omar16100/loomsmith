import { describe, expect, it } from "vitest";
import { canonical_json, to_canonical_file } from "../src/model/canonical.ts";
import { small_doc, spec, to_contact, wire } from "./helpers/entities.ts";

describe("canonical form", () => {
  it("does not depend on collection order", () => {
    const doc = small_doc();
    const shuffled = { ...doc, connectors: [...doc.connectors].reverse(), nodes: [...doc.nodes].reverse() };
    expect(to_canonical_file(shuffled)).toBe(to_canonical_file(doc));
  });

  it("sorts object keys and ends with a newline", () => {
    const text = to_canonical_file(small_doc());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.indexOf('"applied_batch_ids"')).toBeLessThan(text.indexOf('"connectors"'));
    expect(canonical_json({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("keeps meaningful array order inside entities", () => {
    const w = wire("w9", "h1", "W9", [to_contact("j2", "1"), to_contact("j1", "1")], spec(0.5, "G", ["W", "L"]), ["s2", "s1"]);
    const out = JSON.parse(canonical_json(w));
    expect(out.route).toEqual(["s2", "s1"]);
    expect(out.ends[0].contact_id).toBe("j2_k1");
    expect(out.spec.stripe_colours).toEqual(["W", "L"]);
  });
});
