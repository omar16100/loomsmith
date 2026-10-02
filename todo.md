# todo

## M0 scaffold (27 Sep 2026)
- [x] Save codex r1/r2 reviews outside this repo
- [x] Repo init: git init, branch feat/m0_m1_core
- [x] LICENSE Apache-2.0 (canonical text, sha256 cfc7749b...)
- [x] docs/27092026_loomsmith_design.md, docs/c4model.md, docs/index.md, THIRD_PARTY_NOTICES.md
- [x] docs/27092026_loomsmith_plan.md (implementation plan, codex reviewed + findings applied)
- [x] Workspace scaffold (pnpm, tsconfig, vitest, CI)
- [x] parsnip entity

## Later milestones
- [x] M1 model draft + golden synthetic fixture: `@loomsmith/core` (schema, command log, structural and completeness validation, evidence/review state, routes and cut lengths, nets, SRS-safe bench test data, wire list, BOM), 99 tests pass (12 files), branch `feat/m0_m1_core`
- [ ] M1b owner: pick LS400 sub-harness, photos + measurements
- [ ] M2 CLI
- [ ] M3 ingest spike
- [ ] M4 web editor
- [ ] M5 ingest v1
- [ ] M6 LS400 pilot

## M1 final review fixes (27 Sep 2026)
- [x] F1 bench test data fails closed: `derive_test_data` returns `{ ok, data }` or `{ ok: false, problems }` (unknown harness/mating/connector, mating crossing the boundary, structural errors); SRS/listed connectors exclude a net whatever harness they are in; shared `active_matings`; `untestable_net_ids`; no ":" in labels
- [x] F2 rejected review is `M_REVIEW_REJECTED` (error), blocks `is_release_ready`
- [x] F3 BOM wire `quantity` is `null` while any cut length is unknown; new `known_quantity`
- [x] F4 tests for `M_WIRE_END_OPEN`, `M_ENDPOINT_NODE_MISSING`, `M_ROUTE_NOT_CONTIGUOUS`, `S_DUPLICATE_CAVITY`, `S_NODE_DUPLICATE_REF`, `S_MATING_INVALID` (self-mate, two matings)
- [x] F5 `blob_ref` rejects ".." path segments; ids "." and ".." rejected
- [x] F6 deferred work recorded below
- [x] F7 docs/data_model.md and docs/c4model.md match the code

## Deferred from M1 review (27 Sep 2026)
- [x] M1b schema-freeze checklist: nullable allowances (unknown strip/service length) instead of forced numbers (schema v2: per-end `{ datum, beyond_datum_mm }`, `service_loop_mm`, all nullable)
- [ ] M1b schema-freeze checklist (remaining): move `applied_batch_ids` idempotency history out of the document into the log/store (SaaS); length `origin` lives on evidence (spec said on the length); approvals bound to value, not revision (documented decision); batch actor field for SaaS; `format`/`schema_version` position in canonical file; public index exports internal helpers
- [ ] M2: isolation checks are O(N^2) (3000 nets gave 4.5M checks): switch to one check per net against all other nets tied together, or make the pairwise matrix opt-in, before worksheet export
- [ ] M2: repair fingerprint rejects genuine improvements (e.g. overfilled contact 3 -> 2 ends) because it compares raw messages
- [ ] M2: `batch_id` reuse with different content is accepted as a no-op (store a content hash)
- [ ] Later: review warnings ignore harness scope
- [ ] Later: reviews at the same revision are ordered by id
- [ ] Later: inverse commands share entity objects with the document (clone on return)
- [x] Later: `route: []` on a same-node wire yields known length 0 (resolved: route length 0 is right for a same-node wire; its cut length is the allowances, given from one point on that node, else `M_ALLOWANCE_DATUM_MISMATCH`)
- [ ] Later: wire list sorts W10 before W2 (natural sort)
- [ ] Later: `incompatible` parts pass completeness
- [ ] Later: derivations do not log
- [ ] Later: `S_DUPLICATE_ID` path is the bare id
- [ ] Later: `check_reviews` is O(n^2)
- [ ] Later: test-coverage minors: memory logger debug, nested strict schemas, `format_issues` root, double-run determinism, `update_project` expect mismatch, seal quantity > 1, tol-null lengths, `round_mm` fractions, MISSING fallbacks

## Residuals from the codex SRS re-check (27 Sep 2026, external review output not in this repo)
- [ ] Before M2 (first non-test caller): `derive_test_data` must always build its own index; a stale caller-supplied index can bypass SRS exclusion.
- [ ] When the API is public: `derive_test_data` ignores non-enumerable `mating_states` keys (JSON inputs are fine).
- [ ] M1b freeze decision: restoring a value that an older review rejected yields only `W_REVIEW_STALE` (latest-review policy); decide whether any rejection of the current value should block.
- [ ] M2 perf: `derive_test_data` runs `validate_structure` on every call.

## Length capture (28 Sep 2026)
- [x] Task 1: schema v2 (plus/minus tolerance bands, per-end segment datums, `length_estimate`, signed per-end allowances given from a datum), `make_length` builder, `model/datums.ts`
- [x] Task 2: migration from schema_version 1 to 2, maps values exactly, invents nothing, refuses to repair
- [x] Task 3: structural checks `S_DATUM_NODE_KIND`, `S_LENGTH_ESTIMATE_RANGE`
- [x] Task 4: build-level completeness rules (`M_LENGTH_UNMEASURED`, `M_LENGTH_DATUM_UNKNOWN`, `M_ROUTE_DATUM_MISMATCH`, `M_ALLOWANCE_UNKNOWN`, `M_ALLOWANCE_DATUM_MISMATCH`, `M_CUT_LENGTH_NOT_POSITIVE`, `W_LENGTH_OUTSIDE_ESTIMATE`), enriched synthetic fixture (photo evidence, documented and assumed length evidence, an estimate a documented length falls outside, an unknown beyond-datum allowance)
- [x] Final fix wave (28 Sep 2026, whole-branch review plus codex astra, F1 to F8): BOM never counts a non-positive cut length as wire quantity; reversed-segment join test actually discriminates its ends; unknown datum on the leaving side of an internal join is covered (topology and completeness); migration returns `MigrationStats` and `load_document` logs `document migrated`; `LoadResult` carries `migrated_from`; `trusted_length_origins` typed `Origin`, `M_LENGTH_DATUM_UNKNOWN` names the node id; plan doc, data_model.md, c4model.md, index.md and design doc updated; this bookkeeping
- [ ] M2 CLI and M4 web: discard pending batches and undo stacks after a migration
- [ ] M4 measure mode (prefill `default_datum`)
- [ ] terminal part data: strip length, insertion depth
- [ ] photo-assisted measurement spike (after M4)
- [ ] rope method for new designs
- [ ] reuse one `analyse_route` result per wire instead of recomputing it several times per wire (`derive/topology.ts`, `derive/wire_list.ts`, `validate/completeness.ts` each call it separately)
- [ ] decide whether an unknown tolerance band should warn (`W_TOLERANCE_UNKNOWN`) instead of passing silently
- [ ] `issues_at` in `migrate/v1_to_v2.ts` duplicates `schema/format_issues.ts`'s `format_issues`; share one helper
- [ ] `values_of` and `canonical_json` typing in `migrate/v1_to_v2.ts` hide `undefined` (a missing field and an explicit `null` are not distinguished in the cache)
- [ ] test gaps: `route_end_datums` with `null` and `[]` ends; same-node wrong kind at `end_a` (only `end_b` is covered); `S_DATUM_NODE_KIND` on `datum_b` (only `datum_a` is covered); `W_LENGTH_OUTSIDE_ESTIMATE` on an unrouted or out-of-scope segment; migration malformed-case assertions are loose prefix matches, not exact; `value_json`/`reviewed_value_json` that is not JSON; non-array collections in the raw document; a migrated v1 document has no structural issues (`validate_structure` on the migrated golden)
- [ ] fix the `Photos:` label formatting in `docs/data_model.md`

## Open-source publication (02 Oct 2026)
- [x] Repo-relative paths in docs (local machine paths removed; private references described in words)
- [x] README added
