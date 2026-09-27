import { describe, expect, it } from "vitest";
import { batch_json_schema, document_json_schema } from "../src/schema/json_schema.ts";
import { collection_names, collection_schemas, document_schema, wire_schema } from "../src/schema/document.ts";
import { batch_schema } from "../src/schema/commands.ts";

const minimal = {
  format: "loomsmith",
  schema_version: 1,
  document_id: "d1",
  revision: 0,
  applied_batch_ids: [],
  project: { label: "P" },
  harnesses: [{ id: "h1", label: "MAIN" }],
  parts: [], connectors: [], contacts: [], splices: [], ground_points: [], wires: [],
  nodes: [], segments: [], matings: [], assets: [], evidence: [], reviews: [], view_positions: [],
};

const schematic_wire = {
  id: "w1",
  harness_id: "h1",
  label: "W1",
  ends: [{ kind: "open" }, { kind: "open" }],
  spec: { cross_section_mm2: null, designation: null, base_colour: null, stripe_colours: [], insulation: null },
  route: null,
  allowances: { end_a_mm: 0, end_b_mm: 0, service_mm: 0 },
};

describe("document schema", () => {
  it("accepts a minimal document", () => {
    expect(document_schema.safeParse(minimal).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(document_schema.safeParse({ ...minimal, extra: 1 }).success).toBe(false);
  });

  it("restricts the id alphabet and asset locators", () => {
    expect(document_schema.safeParse({ ...minimal, harnesses: [{ id: "a/b", label: "X" }] }).success).toBe(false);
    const with_asset = (blob_ref: string) => ({
      ...minimal,
      assets: [{ id: "a1", sha256: "0".repeat(64), media_type: "application/pdf", blob_ref, title: null }],
    });
    expect(document_schema.safeParse(with_asset("synthetic://fixture/diagram.pdf")).success).toBe(true);
    expect(document_schema.safeParse(with_asset("pdfs/ewd_102.pdf")).success).toBe(true);
    expect(document_schema.safeParse(with_asset("/Users/me/ewd.pdf")).success).toBe(false);
    expect(document_schema.safeParse(with_asset("https://bucket.example/ewd.pdf?X-Amz-Expires=300")).success).toBe(false);
    // A Windows UNC network path is also an absolute, non-portable locator.
    expect(document_schema.safeParse(with_asset("\\\\server\\share\\ewd.pdf")).success).toBe(false);
  });

  it("rejects ':' in labels so a CONNECTOR:CAVITY probe label can never equal another label", () => {
    expect(document_schema.safeParse({ ...minimal, harnesses: [{ id: "h1", label: "J1:3" }] }).success).toBe(false);
    expect(wire_schema.safeParse({ ...schematic_wire, label: "W:1" }).success).toBe(false);
    expect(document_schema.safeParse({ ...minimal, project: { label: "A:B" } }).success).toBe(false);
    expect(document_schema.safeParse({ ...minimal, harnesses: [{ id: "h1", label: "J1-3 (main)" }] }).success).toBe(true);
  });

  it("accepts a schematic-only wire with unknown spec and no route", () => {
    expect(wire_schema.safeParse(schematic_wire).success).toBe(true);
  });

  it("rejects a zero cross-section (unknown must be null)", () => {
    const bad = { ...schematic_wire, spec: { ...schematic_wire.spec, cross_section_mm2: 0 } };
    expect(wire_schema.safeParse(bad).success).toBe(false);
  });

  it("keeps collections in a fixed order", () => {
    expect(Object.keys(collection_schemas)).toEqual([...collection_names]);
  });

  it("validates batches", () => {
    const batch = {
      batch_id: "b1", document_id: "d1", command_schema_version: 1, expected_revision: 0,
      created_at: "2026-09-27T00:00:00Z",
      commands: [{ op: "insert", collection: "harnesses", entity: { id: "h2", label: "X" } }],
    };
    expect(batch_schema.safeParse(batch).success).toBe(true);
    expect(batch_schema.safeParse({ ...batch, commands: [] }).success).toBe(false);
    expect(batch_schema.safeParse({ ...batch, commands: [{ op: "insert", collection: "nope", entity: {} }] }).success).toBe(false);
  });

  it("publishes JSON Schemas", async () => {
    await expect(JSON.stringify(document_json_schema(), null, 2) + "\n").toMatchFileSnapshot(
      "../generated/loomsmith_document_v1.schema.json",
    );
    await expect(JSON.stringify(batch_json_schema(), null, 2) + "\n").toMatchFileSnapshot(
      "../generated/loomsmith_batch_v1.schema.json",
    );
  });
});
