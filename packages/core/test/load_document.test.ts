import { describe, expect, it } from "vitest";
import { to_canonical_file } from "../src/model/canonical.ts";
import { load_document, type LoadResult } from "../src/migrate/load_document.ts";
import { small_doc } from "./helpers/entities.ts";

const error_code = (result: LoadResult) => (result.ok ? null : result.error.code);

describe("load_document", () => {
  it("round-trips a canonical document", () => {
    const text = to_canonical_file(small_doc());
    const result = load_document(JSON.parse(text));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(to_canonical_file(result.doc)).toBe(text);
      // A document already at the current schema_version was never migrated.
      expect(result.migrated_from).toBeNull();
    }
  });

  it("rejects non-objects and other formats", () => {
    expect(error_code(load_document(null))).toBe("not_object");
    expect(error_code(load_document([]))).toBe("not_object");
    expect(error_code(load_document({ format: "wireviz" }))).toBe("wrong_format");
  });

  it("rejects future, unsupported and malformed versions", () => {
    const raw = JSON.parse(to_canonical_file(small_doc()));
    expect(error_code(load_document({ ...raw, schema_version: 3 }))).toBe("future_version");
    expect(error_code(load_document({ ...raw, schema_version: 0 }))).toBe("unsupported_version");
    expect(error_code(load_document({ ...raw, schema_version: "1" }))).toBe("invalid_document");
  });

  it("reports schema errors with their paths", () => {
    const raw = JSON.parse(to_canonical_file(small_doc()));
    raw.wires[0].spec.cross_section_mm2 = -1;
    const result = load_document(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details.join("\n")).toContain("wires.0.spec.cross_section_mm2");
  });
});
