import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { route_end_datums } from "../src/derive/topology.ts";
import { derive_wire_list } from "../src/derive/wire_list.ts";
import { canonical_json, to_canonical_file } from "../src/model/canonical.ts";
import { default_datum } from "../src/model/datums.ts";
import { build_index } from "../src/model/doc_index.ts";
import { load_document, type LoadResult } from "../src/migrate/load_document.ts";
import { migrate_v1_to_v2 } from "../src/migrate/v1_to_v2.ts";
import type { LoomDocument } from "../src/schema/document.ts";
import { evidence_state, review_state } from "../src/validate/review_state.ts";

type Raw = { [key: string]: unknown };

// The M1 golden file exactly as committed at schema_version 1 (main, ce77d35).
const v1_text = readFileSync(new URL("./fixtures/synthetic_milestone_v1.loom.json", import.meta.url), "utf8");
const v1 = (): Raw => JSON.parse(v1_text) as Raw;
const entities = (raw: Raw, collection: string): Raw[] => raw[collection] as Raw[];
const find = (raw: Raw, collection: string, id: string): Raw => {
  const found = entities(raw, collection).find((entity) => entity["id"] === id);
  if (!found) throw new Error(`${collection}/${id} missing`);
  return found;
};
const load_ok = (raw: unknown): LoomDocument => {
  const result = load_document(raw);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message} ${result.error.details.join("; ")}`);
  return result.doc;
};
const failure = (result: LoadResult): string => (result.ok ? "loaded" : `${result.error.code}\n${result.error.details.join("\n")}`);
const evidence_of = (doc: LoomDocument, id: string) => {
  const found = doc.evidence.find((e) => e.id === id);
  if (!found) throw new Error(id);
  return found;
};

// What an owner does after migrating: record the default datum at every segment end and give each wire end's
// allowance from the datum its route was measured to.
function record_datums(doc: LoomDocument): LoomDocument {
  const index = build_index(doc);
  const at = (node_id: string) => {
    const found = index.nodes.get(node_id);
    return found ? default_datum[found.kind] : null;
  };
  const marked = { ...doc, segments: doc.segments.map((s) => ({ ...s, length: { ...s.length, datum_a: at(s.node_a), datum_b: at(s.node_b) } })) };
  const marked_index = build_index(marked);
  return {
    ...marked,
    wires: marked.wires.map((w) => {
      const ends = route_end_datums(marked_index, w);
      if (ends === null) return w;
      return { ...w, allowances: { ...w.allowances, end_a: { ...w.allowances.end_a, datum: ends.end_a }, end_b: { ...w.allowances.end_b, datum: ends.end_b } } };
    }),
  };
}

describe("schema_version 1 to 2 migration", () => {
  it("maps lengths, allowances and estimates value for value", () => {
    const doc = load_ok(v1());
    expect(doc.schema_version).toBe(2);
    expect(doc.segments.find((s) => s.id === "seg_j1_b1")).toEqual({
      id: "seg_j1_b1", harness_id: "h_engine", node_a: "n_j1", node_b: "n_b1",
      length: { nominal_mm: 300, tol_plus_mm: 5, tol_minus_mm: 5, datum_a: null, datum_b: null, note: null },
      length_estimate: null,
    });
    expect(doc.wires.find((w) => w.id === "w1")?.allowances).toEqual({
      end_a: { datum: null, beyond_datum_mm: 20 }, end_b: { datum: null, beyond_datum_mm: 20 }, service_loop_mm: 0,
    });
  });

  it("leaves cut lengths unknown until datums are recorded, then exactly what version 1 computed", () => {
    const migrated = load_ok(v1());
    expect(derive_wire_list(migrated).find((row) => row.wire_label === "W1")?.cut_length).toMatchObject({
      status: "unknown", unknown_allowances: ["end_a.datum", "end_b.datum"],
    });
    const rows = derive_wire_list(record_datums(migrated));
    expect(Object.fromEntries(rows.map((row) => [row.wire_label, row.cut_length.nominal_mm]))).toEqual({
      W1: 460, W2: 490, W3: null, W4: 420, W5: null, W6: 910, W7: null, W8: null,
    });
    expect(rows.find((row) => row.wire_label === "W1")?.cut_length).toMatchObject({ tol_plus_mm: 8, tol_minus_mm: 8 });
  });

  it("keeps current evidence and reviews current and stale ones stale", () => {
    const doc = load_ok(v1());
    const index = build_index(doc);
    expect(evidence_state(index, evidence_of(doc, "e_seg_j1_b1_length"))).toBe("current");
    expect(evidence_state(index, evidence_of(doc, "e_w7_ends"))).toBe("current");
    expect(review_state(doc, index, "w1", "spec")).toBe("approved");
    expect(review_state(doc, index, "w2", "spec")).toBe("stale");
  });

  it("treats every recorded value the same whether evidence, approval or rejection holds it", () => {
    // seg_j1_b1's v1 length and what the migration makes of it.
    const v1_length = { datum: null, nominal_mm: 300, tol_mm: 5 };
    const v2_of = (nominal_mm: number) => ({ nominal_mm, tol_plus_mm: 5, tol_minus_mm: 5, datum_a: null, datum_b: null, note: null });
    type Holder = "evidence" | "approved" | "rejected";
    const holders: Holder[] = ["evidence", "approved", "rejected"];
    const with_record = (holder: Holder, recorded: string): Raw => {
      const raw = v1();
      if (holder === "evidence") find(raw, "evidence", "e_seg_j1_b1_length")["value_json"] = recorded;
      else entities(raw, "reviews").push({ id: "r_probe", entity_id: "seg_j1_b1", field: "length", status: holder, reviewed_value_json: recorded, revision: 3 });
      return raw;
    };
    const state_and_record = (holder: Holder, doc: LoomDocument): [string, string | undefined] => {
      const index = build_index(doc);
      if (holder === "evidence") {
        const e = evidence_of(doc, "e_seg_j1_b1_length");
        return [evidence_state(index, e), e.value_json];
      }
      return [review_state(doc, index, "seg_j1_b1", "length"), doc.reviews.find((r) => r.id === "r_probe")?.reviewed_value_json];
    };
    const current_state = { evidence: "current", approved: "approved", rejected: "rejected" } as const;
    const pretty = JSON.stringify(v1_length, null, 2);
    const extra_key = canonical_json({ ...v1_length, note: "extra" });
    for (const holder of holders) {
      // Current canonical v1: translated, still current (a rejection still blocks).
      expect(state_and_record(holder, load_ok(with_record(holder, canonical_json(v1_length)))), holder).toEqual([current_state[holder], canonical_json(v2_of(300))]);
      // Stale canonical v1: translated, still stale.
      expect(state_and_record(holder, load_ok(with_record(holder, canonical_json({ ...v1_length, nominal_mm: 290 })))), holder).toEqual(["stale", canonical_json(v2_of(290))]);
      // Not canonical, or not a valid v1 value: left exactly as it was, still stale.
      expect(state_and_record(holder, load_ok(with_record(holder, pretty))), holder).toEqual(["stale", pretty]);
      expect(state_and_record(holder, load_ok(with_record(holder, extra_key))), holder).toEqual(["stale", extra_key]);
      // Already the v2 value: loading would revive it, so the load is refused.
      const revived = failure(load_document(with_record(holder, canonical_json(v2_of(300)))));
      expect(revived, holder).toContain("migration_failed");
      expect(revived, holder).toContain("would change from stale to current");
    }
  });

  it("rewrites allowance evidence and reviews too", () => {
    const raw = v1();
    const w1 = find(raw, "wires", "w1");
    entities(raw, "reviews").push({ id: "r_w1_allowances", entity_id: "w1", field: "allowances", status: "approved", reviewed_value_json: canonical_json(w1["allowances"]), revision: 3 });
    entities(raw, "evidence").push({
      id: "e_w1_allowances_old", entity_id: "w1", field: "allowances", origin: "assumed",
      value_json: canonical_json({ end_a_mm: 10, end_b_mm: 20, service_mm: 0 }), source: null, note: null,
    });
    const doc = load_ok(raw);
    const index = build_index(doc);
    expect(review_state(doc, index, "w1", "allowances")).toBe("approved");
    const old = evidence_of(doc, "e_w1_allowances_old");
    expect(evidence_state(index, old)).toBe("stale");
    expect(old.value_json).toBe(canonical_json({ end_a: { datum: null, beyond_datum_mm: 10 }, end_b: { datum: null, beyond_datum_mm: 20 }, service_loop_mm: 0 }));
  });

  it("refuses when a record depends on a value the migration rewrites", () => {
    const raw = v1();
    const evidence = find(raw, "evidence", "e_seg_j1_b1_length");
    entities(raw, "reviews").push({
      id: "r_e_value", entity_id: "e_seg_j1_b1_length", field: "value_json", status: "approved", reviewed_value_json: canonical_json(evidence["value_json"]), revision: 3,
    });
    const result = failure(load_document(raw));
    expect(result).toContain("migration_failed");
    expect(result).toContain("would change from current to stale");
  });

  it("refuses a record whose target id is used twice", () => {
    const raw = v1();
    const seg = find(raw, "segments", "seg_b1_g1");
    entities(raw, "harnesses").push({ id: "seg_b1_g1", label: "DUPLICATE" });
    entities(raw, "evidence").push({ id: "e_dup", entity_id: "seg_b1_g1", field: "length", origin: "measured", value_json: canonical_json(seg["length"]), source: null, note: null });
    const result = failure(load_document(raw));
    expect(result).toContain("migration_failed");
    expect(result).toContain("used more than once");
  });

  it("never repairs a malformed version 1 value", () => {
    const cases: Array<[string, (raw: Raw) => void, string]> = [
      ["extra key", (raw) => { find(raw, "segments", "seg_b1_g1")["length"] = { nominal_mm: 80, tol_mm: 2, datum: null, note: "DO NOT DROP" }; }, "segments.0.length"],
      ["missing tol_mm", (raw) => { find(raw, "segments", "seg_b1_g1")["length"] = { nominal_mm: 80, datum: null }; }, "segments.0.length.tol_mm"],
      ["v2 length", (raw) => { find(raw, "segments", "seg_b1_g1")["length"] = { nominal_mm: 80, tol_plus_mm: 2, tol_minus_mm: 2, datum_a: null, datum_b: null, note: null }; }, "segments.0.length"],
      ["stray estimate", (raw) => { find(raw, "segments", "seg_b1_g1")["length_estimate"] = null; }, "segments.0.length_estimate"],
      ["null allowance", (raw) => { (find(raw, "wires", "w1")["allowances"] as Raw)["end_a_mm"] = null; }, "wires.0.allowances.end_a_mm"],
    ];
    for (const [name, change, where] of cases) {
      const raw = v1();
      change(raw);
      const result = failure(load_document(raw));
      expect(result, name).toContain("migration_failed");
      expect(result, name).toContain(where);
    }
  });

  it("moves a free-text v1 datum into note", () => {
    const raw = v1();
    find(raw, "segments", "seg_b1_g1")["length"] = { nominal_mm: 80, tol_mm: 2, datum: "to stud centre" };
    expect(load_ok(raw).segments.find((s) => s.id === "seg_b1_g1")?.length).toEqual({
      nominal_mm: 80, tol_plus_mm: 2, tol_minus_mm: 2, datum_a: null, datum_b: null, note: "to stud centre",
    });
  });

  it("does not modify its input and saves as version 2", () => {
    const raw = v1();
    migrate_v1_to_v2(raw);
    expect(JSON.stringify(raw)).toBe(JSON.stringify(v1()));
    const text = to_canonical_file(load_ok(v1()));
    expect(to_canonical_file(load_ok(JSON.parse(text)))).toBe(text);
  });
});
