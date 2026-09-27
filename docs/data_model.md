# loomsmith data model

Category: Reference.

## 1. Scope

This document describes the file format, entities, evidence/review model, command log
and derivations implemented in `@loomsmith/core` as of M1 (Task 10). It documents only
what the code in `/Users/macmini/projects/loomsmith/packages/core/src` does; it is not a
design proposal. Source of truth for each section is the file named in that section.

Last verified: 27 Sep 2026, against branch `feat/m0_m1_core`, 80 passing tests (12 files).

## 2. File format

Defined in `/Users/macmini/projects/loomsmith/packages/core/src/schema/document.ts`.

A loomsmith document is a single JSON object:

| Field | Type | Meaning |
|---|---|---|
| `format` | literal `"loomsmith"` | file format tag |
| `schema_version` | literal `1` | current schema version (`current_schema_version`) |
| `document_id` | id | opaque, caller-supplied |
| `revision` | non-negative integer | incremented by one on every accepted batch |
| `applied_batch_ids` | array of id | batch ids already applied, for idempotency |
| `project` | object | `{ label }` |
| 14 collections | arrays | see section 3, in `collection_names` order |

`collection_names` (also the canonical write order) is:
`harnesses`, `parts`, `connectors`, `contacts`, `splices`, `ground_points`, `wires`,
`nodes`, `segments`, `matings`, `assets`, `evidence`, `reviews`, `view_positions`.

**Canonical ordering** (`/Users/macmini/projects/loomsmith/packages/core/src/model/canonical.ts`):
- Each collection is a set, sorted by `id` (`compare_ids`, plain string comparison).
- Arrays inside an entity (`ends`, `route`, `cavities`, `stripe_colours`, `cavity_map`) keep
  the order the caller gave them; they are not sorted.
- `to_canonical_file` writes all object keys sorted (`sort_keys_deep`), 2-space indent,
  trailing newline. `canonical_json` (no indent, sorted keys) is used internally for
  content-equality comparisons (evidence/review staleness, command `expect`/`expect_entity`).

**Id rules** (`/Users/macmini/projects/loomsmith/packages/core/src/schema/primitives.ts`):
- `id_schema`: `^[A-Za-z0-9_.-]{1,128}$`, a restricted alphabet so composite keys such as
  `contact:<id>` or `<connector_id>/<cavity_id>` cannot collide with a real id.
- Ids are unique across all collections except `view_positions`
  (`build_index` in `/Users/macmini/projects/loomsmith/packages/core/src/model/doc_index.ts`
  skips `view_positions` when building the global `by_id` map and collecting `duplicate_ids`).
  `view_positions` ids are checked for uniqueness only within their own collection
  (`S_DUPLICATE_ID` in `structural.ts`).
- Cavity ids are unique only within their owning connector; cavity **labels** are also
  unique within a connector (`S_DUPLICATE_CAVITY`, `S_DUPLICATE_LABEL`).
- Labels are separate from ids and have their own uniqueness scopes: harness labels are
  unique document-wide; connector/splice/ground_point labels are unique document-wide
  (shared "project label" namespace); wire labels are unique per harness
  (`check_labels` in `structural.ts`).

**Unit rules**: canonical units are `length_mm` (via the `length` object's `nominal_mm`/
`tol_mm`) and `cross_section_mm2`. An unknown value is always `null`, never `0`
(`length_schema`, `wire_spec_schema` in `document.ts`).

## 3. Entities

One row per collection, fields from `document.ts`.

| Collection | Fields |
|---|---|
| `harnesses` | `id`, `label` |
| `parts` | `id`, `kind` (`housing`\|`terminal`\|`seal`\|`splice`\|`wire`\|`covering`\|`other`), `manufacturer`, `part_number`, `description` |
| `connectors` | `id`, `harness_id`, `label`, `face_view` (`mating_face`\|`wire_entry`\|`null`), `housing_gender` (`male`\|`female`\|`null`), `safety_class` (`srs`\|`null`), `housing` (part use), `cavities` (array of `{ id, label }`, 1 to 256) |
| `contacts` | `id`, `connector_id`, `cavity_id`, `contact_gender` (`male`\|`female`\|`null`), `terminal` (part use), `seal` (`{ part, quantity 1-4 }` or `null`), `max_wire_ends` (1-4) |
| `splices` | `id`, `harness_id`, `label`, `part` (part use), `max_wire_ends` (2-32) |
| `ground_points` | `id`, `harness_id`, `label` |
| `wires` | `id`, `harness_id`, `label`, `ends` (tuple of 2 wire ends), `spec` (wire spec), `route` (array of segment id, or `null` if unrouted), `allowances` (`{ end_a_mm, end_b_mm, service_mm }`, each non-negative) |
| `nodes` | `id`, `harness_id`, `kind` (`connector`\|`breakout`\|`clip`\|`grommet`\|`splice`\|`ground`), `ref_id` (id or `null`) |
| `segments` | `id`, `harness_id`, `node_a`, `node_b`, `length` (length object) |
| `matings` | `id`, `connector_a`, `connector_b`, `cavity_map` (array of `{ cavity_a, cavity_b }`, at least 1) |
| `assets` | `id`, `sha256` (64 hex chars), `media_type`, `blob_ref` (`asset://...`, `synthetic://...` or a relative path only), `title` |
| `evidence` | `id`, `entity_id`, `field`, `origin` (`measured`\|`documented`\|`inferred`\|`assumed`), `value_json`, `source` (`{ asset_id, page_index, bbox }` or `null`), `note` |
| `reviews` | `id`, `entity_id`, `field`, `status` (`approved`\|`rejected`), `reviewed_value_json`, `revision` |
| `view_positions` | `id`, `x`, `y` |

Shared substructures (`primitives.ts`):
- **part use**: `{ part_id (id or null), identification (identified\|candidate\|unknown), compatibility (compatible\|incompatible\|unknown), procurement (available\|unavailable\|reused\|unknown) }`.
- **length**: `{ nominal_mm (positive or null), tol_mm (non-negative or null), datum (text or null) }`.
- **wire end** (`wire_end_schema` in `document.ts`, a discriminated union on `kind`): `contact` (`contact_id`), `splice` (`splice_id`), `ground_point` (`ground_point_id`), `open` (no payload).
- **wire spec**: `{ cross_section_mm2 (positive or null), designation (text or null), base_colour (string 1-16 or null), stripe_colours (up to 3), insulation (text or null) }`.

## 4. Evidence and review

Defined in `/Users/macmini/projects/loomsmith/packages/core/src/validate/review_state.ts`
and `/Users/macmini/projects/loomsmith/packages/core/src/schema/document.ts`.

- Evidence and reviews address **top-level fields only** in M1 (for example `spec` on a
  wire, not `spec.cross_section_mm2`). `make_evidence`/`make_review` throw if the field is
  not a real top-level key of the entity (`require_field` -> `has_field` in `doc_index.ts`);
  `id` is never a reviewable field. Validation reports the same rule for hand-built
  documents as `S_FIELD_UNKNOWN`.
- **Origin** (`origin_schema`): `measured`, `documented`, `inferred`, `assumed`. Only
  `inferred` evidence that is not approved is flagged, as `W_INFERRED_UNREVIEWED`.
- **`reviewed_value_json`**: the canonical JSON (`canonical_json`) of the field's value at
  the moment of review. Approval is bound to the *value*, not the revision: `review_state`
  returns the review's `status` only while the field's current canonical JSON still equals
  `reviewed_value_json`; any other change makes the review `stale`. Reverting a field back
  to a previously approved value (for example by applying an inverse batch / undo) makes
  the old approval live again, deliberately, so undo never destroys review work.
  `latest_review` picks the review with the highest `revision`, tie-broken by the highest
  `id`, for a given `(entity_id, field)`. Structural validation rejects a review whose
  `revision` is ahead of the document's current `revision` (`S_REVIEW_FUTURE_REVISION`), so
  a review can only be recorded at or before the revision it approves.
- **Rejected reviews**: the latest, current (non-stale) review of a field with
  `status: "rejected"` is reported as `W_REVIEW_REJECTED`; a value the reviewer explicitly
  rejected does not pass silently.
- **Stale rule for evidence**: `evidence_state` compares the evidence's stored
  `value_json` to the field's current canonical JSON; a mismatch is `stale` and is reported
  as `W_EVIDENCE_STALE`. A `reviews` row whose own `review_state` is `stale` and that is
  still the latest review for its `(entity_id, field)` is reported as `W_REVIEW_STALE`.

## 5. Command log

Defined in `/Users/macmini/projects/loomsmith/packages/core/src/schema/commands.ts`,
`/Users/macmini/projects/loomsmith/packages/core/src/commands/apply_command.ts` and
`/Users/macmini/projects/loomsmith/packages/core/src/commands/apply_batch.ts`.

- **Ops**: `insert` (`collection`, `entity`), `update` (`collection`, `id`, `set`,
  optional `expect`), `delete` (`collection`, `id`, optional `expect_entity`), and
  `update_project` (`set`, optional `expect`, no collection: it edits the single
  `project` object).
- **`expect`** (update/update_project): a partial record of field/value pairs; each must
  match the entity's current canonical JSON value or the command fails
  `precondition_failed`. **`expect_entity`** (delete): the whole entity must canonical-JSON
  match, or the command fails `precondition_failed` ("changed since it was read").
- **Inverses**: every successful command returns the command(s) that undo it: `insert` <->
  `delete` (with `expect_entity` set to the inserted entity), `update` <-> `update` (swapping
  the previous and new values of only the changed keys, `set`/`expect` reversed),
  `update_project` <-> `update_project` the same way. `apply_batch` accumulates inverses and
  prepends each new one (`inverse.unshift`), so the batch inverse undoes commands in reverse
  order.
- **Batch fields** (`batch_schema`): `batch_id`, `document_id`, `command_schema_version`
  (literal `1`), `expected_revision`, `created_at`, `commands` (1 to 10000).
- **Idempotency**: if `batch.batch_id` is already in `doc.applied_batch_ids`, `apply_batch`
  returns the document unchanged (`duplicate: true`, empty inverse) instead of reapplying.
- **Stale revision rejection**: if `batch.expected_revision !== doc.revision`, the batch is
  rejected with `stale_revision` before any command runs.
- **Ambiguous id target**: `update` and `delete` reject with `precondition_failed` if more
  than one entity in the target collection shares the given id (possible only on an
  already-invalid, hand-edited document carrying an `S_DUPLICATE_ID`); the duplicate must
  be repaired (for example by a `delete` naming the other collection, or by loading a
  corrected file) before either entity can be targeted by id.
- **No cascading deletes in M1**: `apply_command`'s `delete` only checks the entity exists
  and matches `expect_entity`; it does not remove or fix up entities that reference the
  deleted one. Any resulting dangling reference is instead caught by whole-document
  structural validation after the batch (see `structural_errors_introduced` below), so a
  delete that would dangle a reference is rejected rather than silently cascaded.
- **`structural_errors_introduced`**: after every command in the batch is applied,
  `apply_batch` runs `validate_structure` on the result. A **valid document stays valid**:
  if the document was already structurally valid before the batch (0 issues) and the batch
  introduces any structural issue, the batch is rejected with `structural_errors_introduced`
  and the new/worsened issues are returned.
  An **already-invalid document** (for example one hand-edited outside the reducer) instead
  enters repair mode: issues are compared by `issue_fingerprint` (code + entity_id + path +
  message); the batch is accepted only if it introduces no new or worsened issue and
  strictly reduces the total issue count, otherwise it is rejected with `repair_required`.

## 6. Validation codes

From `/Users/macmini/projects/loomsmith/packages/core/src/validate/structural.ts` (level
`structural`, all `severity: error`) and
`/Users/macmini/projects/loomsmith/packages/core/src/validate/completeness.ts` (level
`completeness`).

### Structural (`S_*`, error)

| Code | Meaning |
|---|---|
| `S_DUPLICATE_ID` | the same id is used by more than one entity (or, for `view_positions`, more than one position shares an id) |
| `S_REF_MISSING` | a reference points to an entity that does not exist (harness, part, connector, cavity, segment, node, asset, mating connector, evidence/review target) |
| `S_PART_IDENTITY` | a part use is `identified` or `candidate` but has no `part_id` |
| `S_PART_KIND` | a referenced part exists but is the wrong `kind` for its use (housing/terminal/seal/splice) |
| `S_DUPLICATE_CAVITY` | a cavity id repeats within one connector |
| `S_DUPLICATE_LABEL` | a cavity label, harness label, connector/splice/ground_point label, or wire label (within its harness) repeats where labels must be unique |
| `S_CAVITY_MULTIPLE_CONTACTS` | more than one contact occupies the same cavity |
| `S_CONTACT_OVERFILLED` | a contact holds more wire ends than its `max_wire_ends` |
| `S_SPLICE_OVERFILLED` | a splice holds more wire ends than its `max_wire_ends` |
| `S_HARNESS_MISMATCH` | an entity (wire end, route segment, node, segment endpoint) belongs to a different harness than the entity it is attached to |
| `S_NODE_KIND` | a node's `kind` and `ref_id` disagree: `connector`/`splice`/`ground` nodes need a `ref_id` of the matching kind; other kinds must not have one |
| `S_NODE_DUPLICATE_REF` | more than one node refers to the same `ref_id` |
| `S_SEGMENT_LOOP` | a segment's `node_a` and `node_b` are the same node |
| `S_MATING_INVALID` | a mating is invalid: a connector mated to itself, a mapped cavity that does not exist on its connector, a cavity mapped twice, or a connector that appears in more than one mating |
| `S_FIELD_UNKNOWN` | evidence or a review names a field that is not a top-level field of its entity |
| `S_REVIEW_FUTURE_REVISION` | a review's `revision` is ahead of the document's current `revision` (a review can only be recorded at or before the revision it approves) |

### Completeness (`M_*`, error; build-level only)

| Code | Meaning |
|---|---|
| `M_WIRE_END_OPEN` | a wire end is `open` (not terminated) |
| `M_WIRE_SPEC_UNKNOWN` | a wire's `cross_section_mm2` or `base_colour` is unknown |
| `M_WIRE_UNROUTED` | a wire has no route (`route` is `null`) |
| `M_ENDPOINT_NODE_MISSING` | one of a wire's ends has no topology node to route from/to |
| `M_ROUTE_NOT_CONTIGUOUS` | a wire's route segments do not chain from its start node to its end node |
| `M_LENGTH_UNKNOWN` | a wire's route is contiguous but crosses one or more segments with unknown `nominal_mm` |
| `M_PART_UNIDENTIFIED` | a housing, terminal or splice part use is not `identified` |

### Review warnings (`W_*`, warning; build-level only)

| Code | Meaning |
|---|---|
| `W_EVIDENCE_STALE` | an evidence row's recorded value no longer matches the field's current value |
| `W_INFERRED_UNREVIEWED` | evidence with `origin: "inferred"` is not currently approved |
| `W_REVIEW_STALE` | the latest review of a field is stale (the field changed since it was reviewed) |
| `W_REVIEW_REJECTED` | the latest, current (non-stale) review of a field has `status: "rejected"`: the reviewer flagged the current value as wrong |

`validate()` (`validate.ts`) always runs structural checks; completeness checks run only
at `level: "build"`, scoped to `harness_ids` via `ScopeOptions`/`in_scope`
(`/Users/macmini/projects/loomsmith/packages/core/src/model/scope.ts`).
`is_release_ready(issues)` is `true` iff no issue has `severity: "error"` (warnings do not
block).

## 7. Derivations

All pure functions of the document (plus, where noted, caller-supplied options); nothing
here is stored in the document.

- **Route status** (`analyse_route`, `/Users/macmini/projects/loomsmith/packages/core/src/derive/topology.ts`):
  one of `unrouted` (`route` is `null`), `open_end` (either end is `open`),
  `missing_endpoint_node` (an end's connector/splice/ground_point has no topology node),
  `not_contiguous` (the listed segments do not chain from the start node to the end node),
  or `ok`.
- **Length rules**: `route_length` sums segment `length.nominal_mm` and `length.tol_mm`
  along an `ok` route; if any crossed segment has `nominal_mm: null` the result is
  `status: "unknown"` with the list of `unknown_segment_ids`; a non-`ok` route is
  `status: "unavailable"`. `cut_length` adds `allowances.end_a_mm + end_b_mm + service_mm`
  to a `known` route length; otherwise it passes the route length through unchanged.
  Lengths are rounded to 3 decimal places (`round_mm`, i.e. micrometre precision).
- **Nets** (`derive_nets`, `/Users/macmini/projects/loomsmith/packages/core/src/derive/nets.ts`):
  union-find over wire endpoints (`contact:<id>`, `splice:<id>`, `ground_point:<id>`; `open`
  ends contribute no key) plus mating cavity pairs whose mating is `connected` (per-mating
  override in `options.mating_states`, else `options.default_mating_state`). Scoped by
  `harness_ids` (`in_scope`). Each net's `net_id` is its lowest endpoint key
  (lexicographic); `endpoint_keys` and `wire_ids` are sorted.
- **Bench boundary rules** (`derive_test_data`,
  `/Users/macmini/projects/loomsmith/packages/core/src/derive/test_data.ts`): nets are
  derived with `default_mating_state: "disconnected"` so only explicitly connected matings
  join harnesses. A net that touches an excluded connector (any listed in
  `excluded_connector_ids`, or any `safety_class: "srs"` connector unless
  `include_srs: true`) is excluded **whole**: it gets no continuity or isolation check at
  all (`excluded_net_ids`, `excluded_points`), not just the SRS/excluded probe points, so no
  test voltage reaches an SRS circuit. A point on a connector that has been mated away
  (its counterpart is `connected` in scope) is not a probe point. `continuity` pairs each
  remaining net's first point with every other point in that net. `isolation` pairs the
  first point of each remaining net with the first point of every later net (no self-pairs,
  no duplicate unordered pairs).
- **Wire list** (`derive_wire_list`,
  `/Users/macmini/projects/loomsmith/packages/core/src/derive/wire_list.ts`): one row per
  wire in scope with harness label, wire label, `from`/`to` endpoint labels
  (`"<owner_label>:<cavity_label>"`, or `MISSING(<id>)`/`OPEN`), `cross_section_mm2`,
  `designation`, a `colour` code (`base_colour` plus `stripe_colours` joined with `-`, or
  `UNKNOWN`), route status and cut length. Sorted by harness label then wire label.
- **BOM** (`derive_bom`, `/Users/macmini/projects/loomsmith/packages/core/src/derive/bom.ts`):
  one line per distinct `(category, part_id or "unidentified", identification)` for
  housings, terminals, seals (quantity from the seal's own `quantity`) and splices; wire
  lines are grouped by `(cross_section_mm2 or "unknown", description)` where the
  description keeps the wire's `designation` exactly as written (never re-derived from
  `cross_section_mm2` alone) plus colour code and insulation. Wire quantity is the summed
  known cut length in mm, with a separate `unknown_quantity` counter for wires whose cut
  length could not be computed. Sorted by category, then description, then identification,
  then part id.
