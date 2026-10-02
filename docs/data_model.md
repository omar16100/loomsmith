# loomsmith data model

Category: Reference.

## 1. Scope

This document describes the file format, entities, evidence/review model, command log
and derivations implemented in `@loomsmith/core` as of M1 (Task 10 plus the final review
fixes F1 to F5). It also covers schema v2 length capture
([28092026_length_capture_plan.md](28092026_length_capture_plan.md)): asymmetric
tolerance bands, per-segment-end datums, length estimates and signed per-end allowances,
the version 1 to 2 migration, and the completeness rules that block release on them. It
documents only
what the code in [packages/core/src](../packages/core/src) does; it is not a
design proposal. Source of truth for each section is the file named in that section.

Last verified: 28 Sep 2026, against branch `feat/length_capture`, 137 passing tests (14 files).

## 2. File format

Defined in [document.ts](../packages/core/src/schema/document.ts).

A loomsmith document is a single JSON object:

| Field | Type | Meaning |
|---|---|---|
| `format` | literal `"loomsmith"` | file format tag |
| `schema_version` | literal `2` | current schema version (`current_schema_version`) |
| `document_id` | id | opaque, caller-supplied |
| `revision` | non-negative integer | incremented by one on every accepted batch |
| `applied_batch_ids` | array of id | batch ids already applied, for idempotency |
| `project` | object | `{ label }` |
| 14 collections | arrays | see section 3, in `collection_names` order |

`collection_names` (also the canonical write order) is:
`harnesses`, `parts`, `connectors`, `contacts`, `splices`, `ground_points`, `wires`,
`nodes`, `segments`, `matings`, `assets`, `evidence`, `reviews`, `view_positions`.

**Canonical ordering** ([canonical.ts](../packages/core/src/model/canonical.ts)):
- Each collection is a set, sorted by `id` (`compare_ids`, plain string comparison).
- Arrays inside an entity (`ends`, `route`, `cavities`, `stripe_colours`, `cavity_map`) keep
  the order the caller gave them; they are not sorted.
- `to_canonical_file` writes all object keys sorted (`sort_keys_deep`), 2-space indent,
  trailing newline. `canonical_json` (no indent, sorted keys) is used internally for
  content-equality comparisons (evidence/review staleness, command `expect`/`expect_entity`).

**Id rules** ([primitives.ts](../packages/core/src/schema/primitives.ts)):
- `id_schema`: `^(?!\.\.?$)[A-Za-z0-9_.-]{1,128}$`, a restricted alphabet so composite keys
  such as `contact:<id>` or `<connector_id>/<cavity_id>` cannot collide with a real id. The
  ids `.` and `..` are rejected, so an id used as a file or path name never means "this
  directory" or "the parent directory".
- Ids are unique across all collections except `view_positions`
  (`build_index` in [doc_index.ts](../packages/core/src/model/doc_index.ts)
  skips `view_positions` when building the global `by_id` map and collecting `duplicate_ids`).
  `view_positions` ids are checked for uniqueness only within their own collection
  (`S_DUPLICATE_ID` in `structural.ts`).
- Cavity ids are unique only within their owning connector; cavity **labels** are also
  unique within a connector (`S_DUPLICATE_CAVITY`, `S_DUPLICATE_LABEL`).
- `label_schema` (every `label`, including cavity and project labels): 1 to 64 characters
  and no `:`. A bench probe label is `<connector label>:<cavity label>`, so it can never
  equal a ground point label or another probe label.
- Labels are separate from ids and have their own uniqueness scopes: harness labels are
  unique document-wide; connector/splice/ground_point labels are unique document-wide
  (shared "project label" namespace); wire labels are unique per harness
  (`check_labels` in `structural.ts`).

**Unit rules**: canonical units are millimetres for lengths (`length.nominal_mm`, `tol_plus_mm`,
`tol_minus_mm`, `length_estimate.min_mm`/`max_mm`, `beyond_datum_mm`, `service_loop_mm`) and
`cross_section_mm2`. An unknown value is always `null`, never `0` (`length_schema`,
`allowances_schema`, `wire_spec_schema`).

**Migrations** (`migrate/load_document.ts`; one file per step, `migrate/v1_to_v2.ts`): an older
`schema_version` is upgraded step by step before schema validation; a newer one is rejected
(`future_version`); a step that cannot migrate fails with `migration_failed` and the paths.
Version 1 to 2 maps value for value and invents nothing: `tol_mm` becomes equal `tol_plus_mm` and
`tol_minus_mm`; the free-text `datum` moves to `note`, `datum_a`/`datum_b` are `null`;
`allowances.end_a_mm`/`end_b_mm` become that end's `beyond_datum_mm` with `datum: null`;
`service_mm` becomes `service_loop_mm`; `length_estimate` is `null`. Migrated cut lengths are
therefore unknown until the datums are recorded, then exactly what version 1 computed. Each
rewritten value must match the frozen version 1 shape exactly (no extra, missing or
null-where-required keys); nothing is repaired. Evidence and review value JSON is translated only
when it is exactly the canonical JSON of a valid version 1 value, and every evidence row and
review must keep its current or stale state (targets resolved like `build_index`); otherwise the
load fails. `migrate_v1_to_v2` stays pure (no logging) and returns, on success, `MigrationStats`
(counts `segments`, `wires`, `evidence_translated`, `evidence_unchanged`, `reviews_translated`,
`reviews_unchanged`; translated means the stored string changed) alongside the migrated document.
`load_document` logs an info entry `document migrated` with `{ from, to, ...stats }` for each
migration step it runs, and its `LoadResult` ok variant carries `migrated_from` (the original
`schema_version` when at least one migration ran, else `null`), so a caller such as the CLI or
web can discard pending batches and undo stacks after a migration (D12 in the length capture
plan).

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
| `wires` | `id`, `harness_id`, `label`, `ends` (tuple of 2 wire ends), `spec` (wire spec), `route` (array of segment id, or `null` if unrouted), `allowances` (allowances object) |
| `nodes` | `id`, `harness_id`, `kind` (`connector`\|`breakout`\|`clip`\|`grommet`\|`splice`\|`ground`), `ref_id` (id or `null`) |
| `segments` | `id`, `harness_id`, `node_a`, `node_b`, `length` (length object), `length_estimate` (estimate object or `null`) |
| `matings` | `id`, `connector_a`, `connector_b`, `cavity_map` (array of `{ cavity_a, cavity_b }`, at least 1) |
| `assets` | `id`, `sha256` (64 hex chars), `media_type`, `blob_ref` (`asset://...`, `synthetic://...` or a relative path only; no absolute POSIX, Windows or UNC path, no `?`/`#` query or fragment, and no `..` path segment at the start or after `/` or `\`, so `../x.pdf`, `pdfs/../../etc/passwd` and `asset://a/../b` are rejected), `title` |
| `evidence` | `id`, `entity_id`, `field`, `origin` (`measured`\|`documented`\|`inferred`\|`assumed`), `value_json`, `source` (`{ asset_id, page_index, bbox }` or `null`), `note` |
| `reviews` | `id`, `entity_id`, `field`, `status` (`approved`\|`rejected`), `reviewed_value_json`, `revision` |
| `view_positions` | `id`, `x`, `y` |

Shared substructures (`primitives.ts`):
- **part use**: `{ part_id (id or null), identification (identified\|candidate\|unknown), compatibility (compatible\|incompatible\|unknown), procurement (available\|unavailable\|reused\|unknown) }`.
- **length**: `{ nominal_mm (positive or null), tol_plus_mm, tol_minus_mm (non-negative or null), datum_a, datum_b (datum or null), note (text or null) }`. The tolerance is a build tolerance: the built segment lies in `[nominal - tol_minus_mm, nominal + tol_plus_mm]`. `datum_a`/`datum_b` are the measurement points at `node_a`/`node_b`. `make_length` (`model/make_length.ts`) defaults an omitted `tol_minus_mm` to `0` (never short); an explicit `null` stays unknown.
- **datum**: `connector_back_face`, `connector_mating_face` (connector nodes), `breakout_centre`, `clip_centre`, `grommet_centre`, `splice_centre`, `ground_stud_centre` (the node kind named). No terminal tip: a datum does not name a contact, and terminals of one connector can sit at different depths. `model/datums.ts` holds `datum_node_kind` and the editor default `default_datum` per node kind.
- **length estimate**: `{ min_mm, max_mm (positive), method (text, required) }`, a range guessed before measuring. Never used as a length; its evidence (origin `assumed`, with the source page) goes on field `length_estimate`.
- **allowances**: `{ end_a, end_b, service_loop_mm }`; each end `{ datum (datum or null), beyond_datum_mm (signed number or null) }`: the wire length from that datum to the cut end of the conductor, slack at that end included (negative when the conductor stops short of the datum, e.g. the mating face or a ring terminal on a stud centre). `service_loop_mm` non-negative or null. Strip length is not an allowance: it is inside the cut length and belongs to terminal part data.
- **wire end** (`wire_end_schema` in `document.ts`, a discriminated union on `kind`): `contact` (`contact_id`), `splice` (`splice_id`), `ground_point` (`ground_point_id`), `open` (no payload).
- **wire spec**: `{ cross_section_mm2 (positive or null), designation (text or null), base_colour (string 1-16 or null), stripe_colours (up to 3), insulation (text or null) }`.

## 4. Evidence and review

Defined in [review_state.ts](../packages/core/src/validate/review_state.ts)
and [document.ts](../packages/core/src/schema/document.ts).

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
  the old approval live again only if no later review exists for that `(entity_id, field)`:
  `review_state` always judges the latest review, so if the changed value was reviewed
  afterwards, that later review stays the latest and the reverted field reads as `stale`
  against it.
  `latest_review` picks the review with the highest `revision`, tie-broken by the highest
  `id`, for a given `(entity_id, field)`. Structural validation rejects a review whose
  `revision` is ahead of the document's current `revision` (`S_REVIEW_FUTURE_REVISION`), so
  a review can only be recorded at or before the revision it approves.
- **Rejected reviews**: the latest, current (non-stale) review of a field with
  `status: "rejected"` is reported as `M_REVIEW_REJECTED` with severity `error`, so it
  blocks `is_release_ready` like any other `M_*` code; a value the reviewer explicitly
  rejected never passes into a build.
- **Stale rule for evidence**: `evidence_state` compares the evidence's stored
  `value_json` to the field's current canonical JSON; a mismatch is `stale` and is reported
  as `W_EVIDENCE_STALE`. A `reviews` row whose own `review_state` is `stale` and that is
  still the latest review for its `(entity_id, field)` is reported as `W_REVIEW_STALE`.
- Photos: an image asset (`media_type` `image/...`) cited with `source: { asset_id, page_index: 0, bbox: null }`; image regions are not addressed yet. A length measurement should cite a photo with the tape in frame.

## 5. Command log

Defined in [commands.ts](../packages/core/src/schema/commands.ts),
[apply_command.ts](../packages/core/src/commands/apply_command.ts) and
[apply_batch.ts](../packages/core/src/commands/apply_batch.ts).

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
  message). A batch that introduces any new or worsened issue is rejected with
  `structural_errors_introduced` (the same code as on a valid document, carrying only the
  introduced issues). A batch that introduces nothing new but does not strictly reduce the
  total issue count is rejected with `repair_required` (carrying all remaining issues). The
  batch is accepted only if it introduces no new or worsened issue and strictly reduces the
  total issue count.

**Format contract**: `command_schema_version` versions the batch envelope. Batches and inverse batches are built against the current document format; callers discard pending batches and undo stacks when a document is migrated. Entity payloads are validated against the current schema (an old-shaped segment or wire is `invalid_entity`); evidence `value_json` is an opaque string, so an insert carrying an old-format value is accepted and is simply stale.

## 6. Validation codes

From [structural.ts](../packages/core/src/validate/structural.ts) (level
`structural`, all `severity: error`) and
[completeness.ts](../packages/core/src/validate/completeness.ts) (level
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
| `S_DATUM_NODE_KIND` | a segment's `datum_a`/`datum_b` is not a point on the kind of node at that end (`datum_node_kind` in `model/datums.ts`); a batch that changes a node's kind must fix the datums in the same batch |
| `S_LENGTH_ESTIMATE_RANGE` | a segment's `length_estimate.min_mm` is greater than its `max_mm` |
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
| `M_LENGTH_UNMEASURED` | a segment crossed by an `ok` route has a `nominal_mm` but no current evidence on `length` with origin `measured` or `documented` (`inferred` and `assumed` never count, even approved) |
| `M_LENGTH_DATUM_UNKNOWN` | a segment crossed by an `ok` route has `datum_a` or `datum_b` `null` |
| `M_ROUTE_DATUM_MISMATCH` | on an `ok` route, two consecutive segments were measured to different points of the node where they meet (for example a connector's mating face and its back face), so the distance between the points is in neither |
| `M_ALLOWANCE_UNKNOWN` | a wire has an unknown (`null`) allowance field, whatever its route status; the message lists them |
| `M_ALLOWANCE_DATUM_MISMATCH` | on an `ok` route, a wire end's allowance datum differs from the datum the route was measured to at that end (datums are never converted); on a same-node wire (`route: []`), an allowance datum is not a point on that node's kind or the two ends' datums differ |
| `M_CUT_LENGTH_NOT_POSITIVE` | a known cut length is 0 or less (possible with negative `beyond_datum_mm`) |
| `M_PART_UNIDENTIFIED` | a housing, terminal, seal or splice part use is not `identified` |
| `M_REVIEW_REJECTED` | the latest, current (non-stale) review of a field has `status: "rejected"`: the reviewer flagged the current value as wrong, so the build is blocked until a corrected value is recorded |

### Review warnings (`W_*`, warning; build-level only)

| Code | Meaning |
|---|---|
| `W_EVIDENCE_STALE` | an evidence row's recorded value no longer matches the field's current value |
| `W_INFERRED_UNREVIEWED` | evidence with `origin: "inferred"` is not currently approved |
| `W_LENGTH_OUTSIDE_ESTIMATE` | an in-scope segment's `nominal_mm` is below `length_estimate.min_mm` or above `max_mm` (bounds inclusive), whatever its evidence or routing: check for a typo before cutting |
| `W_REVIEW_STALE` | the latest review of a field is stale (the field changed since it was reviewed) |

`validate()` (`validate.ts`) always runs structural checks; completeness checks run only
at `level: "build"`, scoped to `harness_ids` via `ScopeOptions`/`in_scope`
([scope.ts](../packages/core/src/model/scope.ts)).
`is_release_ready(issues)` is `true` iff no issue has `severity: "error"` (warnings do not
block).

## 7. Derivations

All pure functions of the document (plus, where noted, caller-supplied options); nothing
here is stored in the document.

- **Route status** (`analyse_route`, [topology.ts](../packages/core/src/derive/topology.ts)):
  one of `unrouted` (`route` is `null`), `open_end` (either end is `open`),
  `missing_endpoint_node` (an end's connector/splice/ground_point has no topology node),
  `not_contiguous` (the listed segments do not chain from the start node to the end node),
  or `ok`.
- **Length rules**: `route_length` sums segment `length.nominal_mm` and, separately,
  `tol_plus_mm` and `tol_minus_mm` along an `ok` route; a band is `null` if any crossed
  segment's band on that side is `null`. Any crossed `nominal_mm: null` gives
  `status: "unknown"` with `unknown_segment_ids`; a non-`ok` route is `status: "unavailable"`.
  `route_end_datums` reads the datum at each wire end from the end segment, in whichever
  direction it is stored. `check_route_datums` checks the whole route: every crossed
  segment end has a datum, consecutive segments meet at the same point, and each wire end's
  allowance datum equals the route's datum there; a same-node wire (`route: []`, length 0)
  needs both allowance datums equal and on that node's kind. `cut_length` returns a
  `CutLengthValue` (adds `unknown_allowances` and `datum_problems`): route length + both
  ends' `beyond_datum_mm` + `service_loop_mm`, with the route's bands unchanged. It is known
  only if the route is known, every allowance is known and `check_route_datums` finds
  nothing; datums are never converted. Lengths are rounded to 3 decimal places (`round_mm`).
  A tolerance band may be unknown (`null` in the cut length) without blocking release: no
  completeness rule requires `tol_plus_mm`/`tol_minus_mm` to be known, only `nominal_mm`,
  the datums and the allowances.
- **Nets** (`derive_nets`, [nets.ts](../packages/core/src/derive/nets.ts)):
  union-find over wire endpoints (`contact:<id>`, `splice:<id>`, `ground_point:<id>`; `open`
  ends contribute no key) plus the cavity pairs of every active mating. `active_matings`
  (exported from `nets.ts`, the one place this decision is made, also used by
  `derive_test_data`) returns the matings that are `connected` (per-mating override in
  `mating_states`, an own-property lookup, else the default state) and whose two
  connectors both exist and are in scope. Wires are scoped by `harness_ids` (`in_scope`).
  Each net's `net_id` is its lowest endpoint key (lexicographic); `endpoint_keys` and
  `wire_ids` are sorted.
- **Bench boundary rules** (`derive_test_data`,
  [test_data.ts](../packages/core/src/derive/test_data.ts)): the input is a
  `TestBoundary` (`harness_ids`, `mating_states`, `excluded_connector_ids`, `include_srs`)
  and the result is a `TestDataResult`: `{ ok: true, data: TestData }` or
  `{ ok: false, problems: BoundaryProblem[] }`. The boundary **fails closed**: if any
  problem exists, no test data at all is produced. A `BoundaryProblem` is
  `{ code, id, message }`; problems are sorted by `code`, then `id`:
  - `unknown_harness`: a `harness_ids` entry is not a harness in the document.
  - `unknown_mating`: a `mating_states` key is not a mating in the document (whatever
    state it names).
  - `unknown_connector`: an `excluded_connector_ids` entry is not a connector in the
    document.
  - `mating_crosses_boundary`: a mating declared `connected` has exactly one of its two
    connectors in scope (the bench would otherwise test a path that leaves the boundary,
    for example through an unmodelled SRS connector).
  - `structural_errors` (`id: null`): `validate_structure` reports any issue; the message
    gives the count.

  With no problem, nets are derived with `default_mating_state: "disconnected"`, so only
  explicitly connected matings (both sides in scope, via `active_matings`) join harnesses.
  A net that touches an excluded connector (any listed in `excluded_connector_ids`, or any
  `safety_class: "srs"` connector unless `include_srs: true`) is excluded **whole**,
  whichever harness that connector is in (`is_excluded_endpoint`): it gets no continuity or
  isolation check at all (`excluded_net_ids`, `excluded_points`), not just the
  SRS/excluded probe points, so no test voltage reaches an SRS circuit. Probe points are
  in-scope contacts, labelled `<connector label>:<cavity label>`, and in-scope ground
  points, labelled with the ground point label (labels cannot contain `:`, so these never
  collide). A contact on a connector that has been mated away (its mating is active) is
  not a probe point, and splices are never probe points. A net that is not excluded but
  has no probe point left is listed in `untestable_net_ids` instead of silently vanishing.
  `continuity` pairs each remaining net's first point with every other point in that net.
  `isolation` pairs the first point of each remaining net with the first point of every
  later net (no self-pairs, no duplicate unordered pairs).
- **Wire list** (`derive_wire_list`,
  [wire_list.ts](../packages/core/src/derive/wire_list.ts)): one row per
  wire in scope with harness label, wire label, `from`/`to` endpoint labels
  (`"<owner_label>:<cavity_label>"`, or `MISSING(<id>)`/`OPEN`), `cross_section_mm2`,
  `designation`, a `colour` code (`base_colour` plus `stripe_colours` joined with `-`, or
  `UNKNOWN`), route status and cut length. Sorted by harness label then wire label.
- **BOM** (`derive_bom`, [bom.ts](../packages/core/src/derive/bom.ts)):
  one line per distinct `(category, part_id, identification)` for housings, terminals,
  seals (quantity from the seal's own `quantity`) and splices. A part use with no
  `part_id` is grouped under the empty-string sentinel `""` (never a valid id, so a real
  part literally named `unidentified` is never merged with it) and described as
  `UNIDENTIFIED <category>`. Wire lines are grouped by `(cross_section_mm2 or "unknown",
  description)` where the description keeps the wire's `designation` exactly as written
  (never re-derived from `cross_section_mm2` alone) plus colour code and insulation.
  Quantities (`BomLine`):
  - `quantity` (`number | null`): for part lines the count (`unit: "pcs"`); for wire lines
    (`unit: "mm"`) the total cut length, or `null` whenever any wire in the line has an
    unknown or unavailable cut length, so a partial sum is never shown as the total.
  - `known_quantity` (`number`): for part lines equal to `quantity`; for wire lines the
    sum of the known cut lengths only (rounded with `round_mm`).
  - `unknown_quantity` (`number`): for wire lines the number of wires whose cut length
    could not be computed; always 0 for part lines. A known cut length of 0 or less (a
    data error, `M_CUT_LENGTH_NOT_POSITIVE`) counts here too, never as a quantity.

  Sorted by category (`housing`, `terminal`, `seal`, `splice`, `wire`), then description,
  then identification, then part id, then the full grouping key as the final tiebreak, so
  two lines that display the same text but belong to distinct groups (for example the
  same designation written on two different cross-sections) still sort in a fixed order
  independent of input order.
