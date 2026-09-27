# todo

## M0 scaffold (27 Sep 2026)
- [x] Save codex r1/r2 reviews to /Users/macmini/projects/codex/
- [x] Repo /Users/macmini/projects/loomsmith, git init, branch feat/m0_m1_core
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
- [ ] M1b schema-freeze checklist: nullable allowances (unknown strip/service length) instead of forced numbers; move `applied_batch_ids` idempotency history out of the document into the log/store (SaaS); length `origin` lives on evidence (spec said on the length); approvals bound to value, not revision (documented decision); batch actor field for SaaS; `format`/`schema_version` position in canonical file; public index exports internal helpers
- [ ] M2: isolation checks are O(N^2) (3000 nets gave 4.5M checks): switch to one check per net against all other nets tied together, or make the pairwise matrix opt-in, before worksheet export
- [ ] M2: repair fingerprint rejects genuine improvements (e.g. overfilled contact 3 -> 2 ends) because it compares raw messages
- [ ] M2: `batch_id` reuse with different content is accepted as a no-op (store a content hash)
- [ ] Later: review warnings ignore harness scope
- [ ] Later: reviews at the same revision are ordered by id
- [ ] Later: inverse commands share entity objects with the document (clone on return)
- [ ] Later: `route: []` on a same-node wire yields known length 0
- [ ] Later: wire list sorts W10 before W2 (natural sort)
- [ ] Later: `incompatible` parts pass completeness
- [ ] Later: derivations do not log
- [ ] Later: `S_DUPLICATE_ID` path is the bare id
- [ ] Later: `check_reviews` is O(n^2)
- [ ] Later: test-coverage minors: memory logger debug, nested strict schemas, `format_issues` root, double-run determinism, `update_project` expect mismatch, seal quantity > 1, tol-null lengths, `round_mm` fractions, MISSING fallbacks
