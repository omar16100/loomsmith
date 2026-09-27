import { describe, expect, it } from "vitest";
import { to_canonical_file } from "../src/model/canonical.ts";
import { load_document } from "../src/migrate/load_document.ts";
import { validate_structure } from "../src/validate/structural.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";

describe("synthetic milestone fixture", () => {
  it("builds through commands without structural errors", () => {
    const doc = build_synthetic_milestone();
    expect(validate_structure(doc)).toEqual([]);
    expect(doc.revision).toBe(3);
    expect(doc.applied_batch_ids).toEqual(["b_build", "b_review", "b_resize_w2"]);
  });

  it("builds deterministically", () => {
    expect(to_canonical_file(build_synthetic_milestone())).toBe(to_canonical_file(build_synthetic_milestone()));
  });

  it("round-trips through the loader", () => {
    const text = to_canonical_file(build_synthetic_milestone());
    const loaded = load_document(JSON.parse(text));
    expect(loaded.ok && to_canonical_file(loaded.doc)).toBe(text);
  });

  it("matches the committed golden file", async () => {
    await expect(to_canonical_file(build_synthetic_milestone())).toMatchFileSnapshot(
      "../../../examples/synthetic_milestone/synthetic_milestone.loom.json",
    );
  });
});
