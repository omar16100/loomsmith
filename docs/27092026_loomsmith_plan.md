# loomsmith M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Category: Plan / task record. Status section at the end.

**Goal:** Scaffold the loomsmith monorepo and build `@loomsmith/core`: schema, command-log reducer, structural and completeness validation, and derivations (routes, cut lengths, nets, bench test data, wire list, BOM), proven on a synthetic golden fixture.

**Architecture:** One pure TypeScript package (`packages/core`) with no DOM, filesystem, network, clock or RNG. Every edit is a generic `insert` / `update` / `delete` command inside an atomic, idempotent, revision-checked batch; a batch that introduces structural errors is rejected. Derived data (lengths, nets, BOM, test data) is computed, never stored.

**Tech Stack:** pnpm 10 workspaces, Node >= 22.18, TypeScript 7.0.2 (strict, `noEmit`, `.ts` imports), Vitest 5.0.2, zod 4.6.5.

**Spec:** /Users/macmini/projects/loomsmith/docs/27092026_loomsmith_design.md (architecture: /Users/macmini/projects/loomsmith/docs/c4model.md)

## Global Constraints

- Node engines `>=22.18`; TypeScript `7.0.2`; Vitest `5.0.2`; zod `4.6.5`; `@types/node` `^22.20.4`.
- snake_case for files, functions, variables and JSON keys; PascalCase for types.
- Core source must not use Node, DOM, clock (`Date`) or RNG (`Math.random`, `crypto`); ids and timestamps are passed in by callers.
- JSON canonical format: `format: "loomsmith"`, `schema_version: 1`, collections sorted by id, object keys sorted, 2-space indent, trailing newline.
- Canonical units: `length_mm`, `cross_section_mm2`; unknown values are `null`, never `0`.
- No fabricated data: the fixture is synthetic and says so in its labels and part descriptions.
- Licence Apache-2.0. Only MIT/Apache-compatible code may be copied, recorded in THIRD_PARTY_NOTICES.md. No OEM/EWD-derived data in this repo.
- No em dashes in prose. Keep every source file well under 2000 lines (target < 300).
- Git: work on branch `feat/m0_m1_core`, never commit to `main`; no Claude attribution lines in commit messages.

## File map

```
/Users/macmini/projects/loomsmith/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.config.ts  .gitignore  .github/workflows/ci.yml
  examples/synthetic_milestone/synthetic_milestone.loom.json      (generated golden, Task 6)
  packages/core/
    package.json  tsconfig.json (src only, no Node types)  tsconfig.test.json
    generated/loomsmith_document_v1.schema.json  loomsmith_batch_v1.schema.json   (generated, Task 2)
    src/index.ts                      public exports
    src/log.ts                        Logger interface, null and memory loggers
    src/schema/primitives.ts          ids, labels, part use, length, origin, bbox
    src/schema/document.ts            entity schemas, collection list, document schema, types
    src/schema/commands.ts            insert/update/delete commands, batch schema
    src/schema/json_schema.ts         JSON Schema generation
    src/model/canonical.ts            key sorting, canonical json, collection ordering
    src/model/empty_document.ts       empty document factory
    src/model/doc_index.ts            lookup maps and endpoint keys
    src/model/scope.ts                harness scope filter
    src/migrate/load_document.ts      version checks, migrations, parse
    src/validate/issue.ts             Issue type, keys, paths
    src/validate/structural.ts        structural rules (S_*)
    src/validate/review_state.ts      review state, make_review
    src/validate/completeness.ts      build completeness rules (M_*, W_*)
    src/validate/validate.ts          combined entry point
    src/commands/builders.ts          cmd_insert / cmd_update / cmd_delete
    src/commands/apply_command.ts     single command with inverse
    src/commands/apply_batch.ts       batch reducer, make_batch
    src/derive/topology.ts            endpoint nodes, route analysis, lengths
    src/derive/nets.ts                union-find nets with mating states
    src/derive/test_data.ts           bench continuity and isolation
    src/derive/wire_list.ts           wire list rows
    src/derive/bom.ts                 bill of materials
    test/helpers/entities.ts          entity factories + small_doc
    test/helpers/apply.ts             apply_ok helper
    test/fixtures/synthetic_milestone.ts  fixture builder
    test/*.test.ts
```

---

### Task 1: Workspace scaffold and logger

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.test.json`, `packages/core/src/log.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/log.test.ts`

**Interfaces:**
- Produces: `Logger` (`debug/info/warn/error(message: string, data?: LogData): void`), `LogData`, `LogEntry`, `null_logger`, `create_memory_logger(): Logger & { entries: LogEntry[] }`.

- [ ] **Step 1: Confirm the branch and write the root config**

```bash
cd /Users/macmini/projects/loomsmith && git branch --show-current
```
Expected: `feat/m0_m1_core` (created and renamed during M0).

`package.json`:
```json
{
  "name": "loomsmith",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p packages/core/tsconfig.json && tsc -p packages/core/tsconfig.test.json",
    "check": "pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@types/node": "^22.20.4",
    "typescript": "7.0.2",
    "vitest": "5.0.2"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
```

`.gitignore`:
```
node_modules/
coverage/
.DS_Store
*.log
eval/private/
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
        env:
          CI: "true"
```

- [ ] **Step 2: Write the core package config**

`packages/core/package.json`:
```json
{
  "name": "@loomsmith/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "4.6.5" }
}
```

`packages/core/tsconfig.json` (source only, no Node or DOM types, enforces the pure core):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": [] },
  "include": ["src"]
}
```

`packages/core/tsconfig.test.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

Run: `cd /Users/macmini/projects/loomsmith && pnpm install`
Expected: lockfile `pnpm-lock.yaml` created, no errors.

- [ ] **Step 3: Write the failing logger test**

`packages/core/test/log.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { create_memory_logger, null_logger } from "../src/log.ts";

describe("logger", () => {
  it("records entries with level, message and data", () => {
    const log = create_memory_logger();
    log.info("batch applied", { revision: 1 });
    log.warn("batch rejected");
    expect(log.entries).toEqual([
      { level: "info", message: "batch applied", data: { revision: 1 } },
      { level: "warn", message: "batch rejected", data: null },
    ]);
  });

  it("null logger accepts calls silently", () => {
    expect(() => null_logger.error("ignored", { a: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/log.test.ts`
Expected: FAIL, cannot resolve `../src/log.ts`.

- [ ] **Step 5: Implement the logger and index**

`packages/core/src/log.ts`:
```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogData = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  data: LogData | null;
}

export const null_logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function create_memory_logger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const push =
    (level: LogLevel) =>
    (message: string, data?: LogData): void => {
      entries.push({ level, message, data: data ?? null });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}
```

`packages/core/src/index.ts`:
```ts
export * from "./log.ts";
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm check`
Expected: typecheck passes, 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm workspace, core package and logger"
```

---

### Task 2: Document and command schemas

**Files:**
- Create: `packages/core/src/schema/primitives.ts`, `packages/core/src/schema/document.ts`, `packages/core/src/schema/commands.ts`, `packages/core/src/schema/json_schema.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/schema.test.ts`; generated `packages/core/generated/*.schema.json`

**Interfaces:**
- Produces (primitives): `id_schema`, `label_schema`, `text_schema`, `part_use_schema`, `length_schema`, `origin_schema`, `bbox_schema`; types `PartUse`, `Length`, `Origin`.
- Produces (document): entity schemas `harness_schema, part_schema, cavity_schema, connector_schema, contact_schema, splice_schema, ground_point_schema, wire_end_schema, wire_spec_schema, wire_schema, node_schema, segment_schema, mating_schema, asset_schema, evidence_schema, review_schema, view_position_schema`; `collection_names` (readonly tuple), `CollectionName`, `collection_schemas`, `document_schema`, `current_schema_version` (= 1); types `LoomDocument, Harness, Part, PartKind, Cavity, Connector, Contact, Splice, GroundPoint, WireEnd, WireSpec, Wire, TopologyNode, Segment, Mating, Asset, Evidence, Review, ViewPosition`.
- Produces (commands): `command_schema_version` (= 1), `command_schema`, `batch_schema`; types `Command, InsertCommand, UpdateCommand, DeleteCommand, Batch`.
- Produces (json): `document_json_schema(): Record<string, unknown>`, `batch_json_schema(): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/schema.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/schema.test.ts`
Expected: FAIL, cannot resolve `../src/schema/json_schema.ts`.

- [ ] **Step 3: Implement the schemas**

`packages/core/src/schema/primitives.ts`:
```ts
import * as z from "zod";

export const id_schema = z.string().min(1).max(128);
export const label_schema = z.string().min(1).max(64);
export const text_schema = z.string().min(1).max(500).nullable();

export const part_use_schema = z.strictObject({
  part_id: id_schema.nullable(),
  identification: z.enum(["identified", "candidate", "unknown"]),
  compatibility: z.enum(["compatible", "incompatible", "unknown"]),
  procurement: z.enum(["available", "unavailable", "reused", "unknown"]),
});

export const length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_mm: z.number().nonnegative().nullable(),
  datum: text_schema,
});

export const origin_schema = z.enum(["measured", "documented", "inferred", "assumed"]);

// PDF user space: points, origin bottom-left, [x0, y0, x1, y1]; page_index is 0-based.
export const bbox_schema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export type PartUse = z.infer<typeof part_use_schema>;
export type Length = z.infer<typeof length_schema>;
export type Origin = z.infer<typeof origin_schema>;
```

`packages/core/src/schema/document.ts`:
```ts
import * as z from "zod";
import { bbox_schema, id_schema, label_schema, length_schema, origin_schema, part_use_schema, text_schema } from "./primitives.ts";

export const current_schema_version = 1;

export const harness_schema = z.strictObject({ id: id_schema, label: label_schema });

export const part_kind_schema = z.enum(["housing", "terminal", "seal", "splice", "wire", "covering", "other"]);
export const part_schema = z.strictObject({
  id: id_schema,
  kind: part_kind_schema,
  manufacturer: text_schema,
  part_number: text_schema,
  description: text_schema,
});

export const cavity_schema = z.strictObject({ id: id_schema, label: label_schema });

export const connector_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  face_view: z.enum(["mating_face", "wire_entry"]).nullable(),
  housing_gender: z.enum(["male", "female"]).nullable(),
  safety_class: z.enum(["srs"]).nullable(),
  housing: part_use_schema,
  cavities: z.array(cavity_schema).min(1).max(256),
});

export const contact_schema = z.strictObject({
  id: id_schema,
  connector_id: id_schema,
  cavity_id: id_schema,
  terminal: part_use_schema,
  seal: part_use_schema.nullable(),
  max_wire_ends: z.number().int().min(1).max(4),
});

export const splice_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  part: part_use_schema,
});

export const ground_point_schema = z.strictObject({ id: id_schema, harness_id: id_schema, label: label_schema });

export const wire_end_schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("contact"), contact_id: id_schema }),
  z.strictObject({ kind: z.literal("splice"), splice_id: id_schema }),
  z.strictObject({ kind: z.literal("ground_point"), ground_point_id: id_schema }),
  z.strictObject({ kind: z.literal("open") }),
]);

const colour_schema = z.string().min(1).max(16);

export const wire_spec_schema = z.strictObject({
  cross_section_mm2: z.number().positive().nullable(),
  designation: text_schema,
  base_colour: colour_schema.nullable(),
  stripe_colours: z.array(colour_schema).max(3),
  insulation: text_schema,
});

export const wire_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  ends: z.tuple([wire_end_schema, wire_end_schema]),
  spec: wire_spec_schema,
  route: z.array(id_schema).nullable(),
  allowances: z.strictObject({
    end_a_mm: z.number().nonnegative(),
    end_b_mm: z.number().nonnegative(),
    service_mm: z.number().nonnegative(),
  }),
});

export const node_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  kind: z.enum(["connector", "breakout", "clip", "grommet", "splice", "ground"]),
  ref_id: id_schema.nullable(),
});

export const segment_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  node_a: id_schema,
  node_b: id_schema,
  length: length_schema,
});

export const mating_schema = z.strictObject({
  id: id_schema,
  connector_a: id_schema,
  connector_b: id_schema,
  cavity_map: z.array(z.strictObject({ cavity_a: id_schema, cavity_b: id_schema })).min(1),
});

export const asset_schema = z.strictObject({
  id: id_schema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  media_type: z.string().min(1).max(100),
  blob_ref: z.string().min(1).max(500),
  title: text_schema,
});

export const evidence_schema = z.strictObject({
  id: id_schema,
  entity_id: id_schema,
  field: z.string().min(1).max(64),
  origin: origin_schema,
  source: z
    .strictObject({ asset_id: id_schema, page_index: z.number().int().nonnegative(), bbox: bbox_schema.nullable() })
    .nullable(),
  note: text_schema,
});

export const review_schema = z.strictObject({
  id: id_schema,
  entity_id: id_schema,
  field: z.string().min(1).max(64),
  status: z.enum(["approved", "rejected"]),
  reviewed_value_json: z.string(),
  revision: z.number().int().nonnegative(),
});

export const view_position_schema = z.strictObject({ id: id_schema, x: z.number(), y: z.number() });

export const collection_names = [
  "harnesses", "parts", "connectors", "contacts", "splices", "ground_points", "wires",
  "nodes", "segments", "matings", "assets", "evidence", "reviews", "view_positions",
] as const;
export type CollectionName = (typeof collection_names)[number];

export const collection_schemas = {
  harnesses: harness_schema,
  parts: part_schema,
  connectors: connector_schema,
  contacts: contact_schema,
  splices: splice_schema,
  ground_points: ground_point_schema,
  wires: wire_schema,
  nodes: node_schema,
  segments: segment_schema,
  matings: mating_schema,
  assets: asset_schema,
  evidence: evidence_schema,
  reviews: review_schema,
  view_positions: view_position_schema,
} satisfies Record<CollectionName, z.ZodType>;

export const document_schema = z.strictObject({
  format: z.literal("loomsmith"),
  schema_version: z.literal(current_schema_version),
  document_id: id_schema,
  revision: z.number().int().nonnegative(),
  applied_batch_ids: z.array(id_schema),
  project: z.strictObject({ label: label_schema }),
  harnesses: z.array(harness_schema),
  parts: z.array(part_schema),
  connectors: z.array(connector_schema),
  contacts: z.array(contact_schema),
  splices: z.array(splice_schema),
  ground_points: z.array(ground_point_schema),
  wires: z.array(wire_schema),
  nodes: z.array(node_schema),
  segments: z.array(segment_schema),
  matings: z.array(mating_schema),
  assets: z.array(asset_schema),
  evidence: z.array(evidence_schema),
  reviews: z.array(review_schema),
  view_positions: z.array(view_position_schema),
});

export type LoomDocument = z.infer<typeof document_schema>;
export type Harness = z.infer<typeof harness_schema>;
export type PartKind = z.infer<typeof part_kind_schema>;
export type Part = z.infer<typeof part_schema>;
export type Cavity = z.infer<typeof cavity_schema>;
export type Connector = z.infer<typeof connector_schema>;
export type Contact = z.infer<typeof contact_schema>;
export type Splice = z.infer<typeof splice_schema>;
export type GroundPoint = z.infer<typeof ground_point_schema>;
export type WireEnd = z.infer<typeof wire_end_schema>;
export type WireSpec = z.infer<typeof wire_spec_schema>;
export type Wire = z.infer<typeof wire_schema>;
export type TopologyNode = z.infer<typeof node_schema>;
export type Segment = z.infer<typeof segment_schema>;
export type Mating = z.infer<typeof mating_schema>;
export type Asset = z.infer<typeof asset_schema>;
export type Evidence = z.infer<typeof evidence_schema>;
export type Review = z.infer<typeof review_schema>;
export type ViewPosition = z.infer<typeof view_position_schema>;
```

`packages/core/src/schema/commands.ts`:
```ts
import * as z from "zod";
import { collection_names } from "./document.ts";
import { id_schema } from "./primitives.ts";

export const command_schema_version = 1;

const collection_name_schema = z.enum(collection_names);
const record_schema = z.record(z.string(), z.unknown());

export const insert_command_schema = z.strictObject({
  op: z.literal("insert"),
  collection: collection_name_schema,
  entity: record_schema,
});

export const update_command_schema = z.strictObject({
  op: z.literal("update"),
  collection: collection_name_schema,
  id: id_schema,
  set: record_schema,
  expect: record_schema.optional(),
});

export const delete_command_schema = z.strictObject({
  op: z.literal("delete"),
  collection: collection_name_schema,
  id: id_schema,
  expect_entity: record_schema.optional(),
});

export const command_schema = z.discriminatedUnion("op", [
  insert_command_schema,
  update_command_schema,
  delete_command_schema,
]);

export const batch_schema = z.strictObject({
  batch_id: id_schema,
  document_id: id_schema,
  command_schema_version: z.literal(command_schema_version),
  expected_revision: z.number().int().nonnegative(),
  created_at: z.string().min(1).max(40),
  commands: z.array(command_schema).min(1).max(10000),
});

export type InsertCommand = z.infer<typeof insert_command_schema>;
export type UpdateCommand = z.infer<typeof update_command_schema>;
export type DeleteCommand = z.infer<typeof delete_command_schema>;
export type Command = z.infer<typeof command_schema>;
export type Batch = z.infer<typeof batch_schema>;
```

`packages/core/src/schema/json_schema.ts`:
```ts
import * as z from "zod";
import { batch_schema } from "./commands.ts";
import { document_schema } from "./document.ts";

export function document_json_schema(): Record<string, unknown> {
  return z.toJSONSchema(document_schema) as Record<string, unknown>;
}

export function batch_json_schema(): Record<string, unknown> {
  return z.toJSONSchema(batch_schema) as Record<string, unknown>;
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./schema/primitives.ts";
export * from "./schema/document.ts";
export * from "./schema/commands.ts";
export * from "./schema/json_schema.ts";
```

- [ ] **Step 4: Run tests (first run writes the two generated schema files) and typecheck**

Run: `pnpm vitest run packages/core/test/schema.test.ts && pnpm vitest run packages/core/test/schema.test.ts && pnpm typecheck`
Expected: both runs PASS (second run compares against the files written by the first); typecheck clean; `packages/core/generated/loomsmith_document_v1.schema.json` starts with `"$schema": "https://json-schema.org/draft/2020-12/schema"`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): document, command and batch schemas with generated JSON Schema"
```

---

### Task 3: Canonical form, empty document and loader

**Files:**
- Create: `packages/core/src/model/canonical.ts`, `packages/core/src/model/empty_document.ts`, `packages/core/src/migrate/load_document.ts`
- Create: `packages/core/test/helpers/entities.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/canonical.test.ts`, `packages/core/test/load_document.test.ts`

**Interfaces:**
- Consumes: Task 2 types and schemas; `Logger`, `null_logger`.
- Produces: `compare_strings(a, b): number`, `compare_ids(a: {id: string}, b: {id: string}): number`, `sort_keys_deep(value: unknown): unknown`, `canonical_json(value: unknown): string`, `canonicalize_document(doc: LoomDocument): LoomDocument`, `to_canonical_file(doc: LoomDocument): string`; `create_empty_document(document_id: string, project_label: string): LoomDocument`; `load_document(raw: unknown, log?: Logger): LoadResult` where `LoadResult = { ok: true; doc: LoomDocument } | { ok: false; error: LoadError }` and `LoadError = { code: "not_object" | "wrong_format" | "future_version" | "unsupported_version" | "invalid_document"; message: string; details: string[] }`.
- Produces (test helpers): `unknown_part`, `identified(part_id)`, `candidate(part_id)`, `harness`, `part`, `connector`, `contact`, `splice`, `ground`, `node`, `segment`, `spec`, `wire`, `to_contact`, `to_splice`, `to_ground`, `open_end`, `small_doc()`.

- [ ] **Step 1: Write the test helpers**

`packages/core/test/helpers/entities.ts`:
```ts
import { create_empty_document } from "../../src/model/empty_document.ts";
import type {
  Connector, Contact, GroundPoint, Harness, LoomDocument, Part, PartKind, Segment, Splice, TopologyNode, Wire, WireEnd, WireSpec,
} from "../../src/schema/document.ts";
import type { PartUse } from "../../src/schema/primitives.ts";

export const unknown_part: PartUse = { part_id: null, identification: "unknown", compatibility: "unknown", procurement: "unknown" };

export function identified(part_id: string): PartUse {
  return { part_id, identification: "identified", compatibility: "compatible", procurement: "available" };
}

export function candidate(part_id: string): PartUse {
  return { part_id, identification: "candidate", compatibility: "unknown", procurement: "unknown" };
}

export function harness(id: string, label: string): Harness {
  return { id, label };
}

export function part(id: string, kind: PartKind, part_number: string, description: string): Part {
  return { id, kind, manufacturer: "SYNTHETIC", part_number, description };
}

// Cavity ids are `${connector_id}_c${label}`, contact ids are `${connector_id}_k${label}`.
export function connector(id: string, harness_id: string, label: string, cavity_labels: string[], housing: PartUse = unknown_part): Connector {
  return {
    id, harness_id, label, face_view: "wire_entry", housing_gender: null, safety_class: null, housing,
    cavities: cavity_labels.map((cavity_label) => ({ id: `${id}_c${cavity_label}`, label: cavity_label })),
  };
}

export function contact(
  connector_id: string,
  cavity_label: string,
  options: { terminal?: PartUse; seal?: PartUse | null; max_wire_ends?: number } = {},
): Contact {
  return {
    id: `${connector_id}_k${cavity_label}`,
    connector_id,
    cavity_id: `${connector_id}_c${cavity_label}`,
    terminal: options.terminal ?? unknown_part,
    seal: options.seal ?? null,
    max_wire_ends: options.max_wire_ends ?? 1,
  };
}

export function splice(id: string, harness_id: string, label: string, part_use: PartUse = unknown_part): Splice {
  return { id, harness_id, label, part: part_use };
}

export function ground(id: string, harness_id: string, label: string): GroundPoint {
  return { id, harness_id, label };
}

export function node(id: string, harness_id: string, kind: TopologyNode["kind"], ref_id: string | null): TopologyNode {
  return { id, harness_id, kind, ref_id };
}

export function segment(id: string, harness_id: string, node_a: string, node_b: string, nominal_mm: number | null, tol_mm: number | null = null): Segment {
  return { id, harness_id, node_a, node_b, length: { nominal_mm, tol_mm, datum: null } };
}

export function spec(cross_section_mm2: number | null, base_colour: string | null, stripe_colours: string[] = []): WireSpec {
  return {
    cross_section_mm2,
    designation: cross_section_mm2 === null ? null : `${cross_section_mm2} mm2`,
    base_colour,
    stripe_colours,
    insulation: null,
  };
}

export function wire(id: string, harness_id: string, label: string, ends: [WireEnd, WireEnd], wire_spec: WireSpec, route: string[] | null): Wire {
  return { id, harness_id, label, ends, spec: wire_spec, route, allowances: { end_a_mm: 20, end_b_mm: 20, service_mm: 0 } };
}

export const to_contact = (connector_id: string, cavity_label: string): WireEnd => ({ kind: "contact", contact_id: `${connector_id}_k${cavity_label}` });
export const to_splice = (splice_id: string): WireEnd => ({ kind: "splice", splice_id });
export const to_ground = (ground_point_id: string): WireEnd => ({ kind: "ground_point", ground_point_id });
export const open_end: WireEnd = { kind: "open" };

// A small, structurally valid document built directly (no commands): two connectors, one routed wire.
export function small_doc(): LoomDocument {
  return {
    ...create_empty_document("doc1", "SMALL"),
    harnesses: [harness("h1", "MAIN")],
    connectors: [connector("j1", "h1", "J1", ["1", "2"]), connector("j2", "h1", "J2", ["1", "2"])],
    contacts: [contact("j1", "1"), contact("j2", "1")],
    nodes: [node("n_j1", "h1", "connector", "j1"), node("n_j2", "h1", "connector", "j2")],
    segments: [segment("s1", "h1", "n_j1", "n_j2", 500, 5)],
    wires: [wire("w1", "h1", "W1", [to_contact("j1", "1"), to_contact("j2", "1")], spec(0.5, "R"), ["s1"])],
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/test/canonical.test.ts`:
```ts
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
```

`packages/core/test/load_document.test.ts`:
```ts
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
    if (result.ok) expect(to_canonical_file(result.doc)).toBe(text);
  });

  it("rejects non-objects and other formats", () => {
    expect(error_code(load_document(null))).toBe("not_object");
    expect(error_code(load_document([]))).toBe("not_object");
    expect(error_code(load_document({ format: "wireviz" }))).toBe("wrong_format");
  });

  it("rejects future, unsupported and malformed versions", () => {
    const raw = JSON.parse(to_canonical_file(small_doc()));
    expect(error_code(load_document({ ...raw, schema_version: 2 }))).toBe("future_version");
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/core/test/canonical.test.ts packages/core/test/load_document.test.ts`
Expected: FAIL, cannot resolve `../src/model/canonical.ts`.

- [ ] **Step 4: Implement**

`packages/core/src/model/canonical.ts`:
```ts
import { collection_names, type CollectionName, type LoomDocument } from "../schema/document.ts";

export function compare_strings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compare_ids(a: { id: string }, b: { id: string }): number {
  return compare_strings(a.id, b.id);
}

export function sort_keys_deep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_keys_deep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sort_keys_deep(record[key]);
    return out;
  }
  return value;
}

export function canonical_json(value: unknown): string {
  return JSON.stringify(sort_keys_deep(value));
}

// Collections are unordered sets: sort by id. Arrays inside entities (ends, route, cavities, stripes) keep their order.
export function canonicalize_document(doc: LoomDocument): LoomDocument {
  const out: LoomDocument = { ...doc };
  const writable = out as unknown as Record<CollectionName, unknown>;
  for (const name of collection_names) {
    writable[name] = [...doc[name]].sort(compare_ids);
  }
  return out;
}

export function to_canonical_file(doc: LoomDocument): string {
  return JSON.stringify(sort_keys_deep(canonicalize_document(doc)), null, 2) + "\n";
}
```

`packages/core/src/model/empty_document.ts`:
```ts
import { current_schema_version, type LoomDocument } from "../schema/document.ts";

export function create_empty_document(document_id: string, project_label: string): LoomDocument {
  return {
    format: "loomsmith",
    schema_version: current_schema_version,
    document_id,
    revision: 0,
    applied_batch_ids: [],
    project: { label: project_label },
    harnesses: [], parts: [], connectors: [], contacts: [], splices: [], ground_points: [], wires: [],
    nodes: [], segments: [], matings: [], assets: [], evidence: [], reviews: [], view_positions: [],
  };
}
```

`packages/core/src/migrate/load_document.ts`:
```ts
import { null_logger, type Logger } from "../log.ts";
import { canonicalize_document } from "../model/canonical.ts";
import { current_schema_version, document_schema, type LoomDocument } from "../schema/document.ts";

export type LoadErrorCode = "not_object" | "wrong_format" | "future_version" | "unsupported_version" | "invalid_document";
export interface LoadError {
  code: LoadErrorCode;
  message: string;
  details: string[];
}
export type LoadResult = { ok: true; doc: LoomDocument } | { ok: false; error: LoadError };

type RawDocument = Record<string, unknown>;

// migrations[i] upgrades schema_version i + 1 to i + 2. Empty while only version 1 exists.
const migrations: ReadonlyArray<(raw: RawDocument) => RawDocument> = [];

function fail(log: Logger, code: LoadErrorCode, message: string, details: string[] = []): LoadResult {
  log.warn("document rejected", { code, message, detail_count: details.length });
  return { ok: false, error: { code, message, details } };
}

export function load_document(raw: unknown, log: Logger = null_logger): LoadResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail(log, "not_object", "document must be a JSON object");
  let record = raw as RawDocument;
  if (record["format"] !== "loomsmith") return fail(log, "wrong_format", "format must be \"loomsmith\"");
  const version = record["schema_version"];
  if (typeof version !== "number" || !Number.isInteger(version)) return fail(log, "invalid_document", "schema_version must be an integer");
  if (version > current_schema_version) {
    return fail(log, "future_version", `schema_version ${version} is newer than supported ${current_schema_version}; update loomsmith`);
  }
  if (version < 1) return fail(log, "unsupported_version", `schema_version ${version} is not supported`);
  for (let from = version; from < current_schema_version; from += 1) {
    const step = migrations[from - 1];
    if (!step) return fail(log, "unsupported_version", `no migration from schema_version ${from}`);
    record = step(record);
    log.info("document migrated", { from, to: from + 1 });
  }
  const parsed = document_schema.safeParse(record);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
    return fail(log, "invalid_document", "document failed schema validation", details);
  }
  log.debug("document loaded", { document_id: parsed.data.document_id, revision: parsed.data.revision });
  return { ok: true, doc: canonicalize_document(parsed.data) };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./model/canonical.ts";
export * from "./model/empty_document.ts";
export * from "./migrate/load_document.ts";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): canonical json, empty document and versioned loader"
```

---

### Task 4: Document index and structural validation

**Files:**
- Create: `packages/core/src/model/doc_index.ts`, `packages/core/src/validate/issue.ts`, `packages/core/src/validate/structural.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/structural.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `compare_ids` (Task 3).
- Produces: `DocIndex` (maps `by_id, harnesses, parts, connectors, contacts, splices, ground_points, wires, nodes, segments, matings, assets, contacts_by_cavity, wire_ends_by_endpoint, nodes_by_ref`, plus `duplicate_ids: string[]`), `EntityRef`, `WireEndRef`, `build_index(doc): DocIndex`, `cavity_key(connector_id, cavity_id): string`, `endpoint_key(end: WireEnd): string | null` (`"contact:<id>" | "splice:<id>" | "ground_point:<id>"`), `push_to(map, key, value)`.
- Produces: `Issue { code; level: "structural" | "completeness"; severity: "error" | "warning"; message; path; entity_id: string | null; hint }`, `issue_key(issue)`, `sort_issues(issues)`, `entity_path(collection, id, ...rest)` (format `collection/id/field/index`), `validate_structure(doc, index?): Issue[]`.
- Structural codes: `S_DUPLICATE_ID, S_REF_MISSING, S_PART_KIND, S_DUPLICATE_CAVITY, S_DUPLICATE_LABEL, S_CAVITY_MULTIPLE_CONTACTS, S_CONTACT_OVERFILLED, S_HARNESS_MISMATCH, S_NODE_KIND, S_NODE_DUPLICATE_REF, S_SEGMENT_LOOP, S_MATING_INVALID`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/structural.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { LoomDocument } from "../src/schema/document.ts";
import { validate_structure } from "../src/validate/structural.ts";
import {
  connector, contact, ground, harness, identified, node, open_end, part, segment, small_doc, spec, splice, to_contact, wire,
} from "./helpers/entities.ts";

const find = (doc: LoomDocument, code: string) => validate_structure(doc).filter((issue) => issue.code === code);

describe("validate_structure", () => {
  it("accepts a valid document", () => {
    expect(validate_structure(small_doc())).toEqual([]);
  });

  it("flags a missing harness reference", () => {
    const doc = small_doc();
    const bad = { ...doc, connectors: [...doc.connectors, connector("j9", "nope", "J9", ["1"])] };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(
      expect.objectContaining({ path: "connectors/j9/harness_id", entity_id: "j9", severity: "error", level: "structural" }),
    );
  });

  it("flags a wire end pointing at a missing contact", () => {
    const doc = small_doc();
    const bad = { ...doc, wires: [...doc.wires, wire("w2", "h1", "W2", [to_contact("j1", "2"), open_end], spec(0.5, "R"), null)] };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(expect.objectContaining({ path: "wires/w2/ends/0", entity_id: "w2" }));
  });

  it("flags two contacts in one cavity", () => {
    const doc = small_doc();
    const bad = { ...doc, contacts: [...doc.contacts, { ...contact("j1", "1"), id: "j1_k1b" }] };
    expect(find(bad, "S_CAVITY_MULTIPLE_CONTACTS").map((issue) => issue.entity_id)).toEqual(["j1_k1b"]);
  });

  it("flags a contact holding more wire ends than allowed", () => {
    const doc = small_doc();
    const bad = { ...doc, wires: [...doc.wires, wire("w2", "h1", "W2", [to_contact("j1", "1"), to_contact("j2", "1")], spec(0.5, "R"), null)] };
    expect(find(bad, "S_CONTACT_OVERFILLED").map((issue) => issue.entity_id)).toEqual(["j1_k1", "j2_k1"]);
  });

  it("flags a wire whose end sits in another harness", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      harnesses: [...doc.harnesses, harness("h2", "SECOND")],
      contacts: [...doc.contacts, contact("j1", "2")],
      wires: [...doc.wires, wire("w3", "h2", "W3", [to_contact("j1", "2"), open_end], spec(0.5, "R"), null)],
    };
    expect(find(bad, "S_HARNESS_MISMATCH")).toContainEqual(expect.objectContaining({ path: "wires/w3/ends/0" }));
  });

  it("flags node kind errors and segment loops", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      nodes: [...doc.nodes, node("n_b", "h1", "breakout", "j1")],
      segments: [...doc.segments, segment("s2", "h1", "n_j1", "n_j1", 10)],
    };
    expect(find(bad, "S_NODE_KIND")).toContainEqual(expect.objectContaining({ path: "nodes/n_b/ref_id" }));
    expect(find(bad, "S_SEGMENT_LOOP")).toContainEqual(expect.objectContaining({ entity_id: "s2" }));
  });

  it("flags duplicate labels in the connector, splice and ground namespace", () => {
    const doc = small_doc();
    const bad = { ...doc, splices: [splice("sp1", "h1", "J1")] };
    expect(find(bad, "S_DUPLICATE_LABEL")).toContainEqual(expect.objectContaining({ path: "splices/sp1/label" }));
  });

  it("flags invalid matings", () => {
    const doc = small_doc();
    const bad = { ...doc, matings: [{ id: "m1", connector_a: "j1", connector_b: "j2", cavity_map: [{ cavity_a: "j1_c9", cavity_b: "j2_c1" }] }] };
    expect(find(bad, "S_MATING_INVALID")).toContainEqual(expect.objectContaining({ path: "matings/m1/cavity_map/0" }));
  });

  it("flags an id reused across collections", () => {
    const doc = small_doc();
    const bad = { ...doc, ground_points: [ground("j1", "h1", "G1")] };
    expect(find(bad, "S_DUPLICATE_ID").map((issue) => issue.entity_id)).toEqual(["j1"]);
  });

  it("flags a part of the wrong kind", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      parts: [part("p_seal", "seal", "SYN-S1", "seal (synthetic)")],
      connectors: doc.connectors.map((c) => (c.id === "j1" ? { ...c, housing: identified("p_seal") } : c)),
    };
    expect(find(bad, "S_PART_KIND")).toContainEqual(expect.objectContaining({ path: "connectors/j1/housing/part_id" }));
  });

  it("flags evidence that points at a missing asset", () => {
    const doc = small_doc();
    const bad = {
      ...doc,
      evidence: [{ id: "e1", entity_id: "w1", field: "spec", origin: "documented" as const, source: { asset_id: "a_missing", page_index: 0, bbox: null }, note: null }],
    };
    expect(find(bad, "S_REF_MISSING")).toContainEqual(expect.objectContaining({ path: "evidence/e1/source/asset_id" }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/structural.test.ts`
Expected: FAIL, cannot resolve `../src/validate/structural.ts`.

- [ ] **Step 3: Implement the index and issue helpers**

`packages/core/src/model/doc_index.ts`:
```ts
import {
  collection_names,
  type Asset, type CollectionName, type Connector, type Contact, type GroundPoint, type Harness, type LoomDocument,
  type Mating, type Part, type Segment, type Splice, type TopologyNode, type Wire, type WireEnd,
} from "../schema/document.ts";

export interface EntityRef {
  collection: CollectionName;
  entity: { id: string };
}

export interface WireEndRef {
  wire_id: string;
  end_index: 0 | 1;
}

export interface DocIndex {
  by_id: Map<string, EntityRef>;
  duplicate_ids: string[];
  harnesses: Map<string, Harness>;
  parts: Map<string, Part>;
  connectors: Map<string, Connector>;
  contacts: Map<string, Contact>;
  splices: Map<string, Splice>;
  ground_points: Map<string, GroundPoint>;
  wires: Map<string, Wire>;
  nodes: Map<string, TopologyNode>;
  segments: Map<string, Segment>;
  matings: Map<string, Mating>;
  assets: Map<string, Asset>;
  contacts_by_cavity: Map<string, Contact[]>;
  wire_ends_by_endpoint: Map<string, WireEndRef[]>;
  nodes_by_ref: Map<string, TopologyNode[]>;
}

export function cavity_key(connector_id: string, cavity_id: string): string {
  return `${connector_id}/${cavity_id}`;
}

export function endpoint_key(end: WireEnd): string | null {
  switch (end.kind) {
    case "contact":
      return `contact:${end.contact_id}`;
    case "splice":
      return `splice:${end.splice_id}`;
    case "ground_point":
      return `ground_point:${end.ground_point_id}`;
    case "open":
      return null;
  }
}

export function push_to<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function by_id_map<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function build_index(doc: LoomDocument): DocIndex {
  const by_id = new Map<string, EntityRef>();
  const duplicates = new Set<string>();
  for (const collection of collection_names) {
    if (collection === "view_positions") continue;
    for (const entity of doc[collection]) {
      if (by_id.has(entity.id)) duplicates.add(entity.id);
      else by_id.set(entity.id, { collection, entity });
    }
  }
  const contacts_by_cavity = new Map<string, Contact[]>();
  for (const contact of doc.contacts) push_to(contacts_by_cavity, cavity_key(contact.connector_id, contact.cavity_id), contact);
  const wire_ends_by_endpoint = new Map<string, WireEndRef[]>();
  for (const wire of doc.wires) {
    wire.ends.forEach((end, i) => {
      const key = endpoint_key(end);
      if (key !== null) push_to(wire_ends_by_endpoint, key, { wire_id: wire.id, end_index: i === 0 ? 0 : 1 });
    });
  }
  const nodes_by_ref = new Map<string, TopologyNode[]>();
  for (const n of doc.nodes) if (n.ref_id !== null) push_to(nodes_by_ref, n.ref_id, n);
  return {
    by_id,
    duplicate_ids: [...duplicates].sort(),
    harnesses: by_id_map(doc.harnesses),
    parts: by_id_map(doc.parts),
    connectors: by_id_map(doc.connectors),
    contacts: by_id_map(doc.contacts),
    splices: by_id_map(doc.splices),
    ground_points: by_id_map(doc.ground_points),
    wires: by_id_map(doc.wires),
    nodes: by_id_map(doc.nodes),
    segments: by_id_map(doc.segments),
    matings: by_id_map(doc.matings),
    assets: by_id_map(doc.assets),
    contacts_by_cavity,
    wire_ends_by_endpoint,
    nodes_by_ref,
  };
}
```

`packages/core/src/validate/issue.ts`:
```ts
import { compare_strings } from "../model/canonical.ts";

export type IssueSeverity = "error" | "warning";
export type IssueLevel = "structural" | "completeness";

export interface Issue {
  code: string;
  level: IssueLevel;
  severity: IssueSeverity;
  message: string;
  path: string;
  entity_id: string | null;
  hint: string;
}

export function issue_key(issue: Issue): string {
  return `${issue.code}|${issue.entity_id ?? ""}|${issue.path}`;
}

export function sort_issues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => compare_strings(issue_key(a), issue_key(b)));
}

// Paths address entities by id, not array index: "wires/w1/ends/0".
export function entity_path(collection: string, id: string, ...rest: Array<string | number>): string {
  return [collection, id, ...rest.map(String)].join("/");
}
```

- [ ] **Step 4: Implement structural validation**

`packages/core/src/validate/structural.ts`:
```ts
import { compare_ids } from "../model/canonical.ts";
import { build_index, push_to, type DocIndex } from "../model/doc_index.ts";
import type { LoomDocument, PartKind, WireEnd } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { entity_path, sort_issues, type Issue } from "./issue.ts";

type Emit = (code: string, message: string, path: string, entity_id: string | null, hint: string) => void;

export function validate_structure(doc: LoomDocument, index: DocIndex = build_index(doc)): Issue[] {
  const issues: Issue[] = [];
  const emit: Emit = (code, message, path, entity_id, hint) => {
    issues.push({ code, level: "structural", severity: "error", message, path, entity_id, hint });
  };
  for (const id of index.duplicate_ids) emit("S_DUPLICATE_ID", `id ${id} is used by more than one entity`, id, id, "give every entity a unique id");
  check_harness_refs(doc, index, emit);
  check_part_uses(doc, index, emit);
  check_connectors_and_contacts(doc, index, emit);
  check_wires(doc, index, emit);
  check_topology(doc, index, emit);
  check_matings(doc, index, emit);
  check_evidence(doc, index, emit);
  check_labels(doc, emit);
  return sort_issues(issues);
}

function check_harness_refs(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const collection of ["connectors", "splices", "ground_points", "wires", "nodes", "segments"] as const) {
    for (const entity of doc[collection]) {
      if (!index.harnesses.has(entity.harness_id)) {
        emit("S_REF_MISSING", `harness ${entity.harness_id} not found`, entity_path(collection, entity.id, "harness_id"), entity.id, "create the harness or move the entity");
      }
    }
  }
}

function check_part_uses(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  const uses: Array<{ path: string; entity_id: string; use: PartUse; kind: PartKind }> = [];
  for (const c of doc.connectors) uses.push({ path: entity_path("connectors", c.id, "housing"), entity_id: c.id, use: c.housing, kind: "housing" });
  for (const k of doc.contacts) {
    uses.push({ path: entity_path("contacts", k.id, "terminal"), entity_id: k.id, use: k.terminal, kind: "terminal" });
    if (k.seal !== null) uses.push({ path: entity_path("contacts", k.id, "seal"), entity_id: k.id, use: k.seal, kind: "seal" });
  }
  for (const s of doc.splices) uses.push({ path: entity_path("splices", s.id, "part"), entity_id: s.id, use: s.part, kind: "splice" });
  for (const u of uses) {
    if (u.use.part_id === null) continue;
    const found = index.parts.get(u.use.part_id);
    if (!found) emit("S_REF_MISSING", `part ${u.use.part_id} not found`, `${u.path}/part_id`, u.entity_id, "add the part or clear part_id");
    else if (found.kind !== u.kind) {
      emit("S_PART_KIND", `part ${found.id} is a ${found.kind}, expected ${u.kind}`, `${u.path}/part_id`, u.entity_id, `reference a part of kind ${u.kind}`);
    }
  }
}

function check_connectors_and_contacts(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const c of doc.connectors) {
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const cavity of c.cavities) {
      const path = entity_path("connectors", c.id, "cavities", cavity.id);
      if (ids.has(cavity.id)) emit("S_DUPLICATE_CAVITY", `cavity id ${cavity.id} repeats in ${c.label}`, path, c.id, "use unique cavity ids");
      if (labels.has(cavity.label)) emit("S_DUPLICATE_LABEL", `cavity label ${cavity.label} repeats in ${c.label}`, path, c.id, "use unique cavity labels");
      ids.add(cavity.id);
      labels.add(cavity.label);
    }
  }
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner) {
      emit("S_REF_MISSING", `connector ${k.connector_id} not found`, entity_path("contacts", k.id, "connector_id"), k.id, "attach the contact to an existing connector");
      continue;
    }
    if (!owner.cavities.some((cavity) => cavity.id === k.cavity_id)) {
      emit("S_REF_MISSING", `cavity ${k.cavity_id} is not in ${owner.label}`, entity_path("contacts", k.id, "cavity_id"), k.id, "pick a cavity of the connector");
    }
  }
  for (const [key, list] of index.contacts_by_cavity) {
    for (const extra of [...list].sort(compare_ids).slice(1)) {
      emit("S_CAVITY_MULTIPLE_CONTACTS", `cavity ${key} holds more than one contact`, entity_path("contacts", extra.id), extra.id, "one contact per cavity; raise max_wire_ends for a double crimp");
    }
  }
  for (const k of doc.contacts) {
    const count = index.wire_ends_by_endpoint.get(`contact:${k.id}`)?.length ?? 0;
    if (count > k.max_wire_ends) {
      emit("S_CONTACT_OVERFILLED", `contact holds ${count} wire ends, max ${k.max_wire_ends}`, entity_path("contacts", k.id, "max_wire_ends"), k.id, "raise max_wire_ends only if the terminal is rated for it");
    }
  }
}

// undefined: the referenced entity is missing; null: nothing to compare (open end, or a problem reported elsewhere).
function end_harness_id(index: DocIndex, end: WireEnd): string | null | undefined {
  switch (end.kind) {
    case "contact": {
      const k = index.contacts.get(end.contact_id);
      if (!k) return undefined;
      return index.connectors.get(k.connector_id)?.harness_id ?? null;
    }
    case "splice":
      return index.splices.get(end.splice_id)?.harness_id;
    case "ground_point":
      return index.ground_points.get(end.ground_point_id)?.harness_id;
    case "open":
      return null;
  }
}

function check_wires(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const w of doc.wires) {
    w.ends.forEach((end, i) => {
      const path = entity_path("wires", w.id, "ends", i);
      const harness_id = end_harness_id(index, end);
      if (harness_id === undefined) {
        emit("S_REF_MISSING", `end ${i} of ${w.label} points to a missing ${end.kind}`, path, w.id, "attach the end to an existing contact, splice or ground point");
      } else if (harness_id !== null && harness_id !== w.harness_id) {
        emit("S_HARNESS_MISMATCH", `end ${i} of ${w.label} is in harness ${harness_id}`, path, w.id, "a wire and both of its ends belong to the same harness");
      }
    });
    w.route?.forEach((segment_id, i) => {
      const path = entity_path("wires", w.id, "route", i);
      const seg = index.segments.get(segment_id);
      if (!seg) emit("S_REF_MISSING", `segment ${segment_id} not found`, path, w.id, "route through existing segments");
      else if (seg.harness_id !== w.harness_id) emit("S_HARNESS_MISMATCH", `segment ${segment_id} is in harness ${seg.harness_id}`, path, w.id, "route through segments of the wire's harness");
    });
  }
}

function ref_harness(index: DocIndex, kind: "connector" | "splice" | "ground", ref_id: string): string | undefined {
  switch (kind) {
    case "connector":
      return index.connectors.get(ref_id)?.harness_id;
    case "splice":
      return index.splices.get(ref_id)?.harness_id;
    case "ground":
      return index.ground_points.get(ref_id)?.harness_id;
  }
}

function check_topology(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const n of doc.nodes) {
    const path = entity_path("nodes", n.id, "ref_id");
    if (n.kind === "connector" || n.kind === "splice" || n.kind === "ground") {
      if (n.ref_id === null) {
        emit("S_NODE_KIND", `${n.kind} node needs ref_id`, path, n.id, `point ref_id at a ${n.kind}`);
        continue;
      }
      const harness_id = ref_harness(index, n.kind, n.ref_id);
      if (harness_id === undefined) {
        if (index.by_id.has(n.ref_id)) emit("S_NODE_KIND", `ref_id ${n.ref_id} is not a ${n.kind}`, path, n.id, `point ref_id at a ${n.kind}`);
        else emit("S_REF_MISSING", `${n.kind} ${n.ref_id} not found`, path, n.id, "point ref_id at an existing entity");
      } else if (harness_id !== n.harness_id) {
        emit("S_HARNESS_MISMATCH", `node refers to an entity in harness ${harness_id}`, path, n.id, "nodes belong to the harness of what they locate");
      }
    } else if (n.ref_id !== null) {
      emit("S_NODE_KIND", `${n.kind} node must not have ref_id`, path, n.id, "clear ref_id");
    }
  }
  for (const [ref_id, list] of index.nodes_by_ref) {
    for (const extra of [...list].sort(compare_ids).slice(1)) {
      emit("S_NODE_DUPLICATE_REF", `more than one node refers to ${ref_id}`, entity_path("nodes", extra.id, "ref_id"), extra.id, "one node per connector, splice or ground point");
    }
  }
  for (const s of doc.segments) {
    for (const side of ["node_a", "node_b"] as const) {
      const found = index.nodes.get(s[side]);
      if (!found) emit("S_REF_MISSING", `node ${s[side]} not found`, entity_path("segments", s.id, side), s.id, "join existing nodes");
      else if (found.harness_id !== s.harness_id) emit("S_HARNESS_MISMATCH", `node ${found.id} is in harness ${found.harness_id}`, entity_path("segments", s.id, side), s.id, "join nodes of the segment's harness");
    }
    if (s.node_a === s.node_b) emit("S_SEGMENT_LOOP", "segment starts and ends at the same node", entity_path("segments", s.id), s.id, "a segment joins two different nodes");
  }
}

function check_matings(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  const matings_by_connector = new Map<string, string[]>();
  for (const m of doc.matings) {
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (!a) emit("S_REF_MISSING", `connector ${m.connector_a} not found`, entity_path("matings", m.id, "connector_a"), m.id, "mate existing connectors");
    if (!b) emit("S_REF_MISSING", `connector ${m.connector_b} not found`, entity_path("matings", m.id, "connector_b"), m.id, "mate existing connectors");
    if (m.connector_a === m.connector_b) {
      emit("S_MATING_INVALID", "a connector cannot mate with itself", entity_path("matings", m.id), m.id, "mate two different connectors");
    } else {
      push_to(matings_by_connector, m.connector_b, m.id);
    }
    push_to(matings_by_connector, m.connector_a, m.id);
    const used_a = new Set<string>();
    const used_b = new Set<string>();
    m.cavity_map.forEach((pair, i) => {
      const path = entity_path("matings", m.id, "cavity_map", i);
      if (a && !a.cavities.some((cavity) => cavity.id === pair.cavity_a)) emit("S_MATING_INVALID", `cavity ${pair.cavity_a} is not in ${a.label}`, path, m.id, "map cavities that exist");
      if (b && !b.cavities.some((cavity) => cavity.id === pair.cavity_b)) emit("S_MATING_INVALID", `cavity ${pair.cavity_b} is not in ${b.label}`, path, m.id, "map cavities that exist");
      if (used_a.has(pair.cavity_a) || used_b.has(pair.cavity_b)) emit("S_MATING_INVALID", "a cavity is mapped twice", path, m.id, "map each cavity once");
      used_a.add(pair.cavity_a);
      used_b.add(pair.cavity_b);
    });
  }
  for (const [connector_id, ids] of matings_by_connector) {
    if (ids.length > 1) emit("S_MATING_INVALID", `connector ${connector_id} is in ${ids.length} matings`, entity_path("connectors", connector_id), connector_id, "a connector mates with one counterpart");
  }
}

function check_evidence(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const e of doc.evidence) {
    if (!index.by_id.has(e.entity_id)) emit("S_REF_MISSING", `entity ${e.entity_id} not found`, entity_path("evidence", e.id, "entity_id"), e.id, "attach evidence to an existing entity");
    if (e.source !== null && !index.assets.has(e.source.asset_id)) {
      emit("S_REF_MISSING", `asset ${e.source.asset_id} not found`, entity_path("evidence", e.id, "source", "asset_id"), e.id, "add the asset to the manifest first");
    }
  }
  for (const r of doc.reviews) {
    if (!index.by_id.has(r.entity_id)) emit("S_REF_MISSING", `entity ${r.entity_id} not found`, entity_path("reviews", r.id, "entity_id"), r.id, "review an existing entity");
  }
  for (const p of doc.view_positions) {
    if (!index.by_id.has(p.id)) emit("S_REF_MISSING", `entity ${p.id} not found`, entity_path("view_positions", p.id), p.id, "remove the position of a deleted entity");
  }
}

function check_labels(doc: LoomDocument, emit: Emit): void {
  const harness_labels = new Set<string>();
  for (const h of [...doc.harnesses].sort(compare_ids)) {
    if (harness_labels.has(h.label)) emit("S_DUPLICATE_LABEL", `harness label ${h.label} is used twice`, entity_path("harnesses", h.id, "label"), h.id, "harness labels are unique");
    harness_labels.add(h.label);
  }
  const project_labels = new Set<string>();
  for (const collection of ["connectors", "splices", "ground_points"] as const) {
    for (const entity of [...doc[collection]].sort(compare_ids)) {
      if (project_labels.has(entity.label)) {
        emit("S_DUPLICATE_LABEL", `label ${entity.label} is used twice`, entity_path(collection, entity.id, "label"), entity.id, "connector, splice and ground point labels are unique per project");
      }
      project_labels.add(entity.label);
    }
  }
  const wire_labels = new Set<string>();
  for (const w of [...doc.wires].sort(compare_ids)) {
    const key = `${w.harness_id}/${w.label}`;
    if (wire_labels.has(key)) emit("S_DUPLICATE_LABEL", `wire label ${w.label} is used twice in its harness`, entity_path("wires", w.id, "label"), w.id, "wire labels are unique per harness");
    wire_labels.add(key);
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./model/doc_index.ts";
export * from "./validate/issue.ts";
export * from "./validate/structural.ts";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): document index and structural validation"
```

---

### Task 5: Commands and the batch reducer

**Files:**
- Create: `packages/core/src/commands/builders.ts`, `packages/core/src/commands/apply_command.ts`, `packages/core/src/commands/apply_batch.ts`, `packages/core/test/helpers/apply.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/apply_batch.test.ts`

**Interfaces:**
- Consumes: `batch_schema`, `command_schema_version`, `collection_schemas`, `canonical_json`, `canonicalize_document`, `validate_structure`, `issue_key`, `Logger`.
- Produces: `cmd_insert(collection, entity: { id: string } & Record<string, unknown>): Command`, `cmd_update(collection, id, set, expect?): Command`, `cmd_delete(collection, id): Command`; `apply_command(doc, command): CommandStep`; `apply_batch(doc, raw_batch: unknown, log?): ApplyBatchResult` with `ApplyBatchResult = { ok: true; duplicate: boolean; doc: LoomDocument; inverse: Command[] } | { ok: false; rejection: BatchRejection }` and `BatchRejection = { code: "invalid_batch" | "document_mismatch" | "stale_revision" | "precondition_failed" | "invalid_entity" | "structural_errors_introduced"; message: string; command_index: number | null; issues: Issue[] }`; `make_batch(doc, commands, batch_id, created_at): Batch`.
- Produces (test helper): `apply_ok(doc, commands, batch_id): LoomDocument` (throws on rejection), `fixed_time = "2026-09-27T00:00:00Z"`.
- Rules: deletes never cascade in M1; a delete that leaves references dangling is rejected as `structural_errors_introduced`.

- [ ] **Step 1: Write the test helper and failing tests**

`packages/core/test/helpers/apply.ts`:
```ts
import { apply_batch, make_batch } from "../../src/commands/apply_batch.ts";
import type { Command } from "../../src/schema/commands.ts";
import type { LoomDocument } from "../../src/schema/document.ts";

export const fixed_time = "2026-09-27T00:00:00Z";

export function apply_ok(doc: LoomDocument, commands: Command[], batch_id: string): LoomDocument {
  const result = apply_batch(doc, make_batch(doc, commands, batch_id, fixed_time));
  if (!result.ok) {
    const issues = result.rejection.issues.map((issue) => `${issue.code} ${issue.path}`).join(", ");
    throw new Error(`batch ${batch_id} rejected: ${result.rejection.code} ${result.rejection.message} ${issues}`);
  }
  return result.doc;
}
```

`packages/core/test/apply_batch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { apply_batch, make_batch, type ApplyBatchResult } from "../src/commands/apply_batch.ts";
import { cmd_delete, cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { create_memory_logger } from "../src/log.ts";
import { to_canonical_file } from "../src/model/canonical.ts";
import type { LoomDocument } from "../src/schema/document.ts";
import { apply_ok, fixed_time as T } from "./helpers/apply.ts";
import { harness, small_doc } from "./helpers/entities.ts";

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

  it("undo restores the previous content", () => {
    const doc = small_doc();
    const forward = apply_batch(
      doc,
      make_batch(doc, [
        cmd_update("segments", "s1", { length: { nominal_mm: 510, tol_mm: 5, datum: null } }),
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/apply_batch.test.ts`
Expected: FAIL, cannot resolve `../src/commands/apply_batch.ts`.

- [ ] **Step 3: Implement builders and apply_command**

`packages/core/src/commands/builders.ts`:
```ts
import type { Command } from "../schema/commands.ts";
import type { CollectionName } from "../schema/document.ts";

export function cmd_insert(collection: CollectionName, entity: { id: string } & Record<string, unknown>): Command {
  return { op: "insert", collection, entity };
}

export function cmd_update(collection: CollectionName, id: string, set: Record<string, unknown>, expect?: Record<string, unknown>): Command {
  return expect === undefined ? { op: "update", collection, id, set } : { op: "update", collection, id, set, expect };
}

export function cmd_delete(collection: CollectionName, id: string): Command {
  return { op: "delete", collection, id };
}
```

`packages/core/src/commands/apply_command.ts`:
```ts
import type * as z from "zod";
import { canonical_json } from "../model/canonical.ts";
import type { Command } from "../schema/commands.ts";
import { collection_schemas, type CollectionName, type LoomDocument } from "../schema/document.ts";

export type AnyEntity = { id: string } & Record<string, unknown>;
export type CommandFailureCode = "precondition_failed" | "invalid_entity";
export type CommandStep =
  | { ok: true; doc: LoomDocument; inverse: Command[] }
  | { ok: false; code: CommandFailureCode; message: string };

export function get_collection(doc: LoomDocument, name: CollectionName): readonly AnyEntity[] {
  return doc[name] as unknown as readonly AnyEntity[];
}

function with_collection(doc: LoomDocument, name: CollectionName, items: AnyEntity[]): LoomDocument {
  return { ...doc, [name]: items } as unknown as LoomDocument;
}

function parse_entity(name: CollectionName, value: unknown): { ok: true; entity: AnyEntity } | { ok: false; message: string } {
  const schema: z.ZodType = collection_schemas[name];
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; ") };
  }
  return { ok: true, entity: result.data as AnyEntity };
}

function fail(code: CommandFailureCode, message: string): CommandStep {
  return { ok: false, code, message };
}

export function apply_command(doc: LoomDocument, command: Command): CommandStep {
  const items = get_collection(doc, command.collection);
  const name = command.collection;
  switch (command.op) {
    case "insert": {
      const parsed = parse_entity(name, command.entity);
      if (!parsed.ok) return fail("invalid_entity", `${name}: ${parsed.message}`);
      const entity = parsed.entity;
      if (items.some((item) => item.id === entity.id)) return fail("precondition_failed", `${name}/${entity.id} already exists`);
      return {
        ok: true,
        doc: with_collection(doc, name, [...items, entity]),
        inverse: [{ op: "delete", collection: name, id: entity.id, expect_entity: entity }],
      };
    }
    case "update": {
      const current = items.find((item) => item.id === command.id);
      if (!current) return fail("precondition_failed", `${name}/${command.id} does not exist`);
      if ("id" in command.set) return fail("invalid_entity", `${name}/${command.id}: id cannot be changed`);
      for (const [key, value] of Object.entries(command.expect ?? {})) {
        if (canonical_json(current[key]) !== canonical_json(value)) {
          return fail("precondition_failed", `${name}/${command.id}.${key} does not match the expected value`);
        }
      }
      const parsed = parse_entity(name, { ...current, ...command.set });
      if (!parsed.ok) return fail("invalid_entity", `${name}/${command.id}: ${parsed.message}`);
      const updated = parsed.entity;
      const old_values: Record<string, unknown> = {};
      const new_values: Record<string, unknown> = {};
      for (const key of Object.keys(command.set)) {
        old_values[key] = current[key];
        new_values[key] = updated[key];
      }
      return {
        ok: true,
        doc: with_collection(doc, name, items.map((item) => (item.id === command.id ? updated : item))),
        inverse: [{ op: "update", collection: name, id: command.id, set: old_values, expect: new_values }],
      };
    }
    case "delete": {
      const current = items.find((item) => item.id === command.id);
      if (!current) return fail("precondition_failed", `${name}/${command.id} does not exist`);
      if (command.expect_entity !== undefined && canonical_json(current) !== canonical_json(command.expect_entity)) {
        return fail("precondition_failed", `${name}/${command.id} changed since it was read`);
      }
      return {
        ok: true,
        doc: with_collection(doc, name, items.filter((item) => item.id !== command.id)),
        inverse: [{ op: "insert", collection: name, entity: current }],
      };
    }
  }
}
```

- [ ] **Step 4: Implement apply_batch**

`packages/core/src/commands/apply_batch.ts`:
```ts
import { null_logger, type Logger } from "../log.ts";
import { canonicalize_document } from "../model/canonical.ts";
import { batch_schema, command_schema_version, type Batch, type Command } from "../schema/commands.ts";
import type { LoomDocument } from "../schema/document.ts";
import { issue_key, type Issue } from "../validate/issue.ts";
import { validate_structure } from "../validate/structural.ts";
import { apply_command } from "./apply_command.ts";

export type BatchRejectionCode =
  | "invalid_batch"
  | "document_mismatch"
  | "stale_revision"
  | "precondition_failed"
  | "invalid_entity"
  | "structural_errors_introduced";

export interface BatchRejection {
  code: BatchRejectionCode;
  message: string;
  command_index: number | null;
  issues: Issue[];
}

export type ApplyBatchResult =
  | { ok: true; duplicate: boolean; doc: LoomDocument; inverse: Command[] }
  | { ok: false; rejection: BatchRejection };

function reject(log: Logger, rejection: BatchRejection): ApplyBatchResult {
  log.warn("batch rejected", {
    code: rejection.code,
    message: rejection.message,
    command_index: rejection.command_index,
    issue_count: rejection.issues.length,
  });
  return { ok: false, rejection };
}

export function make_batch(doc: LoomDocument, commands: Command[], batch_id: string, created_at: string): Batch {
  return { batch_id, document_id: doc.document_id, command_schema_version, expected_revision: doc.revision, created_at, commands };
}

// Pure reducer: never mutates `doc`, never reads the clock or RNG. The caller supplies ids and created_at.
export function apply_batch(doc: LoomDocument, raw_batch: unknown, log: Logger = null_logger): ApplyBatchResult {
  const parsed = batch_schema.safeParse(raw_batch);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; ");
    return reject(log, { code: "invalid_batch", message, command_index: null, issues: [] });
  }
  const batch = parsed.data;
  if (batch.document_id !== doc.document_id) {
    return reject(log, { code: "document_mismatch", message: `batch is for document ${batch.document_id}, not ${doc.document_id}`, command_index: null, issues: [] });
  }
  if (doc.applied_batch_ids.includes(batch.batch_id)) {
    log.info("duplicate batch ignored", { batch_id: batch.batch_id, revision: doc.revision });
    return { ok: true, duplicate: true, doc, inverse: [] };
  }
  if (batch.expected_revision !== doc.revision) {
    return reject(log, { code: "stale_revision", message: `batch expects revision ${batch.expected_revision}, document is at ${doc.revision}`, command_index: null, issues: [] });
  }
  let working = doc;
  const inverse: Command[] = [];
  for (const [command_index, command] of batch.commands.entries()) {
    const step = apply_command(working, command);
    if (!step.ok) return reject(log, { code: step.code, message: step.message, command_index, issues: [] });
    working = step.doc;
    inverse.unshift(...step.inverse);
    log.debug("command applied", { batch_id: batch.batch_id, command_index, op: command.op, collection: command.collection });
  }
  const existing = new Set(validate_structure(doc).map(issue_key));
  const introduced = validate_structure(working).filter((issue) => !existing.has(issue_key(issue)));
  if (introduced.length > 0) {
    return reject(log, { code: "structural_errors_introduced", message: `${introduced.length} structural error(s) introduced`, command_index: null, issues: introduced });
  }
  const next = canonicalize_document({ ...working, revision: doc.revision + 1, applied_batch_ids: [...doc.applied_batch_ids, batch.batch_id] });
  log.info("batch applied", { batch_id: batch.batch_id, revision: next.revision, commands: batch.commands.length });
  return { ok: true, duplicate: false, doc: next, inverse };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./commands/builders.ts";
export * from "./commands/apply_command.ts";
export * from "./commands/apply_batch.ts";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): command log reducer with atomic, idempotent, revision-checked batches"
```

---

### Task 6: Synthetic milestone fixture and golden file

**Files:**
- Create: `packages/core/src/validate/review_state.ts` (only `make_review`, `field_value`, `latest_review`, `review_state`; needed by the fixture)
- Create: `packages/core/test/fixtures/synthetic_milestone.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/synthetic_milestone.test.ts`; generated `examples/synthetic_milestone/synthetic_milestone.loom.json`

**Interfaces:**
- Consumes: `apply_ok`, entity helpers, `build_index`, `canonical_json`.
- Produces: `ReviewState = "approved" | "rejected" | "stale" | "unreviewed"`, `field_value(index, entity_id, field): unknown`, `latest_review(doc, entity_id, field): Review | null`, `review_state(doc, index, entity_id, field): ReviewState`, `make_review(doc, index, { id, entity_id, field, status }): Review` (stores `canonical_json` of the current value and `doc.revision`).
- Produces: `build_synthetic_milestone(): LoomDocument`, `synthetic_asset_sha256`.
- Fixture facts relied on by Tasks 7 to 10: harnesses `h_engine` (ENGINE_SIDE) and `h_body` (BODY_SIDE); wires `w1`..`w8` labelled `W1`..`W8`; segment `seg_b1_x1` unmeasured; mating `m_x1_x2`; `J3` is SRS; `X2` housing unknown and its terminals candidate; `w2` spec changed after approval; `w7.ends` inferred and unreviewed.

- [ ] **Step 1: Implement review state helpers**

`packages/core/src/validate/review_state.ts`:
```ts
import { canonical_json } from "../model/canonical.ts";
import type { DocIndex } from "../model/doc_index.ts";
import type { LoomDocument, Review } from "../schema/document.ts";

export type ReviewState = "approved" | "rejected" | "stale" | "unreviewed";

export function field_value(index: DocIndex, entity_id: string, field: string): unknown {
  const ref = index.by_id.get(entity_id);
  return ref ? (ref.entity as Record<string, unknown>)[field] : undefined;
}

export function latest_review(doc: LoomDocument, entity_id: string, field: string): Review | null {
  let latest: Review | null = null;
  for (const r of doc.reviews) {
    if (r.entity_id !== entity_id || r.field !== field) continue;
    if (latest === null || r.revision > latest.revision || (r.revision === latest.revision && r.id > latest.id)) latest = r;
  }
  return latest;
}

// An approval only holds while the value is byte-identical (canonical json) to what was approved.
export function review_state(doc: LoomDocument, index: DocIndex, entity_id: string, field: string): ReviewState {
  const review = latest_review(doc, entity_id, field);
  if (review === null) return "unreviewed";
  if (canonical_json(field_value(index, entity_id, field)) !== review.reviewed_value_json) return "stale";
  return review.status;
}

export function make_review(
  doc: LoomDocument,
  index: DocIndex,
  input: { id: string; entity_id: string; field: string; status: "approved" | "rejected" },
): Review {
  return { ...input, reviewed_value_json: canonical_json(field_value(index, input.entity_id, input.field)), revision: doc.revision };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./validate/review_state.ts";
```

- [ ] **Step 2: Write the fixture builder**

`packages/core/test/fixtures/synthetic_milestone.ts`:
```ts
import { cmd_insert, cmd_update } from "../../src/commands/builders.ts";
import { build_index } from "../../src/model/doc_index.ts";
import { create_empty_document } from "../../src/model/empty_document.ts";
import type { LoomDocument } from "../../src/schema/document.ts";
import { make_review } from "../../src/validate/review_state.ts";
import { apply_ok } from "../helpers/apply.ts";
import {
  candidate, connector, contact, ground, harness, identified, node, part, segment, spec, splice,
  to_contact, to_ground, to_splice, unknown_part, wire,
} from "../helpers/entities.ts";

// sha256 of the text "loomsmith synthetic fixture asset"; the asset itself does not exist.
export const synthetic_asset_sha256 = "2482dd3f269bca15de96089d4caa5fccb1675ff10d978cf9acfb24f17bc2af32";

// Synthetic, not a real vehicle. Covers: splice, repeated colours, unmeasured segment, unknown wire spec,
// double-wire termination (J1:3), base/stripe colours, terminal/seal quantities, a mating across two
// harnesses, schematic-only wires, an SRS connector, inferred evidence and a stale approval.
export function build_synthetic_milestone(): LoomDocument {
  const E = "h_engine";
  const B = "h_body";
  const terminal = identified("p_terminal");
  const seal = identified("p_seal");
  let doc = create_empty_document("doc_synthetic_milestone", "SYNTHETIC MILESTONE (not a real vehicle)");
  doc = apply_ok(doc, [
    cmd_insert("harnesses", harness(E, "ENGINE_SIDE")),
    cmd_insert("harnesses", harness(B, "BODY_SIDE")),
    cmd_insert("parts", part("p_housing_3", "housing", "SYN-H3", "3-way housing (synthetic)")),
    cmd_insert("parts", part("p_housing_2", "housing", "SYN-H2", "2-way housing (synthetic)")),
    cmd_insert("parts", part("p_terminal", "terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)")),
    cmd_insert("parts", part("p_seal", "seal", "SYN-S1", "seal (synthetic)")),
    cmd_insert("parts", part("p_splice", "splice", "SYN-SP1", "splice crimp (synthetic)")),
    cmd_insert("connectors", connector("j1", E, "J1", ["1", "2", "3"], identified("p_housing_3"))),
    cmd_insert("connectors", connector("j2", E, "J2", ["1", "2"], identified("p_housing_2"))),
    cmd_insert("connectors", { ...connector("x1", E, "X1", ["1", "2"], identified("p_housing_2")), housing_gender: "male" }),
    cmd_insert("connectors", { ...connector("x2", B, "X2", ["1", "2"], unknown_part), housing_gender: "female" }),
    cmd_insert("connectors", { ...connector("j3", B, "J3", ["1", "2"], identified("p_housing_2")), safety_class: "srs" }),
    cmd_insert("contacts", contact("j1", "1", { terminal, seal })),
    cmd_insert("contacts", contact("j1", "2", { terminal, seal })),
    cmd_insert("contacts", contact("j1", "3", { terminal, seal, max_wire_ends: 2 })),
    cmd_insert("contacts", contact("j2", "1", { terminal })),
    cmd_insert("contacts", contact("j2", "2", { terminal })),
    cmd_insert("contacts", contact("x1", "1", { terminal })),
    cmd_insert("contacts", contact("x1", "2", { terminal })),
    cmd_insert("contacts", contact("x2", "1", { terminal: candidate("p_terminal") })),
    cmd_insert("contacts", contact("x2", "2", { terminal: candidate("p_terminal") })),
    cmd_insert("contacts", contact("j3", "1", { terminal })),
    cmd_insert("contacts", contact("j3", "2", { terminal })),
    cmd_insert("splices", splice("s1", E, "S1", identified("p_splice"))),
    cmd_insert("ground_points", ground("g1", E, "G1")),
    cmd_insert("nodes", node("n_j1", E, "connector", "j1")),
    cmd_insert("nodes", node("n_j2", E, "connector", "j2")),
    cmd_insert("nodes", node("n_x1", E, "connector", "x1")),
    cmd_insert("nodes", node("n_s1", E, "splice", "s1")),
    cmd_insert("nodes", node("n_g1", E, "ground", "g1")),
    cmd_insert("nodes", node("n_b1", E, "breakout", null)),
    cmd_insert("segments", segment("seg_j1_b1", E, "n_j1", "n_b1", 300, 5)),
    cmd_insert("segments", segment("seg_b1_s1", E, "n_b1", "n_s1", 120, 3)),
    cmd_insert("segments", segment("seg_s1_j2", E, "n_s1", "n_j2", 450, 5)),
    cmd_insert("segments", segment("seg_b1_x1", E, "n_b1", "n_x1", null, null)),
    cmd_insert("segments", segment("seg_b1_g1", E, "n_b1", "n_g1", 80, 2)),
    cmd_insert("wires", wire("w1", E, "W1", [to_contact("j1", "1"), to_splice("s1")], spec(0.5, "R"), ["seg_j1_b1", "seg_b1_s1"])),
    cmd_insert("wires", wire("w2", E, "W2", [to_splice("s1"), to_contact("j2", "1")], spec(0.5, "R"), ["seg_s1_j2"])),
    cmd_insert("wires", wire("w3", E, "W3", [to_splice("s1"), to_contact("x1", "1")], spec(0.5, "R"), ["seg_b1_s1", "seg_b1_x1"])),
    cmd_insert("wires", wire("w4", E, "W4", [to_contact("j1", "2"), to_ground("g1")], spec(0.85, "B"), ["seg_j1_b1", "seg_b1_g1"])),
    cmd_insert("wires", wire("w5", E, "W5", [to_contact("j1", "3"), to_contact("x1", "2")], spec(0.5, "G", ["W"]), ["seg_j1_b1", "seg_b1_x1"])),
    cmd_insert("wires", wire("w6", E, "W6", [to_contact("j1", "3"), to_contact("j2", "2")], spec(0.5, "G", ["W"]), ["seg_j1_b1", "seg_b1_s1", "seg_s1_j2"])),
    cmd_insert("wires", wire("w7", B, "W7", [to_contact("x2", "1"), to_contact("j3", "1")], spec(0.5, "R"), null)),
    cmd_insert("wires", wire("w8", B, "W8", [to_contact("x2", "2"), to_contact("j3", "2")], spec(null, null), null)),
    cmd_insert("matings", {
      id: "m_x1_x2",
      connector_a: "x1",
      connector_b: "x2",
      cavity_map: [{ cavity_a: "x1_c1", cavity_b: "x2_c1" }, { cavity_a: "x1_c2", cavity_b: "x2_c2" }],
    }),
    cmd_insert("assets", {
      id: "a_diagram",
      sha256: synthetic_asset_sha256,
      media_type: "application/pdf",
      blob_ref: "synthetic://fixture/diagram.pdf",
      title: "synthetic diagram placeholder (no real content)",
    }),
    cmd_insert("evidence", {
      id: "e_w7_ends",
      entity_id: "w7",
      field: "ends",
      origin: "inferred",
      source: { asset_id: "a_diagram", page_index: 0, bbox: [100, 200, 300, 220] },
      note: "synthetic example of an LLM-inferred connection",
    }),
    cmd_insert("evidence", { id: "e_seg_j1_b1_length", entity_id: "seg_j1_b1", field: "length", origin: "measured", source: null, note: "synthetic tape measurement" }),
    cmd_insert("view_positions", { id: "n_j1", x: 0, y: 0 }),
    cmd_insert("view_positions", { id: "n_b1", x: 300, y: 0 }),
  ], "b_build");
  const index = build_index(doc);
  doc = apply_ok(doc, [
    cmd_insert("reviews", make_review(doc, index, { id: "r_w1_spec", entity_id: "w1", field: "spec", status: "approved" })),
    cmd_insert("reviews", make_review(doc, index, { id: "r_w2_spec", entity_id: "w2", field: "spec", status: "approved" })),
  ], "b_review");
  doc = apply_ok(doc, [cmd_update("wires", "w2", { spec: spec(0.85, "R") })], "b_resize_w2");
  return doc;
}
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/synthetic_milestone.test.ts`:
```ts
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
```

- [ ] **Step 4: Run it twice (first run writes the golden file), then typecheck**

Run: `pnpm vitest run packages/core/test/synthetic_milestone.test.ts && pnpm vitest run packages/core/test/synthetic_milestone.test.ts && pnpm typecheck`
Expected: PASS both times; `examples/synthetic_milestone/synthetic_milestone.loom.json` exists and contains `"project": {` with label `SYNTHETIC MILESTONE (not a real vehicle)`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(core): synthetic milestone fixture built through commands, golden file"
```

---

### Task 7: Routes and lengths

**Files:**
- Create: `packages/core/src/derive/topology.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/topology.test.ts`

**Interfaces:**
- Consumes: `DocIndex`, `Wire`, `WireEnd`, fixture.
- Produces: `RouteStatus = "unrouted" | "open_end" | "missing_endpoint_node" | "not_contiguous" | "ok"`, `RouteAnalysis { wire_id; status; start_node_id: string | null; end_node_id: string | null; node_path: string[] }`, `LengthStatus = "known" | "unknown" | "unavailable"`, `LengthValue { status; nominal_mm: number | null; tol_mm: number | null; unknown_segment_ids: string[] }`, `endpoint_node_id(index, end): string | null`, `analyse_route(index, wire): RouteAnalysis`, `route_length(index, wire): LengthValue`, `cut_length(index, wire): LengthValue`, `round_mm(value): number`.
- Rules: status order is unrouted, then open_end, then missing_endpoint_node, then contiguity; tolerance is the worst-case sum and becomes null if any segment tolerance is null; an unmeasured segment makes the whole length unknown (never a partial sum).

- [ ] **Step 1: Write the failing test**

`packages/core/test/topology.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/topology.test.ts`
Expected: FAIL, cannot resolve `../src/derive/topology.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/derive/topology.ts`:
```ts
import type { DocIndex } from "../model/doc_index.ts";
import type { Wire, WireEnd } from "../schema/document.ts";

export type RouteStatus = "unrouted" | "open_end" | "missing_endpoint_node" | "not_contiguous" | "ok";

export interface RouteAnalysis {
  wire_id: string;
  status: RouteStatus;
  start_node_id: string | null;
  end_node_id: string | null;
  node_path: string[];
}

export type LengthStatus = "known" | "unknown" | "unavailable";

export interface LengthValue {
  status: LengthStatus;
  nominal_mm: number | null;
  tol_mm: number | null;
  unknown_segment_ids: string[];
}

export function round_mm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function endpoint_node_id(index: DocIndex, end: WireEnd): string | null {
  let ref_id: string | null;
  switch (end.kind) {
    case "contact":
      ref_id = index.contacts.get(end.contact_id)?.connector_id ?? null;
      break;
    case "splice":
      ref_id = end.splice_id;
      break;
    case "ground_point":
      ref_id = end.ground_point_id;
      break;
    case "open":
      return null;
  }
  if (ref_id === null) return null;
  return index.nodes_by_ref.get(ref_id)?.[0]?.id ?? null;
}

export function analyse_route(index: DocIndex, wire: Wire): RouteAnalysis {
  const result = (status: RouteStatus, start: string | null, finish: string | null, node_path: string[]): RouteAnalysis => ({
    wire_id: wire.id, status, start_node_id: start, end_node_id: finish, node_path,
  });
  if (wire.route === null) return result("unrouted", null, null, []);
  if (wire.ends[0].kind === "open" || wire.ends[1].kind === "open") return result("open_end", null, null, []);
  const start = endpoint_node_id(index, wire.ends[0]);
  const finish = endpoint_node_id(index, wire.ends[1]);
  if (start === null || finish === null) return result("missing_endpoint_node", start, finish, []);
  let current = start;
  const node_path = [start];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (seg && seg.node_a === current) current = seg.node_b;
    else if (seg && seg.node_b === current) current = seg.node_a;
    else return result("not_contiguous", start, finish, node_path);
    node_path.push(current);
  }
  return result(current === finish ? "ok" : "not_contiguous", start, finish, node_path);
}

const unavailable: LengthValue = { status: "unavailable", nominal_mm: null, tol_mm: null, unknown_segment_ids: [] };

export function route_length(index: DocIndex, wire: Wire): LengthValue {
  if (analyse_route(index, wire).status !== "ok" || wire.route === null) return { ...unavailable, unknown_segment_ids: [] };
  let nominal = 0;
  let tol: number | null = 0;
  const unknown: string[] = [];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (!seg) continue;
    if (seg.length.nominal_mm === null) unknown.push(seg.id);
    else nominal += seg.length.nominal_mm;
    tol = tol === null || seg.length.tol_mm === null ? null : tol + seg.length.tol_mm;
  }
  if (unknown.length > 0) return { status: "unknown", nominal_mm: null, tol_mm: null, unknown_segment_ids: unknown };
  return { status: "known", nominal_mm: round_mm(nominal), tol_mm: tol === null ? null : round_mm(tol), unknown_segment_ids: [] };
}

export function cut_length(index: DocIndex, wire: Wire): LengthValue {
  const route = route_length(index, wire);
  if (route.status !== "known" || route.nominal_mm === null) return route;
  const a = wire.allowances;
  return { ...route, nominal_mm: round_mm(route.nominal_mm + a.end_a_mm + a.end_b_mm + a.service_mm) };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./derive/topology.ts";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): route analysis and cut lengths that never guess unknown segments"
```

---

### Task 8: Completeness validation and review warnings

**Files:**
- Create: `packages/core/src/model/scope.ts`, `packages/core/src/validate/completeness.ts`, `packages/core/src/validate/validate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/completeness.test.ts`

**Interfaces:**
- Consumes: `analyse_route`, `route_length`, `review_state`, `latest_review`, `make_review`, `entity_path`, `sort_issues`.
- Produces: `ScopeOptions { harness_ids: readonly string[] | null }`, `all_harnesses`, `in_scope(options, harness_id)`; `validate_completeness(doc, options?, index?): Issue[]`; `ValidationLevel = "structural" | "build"`; `validate(doc, { level, harness_ids }, log?): Issue[]`; `is_release_ready(issues): boolean`.
- Completeness codes (error): `M_WIRE_END_OPEN, M_WIRE_SPEC_UNKNOWN, M_WIRE_UNROUTED, M_ENDPOINT_NODE_MISSING, M_ROUTE_NOT_CONTIGUOUS, M_LENGTH_UNKNOWN, M_PART_UNIDENTIFIED`. Warnings: `W_INFERRED_UNREVIEWED, W_REVIEW_STALE`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/completeness.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cmd_insert, cmd_update } from "../src/commands/builders.ts";
import { build_index } from "../src/model/doc_index.ts";
import { validate_completeness } from "../src/validate/completeness.ts";
import { make_review, review_state } from "../src/validate/review_state.ts";
import { is_release_ready, validate } from "../src/validate/validate.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { apply_ok } from "./helpers/apply.ts";
import { to_contact } from "./helpers/entities.ts";

describe("completeness validation", () => {
  it("lists exactly what blocks a build of the fixture", () => {
    const issues = validate(build_synthetic_milestone(), { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.entity_id}`)).toEqual([
      "M_LENGTH_UNKNOWN:w3",
      "M_LENGTH_UNKNOWN:w5",
      "M_PART_UNIDENTIFIED:x2_k1",
      "M_PART_UNIDENTIFIED:x2_k2",
      "M_PART_UNIDENTIFIED:x2",
      "M_WIRE_SPEC_UNKNOWN:w8",
      "M_WIRE_UNROUTED:w7",
      "M_WIRE_UNROUTED:w8",
      "W_INFERRED_UNREVIEWED:w7",
      "W_REVIEW_STALE:w2",
    ]);
    expect(is_release_ready(issues)).toBe(false);
  });

  it("structural level ignores completeness", () => {
    expect(validate(build_synthetic_milestone(), { level: "structural", harness_ids: null })).toEqual([]);
  });

  it("scopes wire and part checks to the selected harnesses", () => {
    const errors = validate_completeness(build_synthetic_milestone(), { harness_ids: ["h_engine"] }).filter((i) => i.severity === "error");
    expect(errors.map((issue) => issue.entity_id)).toEqual(["w3", "w5"]);
  });

  it("tracks approval separately from origin and invalidates it on change", () => {
    const doc = build_synthetic_milestone();
    const index = build_index(doc);
    expect(review_state(doc, index, "w1", "spec")).toBe("approved");
    expect(review_state(doc, index, "w2", "spec")).toBe("stale");
    expect(review_state(doc, index, "w7", "ends")).toBe("unreviewed");

    const approved = apply_ok(doc, [
      cmd_insert("reviews", make_review(doc, index, { id: "r_w7_ends", entity_id: "w7", field: "ends", status: "approved" })),
    ], "b_approve_w7");
    expect(validate_completeness(approved).map((issue) => issue.code)).not.toContain("W_INFERRED_UNREVIEWED");

    const changed = apply_ok(approved, [cmd_update("wires", "w7", { ends: [to_contact("j3", "1"), to_contact("x2", "1")] })], "b_swap_w7");
    expect(review_state(changed, build_index(changed), "w7", "ends")).toBe("stale");
    expect(validate_completeness(changed).map((issue) => issue.code)).toContain("W_INFERRED_UNREVIEWED");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/completeness.test.ts`
Expected: FAIL, cannot resolve `../src/validate/completeness.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/model/scope.ts`:
```ts
export interface ScopeOptions {
  harness_ids: readonly string[] | null;
}

export const all_harnesses: ScopeOptions = { harness_ids: null };

export function in_scope(options: ScopeOptions, harness_id: string): boolean {
  return options.harness_ids === null || options.harness_ids.includes(harness_id);
}
```

`packages/core/src/validate/completeness.ts`:
```ts
import { analyse_route, route_length } from "../derive/topology.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { entity_path, sort_issues, type Issue, type IssueSeverity } from "./issue.ts";
import { latest_review, review_state } from "./review_state.ts";

type Emit = (code: string, severity: IssueSeverity, message: string, path: string, entity_id: string, hint: string) => void;

export function validate_completeness(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): Issue[] {
  const issues: Issue[] = [];
  const emit: Emit = (code, severity, message, path, entity_id, hint) => {
    issues.push({ code, level: "completeness", severity, message, path, entity_id, hint });
  };
  check_wires(doc, index, options, emit);
  check_parts(doc, index, options, emit);
  check_reviews(doc, index, emit);
  return sort_issues(issues);
}

function check_wires(doc: LoomDocument, index: DocIndex, options: ScopeOptions, emit: Emit): void {
  for (const w of doc.wires) {
    if (!in_scope(options, w.harness_id)) continue;
    w.ends.forEach((end, i) => {
      if (end.kind === "open") emit("M_WIRE_END_OPEN", "error", `${w.label} end ${i} is not terminated`, entity_path("wires", w.id, "ends", i), w.id, "attach the end to a contact, splice or ground point");
    });
    if (w.spec.cross_section_mm2 === null || w.spec.base_colour === null) {
      emit("M_WIRE_SPEC_UNKNOWN", "error", `${w.label} has an unknown size or colour`, entity_path("wires", w.id, "spec"), w.id, "measure or look up the wire size and colour");
    }
    const route_path = entity_path("wires", w.id, "route");
    switch (analyse_route(index, w).status) {
      case "unrouted":
        emit("M_WIRE_UNROUTED", "error", `${w.label} has no physical route`, route_path, w.id, "route the wire through measured bundle segments");
        break;
      case "missing_endpoint_node":
        emit("M_ENDPOINT_NODE_MISSING", "error", `an end of ${w.label} has no topology node`, route_path, w.id, "add a node for each connector, splice and ground point on the loom");
        break;
      case "not_contiguous":
        emit("M_ROUTE_NOT_CONTIGUOUS", "error", `the route of ${w.label} does not join its two ends`, route_path, w.id, "list segments in order from end A to end B");
        break;
      case "ok": {
        const length = route_length(index, w);
        if (length.status === "unknown") {
          emit("M_LENGTH_UNKNOWN", "error", `${w.label} crosses unmeasured segment(s) ${length.unknown_segment_ids.join(", ")}`, route_path, w.id, "measure the listed bundle segments");
        }
        break;
      }
      case "open_end":
        break;
    }
  }
}

function check_parts(doc: LoomDocument, index: DocIndex, options: ScopeOptions, emit: Emit): void {
  const check = (use: PartUse, what: string, owner_label: string, path: string, entity_id: string): void => {
    if (use.identification !== "identified") {
      emit("M_PART_UNIDENTIFIED", "error", `${what} part of ${owner_label} is ${use.identification}`, path, entity_id, "identify the manufacturer part number");
    }
  };
  for (const c of doc.connectors) {
    if (in_scope(options, c.harness_id)) check(c.housing, "housing", c.label, entity_path("connectors", c.id, "housing"), c.id);
  }
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner || !in_scope(options, owner.harness_id)) continue;
    check(k.terminal, "terminal", owner.label, entity_path("contacts", k.id, "terminal"), k.id);
    if (k.seal !== null) check(k.seal, "seal", owner.label, entity_path("contacts", k.id, "seal"), k.id);
  }
  for (const s of doc.splices) {
    if (in_scope(options, s.harness_id)) check(s.part, "splice", s.label, entity_path("splices", s.id, "part"), s.id);
  }
}

function check_reviews(doc: LoomDocument, index: DocIndex, emit: Emit): void {
  for (const e of doc.evidence) {
    if (e.origin === "inferred" && review_state(doc, index, e.entity_id, e.field) !== "approved") {
      emit("W_INFERRED_UNREVIEWED", "warning", `${e.entity_id}.${e.field} is inferred and not approved`, entity_path("evidence", e.id), e.entity_id, "check the value against its source and approve it");
    }
  }
  for (const r of doc.reviews) {
    if (latest_review(doc, r.entity_id, r.field)?.id === r.id && review_state(doc, index, r.entity_id, r.field) === "stale") {
      emit("W_REVIEW_STALE", "warning", `${r.entity_id}.${r.field} changed after it was reviewed`, entity_path("reviews", r.id), r.entity_id, "review the new value");
    }
  }
}
```

`packages/core/src/validate/validate.ts`:
```ts
import { null_logger, type Logger } from "../log.ts";
import { build_index } from "../model/doc_index.ts";
import type { LoomDocument } from "../schema/document.ts";
import { validate_completeness } from "./completeness.ts";
import { sort_issues, type Issue } from "./issue.ts";
import { validate_structure } from "./structural.ts";

export type ValidationLevel = "structural" | "build";

export function validate(
  doc: LoomDocument,
  options: { level: ValidationLevel; harness_ids: readonly string[] | null },
  log: Logger = null_logger,
): Issue[] {
  const index = build_index(doc);
  const structural = validate_structure(doc, index);
  const completeness = options.level === "build" ? validate_completeness(doc, { harness_ids: options.harness_ids }, index) : [];
  log.debug("document validated", { level: options.level, structural: structural.length, completeness: completeness.length });
  return sort_issues([...structural, ...completeness]);
}

export function is_release_ready(issues: readonly Issue[]): boolean {
  return !issues.some((issue) => issue.severity === "error");
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./model/scope.ts";
export * from "./validate/completeness.ts";
export * from "./validate/validate.ts";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): build completeness checks and review-state warnings"
```

---

### Task 9: Nets and bench test data

**Files:**
- Create: `packages/core/src/derive/nets.ts`, `packages/core/src/derive/test_data.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/nets_test_data.test.ts`

**Interfaces:**
- Consumes: `build_index`, `endpoint_key`, `cavity_key`, `push_to`, `compare_strings`.
- Produces: `MatingState = "connected" | "disconnected"`, `NetOptions { harness_ids: readonly string[] | null; mating_states: Readonly<Record<string, MatingState>>; default_mating_state: MatingState }`, `Net { net_id; endpoint_keys: string[]; wire_ids: string[] }`, `derive_nets(doc, options, index?): Net[]` (net_id = smallest endpoint key; sorted by net_id).
- Produces: `TestBoundary { harness_ids: readonly string[]; mating_states; excluded_connector_ids: readonly string[]; include_srs: boolean }`, `TestNet { net_id; points: string[] }`, `ContinuityCheck { net_id; from; to }`, `IsolationCheck { net_a; net_b; point_a; point_b }`, `TestData { boundary; nets; continuity; isolation; excluded_points }`, `derive_test_data(doc, boundary, index?): TestData`.
- Rules: unlisted matings default to disconnected on the bench; splices are not test points; connectors mated (connected) inside the boundary are not test points; SRS connectors are excluded unless `include_srs`; continuity is a star from the first point of each net; isolation compares the first point of every pair of nets.

- [ ] **Step 1: Write the failing test**

`packages/core/test/nets_test_data.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { derive_nets } from "../src/derive/nets.ts";
import { derive_test_data } from "../src/derive/test_data.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";

const doc = build_synthetic_milestone();

describe("nets", () => {
  it("joins wires through splices and connected matings", () => {
    expect(derive_nets(doc, { harness_ids: null, mating_states: {}, default_mating_state: "connected" })).toEqual([
      {
        net_id: "contact:j1_k1",
        endpoint_keys: ["contact:j1_k1", "contact:j2_k1", "contact:j3_k1", "contact:x1_k1", "contact:x2_k1", "splice:s1"],
        wire_ids: ["w1", "w2", "w3", "w7"],
      },
      { net_id: "contact:j1_k2", endpoint_keys: ["contact:j1_k2", "ground_point:g1"], wire_ids: ["w4"] },
      {
        net_id: "contact:j1_k3",
        endpoint_keys: ["contact:j1_k3", "contact:j2_k2", "contact:j3_k2", "contact:x1_k2", "contact:x2_k2"],
        wire_ids: ["w5", "w6", "w8"],
      },
    ]);
  });

  it("keeps harnesses apart when their mating is disconnected", () => {
    const nets = derive_nets(doc, { harness_ids: null, mating_states: { m_x1_x2: "disconnected" }, default_mating_state: "connected" });
    expect(nets.map((net) => net.net_id)).toEqual(["contact:j1_k1", "contact:j1_k2", "contact:j1_k3", "contact:j3_k1", "contact:j3_k2"]);
  });
});

describe("bench test data", () => {
  it("builds continuity and isolation checks for one harness", () => {
    const data = derive_test_data(doc, { harness_ids: ["h_engine"], mating_states: {}, excluded_connector_ids: [], include_srs: false });
    expect(data.nets).toEqual([
      { net_id: "contact:j1_k1", points: ["J1:1", "J2:1", "X1:1"] },
      { net_id: "contact:j1_k2", points: ["G1", "J1:2"] },
      { net_id: "contact:j1_k3", points: ["J1:3", "J2:2", "X1:2"] },
    ]);
    expect(data.continuity).toEqual([
      { net_id: "contact:j1_k1", from: "J1:1", to: "J2:1" },
      { net_id: "contact:j1_k1", from: "J1:1", to: "X1:1" },
      { net_id: "contact:j1_k2", from: "G1", to: "J1:2" },
      { net_id: "contact:j1_k3", from: "J1:3", to: "J2:2" },
      { net_id: "contact:j1_k3", from: "J1:3", to: "X1:2" },
    ]);
    expect(data.isolation).toEqual([
      { net_a: "contact:j1_k1", net_b: "contact:j1_k2", point_a: "J1:1", point_b: "G1" },
      { net_a: "contact:j1_k1", net_b: "contact:j1_k3", point_a: "J1:1", point_b: "J1:3" },
      { net_a: "contact:j1_k2", net_b: "contact:j1_k3", point_a: "G1", point_b: "J1:3" },
    ]);
    expect(data.excluded_points).toEqual([]);
  });

  it("hides mated connectors and excludes SRS by default", () => {
    const data = derive_test_data(doc, {
      harness_ids: ["h_engine", "h_body"], mating_states: { m_x1_x2: "connected" }, excluded_connector_ids: [], include_srs: false,
    });
    expect(data.nets).toEqual([
      { net_id: "contact:j1_k1", points: ["J1:1", "J2:1"] },
      { net_id: "contact:j1_k2", points: ["G1", "J1:2"] },
      { net_id: "contact:j1_k3", points: ["J1:3", "J2:2"] },
    ]);
    expect(data.excluded_points).toEqual(["J3:1", "J3:2"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/nets_test_data.test.ts`
Expected: FAIL, cannot resolve `../src/derive/nets.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/derive/nets.ts`:
```ts
import { compare_strings } from "../model/canonical.ts";
import { build_index, cavity_key, endpoint_key, push_to, type DocIndex } from "../model/doc_index.ts";
import type { LoomDocument } from "../schema/document.ts";

export type MatingState = "connected" | "disconnected";

export interface NetOptions {
  harness_ids: readonly string[] | null;
  mating_states: Readonly<Record<string, MatingState>>;
  default_mating_state: MatingState;
}

export interface Net {
  net_id: string;
  endpoint_keys: string[];
  wire_ids: string[];
}

function make_union_find() {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key);
    if (up === undefined) {
      parent.set(key, key);
      return key;
    }
    if (up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const root_a = find(a);
    const root_b = find(b);
    if (root_a === root_b) return;
    if (root_a < root_b) parent.set(root_b, root_a);
    else parent.set(root_a, root_b);
  };
  return { find, union, keys: (): string[] => [...parent.keys()] };
}

export function derive_nets(doc: LoomDocument, options: NetOptions, index: DocIndex = build_index(doc)): Net[] {
  const uf = make_union_find();
  const scope = (harness_id: string): boolean => options.harness_ids === null || options.harness_ids.includes(harness_id);
  const wires = doc.wires.filter((w) => scope(w.harness_id));
  for (const w of wires) {
    const a = endpoint_key(w.ends[0]);
    const b = endpoint_key(w.ends[1]);
    if (a !== null) uf.find(a);
    if (b !== null) uf.find(b);
    if (a !== null && b !== null) uf.union(a, b);
  }
  for (const m of doc.matings) {
    if ((options.mating_states[m.id] ?? options.default_mating_state) !== "connected") continue;
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (!a || !b || !scope(a.harness_id) || !scope(b.harness_id)) continue;
    for (const pair of m.cavity_map) {
      const contact_a = index.contacts_by_cavity.get(cavity_key(a.id, pair.cavity_a))?.[0];
      const contact_b = index.contacts_by_cavity.get(cavity_key(b.id, pair.cavity_b))?.[0];
      if (contact_a && contact_b) uf.union(`contact:${contact_a.id}`, `contact:${contact_b.id}`);
    }
  }
  const members = new Map<string, string[]>();
  for (const key of uf.keys()) push_to(members, uf.find(key), key);
  const wire_ids = new Map<string, string[]>();
  for (const w of wires) {
    const key = endpoint_key(w.ends[0]) ?? endpoint_key(w.ends[1]);
    if (key !== null) push_to(wire_ids, uf.find(key), w.id);
  }
  return [...members.entries()]
    .map(([root, keys]) => {
      const endpoint_keys = [...keys].sort();
      return { net_id: endpoint_keys[0] ?? root, endpoint_keys, wire_ids: [...(wire_ids.get(root) ?? [])].sort() };
    })
    .sort((x, y) => compare_strings(x.net_id, y.net_id));
}
```

`packages/core/src/derive/test_data.ts`:
```ts
import { build_index, type DocIndex } from "../model/doc_index.ts";
import type { LoomDocument } from "../schema/document.ts";
import { derive_nets, type MatingState } from "./nets.ts";

export interface TestBoundary {
  harness_ids: readonly string[];
  mating_states: Readonly<Record<string, MatingState>>;
  excluded_connector_ids: readonly string[];
  include_srs: boolean;
}

export interface TestNet {
  net_id: string;
  points: string[];
}

export interface ContinuityCheck {
  net_id: string;
  from: string;
  to: string;
}

export interface IsolationCheck {
  net_a: string;
  net_b: string;
  point_a: string;
  point_b: string;
}

export interface TestData {
  boundary: TestBoundary;
  nets: TestNet[];
  continuity: ContinuityCheck[];
  isolation: IsolationCheck[];
  excluded_points: string[];
}

export function derive_test_data(doc: LoomDocument, boundary: TestBoundary, index: DocIndex = build_index(doc)): TestData {
  const nets = derive_nets(doc, { harness_ids: boundary.harness_ids, mating_states: boundary.mating_states, default_mating_state: "disconnected" }, index);
  const scope = (harness_id: string): boolean => boundary.harness_ids.includes(harness_id);
  const mated = new Set<string>();
  for (const m of doc.matings) {
    if ((boundary.mating_states[m.id] ?? "disconnected") !== "connected") continue;
    const a = index.connectors.get(m.connector_a);
    const b = index.connectors.get(m.connector_b);
    if (a && b && scope(a.harness_id) && scope(b.harness_id)) {
      mated.add(a.id);
      mated.add(b.id);
    }
  }
  const excluded = new Set<string>();
  const point_label = (key: string): string | null => {
    if (key.startsWith("contact:")) {
      const k = index.contacts.get(key.slice("contact:".length));
      const owner = k ? index.connectors.get(k.connector_id) : undefined;
      if (!k || !owner || !scope(owner.harness_id) || mated.has(owner.id)) return null;
      const label = `${owner.label}:${owner.cavities.find((cavity) => cavity.id === k.cavity_id)?.label ?? k.cavity_id}`;
      if (boundary.excluded_connector_ids.includes(owner.id) || (owner.safety_class === "srs" && !boundary.include_srs)) {
        excluded.add(label);
        return null;
      }
      return label;
    }
    if (key.startsWith("ground_point:")) {
      const g = index.ground_points.get(key.slice("ground_point:".length));
      return g && scope(g.harness_id) ? g.label : null;
    }
    return null;
  };
  const test_nets: TestNet[] = [];
  for (const net of nets) {
    const points = net.endpoint_keys.map(point_label).filter((p): p is string => p !== null).sort();
    if (points.length > 0) test_nets.push({ net_id: net.net_id, points });
  }
  const continuity: ContinuityCheck[] = [];
  for (const net of test_nets) {
    const [first, ...rest] = net.points;
    if (first === undefined) continue;
    for (const to of rest) continuity.push({ net_id: net.net_id, from: first, to });
  }
  const isolation: IsolationCheck[] = [];
  test_nets.forEach((a, i) => {
    for (const b of test_nets.slice(i + 1)) {
      const point_a = a.points[0];
      const point_b = b.points[0];
      if (point_a !== undefined && point_b !== undefined) isolation.push({ net_a: a.net_id, net_b: b.net_id, point_a, point_b });
    }
  });
  return { boundary, nets: test_nets, continuity, isolation, excluded_points: [...excluded].sort() };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./derive/nets.ts";
export * from "./derive/test_data.ts";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): nets with mating states and bench continuity/isolation data"
```

---

### Task 10: Wire list and BOM

**Files:**
- Create: `packages/core/src/derive/wire_list.ts`, `packages/core/src/derive/bom.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/wire_list_bom.test.ts`

**Interfaces:**
- Consumes: `analyse_route`, `cut_length`, `round_mm`, `ScopeOptions`, `in_scope`, `all_harnesses`, `compare_strings`.
- Produces: `WireListRow { wire_id; harness_label; wire_label; from; to; cross_section_mm2: number | null; designation: string | null; colour: string; route_status: RouteStatus; cut_length: LengthValue }`, `end_label(index, end): string` (`"J1:1"`, splice/ground label, `"OPEN"`), `colour_code(spec): string` (`"G-W"`, `"UNKNOWN"`), `derive_wire_list(doc, options?, index?): WireListRow[]` sorted by harness label then wire label.
- Produces: `BomCategory = "housing" | "terminal" | "seal" | "splice" | "wire"`, `BomLine { category; part_id: string | null; part_number: string | null; description; quantity: number; unit: "pcs" | "mm"; unknown_quantity: number; identification: string }`, `derive_bom(doc, options?, index?): BomLine[]` sorted by category, description, identification. Wire lines sum known cut lengths and count wires with unknown or unavailable length in `unknown_quantity`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/wire_list_bom.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { derive_bom } from "../src/derive/bom.ts";
import { derive_wire_list } from "../src/derive/wire_list.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";

const doc = build_synthetic_milestone();

describe("wire list", () => {
  it("lists wires with end labels, colours and cut lengths", () => {
    const rows = derive_wire_list(doc);
    expect(rows.map((row) => row.wire_label)).toEqual(["W7", "W8", "W1", "W2", "W3", "W4", "W5", "W6"]);
    expect(rows[2]).toEqual({
      wire_id: "w1", harness_label: "ENGINE_SIDE", wire_label: "W1", from: "J1:1", to: "S1",
      cross_section_mm2: 0.5, designation: "0.5 mm2", colour: "R", route_status: "ok",
      cut_length: { status: "known", nominal_mm: 460, tol_mm: 8, unknown_segment_ids: [] },
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
    const line = (category: string, part_id: string | null, part_number: string | null, description: string, quantity: number, identification: string, unit = "pcs", unknown_quantity = 0) =>
      ({ category, part_id, part_number, description, quantity, unit, unknown_quantity, identification });
    expect(derive_bom(doc)).toEqual([
      line("housing", "p_housing_2", "SYN-H2", "2-way housing (synthetic)", 3, "identified"),
      line("housing", "p_housing_3", "SYN-H3", "3-way housing (synthetic)", 1, "identified"),
      line("housing", null, null, "UNIDENTIFIED housing", 1, "unknown"),
      line("terminal", "p_terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)", 2, "candidate"),
      line("terminal", "p_terminal", "SYN-T1", "terminal 0.3-0.85 mm2 (synthetic)", 9, "identified"),
      line("seal", "p_seal", "SYN-S1", "seal (synthetic)", 3, "identified"),
      line("splice", "p_splice", "SYN-SP1", "splice crimp (synthetic)", 1, "identified"),
      line("wire", null, null, "0.5 mm2 G-W", 910, "n/a", "mm", 1),
      line("wire", null, null, "0.5 mm2 R", 460, "n/a", "mm", 2),
      line("wire", null, null, "0.85 mm2 B", 420, "n/a", "mm", 0),
      line("wire", null, null, "0.85 mm2 R", 490, "n/a", "mm", 0),
      line("wire", null, null, "UNKNOWN mm2 UNKNOWN", 0, "n/a", "mm", 1),
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/test/wire_list_bom.test.ts`
Expected: FAIL, cannot resolve `../src/derive/bom.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/derive/wire_list.ts`:
```ts
import { compare_strings } from "../model/canonical.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument, WireEnd, WireSpec } from "../schema/document.ts";
import { analyse_route, cut_length, type LengthValue, type RouteStatus } from "./topology.ts";

export interface WireListRow {
  wire_id: string;
  harness_label: string;
  wire_label: string;
  from: string;
  to: string;
  cross_section_mm2: number | null;
  designation: string | null;
  colour: string;
  route_status: RouteStatus;
  cut_length: LengthValue;
}

export function end_label(index: DocIndex, end: WireEnd): string {
  switch (end.kind) {
    case "contact": {
      const k = index.contacts.get(end.contact_id);
      const owner = k ? index.connectors.get(k.connector_id) : undefined;
      if (!k || !owner) return `MISSING(${end.contact_id})`;
      return `${owner.label}:${owner.cavities.find((cavity) => cavity.id === k.cavity_id)?.label ?? k.cavity_id}`;
    }
    case "splice":
      return index.splices.get(end.splice_id)?.label ?? `MISSING(${end.splice_id})`;
    case "ground_point":
      return index.ground_points.get(end.ground_point_id)?.label ?? `MISSING(${end.ground_point_id})`;
    case "open":
      return "OPEN";
  }
}

export function colour_code(spec: WireSpec): string {
  return spec.base_colour === null ? "UNKNOWN" : [spec.base_colour, ...spec.stripe_colours].join("-");
}

export function derive_wire_list(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): WireListRow[] {
  return doc.wires
    .filter((w) => in_scope(options, w.harness_id))
    .map((w) => ({
      wire_id: w.id,
      harness_label: index.harnesses.get(w.harness_id)?.label ?? w.harness_id,
      wire_label: w.label,
      from: end_label(index, w.ends[0]),
      to: end_label(index, w.ends[1]),
      cross_section_mm2: w.spec.cross_section_mm2,
      designation: w.spec.designation,
      colour: colour_code(w.spec),
      route_status: analyse_route(index, w).status,
      cut_length: cut_length(index, w),
    }))
    .sort((a, b) => compare_strings(a.harness_label, b.harness_label) || compare_strings(a.wire_label, b.wire_label));
}
```

`packages/core/src/derive/bom.ts`:
```ts
import { compare_strings } from "../model/canonical.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { cut_length, round_mm } from "./topology.ts";
import { colour_code } from "./wire_list.ts";

export type BomCategory = "housing" | "terminal" | "seal" | "splice" | "wire";

export interface BomLine {
  category: BomCategory;
  part_id: string | null;
  part_number: string | null;
  description: string;
  quantity: number;
  unit: "pcs" | "mm";
  unknown_quantity: number;
  identification: string;
}

const category_order: Record<BomCategory, number> = { housing: 0, terminal: 1, seal: 2, splice: 3, wire: 4 };

export function derive_bom(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add_part = (category: BomCategory, use: PartUse): void => {
    const key = `${category}|${use.part_id ?? "unidentified"}|${use.identification}`;
    const existing = lines.get(key);
    if (existing) {
      existing.quantity += 1;
      return;
    }
    const found = use.part_id === null ? undefined : index.parts.get(use.part_id);
    lines.set(key, {
      category,
      part_id: use.part_id,
      part_number: found?.part_number ?? null,
      description: found?.description ?? found?.part_number ?? use.part_id ?? `UNIDENTIFIED ${category}`,
      quantity: 1,
      unit: "pcs",
      unknown_quantity: 0,
      identification: use.identification,
    });
  };
  for (const c of doc.connectors) if (in_scope(options, c.harness_id)) add_part("housing", c.housing);
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner || !in_scope(options, owner.harness_id)) continue;
    add_part("terminal", k.terminal);
    if (k.seal !== null) add_part("seal", k.seal);
  }
  for (const s of doc.splices) if (in_scope(options, s.harness_id)) add_part("splice", s.part);
  for (const w of doc.wires) {
    if (!in_scope(options, w.harness_id)) continue;
    const description = `${w.spec.cross_section_mm2 ?? "UNKNOWN"} mm2 ${colour_code(w.spec)}${w.spec.insulation === null ? "" : ` ${w.spec.insulation}`}`;
    const key = `wire|${description}`;
    const line = lines.get(key) ?? { category: "wire" as const, part_id: null, part_number: null, description, quantity: 0, unit: "mm" as const, unknown_quantity: 0, identification: "n/a" };
    const length = cut_length(index, w);
    if (length.status === "known" && length.nominal_mm !== null) line.quantity = round_mm(line.quantity + length.nominal_mm);
    else line.unknown_quantity += 1;
    lines.set(key, line);
  }
  return [...lines.values()].sort(
    (a, b) => category_order[a.category] - category_order[b.category] || compare_strings(a.description, b.description) || compare_strings(a.identification, b.identification),
  );
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./derive/wire_list.ts";
export * from "./derive/bom.ts";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm check`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): wire list and bill of materials with visible unknowns"
```

---

### Task 11: Documentation, review and hand-off

**Files:**
- Create: `docs/data_model.md`
- Modify: `docs/c4model.md`, `docs/index.md`, `docs/27092026_loomsmith_plan.md` (Status), `todo.md`

- [ ] **Step 1: Write `docs/data_model.md` (Category: Reference)**

Sections, with content taken from the implemented code:
1. Scope and last verified date.
2. File format: `format`, `schema_version` (1), `document_id`, `revision`, `applied_batch_ids`, the 14 collections in `collection_names` order, canonical ordering rules, id rules (opaque, unique across collections except `view_positions`, labels separate), unit rules (`null` means unknown).
3. Entities: one table row per collection with its fields (from `packages/core/src/schema/document.ts`).
4. Evidence and review: origin vs review status, `reviewed_value_json`, stale rule.
5. Command log: `insert` / `update` / `delete`, `expect` and `expect_entity` preconditions, inverses, batch fields, idempotency, stale revision rejection, no cascading deletes in M1, `structural_errors_introduced`.
6. Validation codes: table of every `S_*`, `M_*`, `W_*` code with level, severity and meaning.
7. Derivations: route status order, length rules, nets, bench boundary rules, wire list, BOM.

- [ ] **Step 2: Update `docs/c4model.md`, `docs/index.md`, `todo.md` and this plan's Status**

- `c4model.md`: mark `packages/core` components as implemented (M1) and add `model/scope.ts`; note that other containers are not built yet.
- `index.md`: add a row for `data_model.md` (Reference).
- `todo.md`: tick M0 and M1 items.

- [ ] **Step 3: Full verification**

Run: `cd /Users/macmini/projects/loomsmith && CI=true pnpm check`
Expected: typecheck clean; every test file PASS; no snapshot written (CI mode fails on missing snapshots).

Run:
```bash
for p in 'Date.now()' 'new Date($$$)' 'Math.random()' 'crypto.$F($$$)' 'performance.now()'; do ast-grep run --lang ts -p "$p" packages/core/src; done; echo "purity scan done"
```
Expected: only `purity scan done` is printed (no matches). `node:` imports and DOM globals are already rejected by `packages/core/tsconfig.json` (`types: []`, `lib: ["ES2023"]`).

- [ ] **Step 4: Codex review of the branch**

```bash
cd /Users/macmini/projects/loomsmith && codex exec --skip-git-repo-check -c 'model="gpt-6-astra"' -c 'approval_policy="never"' -s read-only \
  -o /Users/macmini/projects/codex/loomsmith_m1_core_review_27092026.txt - <<'PROMPT'
Review the loomsmith M1 core on branch feat/m0_m1_core in /Users/macmini/projects/loomsmith (read-only).
Spec: docs/27092026_loomsmith_design.md; plan: docs/27092026_loomsmith_plan.md; code: packages/core/src; tests: packages/core/test.
Report correctness bugs, spec deviations, determinism or purity leaks, and missing tests, prioritized, with file:line.
PROMPT
```
Apply confirmed findings with a failing test first, rerun `CI=true pnpm check`.

- [ ] **Step 5: Commit and record**

```bash
git add -A && git commit -m "docs: data model reference, c4 and plan status for M1"
parsnip entity add --type project -o "loomsmith: open-source wiring harness tool, repo /Users/macmini/projects/loomsmith, Apache-2.0" -o "M0+M1 core done 27 Sep 2026 on branch feat/m0_m1_core: schema, command log, validation, derivations" -o "spec docs/27092026_loomsmith_design.md, plan docs/27092026_loomsmith_plan.md" --tag loomsmith --tag wiring-harness --tag opensource -p loomsmith "loomsmith_project"
```

---

## Status

| Task | State |
|---|---|
| M0 docs, licence, git init | done 27 Sep 2026 |
| 1 Workspace scaffold and logger | todo |
| 2 Schemas | todo |
| 3 Canonical form and loader | todo |
| 4 Structural validation | todo |
| 5 Command reducer | todo |
| 6 Synthetic fixture | todo |
| 7 Routes and lengths | todo |
| 8 Completeness and reviews | todo |
| 9 Nets and test data | todo |
| 10 Wire list and BOM | todo |
| 11 Docs, review, hand-off | todo |

## Decisions

- Generic `insert` / `update` / `delete` commands plus whole-document structural validation after each batch, instead of one handler per domain command. Keeps the command log small and sync-friendly; domain macros can expand to these later.
- Reviews store `reviewed_value_json` (canonical json of the approved value), so staleness is derived and never needs a write.
- Unlisted matings default to disconnected in bench test data and to the caller's choice in `derive_nets`.

## Deviations from the spec

- Vitest browser-mode parity runs are deferred to M4 (web tooling arrives there). Core purity is enforced now by a `types: []` tsconfig and the ast-grep scan in Task 11.
- Cascading deletes are not in M1: a delete that would dangle references is rejected.
