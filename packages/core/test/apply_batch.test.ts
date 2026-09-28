import { describe, expect, it } from "vitest";
import { apply_batch, make_batch, type ApplyBatchResult } from "../src/commands/apply_batch.ts";
import { cmd_delete, cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { create_memory_logger } from "../src/log.ts";
import { canonical_json, to_canonical_file } from "../src/model/canonical.ts";
import { build_index } from "../src/model/doc_index.ts";
import { make_length } from "../src/model/make_length.ts";
import type { Command } from "../src/schema/commands.ts";
import type { LoomDocument } from "../src/schema/document.ts";
import { evidence_state } from "../src/validate/review_state.ts";
import { apply_ok, fixed_time as T } from "./helpers/apply.ts";
import { harness, node, open_end, segment, small_doc, spec, to_contact, wire } from "./helpers/entities.ts";

const rejection = (result: ApplyBatchResult) => (result.ok ? null : result.rejection);
const content_of = (doc: LoomDocument) => to_canonical_file({ ...doc, revision: 0, applied_batch_ids: [] });

describe("apply_batch", () => {
  it("applies an insert, bumps the revision and returns the inverse", () => {
    const doc = small_doc();
    const result = apply_batch(doc, make_batch(doc, [cmd_insert("harnesses", harness("h2", "SECOND"))], "b1", T));
    if (!result.ok) throw new Error(result.rejection.message);
    expect(result.duplicate).toBe(false);
    expect(result.doc.revision).toBe(1);
    expect(result.doc.applied_batch_ids).toEqual(["b1"]);
    expect(result.doc.harnesses.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(result.inverse).toEqual([{ op: "delete", collection: "harnesses", id: "h2", expect_entity: { id: "h2", label: "SECOND" } }]);
  });

  it("treats a repeated batch_id as a no-op", () => {
    const doc = apply_ok(small_doc(), [cmd_insert("harnesses", harness("h2", "SECOND"))], "b1");
    const again = apply_batch(doc, make_batch(doc, [cmd_insert("harnesses", harness("h3", "THIRD"))], "b1", T));
    expect(again.ok && again.duplicate).toBe(true);
    expect(again.ok ? again.doc : null).toBe(doc);
  });

  it("rejects a stale expected_revision", () => {
    const doc = small_doc();
    const batch = { ...make_batch(doc, [cmd_insert("harnesses", harness("h2", "X"))], "b1", T), expected_revision: 5 };
    expect(rejection(apply_batch(doc, batch))?.code).toBe("stale_revision");
  });

  it("rejects a batch for another document", () => {
    const doc = small_doc();
    const batch = { ...make_batch(doc, [cmd_insert("harnesses", harness("h2", "X"))], "b1", T), document_id: "other" };
    expect(rejection(apply_batch(doc, batch))?.code).toBe("document_mismatch");
  });

  it("rejects malformed batches", () => {
    expect(rejection(apply_batch(small_doc(), { batch_id: "b1" }))?.code).toBe("invalid_batch");
  });

  it("rejects inserting an existing id", () => {
    const doc = small_doc();
    const result = apply_batch(doc, make_batch(doc, [cmd_insert("harnesses", harness("h1", "DUP"))], "b1", T));
    expect(rejection(result)).toMatchObject({ code: "precondition_failed", command_index: 0 });
  });

  it("rejects an invalid entity", () => {
    const doc = small_doc();
    const result = apply_batch(doc, make_batch(doc, [cmd_insert("harnesses", harness("h2", ""))], "b1", T));
    expect(rejection(result)?.code).toBe("invalid_entity");
  });

  it("is atomic: a failing command leaves the document untouched", () => {
    const doc = small_doc();
    const before = to_canonical_file(doc);
    const result = apply_batch(
      doc,
      make_batch(doc, [cmd_insert("harnesses", harness("h2", "OK")), cmd_insert("harnesses", harness("h1", "DUP"))], "b1", T),
    );
    expect(rejection(result)?.command_index).toBe(1);
    expect(to_canonical_file(doc)).toBe(before);
  });

  it("rejects a delete that would leave dangling references", () => {
    const doc = small_doc();
    const result = rejection(apply_batch(doc, make_batch(doc, [cmd_delete("connectors", "j2")], "b1", T)));
    expect(result?.code).toBe("structural_errors_introduced");
    expect(result?.issues).toContainEqual(expect.objectContaining({ code: "S_REF_MISSING", entity_id: "j2_k1" }));
  });

  it("checks update expectations and inverts updates", () => {
    const doc = small_doc();
    const wrong = apply_batch(doc, make_batch(doc, [cmd_update("wires", "w1", { label: "W1X" }, { label: "NOT_W1" })], "b1", T));
    expect(rejection(wrong)?.code).toBe("precondition_failed");
    const ok = apply_batch(doc, make_batch(doc, [cmd_update("wires", "w1", { label: "W1X" }, { label: "W1" })], "b1", T));
    if (!ok.ok) throw new Error(ok.rejection.message);
    expect(ok.inverse).toEqual([{ op: "update", collection: "wires", id: "w1", set: { label: "W1" }, expect: { label: "W1X" } }]);
  });

  it("rejects changing an id through update", () => {
    const doc = small_doc();
    expect(rejection(apply_batch(doc, make_batch(doc, [cmd_update("wires", "w1", { id: "w9" })], "b1", T)))?.code).toBe("invalid_entity");
  });

  it("accepts only repair batches on a structurally invalid document", () => {
    const valid = small_doc();
    const broken = { ...valid, wires: [...valid.wires, wire("w2", "h1", "W2", [to_contact("j1", "1"), to_contact("j2", "1")], spec(0.5, "R"), null)] };
    const third_end = wire("w3", "h1", "W3", [to_contact("j1", "1"), open_end], spec(0.5, "R"), null);
    const worsen = apply_batch(broken, make_batch(broken, [cmd_insert("wires", third_end)], "b1", T));
    expect(rejection(worsen)?.code).toBe("structural_errors_introduced");
    const unrelated = apply_batch(broken, make_batch(broken, [cmd_insert("harnesses", harness("h2", "SECOND"))], "b2", T));
    expect(rejection(unrelated)?.code).toBe("repair_required");
    const repair = apply_batch(broken, make_batch(broken, [cmd_delete("wires", "w2")], "b3", T));
    expect(repair.ok).toBe(true);
  });

  it("rejects delete and update of an id shared by more than one entity in the same collection", () => {
    const valid = small_doc();
    // A hand-edited/loaded document can carry two rows with the same id in one collection (S_DUPLICATE_ID);
    // repair must not delete both while returning an inverse that only restores one of them.
    const dup_harness = { ...valid, harnesses: [...valid.harnesses, harness("h1", "DUP")] };
    const del = apply_batch(dup_harness, make_batch(dup_harness, [cmd_delete("harnesses", "h1")], "b1", T));
    expect(rejection(del)?.code).toBe("precondition_failed");
    const upd = apply_batch(dup_harness, make_batch(dup_harness, [cmd_update("harnesses", "h1", { label: "RENAMED" })], "b1", T));
    expect(rejection(upd)?.code).toBe("precondition_failed");
  });

  it("updates the project label with an inverse", () => {
    const doc = small_doc();
    const result = apply_batch(doc, make_batch(doc, [{ op: "update_project", set: { label: "RENAMED" }, expect: { label: "SMALL" } }], "b1", T));
    if (!result.ok) throw new Error(result.rejection.message);
    expect(result.doc.project.label).toBe("RENAMED");
    expect(result.inverse).toEqual([{ op: "update_project", set: { label: "SMALL" }, expect: { label: "RENAMED" } }]);
  });

  it("undo restores the previous content", () => {
    const doc = small_doc();
    const forward = apply_batch(
      doc,
      make_batch(doc, [
        cmd_update("segments", "s1", { length: make_length({ nominal_mm: 510, tol_plus_mm: 5 }) }),
        cmd_insert("harnesses", harness("h2", "SECOND")),
      ], "b1", T),
    );
    if (!forward.ok) throw new Error(forward.rejection.message);
    const undo = apply_batch(forward.doc, make_batch(forward.doc, forward.inverse, "b2", T));
    if (!undo.ok) throw new Error(undo.rejection.message);
    expect(content_of(undo.doc)).toBe(content_of(doc));
    expect(undo.doc.revision).toBe(2);
  });

  it("replays deterministically", () => {
    const build = () =>
      apply_ok(apply_ok(small_doc(), [cmd_insert("harnesses", harness("h2", "SECOND"))], "b1"), [cmd_update("wires", "w1", { label: "W1X" })], "b2");
    expect(to_canonical_file(build())).toBe(to_canonical_file(build()));
  });

  it("does not mutate its input and logs the outcome", () => {
    const doc = small_doc();
    const snapshot = JSON.stringify(doc);
    const log = create_memory_logger();
    apply_batch(doc, make_batch(doc, [cmd_insert("harnesses", harness("h2", "SECOND"))], "b1", T), log);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(log.entries.map((entry) => entry.message)).toContain("batch applied");
  });

  it("keeps datums, estimates and lengths consistent through batches", () => {
    const doc = apply_ok(small_doc(), [
      cmd_insert("nodes", node("n_b1", "h1", "breakout", null)),
      cmd_insert("segments", segment("s2", "h1", "n_j1", "n_b1", 100, 2, 0, ["connector_back_face", "breakout_centre"])),
    ], "b_setup");
    const s2 = doc.segments.find((s) => s.id === "s2");
    if (!s2) throw new Error("s2 missing");
    const run = (commands: Command[], id: string) => apply_batch(doc, make_batch(doc, commands, id, T));
    // Old-shaped lengths and allowances are refused, never misread.
    expect(rejection(run([cmd_update("segments", "s2", { length: { nominal_mm: 100, tol_mm: 2, datum: null } })], "b1"))?.code).toBe("invalid_entity");
    expect(rejection(run([cmd_update("wires", "w1", { allowances: { end_a_mm: 20, end_b_mm: 20, service_mm: 0 } })], "b1w"))?.code).toBe("invalid_entity");
    // Evidence value_json is opaque: an old-format value is accepted and is simply stale.
    const legacy = run([cmd_insert("evidence", {
      id: "e_legacy", entity_id: "s2", field: "length", origin: "measured", value_json: canonical_json({ datum: null, nominal_mm: 100, tol_mm: 2 }), source: null, note: null,
    })], "b1e");
    if (!legacy.ok) throw new Error(legacy.rejection.message);
    const inserted = legacy.doc.evidence.find((e) => e.id === "e_legacy");
    expect(inserted && evidence_state(build_index(legacy.doc), inserted)).toBe("stale");
    // Changing a node's kind alone would strand the datum measured to it; changing both in one batch is fine.
    expect(rejection(run([cmd_update("nodes", "n_b1", { kind: "clip" })], "b2"))?.code).toBe("structural_errors_introduced");
    expect(run([cmd_update("nodes", "n_b1", { kind: "clip" }), cmd_update("segments", "s2", { length: { ...s2.length, datum_b: "clip_centre" } })], "b3").ok).toBe(true);
    expect(rejection(run([cmd_update("segments", "s2", { length_estimate: { min_mm: 300, max_mm: 200, method: "synthetic" } })], "b4"))?.code).toBe("structural_errors_introduced");
  });

  it("repairs a loaded document with an inverted estimate", () => {
    const base = small_doc();
    const broken = { ...base, segments: base.segments.map((s) => ({ ...s, length_estimate: { min_mm: 600, max_mm: 400, method: "synthetic" } })) };
    expect(rejection(apply_batch(broken, make_batch(broken, [cmd_insert("harnesses", harness("h2", "SECOND"))], "b1", T)))?.code).toBe("repair_required");
    const fixed = apply_batch(broken, make_batch(broken, [cmd_update("segments", "s1", { length_estimate: { min_mm: 400, max_mm: 600, method: "synthetic" } })], "b2", T));
    expect(fixed.ok).toBe(true);
  });
});
