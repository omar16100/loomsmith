# Length capture (schema v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Category: Plan / task record. Status: planned 28 Sep 2026, revision 2 after codex astra review r1 (/Users/macmini/projects/codex/loomsmith_length_capture_plan_review_28092026.txt). Branch `feat/length_capture` (from `main` ce77d35).

**Goal:** Let a document record how a harness was measured (asymmetric tolerance, measurement points at both ends of every segment, a pre-measurement estimate, per-end allowances given from a stated datum and allowed to be unknown) and block release outputs until every routed length is measured, pinned to its datums and backed by measured or documented evidence.

**Architecture:** File format goes from schema_version 1 to 2 with the first real migration (`migrate/v1_to_v2.ts`). It validates the values it rewrites against frozen v1 shapes, maps them value for value, and refuses any document where an evidence row or review would change between current and stale. Length math stays in `derive/topology.ts`: two tolerance bands, datum checks along the whole route, signed per-end allowances, unknown never 0. New structural rules (datum fits node kind, estimate range) and completeness rules (unmeasured length, unknown datum, datum mismatch at a route join, unknown allowance, allowance datum mismatch, non-positive cut length, length outside estimate) extend the existing validators.

**Tech Stack:** TypeScript 7.0.2 (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, erasableSyntaxOnly), zod 4.6.5, Vitest 5.0.2, pnpm 10, Node 22.18 or later.

**Spec:** /Users/macmini/.claude/plans/what-are-the-good-fizzy-newell.md (approved 28 Sep 2026, recommended approach steps 2 and 3), within /Users/macmini/projects/loomsmith/docs/27092026_loomsmith_design.md. Current format reference: /Users/macmini/projects/loomsmith/docs/data_model.md.

## Global Constraints

- Work only on branch `feat/length_capture`; never commit to `main`. The branch merges only as a whole (Task 1 alone refuses version 1 files until Task 2 lands).
- `packages/core/src` stays pure: no Node, DOM, clock or RNG (core tsconfig has `types: []`). Tests may use `node:fs`.
- snake_case for every identifier, field, function and file name.
- Unknown is `null`, never `0`: lengths, tolerances, datums, allowances. Any unknown input makes a derived length unknown.
- Datum values, exactly: `connector_back_face`, `connector_mating_face`, `breakout_centre`, `clip_centre`, `grommet_centre`, `splice_centre`, `ground_stud_centre`.
- New issue codes, exactly: `S_DATUM_NODE_KIND`, `S_LENGTH_ESTIMATE_RANGE`, `M_LENGTH_UNMEASURED`, `M_LENGTH_DATUM_UNKNOWN`, `M_ROUTE_DATUM_MISMATCH`, `M_ALLOWANCE_UNKNOWN`, `M_ALLOWANCE_DATUM_MISMATCH`, `M_CUT_LENGTH_NOT_POSITIVE`, `W_LENGTH_OUTSIDE_ESTIMATE`. New load error code: `migration_failed`.
- `command_schema_version` stays `1`; batch JSON Schema file name stays `loomsmith_batch_v1.schema.json`.
- Fixtures are synthetic; no OEM (Toyota) data in this repo.
- No em dashes in code comments, docs or commit messages.
- Commit messages: conventional prefix (`feat(core):`, `test(core):`, `docs:`), no `Co-Authored-By` trailer and no "Generated with" line.
- Use `ast-grep` (not grep) for code search. Run `pnpm check` (typecheck plus all tests) before every commit; it must pass.
- Keep every file under about 2000 lines.

## Decisions

- D1 Tolerance is a build tolerance (drawing semantics: the built segment lies in `[nominal - tol_minus_mm, nominal + tol_plus_mm]`), not measurement uncertainty. Route bands add per side; a band is `null` if any crossed segment's band on that side is unknown. Cut length carries the route bands unchanged and is never shifted.
- D2 "Never short" is a default of the `make_length` builder (`tol_minus_mm: 0` when omitted), not a schema default. An explicit `null` stays unknown.
- D3 Datum is recorded per segment end (`datum_a` at `node_a`, `datum_b` at `node_b`). Each datum belongs to one node kind (`model/datums.ts`, `datum_node_kind`); a mismatch is structural (`S_DATUM_NODE_KIND`), so a batch that changes a node kind must fix the datums in the same batch. `default_datum` per node kind is exported for editors to prefill; nothing applies it silently.
- D4 The estimate is a separate top-level field `length_estimate` (`{ min_mm, max_mm, method }` or `null`), so editing it never stales evidence on `length`. Its evidence (origin `assumed`, source page) goes on field `length_estimate`. It never feeds any length.
- D5 Allowances per wire end are `{ datum, beyond_datum_mm }` plus `service_loop_mm` per wire. `beyond_datum_mm` is the signed wire length from that datum to the cut end of the conductor, slack at that end included: positive into a housing (back face datum), negative when the conductor stops short of the datum (mating face, ring terminal on a stud centre). Cut length = route length + both `beyond_datum_mm` + `service_loop_mm`. **Deviation from the spec's "strip, insertion, slack" split** (codex r1 finding 1): strip length does not change cut length (the stripped conductor is inside the cut length) and belongs to terminal part data; insertion depth and slack are both "wire beyond the datum" and cannot be told apart without terminal geometry; a non-negative split cannot express datums beyond the conductor end.
- D6 A cut length is known only when the route is known, every allowance is known, and the datums check out along the whole route (`check_route_datums`, codex r2 finding 1): every crossed segment end has a datum (else `M_LENGTH_DATUM_UNKNOWN`); consecutive segments meet at the same point (a join measured to a connector's mating face on one side and its back face on the other leaves the distance between the faces out: `M_ROUTE_DATUM_MISMATCH`); and at each wire end the allowance datum equals the route's datum there, read from the end segment in whichever direction it is stored (`M_ALLOWANCE_DATUM_MISMATCH`). There is no datum conversion. A same-node wire (`route: []`, codex r2 finding 2) has route length 0 and is valid only when both allowance datums are points on that node's kind and are equal; its cut length is then the allowances alone (what v1 computed), otherwise `M_ALLOWANCE_DATUM_MISMATCH`.
- D7 Migration maps values exactly and invents nothing: `tol_mm` to equal `tol_plus_mm`/`tol_minus_mm`; free-text `datum` to `note`; `datum_a`/`datum_b` `null`; `end_a_mm`/`end_b_mm` to that end's `beyond_datum_mm` with `datum: null` (v1's documented meaning: wire added at that end); `service_mm` to `service_loop_mm`; `length_estimate` `null`. Consequence: migrated cut lengths are unknown until datums are recorded (v1 never recorded them); then they are exactly what v1 computed (tested). Each rewritten value is first validated against a frozen strict v1 shape; any mismatch (extra key, missing key, invalid null, v2-shaped value, a `length_estimate` key) fails the load with `migration_failed` and paths. Nothing is repaired.
- D8 Evidence and reviews store `canonical_json` of a value and are compared by exact string equality. The migration translates a stored string only if it is exactly the canonical JSON of a valid v1 value; anything else is left as it is. It then checks every evidence row and review: resolving its target like `build_index` (first entity with the id, `view_positions` excluded), its current/stale state must be the same before and after. A flip (for example a stale string that already equals the new value, or a review of an evidence row's `value_json`) or a duplicated target id whose field changed fails the load with `migration_failed`.
- D9 `M_LENGTH_UNMEASURED` (error, per segment, `segments/<id>/length`): a segment crossed by an in-scope wire whose route is `ok`, with non-null `nominal_mm` and no current evidence on `length` with origin `measured` or `documented`. `inferred` and `assumed` never count, even approved. Unrouted segments are not flagged (same boundary as `M_LENGTH_UNKNOWN`); a `null` length stays `M_LENGTH_UNKNOWN` on the wire. `M_LENGTH_DATUM_UNKNOWN` (error, per segment, same boundary): `datum_a` or `datum_b` is `null`.
- D10 `M_ALLOWANCE_UNKNOWN` (error, per in-scope wire, `wires/<id>/allowances`) whatever the route status. `M_ALLOWANCE_DATUM_MISMATCH` (error, per wire end, `wires/<id>/allowances/end_a|end_b/datum`) and `M_ROUTE_DATUM_MISMATCH` (error, per wire, `wires/<id>/route`) on `ok` routes. `M_CUT_LENGTH_NOT_POSITIVE` (error) when a known cut length is 0 or less (negative allowances make this possible).
- D11 `W_LENGTH_OUTSIDE_ESTIMATE` (warning, per in-scope segment, `segments/<id>/length`): `nominal_mm` below `min_mm` or above `max_mm`, bounds inclusive. This deliberately covers every in-scope segment with an estimate, routed or not and whatever its evidence (broader than the spec's "measured length"), because a typo is worth catching before any evidence is recorded.
- D12 `command_schema_version` stays 1: it versions the batch envelope. Contract: batches and inverse batches are built against the current document format; callers discard pending batches and undo stacks when a document is migrated (CLI and web requirement, M2 and M4). Entity payloads are validated against the current schema on apply, so an old-shaped segment or wire is rejected (`invalid_entity`). Evidence `value_json` is an opaque string, so an evidence insert carrying old-format JSON is accepted and is simply stale.
- D13 Photos as evidence: an image asset (`media_type` `image/...`), cited with `source: { asset_id, page_index: 0, bbox: null }` (image regions are not addressed yet). The fixture carries one synthetic example.
- D14 The document JSON Schema file is renamed `loomsmith_document_v2.schema.json` (v1 stays in git history).
- D15 No `terminal_tip` datum (codex r2 finding 3, a spec deviation): a connector's terminals can sit at different depths, and a datum does not name a contact, so two "terminal tips" could be different points and still compare equal. It returns when a datum can reference its contact. Back face and mating face are single planes of the connector.

## File map

| File | Change | Task |
|---|---|---|
| `packages/core/src/schema/primitives.ts` | `datum_schema`, v2 `length_schema`, `length_estimate_schema`, types | 1 |
| `packages/core/src/schema/document.ts` | version 2, allowance schemas, `length_estimate` on segments, types | 1 |
| `packages/core/src/model/make_length.ts` (new) | `make_length` (never-short default) | 1 |
| `packages/core/src/model/datums.ts` (new) | `datum_node_kind`, `default_datum` | 1 |
| `packages/core/src/derive/topology.ts` | bands, `route_end_datums`, `check_route_datums`, `datum_problems`, `unknown_allowances`, `CutLengthValue`, new `cut_length` | 1 |
| `packages/core/src/derive/wire_list.ts`, `src/index.ts` | `CutLengthValue` row type, exports | 1 |
| `packages/core/test/fixtures/synthetic_milestone_v1.loom.json` (new) | frozen v1 golden (ce77d35) | 1 |
| `packages/core/src/migrate/v1_to_v2.ts` (new), `migrate/load_document.ts` | migration, `migration_failed` | 2 |
| `packages/core/src/validate/structural.ts` | `S_DATUM_NODE_KIND`, `S_LENGTH_ESTIMATE_RANGE` | 3 |
| `packages/core/src/validate/completeness.ts` | six new completeness codes | 4 |
| `packages/core/test/**` | helpers, fixture, expectations, new tests | 1 to 4 |
| `packages/core/generated/loomsmith_document_v2.schema.json`, `examples/synthetic_milestone/synthetic_milestone.loom.json` | regenerated | 1, 4 |
| `docs/data_model.md`, `docs/c4model.md`, `todo.md`, this plan | docs | 1 to 4 |

---

### Task 1: Schema v2 length and allowance model

**Files:**
- Create: `packages/core/src/model/make_length.ts`, `packages/core/src/model/datums.ts`, `packages/core/test/make_length.test.ts`, `packages/core/test/fixtures/synthetic_milestone_v1.loom.json`
- Modify: `packages/core/src/schema/primitives.ts`, `packages/core/src/schema/document.ts`, `packages/core/src/derive/topology.ts`, `packages/core/src/derive/wire_list.ts`, `packages/core/src/index.ts`
- Modify tests: `packages/core/test/helpers/entities.ts`, `packages/core/test/fixtures/synthetic_milestone.ts`, `packages/core/test/topology.test.ts`, `packages/core/test/wire_list_bom.test.ts`, `packages/core/test/apply_batch.test.ts`, `packages/core/test/completeness.test.ts`, `packages/core/test/nets_test_data.test.ts`, `packages/core/test/schema.test.ts`, `packages/core/test/load_document.test.ts`
- Regenerate: `packages/core/generated/loomsmith_document_v2.schema.json` (delete `_v1`), `examples/synthetic_milestone/synthetic_milestone.loom.json`
- Docs: `docs/data_model.md`

**Interfaces:**
- Produces: `datum_schema`, `Datum`, v2 `length_schema`, `Length`, `length_estimate_schema`, `LengthEstimate` (primitives.ts); `current_schema_version = 2`, `end_allowance_schema`, `allowances_schema`, `EndAllowance`, `Allowances`, `segment_schema` with `length_estimate` (document.ts); `make_length(input: LengthInput): Length`, `LengthInput`; `datum_node_kind: Readonly<Record<Datum, TopologyNode["kind"]>>`, `default_datum: Readonly<Record<TopologyNode["kind"], Datum>>`; in topology.ts: `LengthValue { status; nominal_mm; tol_plus_mm; tol_minus_mm; unknown_segment_ids }`, `CutLengthValue extends LengthValue { unknown_allowances: string[]; datum_problems: string[] }`, `RouteEndDatums { end_a: Datum | null; end_b: Datum | null }`, `route_end_datums(index, wire): RouteEndDatums | null`, `DatumCheck { unknown_ends: string[]; join_conflicts: string[]; allowance_conflicts: Array<{ side: "end_a" | "end_b"; message: string }> }`, `check_route_datums(index, wire): DatumCheck | null`, `datum_problems(index, wire): string[]`, `unknown_allowances(wire): string[]`, `route_length(index, wire): LengthValue`, `cut_length(index, wire): CutLengthValue`. Test helper `segment(id, harness_id, node_a, node_b, nominal_mm, tol_plus_mm = null, tol_minus_mm = 0, datums: [Datum | null, Datum | null] = [null, null])`; `wire(...)` gives each end `{ datum: <default for the end kind>, beyond_datum_mm: 20 }` and `service_loop_mm: 0`.

- [ ] **Step 1: Freeze the v1 golden file before changing anything**

```bash
cp examples/synthetic_milestone/synthetic_milestone.loom.json packages/core/test/fixtures/synthetic_milestone_v1.loom.json
git show ce77d35:examples/synthetic_milestone/synthetic_milestone.loom.json | cmp - packages/core/test/fixtures/synthetic_milestone_v1.loom.json
```

Expected: `cmp` prints nothing (identical to main).

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/make_length.test.ts`:

```ts
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
```

In `packages/core/test/schema.test.ts`: change `schema_version: 1` to `schema_version: 2` in `minimal`; change `schematic_wire.allowances` to

```ts
  allowances: { end_a: { datum: null, beyond_datum_mm: null }, end_b: { datum: null, beyond_datum_mm: null }, service_loop_mm: null },
```

change the imports to

```ts
import { collection_names, collection_schemas, document_schema, segment_schema, wire_schema } from "../src/schema/document.ts";
import { make_length } from "../src/model/make_length.ts";
```

change the snapshot path `"../generated/loomsmith_document_v1.schema.json"` to `"../generated/loomsmith_document_v2.schema.json"`, and add inside `describe("document schema", ...)`:

```ts
  it("accepts per-end allowances with signed beyond-datum lengths and rejects the v1 flat shape", () => {
    expect(wire_schema.safeParse(schematic_wire).success).toBe(true);
    const ring = { ...schematic_wire, allowances: { end_a: { datum: "ground_stud_centre", beyond_datum_mm: -8 }, end_b: { datum: "connector_back_face", beyond_datum_mm: 12 }, service_loop_mm: 0 } };
    expect(wire_schema.safeParse(ring).success).toBe(true);
    expect(wire_schema.safeParse({ ...schematic_wire, allowances: { end_a_mm: 0, end_b_mm: 0, service_mm: 0 } }).success).toBe(false);
    expect(wire_schema.safeParse({ ...ring, allowances: { ...ring.allowances, service_loop_mm: -1 } }).success).toBe(false);
    expect(wire_schema.safeParse({ ...ring, allowances: { ...ring.allowances, end_a: { datum: "somewhere", beyond_datum_mm: 0 } } }).success).toBe(false);
  });

  it("accepts asymmetric tolerance, datums and an estimate range; rejects the v1 length", () => {
    const seg = {
      id: "s1", harness_id: "h1", node_a: "n1", node_b: "n2",
      length: make_length({ nominal_mm: 300, tol_plus_mm: 10, datum_a: "connector_back_face", datum_b: "breakout_centre" }),
      length_estimate: { min_mm: 250, max_mm: 400, method: "body dimensions" },
    };
    expect(segment_schema.safeParse(seg).success).toBe(true);
    expect(segment_schema.safeParse({ ...seg, length_estimate: null }).success).toBe(true);
    expect(segment_schema.safeParse({ ...seg, length: { nominal_mm: 300, tol_mm: 5, datum: null } }).success).toBe(false);
    expect(segment_schema.safeParse({ ...seg, length: { ...seg.length, datum_a: "somewhere" } }).success).toBe(false);
    expect(segment_schema.safeParse({ ...seg, length: { ...seg.length, tol_minus_mm: -1 } }).success).toBe(false);
    expect(segment_schema.safeParse({ ...seg, length_estimate: { min_mm: 250, max_mm: 400, method: "" } }).success).toBe(false);
  });
```

In `packages/core/test/topology.test.ts`: change the imports to

```ts
import { analyse_route, check_route_datums, cut_length, route_end_datums, route_length, unknown_allowances } from "../src/derive/topology.ts";
import { build_index } from "../src/model/doc_index.ts";
import type { LoomDocument, Wire } from "../src/schema/document.ts";
import type { Datum } from "../src/schema/primitives.ts";
import { build_synthetic_milestone } from "./fixtures/synthetic_milestone.ts";
import { connector, contact, node, segment, small_doc, spec, to_contact, wire } from "./helpers/entities.ts";
```

add after the `w` helper:

```ts
// small_doc: one 500 mm segment J1 back face to J2 back face (plus 5, minus 0), W1 with 20 mm beyond each back face.
const cut = (doc: LoomDocument) => cut_length(build_index(doc), doc.wires[0]!);
const measured_at_j1 = (datum: Datum, nominal_mm: number, beyond_datum_mm: number): LoomDocument => {
  const base = small_doc();
  return {
    ...base,
    segments: base.segments.map((s) => ({ ...s, length: { ...s.length, nominal_mm, datum_a: datum } })),
    wires: base.wires.map((item) => ({ ...item, allowances: { ...item.allowances, end_a: { datum, beyond_datum_mm } } })),
  };
};
```

replace the two length tests with

```ts
  it("sums known segments and allowances with worst-case plus and minus bands", () => {
    expect(route_length(index, w("W4"))).toEqual({ status: "known", nominal_mm: 380, tol_plus_mm: 7, tol_minus_mm: 0, unknown_segment_ids: [] });
    expect(cut_length(index, w("W1"))).toEqual({
      status: "known", nominal_mm: 460, tol_plus_mm: 8, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [],
    });
    expect(cut_length(index, w("W6"))).toEqual({
      status: "known", nominal_mm: 910, tol_plus_mm: 13, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [],
    });
  });

  it("never guesses an unmeasured segment", () => {
    expect(cut_length(index, w("W5"))).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: ["seg_b1_x1"], unknown_allowances: [], datum_problems: [],
    });
  });

  it("loses a tolerance band when any crossed segment's band on that side is unknown", () => {
    const base = small_doc();
    const two = {
      ...base,
      nodes: [...base.nodes, node("n_b1", "h1", "breakout", null)],
      segments: [segment("s1", "h1", "n_j1", "n_b1", 200, 4, null), segment("s2", "h1", "n_b1", "n_j2", 300, 6, 2)],
      wires: base.wires.map((item) => ({ ...item, route: ["s1", "s2"] })),
    };
    expect(route_length(build_index(two), two.wires[0]!)).toEqual({
      status: "known", nominal_mm: 500, tol_plus_mm: 10, tol_minus_mm: null, unknown_segment_ids: [],
    });
  });

  it("gives the same cut length whichever datum the length was measured to", () => {
    // The J1 mating face is 25 mm past its back face and the conductor ends 20 mm past the back face. Each pair of
    // (route length, wire beyond the datum) describes the same wire.
    expect(cut(measured_at_j1("connector_back_face", 500, 20)).nominal_mm).toBe(540);
    expect(cut(measured_at_j1("connector_mating_face", 525, -5)).nominal_mm).toBe(540);
    const base = small_doc();
    const looped = { ...base, wires: base.wires.map((item) => ({ ...item, allowances: { ...item.allowances, service_loop_mm: 100 } })) };
    expect(cut(looped).nominal_mm).toBe(640);
  });

  it("requires consecutive segments to meet at the same point, whichever way they are stored", () => {
    // The route passes connector J3: s1 is measured to J3's mating face, s2 from its back face, so the distance between
    // the two faces is in neither segment.
    const base = small_doc();
    const through_j3 = (s1_datum_at_j3: Datum | null, reverse_s2: boolean): LoomDocument => {
      const s2 = segment("s2", "h1", "n_j3", "n_j2", 300, 5, 0, ["connector_back_face", "connector_back_face"]);
      const stored = reverse_s2 ? { ...s2, node_a: s2.node_b, node_b: s2.node_a, length: { ...s2.length, datum_a: s2.length.datum_b, datum_b: s2.length.datum_a } } : s2;
      return {
        ...base,
        connectors: [...base.connectors, connector("j3", "h1", "J3", ["1"])],
        nodes: [...base.nodes, node("n_j3", "h1", "connector", "j3")],
        segments: [segment("s1", "h1", "n_j1", "n_j3", 200, 5, 0, ["connector_back_face", s1_datum_at_j3]), stored],
        wires: base.wires.map((item) => ({ ...item, route: ["s1", "s2"] })),
      };
    };
    for (const reverse_s2 of [false, true]) {
      const gap = through_j3("connector_mating_face", reverse_s2);
      expect(check_route_datums(build_index(gap), gap.wires[0]!)?.join_conflicts).toEqual(["n_j3: s1 measured to connector_mating_face, s2 from connector_back_face"]);
      expect(cut(gap)).toMatchObject({ status: "unknown", nominal_mm: null, datum_problems: ["n_j3: s1 measured to connector_mating_face, s2 from connector_back_face"] });
      // An internal end with no datum is just as unknown as an outer one.
      expect(cut(through_j3(null, reverse_s2))).toMatchObject({ status: "unknown", nominal_mm: null, datum_problems: ["s1 at n_j3: datum unknown"] });
      expect(cut(through_j3("connector_back_face", reverse_s2)).nominal_mm).toBe(540);
    }
  });

  it("measures a same-node wire from one point on that node", () => {
    const base = small_doc();
    const jumper = (end_b: Datum): LoomDocument => ({
      ...base,
      contacts: [...base.contacts, contact("j1", "2")],
      wires: [{ ...wire("w9", "h1", "W9", [to_contact("j1", "1"), to_contact("j1", "2")], spec(0.5, "R"), []), allowances: { end_a: { datum: "connector_back_face", beyond_datum_mm: 20 }, end_b: { datum: end_b, beyond_datum_mm: 20 }, service_loop_mm: 10 } }],
    });
    expect(cut(jumper("connector_back_face"))).toMatchObject({ status: "known", nominal_mm: 50 });
    expect(cut(jumper("connector_mating_face")).datum_problems).toEqual(["end_b: allowance from connector_mating_face, end_a from connector_back_face at the same node"]);
    expect(cut(jumper("splice_centre")).datum_problems).toEqual(["end_b: splice_centre is not a point on connector node n_j1"]);
  });

  it("reads each wire end's datum whichever way round the segment is stored, and never converts datums", () => {
    const doc = measured_at_j1("connector_mating_face", 525, -5);
    const s1 = doc.segments[0]!;
    const reversed = { ...doc, segments: [{ ...s1, node_a: s1.node_b, node_b: s1.node_a, length: { ...s1.length, datum_a: s1.length.datum_b, datum_b: s1.length.datum_a } }] };
    expect(route_end_datums(build_index(reversed), reversed.wires[0]!)).toEqual({ end_a: "connector_mating_face", end_b: "connector_back_face" });
    expect(cut(reversed).nominal_mm).toBe(540);
    const wrong = { ...reversed, wires: reversed.wires.map((item) => ({ ...item, allowances: { ...item.allowances, end_a: { datum: "connector_back_face" as const, beyond_datum_mm: -5 } } })) };
    expect(cut(wrong)).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [], unknown_allowances: [],
      datum_problems: ["end_a: route measured to connector_mating_face, allowance from connector_back_face"],
    });
    const base = small_doc();
    const unmarked = { ...base, segments: base.segments.map((s) => ({ ...s, length: { ...s.length, datum_b: null } })) };
    expect(cut(unmarked)).toMatchObject({ status: "unknown", datum_problems: ["s1 at n_j2: datum unknown"] });
  });

  it("never treats an unknown allowance as 0", () => {
    const base = small_doc();
    const w1 = { ...base.wires[0]!, allowances: { end_a: { datum: null, beyond_datum_mm: 20 }, end_b: { datum: "connector_back_face" as const, beyond_datum_mm: null }, service_loop_mm: 0 } };
    expect(unknown_allowances(w1)).toEqual(["end_a.datum", "end_b.beyond_datum_mm"]);
    expect(cut_length(build_index(base), w1)).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [], unknown_allowances: ["end_a.datum", "end_b.beyond_datum_mm"], datum_problems: [],
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/make_length.test.ts packages/core/test/topology.test.ts packages/core/test/schema.test.ts`
Expected: FAIL (cannot resolve `../src/model/make_length.ts`; `route_end_datums` and `unknown_allowances` not exported; `segment_schema` rejects `length_estimate`).

- [ ] **Step 4: Implement the schema**

In `packages/core/src/schema/primitives.ts` replace `length_schema` with:

```ts
// Where a segment length is measured to at one end. Each value is a point on one node kind (model/datums.ts,
// S_DATUM_NODE_KIND): the two connector faces on connector nodes, a centre on every other kind. No terminal tip yet:
// terminals of one connector can sit at different depths and a datum does not name a contact.
export const datum_schema = z.enum([
  "connector_back_face",
  "connector_mating_face",
  "breakout_centre",
  "clip_centre",
  "grommet_centre",
  "splice_centre",
  "ground_stud_centre",
]);

// A build tolerance around nominal, each side separately (a plus-only band has tol_minus_mm 0); null is unknown.
// datum_a and datum_b are the measurement points at the segment's node_a and node_b.
export const length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_plus_mm: z.number().nonnegative().nullable(),
  tol_minus_mm: z.number().nonnegative().nullable(),
  datum_a: datum_schema.nullable(),
  datum_b: datum_schema.nullable(),
  note: text_schema,
});

// A range guessed before measuring (for example from body dimensions). Never used as a length: it only lets
// validation flag a measurement outside it (W_LENGTH_OUTSIDE_ESTIMATE). min_mm <= max_mm is S_LENGTH_ESTIMATE_RANGE.
export const length_estimate_schema = z.strictObject({
  min_mm: z.number().positive(),
  max_mm: z.number().positive(),
  method: z.string().min(1).max(500),
});
```

and add at the bottom:

```ts
export type Datum = z.infer<typeof datum_schema>;
export type LengthEstimate = z.infer<typeof length_estimate_schema>;
```

In `packages/core/src/schema/document.ts`:
- import line: `import { bbox_schema, datum_schema, id_schema, label_schema, length_estimate_schema, length_schema, origin_schema, part_use_schema, text_schema } from "./primitives.ts";`
- `export const current_schema_version = 2;`
- before `wire_schema`:

```ts
// One wire end: the datum its figure is given from, and the signed wire length from that datum to the cut end of the
// conductor, slack at that end included. Positive into a housing from its back face; negative when the conductor
// stops short of the datum (the mating face, a ring terminal on a stud centre). null is unknown.
export const end_allowance_schema = z.strictObject({
  datum: datum_schema.nullable(),
  beyond_datum_mm: z.number().nullable(),
});

export const allowances_schema = z.strictObject({
  end_a: end_allowance_schema,
  end_b: end_allowance_schema,
  service_loop_mm: z.number().nonnegative().nullable(),
});
```

- in `wire_schema` replace the `allowances: z.strictObject({...})` block with `allowances: allowances_schema,`
- in `segment_schema` add `length_estimate: length_estimate_schema.nullable(),` after `length: length_schema,`
- types: `export type EndAllowance = z.infer<typeof end_allowance_schema>;` and `export type Allowances = z.infer<typeof allowances_schema>;`

Create `packages/core/src/model/make_length.ts`:

```ts
import type { Datum, Length } from "../schema/primitives.ts";

export interface LengthInput {
  nominal_mm: number | null;
  tol_plus_mm?: number | null;
  tol_minus_mm?: number | null;
  datum_a?: Datum | null;
  datum_b?: Datum | null;
  note?: string | null;
}

// New lengths are never short: with no stated minus tolerance the built segment may not be shorter than nominal.
// Only an omitted field takes a default; an explicit null stays null (unknown).
export function make_length(input: LengthInput): Length {
  return {
    nominal_mm: input.nominal_mm,
    tol_plus_mm: input.tol_plus_mm ?? null,
    tol_minus_mm: input.tol_minus_mm === undefined ? 0 : input.tol_minus_mm,
    datum_a: input.datum_a ?? null,
    datum_b: input.datum_b ?? null,
    note: input.note ?? null,
  };
}
```

Create `packages/core/src/model/datums.ts`:

```ts
import type { TopologyNode } from "../schema/document.ts";
import type { Datum } from "../schema/primitives.ts";

// The node kind each measurement point belongs to (S_DATUM_NODE_KIND).
export const datum_node_kind: Readonly<Record<Datum, TopologyNode["kind"]>> = Object.freeze({
  connector_back_face: "connector",
  connector_mating_face: "connector",
  breakout_centre: "breakout",
  clip_centre: "clip",
  grommet_centre: "grommet",
  splice_centre: "splice",
  ground_stud_centre: "ground",
});

// The usual measurement point per node kind (a connector is measured to its back face, where the wires leave the
// housing). Editors prefill it; core never applies it silently.
export const default_datum: Readonly<Record<TopologyNode["kind"], Datum>> = Object.freeze({
  connector: "connector_back_face",
  breakout: "breakout_centre",
  clip: "clip_centre",
  grommet: "grommet_centre",
  splice: "splice_centre",
  ground: "ground_stud_centre",
});
```

In `packages/core/src/index.ts` add `export * from "./model/make_length.ts";` and `export * from "./model/datums.ts";` after the `empty_document` export.

- [ ] **Step 5: Implement the length math**

In `packages/core/src/derive/topology.ts`:
- imports: add `import { datum_node_kind } from "../model/datums.ts";` and `import type { Datum } from "../schema/primitives.ts";`, and add `Segment` to the document type import (`import type { Segment, Wire, WireEnd } from "../schema/document.ts";`)
- replace everything from `export type LengthStatus` through the `LengthValue` interface with:

```ts
export type LengthStatus = "known" | "unknown" | "unavailable";

export interface LengthValue {
  status: LengthStatus;
  nominal_mm: number | null;
  // Worst case along the route: the sum of every crossed segment's band on that side, null if any is unknown.
  tol_plus_mm: number | null;
  tol_minus_mm: number | null;
  unknown_segment_ids: string[];
}

export interface CutLengthValue extends LengthValue {
  // Unknown allowance fields ("end_a.datum", "end_b.beyond_datum_mm", "service_loop_mm").
  unknown_allowances: string[];
  // Everything check_route_datums found, as text ("s1 at n_j2: datum unknown").
  datum_problems: string[];
}

export interface RouteEndDatums {
  end_a: Datum | null;
  end_b: Datum | null;
}

export interface DatumCheck {
  // Crossed segment ends with no datum ("seg_b1_x1 at n_b1").
  unknown_ends: string[];
  // Nodes where consecutive segments were measured to different points ("n_j3: s1 measured to ..., s2 from ...").
  join_conflicts: string[];
  // Wire ends whose allowance is given from another point than the route has there.
  allowance_conflicts: Array<{ side: "end_a" | "end_b"; message: string }>;
}
```

- replace everything from `const unavailable` to the end of the file with:

```ts
const unavailable: LengthValue = { status: "unavailable", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [] };

const add_band = (sum: number | null, value: number | null): number | null => (sum === null || value === null ? null : sum + value);
const round_band = (value: number | null): number | null => (value === null ? null : round_mm(value));

export function route_length(index: DocIndex, wire: Wire): LengthValue {
  if (analyse_route(index, wire).status !== "ok" || wire.route === null) return { ...unavailable, unknown_segment_ids: [] };
  let nominal = 0;
  let tol_plus: number | null = 0;
  let tol_minus: number | null = 0;
  const unknown: string[] = [];
  for (const segment_id of wire.route) {
    const seg = index.segments.get(segment_id);
    if (!seg) continue;
    if (seg.length.nominal_mm === null) unknown.push(seg.id);
    else nominal += seg.length.nominal_mm;
    tol_plus = add_band(tol_plus, seg.length.tol_plus_mm);
    tol_minus = add_band(tol_minus, seg.length.tol_minus_mm);
  }
  if (unknown.length > 0) return { status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: unknown };
  return { status: "known", nominal_mm: round_mm(nominal), tol_plus_mm: round_band(tol_plus), tol_minus_mm: round_band(tol_minus), unknown_segment_ids: [] };
}

// The datum of a segment at one of its nodes, whichever direction the segment is stored in.
const datum_at = (seg: Segment, node_id: string): Datum | null => (seg.node_a === node_id ? seg.length.datum_a : seg.length.datum_b);

// The datum the route was measured to at each wire end. null for a route that is not ok; a same-node route ([])
// has no segment, so no datum at either end.
export function route_end_datums(index: DocIndex, wire: Wire): RouteEndDatums | null {
  const analysis = analyse_route(index, wire);
  if (analysis.status !== "ok" || wire.route === null) return null;
  const first = index.segments.get(wire.route[0] ?? "");
  const last = index.segments.get(wire.route[wire.route.length - 1] ?? "");
  const start = analysis.node_path[0];
  const finish = analysis.node_path[analysis.node_path.length - 1];
  return {
    end_a: first && start !== undefined ? datum_at(first, start) : null,
    end_b: last && finish !== undefined ? datum_at(last, finish) : null,
  };
}

// Every measurement point along the route must be known, consecutive segments must meet at the same point, and each
// wire end's allowance must be given from the point the route has there; otherwise the sum leaves out, or counts
// twice, the distance between two points. Datums are never converted. null for a route that is not ok.
export function check_route_datums(index: DocIndex, wire: Wire): DatumCheck | null {
  const analysis = analyse_route(index, wire);
  if (analysis.status !== "ok" || wire.route === null) return null;
  const check: DatumCheck = { unknown_ends: [], join_conflicts: [], allowance_conflicts: [] };
  const path = analysis.node_path;
  const given = { end_a: wire.allowances.end_a.datum, end_b: wire.allowances.end_b.datum };
  if (wire.route.length === 0) {
    // A same-node wire: route length 0, so both ends must be given from one point on that node.
    const here = path[0] === undefined ? undefined : index.nodes.get(path[0]);
    for (const side of ["end_a", "end_b"] as const) {
      const datum = given[side];
      if (here && datum !== null && datum_node_kind[datum] !== here.kind) {
        check.allowance_conflicts.push({ side, message: `${side}: ${datum} is not a point on ${here.kind} node ${here.id}` });
      }
    }
    if (check.allowance_conflicts.length === 0 && given.end_a !== null && given.end_b !== null && given.end_a !== given.end_b) {
      check.allowance_conflicts.push({ side: "end_b", message: `end_b: allowance from ${given.end_b}, end_a from ${given.end_a} at the same node` });
    }
    return check;
  }
  let previous: { segment_id: string; datum: Datum | null } | null = null;
  for (const [i, segment_id] of wire.route.entries()) {
    const seg = index.segments.get(segment_id);
    const from = path[i];
    const to = path[i + 1];
    if (!seg || from === undefined || to === undefined) continue;
    const leaving = datum_at(seg, from);
    const reaching = datum_at(seg, to);
    if (leaving === null) check.unknown_ends.push(`${seg.id} at ${from}`);
    if (reaching === null) check.unknown_ends.push(`${seg.id} at ${to}`);
    if (previous !== null && previous.datum !== null && leaving !== null && previous.datum !== leaving) {
      check.join_conflicts.push(`${from}: ${previous.segment_id} measured to ${previous.datum}, ${seg.id} from ${leaving}`);
    }
    previous = { segment_id: seg.id, datum: reaching };
  }
  const measured = route_end_datums(index, wire);
  for (const side of ["end_a", "end_b"] as const) {
    const at_end = measured?.[side] ?? null;
    const datum = given[side];
    if (datum !== null && at_end !== null && datum !== at_end) {
      check.allowance_conflicts.push({ side, message: `${side}: route measured to ${at_end}, allowance from ${datum}` });
    }
  }
  return check;
}

// check_route_datums as text for CutLengthValue. An allowance with no datum is reported by unknown_allowances.
export function datum_problems(index: DocIndex, wire: Wire): string[] {
  const check = check_route_datums(index, wire);
  if (check === null) return [];
  return [...check.unknown_ends.map((end) => `${end}: datum unknown`), ...check.join_conflicts, ...check.allowance_conflicts.map((conflict) => conflict.message)];
}

export function unknown_allowances(wire: Wire): string[] {
  const a = wire.allowances;
  const missing: string[] = [];
  for (const side of ["end_a", "end_b"] as const) {
    if (a[side].datum === null) missing.push(`${side}.datum`);
    if (a[side].beyond_datum_mm === null) missing.push(`${side}.beyond_datum_mm`);
  }
  if (a.service_loop_mm === null) missing.push("service_loop_mm");
  return missing;
}

// Cut length = route length + wire beyond the datum at both ends + service loop. Allowances add no tolerance.
export function cut_length(index: DocIndex, wire: Wire): CutLengthValue {
  const route = route_length(index, wire);
  const missing = unknown_allowances(wire);
  if (route.status === "unavailable") return { ...route, unknown_allowances: missing, datum_problems: [] };
  const problems = datum_problems(index, wire);
  const { end_a, end_b, service_loop_mm } = wire.allowances;
  if (
    route.status === "unknown" || route.nominal_mm === null || missing.length > 0 || problems.length > 0 ||
    end_a.beyond_datum_mm === null || end_b.beyond_datum_mm === null || service_loop_mm === null
  ) {
    return { status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: route.unknown_segment_ids, unknown_allowances: missing, datum_problems: problems };
  }
  const nominal_mm = round_mm(route.nominal_mm + end_a.beyond_datum_mm + end_b.beyond_datum_mm + service_loop_mm);
  return { ...route, nominal_mm, unknown_allowances: [], datum_problems: [] };
}
```

In `packages/core/src/derive/wire_list.ts` change the topology import to `import { analyse_route, cut_length, type CutLengthValue, type RouteStatus } from "./topology.ts";` and the row field to `cut_length: CutLengthValue;`.

- [ ] **Step 6: Move the existing tests and fixture to v2 shapes**

`packages/core/test/helpers/entities.ts`:
- imports: add `import { make_length } from "../../src/model/make_length.ts";` and change the primitives type import to `import type { Datum, PartUse } from "../../src/schema/primitives.ts";`.
- replace `segment`:

```ts
export function segment(
  id: string, harness_id: string, node_a: string, node_b: string, nominal_mm: number | null,
  tol_plus_mm: number | null = null, tol_minus_mm: number | null = 0, datums: [Datum | null, Datum | null] = [null, null],
): Segment {
  const length = make_length({ nominal_mm, tol_plus_mm, tol_minus_mm, datum_a: datums[0], datum_b: datums[1] });
  return { id, harness_id, node_a, node_b, length, length_estimate: null };
}
```

- replace `wire` with:

```ts
// The datum a wire end's allowance is given from, by what the end is attached to.
function end_datum(end: WireEnd): Datum | null {
  switch (end.kind) {
    case "contact":
      return "connector_back_face";
    case "splice":
      return "splice_centre";
    case "ground_point":
      return "ground_stud_centre";
    case "open":
      return null;
  }
}

// 20 mm of wire beyond the datum at each end (into the housing, slack included), no service loop.
export function wire(id: string, harness_id: string, label: string, ends: [WireEnd, WireEnd], wire_spec: WireSpec, route: string[] | null): Wire {
  const allowances = { end_a: { datum: end_datum(ends[0]), beyond_datum_mm: 20 }, end_b: { datum: end_datum(ends[1]), beyond_datum_mm: 20 }, service_loop_mm: 0 };
  return { id, harness_id, label, ends, spec: wire_spec, route, allowances };
}
```

- in `small_doc`: `segments: [segment("s1", "h1", "n_j1", "n_j2", 500, 5, 0, ["connector_back_face", "connector_back_face"])],`

`packages/core/test/fixtures/synthetic_milestone.ts`:
- add `import type { Datum } from "../../src/schema/primitives.ts";`
- at the top of `build_synthetic_milestone` add:

```ts
  const at_connector: Datum = "connector_back_face";
  const at_breakout: Datum = "breakout_centre";
  const at_splice: Datum = "splice_centre";
  const at_ground: Datum = "ground_stud_centre";
```

- replace the five segment inserts with:

```ts
    cmd_insert("segments", segment("seg_j1_b1", E, "n_j1", "n_b1", 300, 5, 0, [at_connector, at_breakout])),
    cmd_insert("segments", segment("seg_b1_s1", E, "n_b1", "n_s1", 120, 3, 1, [at_breakout, at_splice])),
    cmd_insert("segments", segment("seg_s1_j2", E, "n_s1", "n_j2", 450, 5, 0, [at_splice, at_connector])),
    cmd_insert("segments", segment("seg_b1_x1", E, "n_b1", "n_x1", null, null, 0, [at_breakout, at_connector])),
    cmd_insert("segments", segment("seg_b1_g1", E, "n_b1", "n_g1", 80, 2, 0, [at_breakout, at_ground])),
```

(`seg_b1_s1` carries the one asymmetric band: plus 3, minus 1.)

`packages/core/test/wire_list_bom.test.ts`: the W1 row's cut length becomes `cut_length: { status: "known", nominal_mm: 460, tol_plus_mm: 8, tol_minus_mm: 1, unknown_segment_ids: [], unknown_allowances: [], datum_problems: [] },`.

`packages/core/test/apply_batch.test.ts` (undo test): `cmd_update("segments", "s1", { length: make_length({ nominal_mm: 510, tol_plus_mm: 5 }) })`, with `import { make_length } from "../src/model/make_length.ts";`.

`packages/core/test/completeness.test.ts` (evidence stale test): `cmd_update("segments", "seg_j1_b1", { length: make_length({ nominal_mm: 310, tol_plus_mm: 5, datum_a: "connector_back_face", datum_b: "breakout_centre" }) })`, with the same import.

`packages/core/test/nets_test_data.test.ts` (long chain test): `allowances: { end_a: { datum: null, beyond_datum_mm: null }, end_b: { datum: null, beyond_datum_mm: null }, service_loop_mm: null },`.

`packages/core/test/load_document.test.ts`: the future version case becomes `schema_version: 3`.

- [ ] **Step 7: Regenerate the snapshots and run the suite**

```bash
git rm -q packages/core/generated/loomsmith_document_v1.schema.json
pnpm vitest run -u packages/core/test/schema.test.ts packages/core/test/synthetic_milestone.test.ts
git diff --stat
pnpm check
```

Expected: `pnpm check` passes. Golden diff contains only: `schema_version` 2; every segment's v2 length (with the datums above) and `length_estimate: null`; `seg_b1_s1` minus band 1; every wire's `{ end_a: { datum, beyond_datum_mm: 20 }, end_b: {...}, service_loop_mm: 0 }`; `e_seg_j1_b1_length.value_json` now holding the v2 length with its datums.

- [ ] **Step 8: Update docs/data_model.md**

- Section 2 table: `schema_version` literal `2`.
- Unit rules paragraph: "**Unit rules**: canonical units are millimetres for lengths (`length.nominal_mm`, `tol_plus_mm`, `tol_minus_mm`, `length_estimate.min_mm`/`max_mm`, `beyond_datum_mm`, `service_loop_mm`) and `cross_section_mm2`. An unknown value is always `null`, never `0` (`length_schema`, `allowances_schema`, `wire_spec_schema`)."
- Entities table: `wires` row ends with "`allowances` (allowances object)"; `segments` row: "`id`, `harness_id`, `node_a`, `node_b`, `length` (length object), `length_estimate` (estimate object or `null`)".
- Replace the **length** bullet with:
  - "**length**: `{ nominal_mm (positive or null), tol_plus_mm, tol_minus_mm (non-negative or null), datum_a, datum_b (datum or null), note (text or null) }`. The tolerance is a build tolerance: the built segment lies in `[nominal - tol_minus_mm, nominal + tol_plus_mm]`. `datum_a`/`datum_b` are the measurement points at `node_a`/`node_b`. `make_length` (`model/make_length.ts`) defaults an omitted `tol_minus_mm` to `0` (never short); an explicit `null` stays unknown."
  - "**datum**: `connector_back_face`, `connector_mating_face` (connector nodes), `breakout_centre`, `clip_centre`, `grommet_centre`, `splice_centre`, `ground_stud_centre` (the node kind named). No terminal tip: a datum does not name a contact, and terminals of one connector can sit at different depths. `model/datums.ts` holds `datum_node_kind` and the editor default `default_datum` per node kind."
  - "**length estimate**: `{ min_mm, max_mm (positive), method (text, required) }`, a range guessed before measuring. Never used as a length; its evidence (origin `assumed`, with the source page) goes on field `length_estimate`."
  - "**allowances**: `{ end_a, end_b, service_loop_mm }`; each end `{ datum (datum or null), beyond_datum_mm (signed number or null) }`: the wire length from that datum to the cut end of the conductor, slack at that end included (negative when the conductor stops short of the datum, e.g. the mating face or a ring terminal on a stud centre). `service_loop_mm` non-negative or null. Strip length is not an allowance: it is inside the cut length and belongs to terminal part data."
- Section 7 **Length rules**: "`route_length` sums segment `length.nominal_mm` and, separately, `tol_plus_mm` and `tol_minus_mm` along an `ok` route; a band is `null` if any crossed segment's band on that side is `null`. Any crossed `nominal_mm: null` gives `status: "unknown"` with `unknown_segment_ids`; a non-`ok` route is `status: "unavailable"`. `route_end_datums` reads the datum at each wire end from the end segment, in whichever direction it is stored. `check_route_datums` checks the whole route: every crossed segment end has a datum, consecutive segments meet at the same point, and each wire end's allowance datum equals the route's datum there; a same-node wire (`route: []`, length 0) needs both allowance datums equal and on that node's kind. `cut_length` returns a `CutLengthValue` (adds `unknown_allowances` and `datum_problems`): route length + both ends' `beyond_datum_mm` + `service_loop_mm`, with the route's bands unchanged. It is known only if the route is known, every allowance is known and `check_route_datums` finds nothing; datums are never converted. Lengths are rounded to 3 decimal places (`round_mm`)."

- [ ] **Step 9: Commit**

```bash
git add -A packages/core examples docs/data_model.md
git commit -m "feat(core): schema v2 lengths with plus/minus bands, datums, estimates and signed per-end allowances"
```

---

### Task 2: v1 to v2 migration

**Files:**
- Create: `packages/core/src/migrate/v1_to_v2.ts`, `packages/core/test/migrate_v1_to_v2.test.ts`
- Modify: `packages/core/src/migrate/load_document.ts`, `docs/data_model.md`

**Interfaces:**
- Consumes: v2 schema, `route_end_datums`, `default_datum`, frozen `test/fixtures/synthetic_milestone_v1.loom.json` (Task 1); `canonical_json`; `evidence_state`, `review_state`; `derive_wire_list`.
- Produces: `MigrationResult = { ok: true; raw: Record<string, unknown> } | { ok: false; details: string[] }`, `migrate_v1_to_v2(raw): MigrationResult`; `LoadErrorCode` gains `"migration_failed"`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/migrate_v1_to_v2.test.ts`:

```ts
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
```

(Golden order: segments sorted by id put `seg_b1_g1` at index 0; wires put `w1` at index 0.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/migrate_v1_to_v2.test.ts`
Expected: FAIL (cannot resolve `../src/migrate/v1_to_v2.ts`).

- [ ] **Step 3: Implement the migration**

Create `packages/core/src/migrate/v1_to_v2.ts`:

```ts
import * as z from "zod";
import { canonical_json } from "../model/canonical.ts";

type RawRecord = Record<string, unknown>;
export type MigrationResult = { ok: true; raw: RawRecord } | { ok: false; details: string[] };

// Frozen copies of the version 1 shapes this step rewrites. They must never follow later schema changes.
const v1_length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_mm: z.number().nonnegative().nullable(),
  datum: z.string().min(1).max(500).nullable(),
});
const v1_allowances_schema = z.strictObject({
  end_a_mm: z.number().nonnegative(),
  end_b_mm: z.number().nonnegative(),
  service_mm: z.number().nonnegative(),
});
// build_index order without view_positions: evidence and reviews resolve to the first entity with an id.
const v1_indexed_collections = [
  "harnesses", "parts", "connectors", "contacts", "splices", "ground_points", "wires",
  "nodes", "segments", "matings", "assets", "evidence", "reviews",
] as const;

const is_record = (value: unknown): value is RawRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const records_of = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function issues_at(prefix: string, issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string[] {
  return issues.map((issue) => `${[prefix, ...issue.path.map(String)].join(".")}: ${issue.message}`);
}

// Value for value, nothing invented: the symmetric tolerance becomes equal bands, the free-text datum moves to note
// and the measurement points stay unknown (version 1 never recorded them).
function length_to_v2(v: z.infer<typeof v1_length_schema>): RawRecord {
  return { nominal_mm: v.nominal_mm, tol_plus_mm: v.tol_mm, tol_minus_mm: v.tol_mm, datum_a: null, datum_b: null, note: v.datum };
}

// Version 1 kept one number per end: the wire added at that end, from a datum it never recorded.
function allowances_to_v2(v: z.infer<typeof v1_allowances_schema>): RawRecord {
  return {
    end_a: { datum: null, beyond_datum_mm: v.end_a_mm },
    end_b: { datum: null, beyond_datum_mm: v.end_b_mm },
    service_loop_mm: v.service_mm,
  };
}

// A stored value is translated only when it is exactly the canonical JSON of a valid version 1 value. Anything
// else stays as it is; check_record_states proves its state did not change.
function translate_recorded<T>(recorded: unknown, schema: z.ZodType<T>, to_v2: (value: T) => RawRecord): unknown {
  if (typeof recorded !== "string") return recorded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(recorded);
  } catch {
    return recorded;
  }
  const valid = schema.safeParse(parsed);
  if (!valid.success || canonical_json(parsed) !== recorded) return recorded;
  return canonical_json(to_v2(valid.data));
}

function entities_by_id(raw: RawRecord): Map<string, RawRecord[]> {
  const found = new Map<string, RawRecord[]>();
  for (const collection of v1_indexed_collections) {
    for (const entity of records_of(raw[collection])) {
      if (!is_record(entity) || typeof entity["id"] !== "string") continue;
      const list = found.get(entity["id"]) ?? [];
      list.push(entity);
      found.set(entity["id"], list);
    }
  }
  return found;
}

// Every evidence row and review keeps its current or stale state. A migration that would revive a stale record, or
// stale a current one, is refused rather than guessed.
function check_record_states(before: RawRecord, after: RawRecord): string[] {
  const problems: string[] = [];
  const old_index = entities_by_id(before);
  const new_index = entities_by_id(after);
  // Canonical values of one field of every entity with an id, before and after, computed once per (id, field).
  const values_cache = new Map<string, { old_values: string[]; new_values: string[] }>();
  const values_of = (entity_id: string, field: string) => {
    const key = JSON.stringify([entity_id, field]);
    let values = values_cache.get(key);
    if (!values) {
      values = {
        old_values: (old_index.get(entity_id) ?? []).map((entity) => canonical_json(entity[field])),
        new_values: (new_index.get(entity_id) ?? []).map((entity) => canonical_json(entity[field])),
      };
      values_cache.set(key, values);
    }
    return values;
  };
  for (const [collection, key] of [["evidence", "value_json"], ["reviews", "reviewed_value_json"]] as const) {
    const new_records = records_of(after[collection]);
    records_of(before[collection]).forEach((old_record, i) => {
      const new_record = new_records[i];
      if (!is_record(old_record) || !is_record(new_record)) return;
      const entity_id = old_record["entity_id"];
      const field = old_record["field"];
      if (typeof entity_id !== "string" || typeof field !== "string") return;
      const { old_values, new_values } = values_of(entity_id, field);
      if (old_values.length > 1 && JSON.stringify(old_values) !== JSON.stringify(new_values)) {
        problems.push(`${collection}.${i}: id ${entity_id} is used more than once and its ${field} changed, so the target is ambiguous`);
        return;
      }
      const was_current = old_values[0] !== undefined && old_values[0] === old_record[key];
      const is_current = new_values[0] !== undefined && new_values[0] === new_record[key];
      if (was_current !== is_current) {
        problems.push(`${collection}.${i}: ${entity_id}.${field} would change from ${was_current ? "current" : "stale"} to ${is_current ? "current" : "stale"}`);
      }
    });
  }
  return problems;
}

export function migrate_v1_to_v2(raw: RawRecord): MigrationResult {
  const details: string[] = [];
  const segment_ids = new Set<string>();
  const wire_ids = new Set<string>();
  const next: RawRecord = { ...raw, schema_version: 2 };
  if (Array.isArray(raw["segments"])) {
    next["segments"] = raw["segments"].map((s: unknown, i: number) => {
      if (!is_record(s)) return s;
      if (typeof s["id"] === "string") segment_ids.add(s["id"]);
      if ("length_estimate" in s) details.push(`segments.${i}.length_estimate: not a schema_version 1 field`);
      const length = v1_length_schema.safeParse(s["length"]);
      if (!length.success) {
        details.push(...issues_at(`segments.${i}.length`, length.error.issues));
        return s;
      }
      return { ...s, length: length_to_v2(length.data), length_estimate: null };
    });
  }
  if (Array.isArray(raw["wires"])) {
    next["wires"] = raw["wires"].map((w: unknown, i: number) => {
      if (!is_record(w)) return w;
      if (typeof w["id"] === "string") wire_ids.add(w["id"]);
      const allowances = v1_allowances_schema.safeParse(w["allowances"]);
      if (!allowances.success) {
        details.push(...issues_at(`wires.${i}.allowances`, allowances.error.issues));
        return w;
      }
      return { ...w, allowances: allowances_to_v2(allowances.data) };
    });
  }
  if (details.length > 0) return { ok: false, details };
  const translate = (entity_id: unknown, field: unknown, recorded: unknown): unknown => {
    if (typeof entity_id !== "string") return recorded;
    if (field === "length" && segment_ids.has(entity_id)) return translate_recorded(recorded, v1_length_schema, length_to_v2);
    if (field === "allowances" && wire_ids.has(entity_id)) return translate_recorded(recorded, v1_allowances_schema, allowances_to_v2);
    return recorded;
  };
  if (Array.isArray(raw["evidence"])) {
    next["evidence"] = raw["evidence"].map((e: unknown) => (is_record(e) ? { ...e, value_json: translate(e["entity_id"], e["field"], e["value_json"]) } : e));
  }
  if (Array.isArray(raw["reviews"])) {
    next["reviews"] = raw["reviews"].map((r: unknown) => (is_record(r) ? { ...r, reviewed_value_json: translate(r["entity_id"], r["field"], r["reviewed_value_json"]) } : r));
  }
  const state_problems = check_record_states(raw, next);
  return state_problems.length > 0 ? { ok: false, details: state_problems } : { ok: true, raw: next };
}
```

In `packages/core/src/migrate/load_document.ts`:
- add `import { migrate_v1_to_v2, type MigrationResult } from "./v1_to_v2.ts";`
- `export type LoadErrorCode = "not_object" | "wrong_format" | "future_version" | "unsupported_version" | "migration_failed" | "invalid_document";`
- replace the migrations comment and constant:

```ts
// migrations[i] upgrades schema_version i + 1 to i + 2, or refuses with the paths it cannot migrate.
const migrations: ReadonlyArray<(raw: RawDocument) => MigrationResult> = [migrate_v1_to_v2];
```

- replace the migration loop:

```ts
  for (let from = version; from < current_schema_version; from += 1) {
    const step = migrations[from - 1];
    if (!step) return fail(log, "unsupported_version", `no migration from schema_version ${from}`);
    const migrated = step(record);
    if (!migrated.ok) return fail(log, "migration_failed", `schema_version ${from} document cannot be migrated to ${from + 1}`, migrated.details);
    record = migrated.raw;
    log.info("document migrated", { from, to: from + 1 });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/test/migrate_v1_to_v2.test.ts` then `pnpm check`
Expected: PASS.

- [ ] **Step 5: Update docs/data_model.md**

At the end of section 2 add:

"**Migrations** (`migrate/load_document.ts`; one file per step, `migrate/v1_to_v2.ts`): an older `schema_version` is upgraded step by step before schema validation; a newer one is rejected (`future_version`); a step that cannot migrate fails with `migration_failed` and the paths. Version 1 to 2 maps value for value and invents nothing: `tol_mm` becomes equal `tol_plus_mm` and `tol_minus_mm`; the free-text `datum` moves to `note`, `datum_a`/`datum_b` are `null`; `allowances.end_a_mm`/`end_b_mm` become that end's `beyond_datum_mm` with `datum: null`; `service_mm` becomes `service_loop_mm`; `length_estimate` is `null`. Migrated cut lengths are therefore unknown until the datums are recorded, then exactly what version 1 computed. Each rewritten value must match the frozen version 1 shape exactly (no extra, missing or null-where-required keys); nothing is repaired. Evidence and review value JSON is translated only when it is exactly the canonical JSON of a valid version 1 value, and every evidence row and review must keep its current or stale state (targets resolved like `build_index`); otherwise the load fails."

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/migrate packages/core/test/migrate_v1_to_v2.test.ts docs/data_model.md
git commit -m "feat(core): migrate schema_version 1 documents to 2 without repairing or reviving anything"
```

---

### Task 3: Structural rules for datums and estimates

**Files:**
- Modify: `packages/core/src/validate/structural.ts`, `packages/core/test/structural.test.ts`, `packages/core/test/apply_batch.test.ts`, `docs/data_model.md`

**Interfaces:**
- Consumes: `datum_node_kind` (model/datums.ts), segment `length.datum_a`/`datum_b`, `length_estimate` (Task 1); `apply_batch`, `make_batch`, `apply_ok`.
- Produces: `S_DATUM_NODE_KIND` (path `segments/<id>/length/datum_a|datum_b`), `S_LENGTH_ESTIMATE_RANGE` (path `segments/<id>/length_estimate`).

- [ ] **Step 1: Write the failing tests**

Add inside `describe("validate_structure", ...)` in `packages/core/test/structural.test.ts`:

```ts
  it("requires each segment datum to be a point on the node it measures to", () => {
    const base = small_doc();
    const seg = base.segments[0]!;
    const doc = { ...base, segments: [{ ...seg, length: { ...seg.length, datum_a: "breakout_centre" as const } }] };
    expect(validate_structure(doc).map((issue) => `${issue.code}:${issue.path}`)).toEqual(["S_DATUM_NODE_KIND:segments/s1/length/datum_a"]);
  });

  it("rejects an estimate whose min exceeds its max and accepts a single-value range", () => {
    const base = small_doc();
    const with_estimate = (min_mm: number, max_mm: number): LoomDocument => ({
      ...base, segments: [{ ...base.segments[0]!, length_estimate: { min_mm, max_mm, method: "synthetic" } }],
    });
    expect(validate_structure(with_estimate(600, 400)).map((issue) => `${issue.code}:${issue.path}`)).toEqual(["S_LENGTH_ESTIMATE_RANGE:segments/s1/length_estimate"]);
    expect(validate_structure(with_estimate(500, 500))).toEqual([]);
  });
```

In `packages/core/test/apply_batch.test.ts` change the helpers import to `import { harness, node, open_end, segment, small_doc, spec, to_contact, wire } from "./helpers/entities.ts";`, change the canonical import to `import { canonical_json, to_canonical_file } from "../src/model/canonical.ts";`, add `import type { Command } from "../src/schema/commands.ts";`, `import { build_index } from "../src/model/doc_index.ts";` and `import { evidence_state } from "../src/validate/review_state.ts";`, and add inside `describe("apply_batch", ...)`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/structural.test.ts packages/core/test/apply_batch.test.ts`
Expected: FAIL (the new structural tests get `[]`; the node kind and inverted estimate batches are accepted; `repair_required` is not raised).

- [ ] **Step 3: Implement**

In `packages/core/src/validate/structural.ts`:
- add `import { datum_node_kind } from "../model/datums.ts";`
- replace the `for (const s of doc.segments)` loop in `check_topology` with:

```ts
  for (const s of doc.segments) {
    for (const side of ["node_a", "node_b"] as const) {
      const found = index.nodes.get(s[side]);
      if (!found) emit("S_REF_MISSING", `node ${s[side]} not found`, entity_path("segments", s.id, side), s.id, "join existing nodes");
      else if (found.harness_id !== s.harness_id) emit("S_HARNESS_MISMATCH", `node ${found.id} is in harness ${found.harness_id}`, entity_path("segments", s.id, side), s.id, "join nodes of the segment's harness");
      const datum_field = side === "node_a" ? "datum_a" : "datum_b";
      const datum = s.length[datum_field];
      if (found && datum !== null && datum_node_kind[datum] !== found.kind) {
        emit("S_DATUM_NODE_KIND", `${datum_field} ${datum} is not a point on ${found.kind} node ${found.id}`, entity_path("segments", s.id, "length", datum_field), s.id, `measure ${side} to a ${found.kind} datum`);
      }
    }
    if (s.node_a === s.node_b) emit("S_SEGMENT_LOOP", "segment starts and ends at the same node", entity_path("segments", s.id), s.id, "a segment joins two different nodes");
    const estimate = s.length_estimate;
    if (estimate !== null && estimate.min_mm > estimate.max_mm) {
      emit("S_LENGTH_ESTIMATE_RANGE", `estimate min ${estimate.min_mm} mm exceeds max ${estimate.max_mm} mm`, entity_path("segments", s.id, "length_estimate"), s.id, "correct the estimate bounds");
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/test/structural.test.ts packages/core/test/apply_batch.test.ts` then `pnpm check`
Expected: PASS.

- [ ] **Step 5: Update docs/data_model.md**

Structural table, after `S_SEGMENT_LOOP`:

```
| `S_DATUM_NODE_KIND` | a segment's `datum_a`/`datum_b` is not a point on the kind of node at that end (`datum_node_kind` in `model/datums.ts`); a batch that changes a node's kind must fix the datums in the same batch |
| `S_LENGTH_ESTIMATE_RANGE` | a segment's `length_estimate.min_mm` is greater than its `max_mm` |
```

Section 5 (command log), add: "**Format contract**: `command_schema_version` versions the batch envelope. Batches and inverse batches are built against the current document format; callers discard pending batches and undo stacks when a document is migrated. Entity payloads are validated against the current schema (an old-shaped segment or wire is `invalid_entity`); evidence `value_json` is an opaque string, so an insert carrying an old-format value is accepted and is simply stale."

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/validate/structural.ts packages/core/test/structural.test.ts packages/core/test/apply_batch.test.ts docs/data_model.md
git commit -m "feat(core): structural checks for segment datums and estimate ranges"
```

---

### Task 4: Completeness rules and the enriched fixture

**Files:**
- Modify: `packages/core/src/validate/completeness.ts`, `packages/core/test/fixtures/synthetic_milestone.ts`, `packages/core/test/completeness.test.ts`, `packages/core/test/topology.test.ts`, `packages/core/test/wire_list_bom.test.ts`
- Regenerate: `examples/synthetic_milestone/synthetic_milestone.loom.json`
- Docs: `docs/data_model.md`, `docs/c4model.md`, `todo.md`, this plan

**Interfaces:**
- Consumes: `analyse_route`, `route_length`, `check_route_datums`, `cut_length`, `unknown_allowances` (topology.ts); `evidence_state`, `make_evidence`, `make_review`; `make_length`.
- Produces: `M_LENGTH_UNMEASURED`, `M_LENGTH_DATUM_UNKNOWN` (segment, `segments/<id>/length`), `M_ROUTE_DATUM_MISMATCH` (wire, `wires/<id>/route`), `M_ALLOWANCE_UNKNOWN` (wire, `wires/<id>/allowances`), `M_ALLOWANCE_DATUM_MISMATCH` (wire, `wires/<id>/allowances/end_a|end_b/datum`), `M_CUT_LENGTH_NOT_POSITIVE` (wire, `wires/<id>/allowances`), `W_LENGTH_OUTSIDE_ESTIMATE` (segment, `segments/<id>/length`).

- [ ] **Step 1: Enrich the fixture**

In `packages/core/test/fixtures/synthetic_milestone.ts`:
- after `synthetic_asset_sha256` add:

```ts
// sha256 of the text "loomsmith synthetic photo asset"; the photo itself does not exist.
export const synthetic_photo_sha256 = "660550cd0c2d9364fa5dbb5eb8f493d9acb8641b58063a93a680145cde064a84";
```

- extend the header comment's coverage list with: "measured (with a photo), documented and assumed length evidence, datums, an estimate a documented length falls outside, an unknown beyond-datum allowance".
- before `doc = apply_ok(doc, [` (the `b_build` batch) add:

```ts
  const estimate = (min_mm: number, max_mm: number) => ({ min_mm, max_mm, method: "synthetic body-dimension estimate" });
  const w4 = wire("w4", E, "W4", [to_contact("j1", "2"), to_ground("g1")], spec(0.85, "B"), ["seg_j1_b1", "seg_b1_g1"]);
```

- in `b_build`, change the `seg_j1_b1` and `seg_s1_j2` inserts and the `w4` insert to:

```ts
    cmd_insert("segments", { ...segment("seg_j1_b1", E, "n_j1", "n_b1", 300, 5, 0, [at_connector, at_breakout]), length_estimate: estimate(250, 350) }),
```

```ts
    cmd_insert("segments", { ...segment("seg_s1_j2", E, "n_s1", "n_j2", 450, 5, 0, [at_splice, at_connector]), length_estimate: estimate(500, 700) }),
```

```ts
    // Ring terminal not chosen yet: the wire beyond the stud centre is unknown.
    cmd_insert("wires", { ...w4, allowances: { ...w4.allowances, end_b: { ...w4.allowances.end_b, beyond_datum_mm: null } } }),
```

- in `b_build`, after the `a_diagram` asset insert, add:

```ts
    cmd_insert("assets", {
      id: "a_photo_seg_j1_b1",
      sha256: synthetic_photo_sha256,
      media_type: "image/jpeg",
      blob_ref: "synthetic://fixture/seg_j1_b1_tape.jpg",
      title: "synthetic photo placeholder: tape along seg_j1_b1 (no real content)",
    }),
```

- in `b_review`, change `e_seg_j1_b1_length` to cite the photo and add two evidence rows after it:

```ts
    cmd_insert("evidence", make_evidence(index, {
      id: "e_seg_j1_b1_length", entity_id: "seg_j1_b1", field: "length", origin: "measured",
      source: { asset_id: "a_photo_seg_j1_b1", page_index: 0, bbox: null }, note: "synthetic tape measurement, tape in frame",
    })),
    cmd_insert("evidence", make_evidence(index, {
      id: "e_seg_s1_j2_length", entity_id: "seg_s1_j2", field: "length", origin: "documented",
      source: { asset_id: "a_diagram", page_index: 0, bbox: null }, note: "synthetic formboard dimension",
    })),
    cmd_insert("evidence", make_evidence(index, {
      id: "e_seg_b1_g1_length", entity_id: "seg_b1_g1", field: "length", origin: "assumed", source: null, note: "synthetic guess, not measured",
    })),
```

- [ ] **Step 2: Write the failing tests**

In `packages/core/test/completeness.test.ts`:
- imports: `import type { Evidence, LoomDocument } from "../src/schema/document.ts";`, `import type { Datum } from "../src/schema/primitives.ts";`, add `make_evidence` to the review_state import, and `import { make_length } from "../src/model/make_length.ts";`.
- replace `complete_small_doc` and add two helpers:

```ts
// small_doc with every part identified and its segment measured: no completeness issue at all. `change` edits the
// document before the measurement evidence is recorded, so the evidence describes the changed value.
function complete_small_doc(change: (doc: LoomDocument) => LoomDocument = (doc) => doc): LoomDocument {
  const base = small_doc();
  const doc = change({
    ...base,
    parts: [part("p_housing", "housing", "SYN-H2", "2-way housing (synthetic)"), part("p_terminal", "terminal", "SYN-T1", "terminal (synthetic)")],
    connectors: base.connectors.map((c) => ({ ...c, housing: identified("p_housing") })),
    contacts: base.contacts.map((k) => ({ ...k, terminal: identified("p_terminal") })),
  });
  const measured = make_evidence(build_index(doc), { id: "e_s1_length", entity_id: "s1", field: "length", origin: "measured", source: null, note: null });
  return { ...doc, evidence: [...doc.evidence, measured] };
}

const build_codes = (doc: LoomDocument) => validate(doc, { level: "build", harness_ids: null }).map((issue) => `${issue.code}:${issue.entity_id}`);
const build_paths = (doc: LoomDocument) => validate(doc, { level: "build", harness_ids: null }).map((issue) => `${issue.code}:${issue.severity}:${issue.path}`);
```

- the fixture list test expects:

```ts
    expect(issues.map((issue) => `${issue.code}:${issue.entity_id}`)).toEqual([
      "M_ALLOWANCE_UNKNOWN:w4",
      "M_LENGTH_UNKNOWN:w3",
      "M_LENGTH_UNKNOWN:w5",
      "M_LENGTH_UNMEASURED:seg_b1_g1",
      "M_LENGTH_UNMEASURED:seg_b1_s1",
      "M_PART_UNIDENTIFIED:x2_k1",
      "M_PART_UNIDENTIFIED:x2_k2",
      "M_PART_UNIDENTIFIED:x2",
      "M_WIRE_SPEC_UNKNOWN:w8",
      "M_WIRE_UNROUTED:w7",
      "M_WIRE_UNROUTED:w8",
      "W_INFERRED_UNREVIEWED:w7",
      "W_LENGTH_OUTSIDE_ESTIMATE:seg_s1_j2",
      "W_REVIEW_STALE:w2",
    ]);
```

- the scope test expects `["w4", "w3", "w5", "seg_b1_g1", "seg_b1_s1"]`.
- the evidence stale test adds after its assertion: ``expect(validate_completeness(remeasured).map((issue) => `${issue.code}:${issue.entity_id}`)).toContain("M_LENGTH_UNMEASURED:seg_j1_b1");``
- add:

```ts
  it("accepts only current measured or documented evidence for a routed segment length", () => {
    const complete = complete_small_doc();
    const with_origin = (origin: Evidence["origin"]): LoomDocument => ({ ...complete, evidence: complete.evidence.map((e) => ({ ...e, origin })) });
    expect(build_codes(with_origin("documented"))).toEqual([]);
    expect(build_codes(with_origin("assumed"))).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    expect(build_codes(with_origin("inferred"))).toEqual(["M_LENGTH_UNMEASURED:s1", "W_INFERRED_UNREVIEWED:s1"]);
    const inferred = with_origin("inferred");
    const approved = { ...inferred, reviews: [make_review(inferred, build_index(inferred), { id: "r_s1_length", entity_id: "s1", field: "length", status: "approved" })] };
    expect(build_codes(approved)).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    expect(build_codes({ ...complete, evidence: [] })).toEqual(["M_LENGTH_UNMEASURED:s1"]);
    const length = make_length({ nominal_mm: 505, tol_plus_mm: 5, datum_a: "connector_back_face", datum_b: "connector_back_face" });
    expect(build_codes({ ...complete, segments: complete.segments.map((s) => ({ ...s, length })) })).toEqual(["M_LENGTH_UNMEASURED:s1", "W_EVIDENCE_STALE:s1"]);
  });

  it("only asks to measure segments that a routed wire crosses", () => {
    const complete = complete_small_doc();
    const spare = {
      ...complete,
      nodes: [...complete.nodes, node("n_b1", "h1", "breakout", null)],
      segments: [...complete.segments, segment("s2", "h1", "n_j1", "n_b1", 100, 2)],
    };
    expect(validate(spare, { level: "build", harness_ids: null })).toEqual([]);
  });

  it("requires both datums on a routed segment", () => {
    const unmarked = complete_small_doc((doc) => ({ ...doc, segments: doc.segments.map((s) => ({ ...s, length: { ...s.length, datum_b: null } })) }));
    const issues = validate(unmarked, { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_LENGTH_DATUM_UNKNOWN:error:segments/s1/length"]);
    expect(issues[0]?.message).toContain("node_b");
  });

  it("flags an allowance given from another datum than the route was measured to", () => {
    const shifted = complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, allowances: { ...w.allowances, end_a: { datum: "connector_mating_face" as const, beyond_datum_mm: -5 } } })),
    }));
    expect(build_paths(shifted)).toEqual(["M_ALLOWANCE_DATUM_MISMATCH:error:wires/w1/allowances/end_a/datum"]);
  });

  it("checks the datums where consecutive segments meet at the connector they pass", () => {
    const through_j3 = (s1_datum_at_j3: Datum | null) => complete_small_doc((doc) => ({
      ...doc,
      connectors: [...doc.connectors, { ...connector("j3", "h1", "J3", ["1"]), housing: identified("p_housing") }],
      nodes: [...doc.nodes, node("n_j3", "h1", "connector", "j3")],
      segments: [
        segment("s1", "h1", "n_j1", "n_j3", 200, 5, 0, ["connector_back_face", s1_datum_at_j3]),
        segment("s2", "h1", "n_j3", "n_j2", 300, 5, 0, ["connector_back_face", "connector_back_face"]),
      ],
      wires: doc.wires.map((w) => ({ ...w, route: ["s1", "s2"] })),
    }));
    // Only s1 carries the recorded measurement evidence, so s2 is also unmeasured.
    expect(build_paths(through_j3("connector_mating_face"))).toEqual(["M_LENGTH_UNMEASURED:error:segments/s2/length", "M_ROUTE_DATUM_MISMATCH:error:wires/w1/route"]);
    const unmarked = validate(through_j3(null), { level: "build", harness_ids: null });
    expect(unmarked.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_LENGTH_DATUM_UNKNOWN:error:segments/s1/length", "M_LENGTH_UNMEASURED:error:segments/s2/length"]);
    expect(is_release_ready(unmarked)).toBe(false);
  });

  it("measures a same-node wire from one point on that node", () => {
    const jumper = (end_b: "connector_back_face" | "connector_mating_face") => complete_small_doc((doc) => ({
      ...doc,
      contacts: [...doc.contacts, { ...contact("j1", "2"), terminal: identified("p_terminal") }],
      wires: doc.wires.map((w) => ({ ...w, ends: [to_contact("j1", "1"), to_contact("j1", "2")] as typeof w.ends, route: [], allowances: { ...w.allowances, end_b: { datum: end_b, beyond_datum_mm: 20 } } })),
    }));
    const same_point = validate(jumper("connector_back_face"), { level: "build", harness_ids: null });
    expect(same_point).toEqual([]);
    const two_points = validate(jumper("connector_mating_face"), { level: "build", harness_ids: null });
    expect(two_points.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ALLOWANCE_DATUM_MISMATCH:error:wires/w1/allowances/end_b/datum"]);
    expect(is_release_ready(two_points)).toBe(false);
  });

  it("flags unknown allowances whatever the route status", () => {
    const unknown_beyond = (route: string[] | null) => complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, route, allowances: { ...w.allowances, end_b: { ...w.allowances.end_b, beyond_datum_mm: null } } })),
    }));
    const routed = validate(unknown_beyond(["s1"]), { level: "build", harness_ids: null });
    expect(routed.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["M_ALLOWANCE_UNKNOWN:error:wires/w1/allowances"]);
    expect(routed[0]?.message).toContain("end_b.beyond_datum_mm");
    expect(validate(unknown_beyond(null), { level: "build", harness_ids: null }).map((issue) => issue.code)).toEqual(["M_ALLOWANCE_UNKNOWN", "M_WIRE_UNROUTED"]);
  });

  it("flags a cut length that is not positive", () => {
    const short = complete_small_doc((doc) => ({
      ...doc, wires: doc.wires.map((w) => ({ ...w, allowances: { ...w.allowances, end_a: { ...w.allowances.end_a, beyond_datum_mm: -600 } } })),
    }));
    expect(build_paths(short)).toEqual(["M_CUT_LENGTH_NOT_POSITIVE:error:wires/w1/allowances"]);
  });

  it("warns when a length falls outside its estimate, without staling the length evidence", () => {
    const complete = complete_small_doc();
    const with_estimate = (min_mm: number, max_mm: number): LoomDocument => ({
      ...complete, segments: complete.segments.map((s) => ({ ...s, length_estimate: { min_mm, max_mm, method: "synthetic" } })),
    });
    const issues = validate(with_estimate(400, 450), { level: "build", harness_ids: null });
    expect(issues.map((issue) => `${issue.code}:${issue.severity}:${issue.path}`)).toEqual(["W_LENGTH_OUTSIDE_ESTIMATE:warning:segments/s1/length"]);
    expect(is_release_ready(issues)).toBe(true);
    expect(validate(with_estimate(500, 500), { level: "build", harness_ids: null })).toEqual([]);
  });
```

(small_doc's W1: 500 mm, 20 mm beyond each back face. With end_a at -600 the cut length is -80 mm. With `route: null` the length rules do not run.)

In `packages/core/test/topology.test.ts` add to the known-length test:

```ts
    expect(cut_length(index, w("W4"))).toEqual({
      status: "unknown", nominal_mm: null, tol_plus_mm: null, tol_minus_mm: null, unknown_segment_ids: [], unknown_allowances: ["end_b.beyond_datum_mm"], datum_problems: [],
    });
```

In `packages/core/test/wire_list_bom.test.ts` the BOM line `wire_line("0.85 mm2 B", 420, 420, 0)` becomes `wire_line("0.85 mm2 B", null, 0, 1)`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/completeness.test.ts`
Expected: FAIL (no new issue codes emitted yet).

- [ ] **Step 4: Implement**

In `packages/core/src/validate/completeness.ts`:
- first import: `import { analyse_route, check_route_datums, cut_length, route_length, unknown_allowances } from "../derive/topology.ts";`
- `validate_completeness` calls `check_lengths(doc, index, options, emit);` right after `check_wires(...)`.
- in `check_wires`, after the `M_WIRE_SPEC_UNKNOWN` check:

```ts
    const missing = unknown_allowances(w);
    if (missing.length > 0) {
      emit("M_ALLOWANCE_UNKNOWN", "error", `${w.label} has unknown allowance(s) ${missing.join(", ")}`, entity_path("wires", w.id, "allowances"), w.id, "record each end's datum and wire beyond it, and the service loop (0 when there is none)");
    }
```

- replace the `case "ok"` block with:

```ts
      case "ok": {
        const length = route_length(index, w);
        if (length.status === "unknown") {
          emit("M_LENGTH_UNKNOWN", "error", `${w.label} crosses unmeasured segment(s) ${length.unknown_segment_ids.join(", ")}`, route_path, w.id, "measure the listed bundle segments");
        }
        // Unknown segment datums are M_LENGTH_DATUM_UNKNOWN on the segment (check_lengths).
        const datums = check_route_datums(index, w);
        if (datums !== null && datums.join_conflicts.length > 0) {
          emit("M_ROUTE_DATUM_MISMATCH", "error", `${w.label} joins segments measured to different points: ${datums.join_conflicts.join("; ")}`, route_path, w.id, "measure consecutive segments to the same point where they meet");
        }
        for (const conflict of datums?.allowance_conflicts ?? []) {
          emit("M_ALLOWANCE_DATUM_MISMATCH", "error", `${w.label} ${conflict.message}`, entity_path("wires", w.id, "allowances", conflict.side, "datum"), w.id, "give the allowance from the datum the route has at that end");
        }
        const cut = cut_length(index, w);
        if (cut.status === "known" && cut.nominal_mm !== null && cut.nominal_mm <= 0) {
          emit("M_CUT_LENGTH_NOT_POSITIVE", "error", `${w.label} cut length ${cut.nominal_mm} mm is not positive`, entity_path("wires", w.id, "allowances"), w.id, "check the route lengths and the wire beyond each datum");
        }
        break;
      }
```

- after `check_wires` add:

```ts
// Origins that make a segment length buildable. inferred and assumed values are proposals, even when approved.
const trusted_length_origins: ReadonlySet<string> = new Set(["measured", "documented"]);

function check_lengths(doc: LoomDocument, index: DocIndex, options: ScopeOptions, emit: Emit): void {
  const trusted = new Set<string>();
  for (const e of doc.evidence) {
    if (e.field === "length" && trusted_length_origins.has(e.origin) && evidence_state(index, e) === "current") trusted.add(e.entity_id);
  }
  // Same boundary as M_LENGTH_UNKNOWN: segments crossed by an in-scope wire whose route is ok.
  const routed = new Set<string>();
  for (const w of doc.wires) {
    if (!in_scope(options, w.harness_id) || w.route === null || analyse_route(index, w).status !== "ok") continue;
    for (const segment_id of w.route) routed.add(segment_id);
  }
  for (const s of doc.segments) {
    if (!in_scope(options, s.harness_id)) continue;
    const path = entity_path("segments", s.id, "length");
    if (routed.has(s.id)) {
      const unmarked = [s.length.datum_a === null ? "node_a" : null, s.length.datum_b === null ? "node_b" : null].filter((side) => side !== null);
      if (unmarked.length > 0) {
        emit("M_LENGTH_DATUM_UNKNOWN", "error", `segment ${s.id} does not say where it was measured to at ${unmarked.join(" and ")}`, path, s.id, "record datum_a and datum_b (for example connector_back_face, breakout_centre)");
      }
    }
    const nominal = s.length.nominal_mm;
    if (nominal === null) continue;
    if (routed.has(s.id) && !trusted.has(s.id)) {
      emit("M_LENGTH_UNMEASURED", "error", `segment ${s.id} length ${nominal} mm has no current measured or documented evidence`, path, s.id, "measure the segment and record measured evidence");
    }
    const estimate = s.length_estimate;
    if (estimate !== null && (nominal < estimate.min_mm || nominal > estimate.max_mm)) {
      emit("W_LENGTH_OUTSIDE_ESTIMATE", "warning", `segment ${s.id} length ${nominal} mm is outside its estimate ${estimate.min_mm} to ${estimate.max_mm} mm`, path, s.id, "check the measurement for a typo, then correct the length or the estimate");
    }
  }
}
```

- [ ] **Step 5: Regenerate the golden file and run the suite**

```bash
pnpm vitest run -u packages/core/test/synthetic_milestone.test.ts
pnpm check
```

Expected: PASS. The golden diff shows only: estimates on `seg_j1_b1` and `seg_s1_j2`; `beyond_datum_mm: null` on `w4` end_b; asset `a_photo_seg_j1_b1`; `e_seg_j1_b1_length` citing it with the new note; evidence `e_seg_s1_j2_length` and `e_seg_b1_g1_length`.

- [ ] **Step 6: Docs and bookkeeping**

`docs/data_model.md`:
- section 1: "Last verified" line updated to today, branch `feat/length_capture`, and the actual passing test and file counts from `pnpm check`.
- section 4 (evidence and review), add: "Photos: an image asset (`media_type` `image/...`) cited with `source: { asset_id, page_index: 0, bbox: null }`; image regions are not addressed yet. A length measurement should cite a photo with the tape in frame."
- completeness table, after `M_LENGTH_UNKNOWN`:

```
| `M_LENGTH_UNMEASURED` | a segment crossed by an `ok` route has a `nominal_mm` but no current evidence on `length` with origin `measured` or `documented` (`inferred` and `assumed` never count, even approved) |
| `M_LENGTH_DATUM_UNKNOWN` | a segment crossed by an `ok` route has `datum_a` or `datum_b` `null` |
| `M_ROUTE_DATUM_MISMATCH` | on an `ok` route, two consecutive segments were measured to different points of the node where they meet (for example a connector's mating face and its back face), so the distance between the points is in neither |
| `M_ALLOWANCE_UNKNOWN` | a wire has an unknown (`null`) allowance field, whatever its route status; the message lists them |
| `M_ALLOWANCE_DATUM_MISMATCH` | on an `ok` route, a wire end's allowance datum differs from the datum the route was measured to at that end (datums are never converted); on a same-node wire (`route: []`), an allowance datum is not a point on that node's kind or the two ends' datums differ |
| `M_CUT_LENGTH_NOT_POSITIVE` | a known cut length is 0 or less (possible with negative `beyond_datum_mm`) |
```

- review warnings table, after `W_INFERRED_UNREVIEWED`:

```
| `W_LENGTH_OUTSIDE_ESTIMATE` | an in-scope segment's `nominal_mm` is below `length_estimate.min_mm` or above `max_mm` (bounds inclusive), whatever its evidence or routing: check for a typo before cutting |
```

`docs/c4model.md`: the `migrate/load_document.ts` component row becomes "`migrate/load_document.ts`, `migrate/v1_to_v2.ts` | schema_version checks, step-by-step migrations (1 to 2: plus/minus tolerance, datums, per-end allowances from a datum; validates against frozen v1 shapes, translates evidence and review value JSON, refuses any current/stale flip), parse"; add `model/make_length.ts`, `model/datums.ts` to the component table ("length builder with the never-short default; datum to node kind map and editor defaults"); add to Invariants: "- Unknown is never 0: an unknown segment length, datum or allowance makes every cut length that depends on it unknown; datums are checked along the whole route and never converted; a routed length is buildable only with current measured or documented evidence." and "- Migrations never repair data and never change whether an evidence row or review is current."

`todo.md`: in "Deferred from M1 review" mark the "nullable allowances" part of the M1b checklist done (schema v2); mark "Later: `route: []` on a same-node wire yields known length 0" as resolved (route length 0 is right for a same-node wire; its cut length is the allowances, given from one point on that node, else `M_ALLOWANCE_DATUM_MISMATCH`). Add a section "## Length capture (28 Sep 2026)" with checked items for Tasks 1 to 4 and open items: "M2 CLI and M4 web: discard pending batches and undo stacks after a migration", "M4 measure mode (prefill `default_datum`)", "terminal part data: strip length, insertion depth", "photo-assisted measurement spike (after M4)", "rope method for new designs".

This plan: Status "done (date)", Deviations filled in.

- [ ] **Step 7: Commit**

```bash
git add -A packages/core examples docs todo.md
git commit -m "feat(core): block unmeasured or unpinned lengths and unknown allowances, warn on lengths outside their estimate"
```

---

## Verification

- `pnpm check` green after every task; the final count is 99 plus the new tests, none removed.
- The migration tests prove: the M1 golden file loads; values survive exactly; cut lengths return to the v1 values once datums are recorded; evidence and reviews keep their states; malformed or ambiguous input is refused, never repaired.
- Purity scan before the last commit: `ast-grep --pattern 'Date.now()' packages/core/src` and `ast-grep --pattern 'Math.random()' packages/core/src` return nothing; the core typecheck (`types: []`) rejects any `node:` import.
- Codex astra review of the branch diff before merge; merge only when the owner says so.

## Out of scope

- M4 measure mode, photo-assisted measurement, rope method (spec steps 4 to 6).
- Datum conversion (for example back face to mating face through connector depth): needs connector geometry from part data.
- A `terminal_tip` datum: needs a datum that names its contact (D15).
- Strip length and terminal insertion depth as terminal part data.

## Risks

- Evidence is bound to the whole `length` object (top-level field granularity, M1 decision): adding a datum or note after measuring stales the measured evidence until it is recorded again. Intended (the datum is part of what was measured) but may feel strict in the editor.
- Every existing document gains `M_LENGTH_UNMEASURED` and `M_LENGTH_DATUM_UNKNOWN` errors, and migrated documents lose their cut lengths until datums are recorded: intended, since no loomsmith document has real measurements yet and v1 never recorded datums.
- Unrecognised evidence strings are left as they are; a document whose migration would flip a record's state cannot be loaded until it is fixed by hand (the error names the record).

## Status

Planned 28 Sep 2026. Revision 2 after codex astra r1 (3 blocking, 4 should-fix, 1 nit, all addressed). Revision 3 after codex astra r2 (/Users/macmini/projects/codex/loomsmith_length_capture_plan_review_r2_28092026.txt: 2 blocking, 2 should-fix, 1 nit, all addressed; r2 confirmed the r1 fixes, the arithmetic, issue order and type-checking at every task boundary). Codex astra r3 (/Users/macmini/projects/codex/loomsmith_length_capture_plan_review_r3_28092026.txt): no runtime defect; one missing regression (unknown datum at an internal join) added to Tasks 1 and 4.

Done (28 Sep 2026). Tasks 1 to 4 implemented on branch `feat/length_capture`: schema v2, the v1-to-v2 migration, structural checks (`S_DATUM_NODE_KIND`, `S_LENGTH_ESTIMATE_RANGE`) and the build-level completeness rules (`M_LENGTH_UNMEASURED`, `M_LENGTH_DATUM_UNKNOWN`, `M_ROUTE_DATUM_MISMATCH`, `M_ALLOWANCE_UNKNOWN`, `M_ALLOWANCE_DATUM_MISMATCH`, `M_CUT_LENGTH_NOT_POSITIVE`, `W_LENGTH_OUTSIDE_ESTIMATE`) with the enriched synthetic fixture. `pnpm check` passes: 135 tests (14 files). Merge only when the owner says so.

## Deviations

- 28 Sep 2026, before execution (codex r1): per-end allowances are `{ datum, beyond_datum_mm }` instead of the spec's strip / insertion / slack split (D5); migration keeps v1 end allowances as `beyond_datum_mm` with unknown datums instead of inventing a split (D7); added `M_LENGTH_DATUM_UNKNOWN`, `M_ALLOWANCE_DATUM_MISMATCH`, `M_CUT_LENGTH_NOT_POSITIVE` and load error `migration_failed`.
- 28 Sep 2026, before execution (codex r2): datums are checked at every route join, not only the wire ends (`check_route_datums`, `M_ROUTE_DATUM_MISMATCH`); a same-node wire needs both allowance datums equal and on that node's kind; `terminal_tip` removed from the datum list (D15, a spec deviation); the migration test matrix covers evidence, approvals and rejections; batch tests cover old allowance payloads and opaque old evidence values.
- 28 Sep 2026, Task 4 execution: no deviations from the task-4 brief. Fixture, tests, implementation and docs match the brief's exact code and text verbatim.
