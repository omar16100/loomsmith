# loomsmith C4 model

Category: Architecture. Source of truth for containers, components, dependencies and data flows. Update on every architecture change. Design rationale: /Users/macmini/projects/loomsmith/docs/27092026_loomsmith_design.md.

Last updated: 27 Sep 2026 (M1, `packages/core` implemented on branch `feat/m0_m1_core`, 99 tests
pass; `packages/cli`, `packages/ingest`, `apps/web`, `eval/` are still target architecture,
not built).

## Level 1: system context

| Actor / system | Relationship |
|---|---|
| Harness builder (DIY, classic car owner, small harness shop) | Designs or rebuilds harnesses in the web editor or CLI |
| Coding agent (Claude Code) | Drives the CLI (`apply`, `validate`, `export`) with JSON command batches; later an MCP server |
| LLM provider (Anthropic API) | Called only by the CLI `ingest` command in v1, with the user's own key |
| Wiring diagram PDFs (e.g. Toyota EWD) | Input to ingest; stay on the user's machine; referenced by hash |
| Harness shop / continuity tester | Consumes exported wire list, BOM, test data |
| Future loomsmith cloud (private repo, not built) | Sync, teams, sharing; would reuse the core and the command log |

## Level 2: containers

| Container | Tech | Responsibility | Depends on | Status |
|---|---|---|---|---|
| `packages/core` | TypeScript, zod v4, no DOM/fs/network/clock/RNG | Schema, command log reducer, validation, derivations, exports as strings, migrations, asset manifest, logger interface | none at runtime except zod | **Implemented (M1)** |
| `packages/cli` | Node 22+ | File IO, id/timestamp generation, commands `validate`, `migrate`, `export`, `new`, `apply`, `ingest` | core, ingest | Not built (M2) |
| `packages/ingest` | TypeScript, pdf.js, Anthropic SDK (M3/M5) | PDF parse -> candidate graph -> LLM resolution -> proposals file | core | Not built (M3/M5) |
| `apps/web` | Vite, React, SVG | Editor, IndexedDB autosave, File System Access API, proposal review | core | Not built (M4) |
| `examples/` | JSON | Synthetic golden fixtures | core schema | Implemented: `examples/synthetic_milestone/synthetic_milestone.loom.json` |
| `eval/` | JSON + reports | Ingest spike labels and metrics; OEM pages referenced by hash only | ingest | Not built (M3) |

## Level 3: core components

Implemented in M1 unless noted. See `/Users/macmini/projects/loomsmith/docs/data_model.md`
for the file format, entity fields, validation codes and derivation rules.

| Component | Responsibility |
|---|---|
| `schema/document.ts`, `schema/primitives.ts`, `schema/commands.ts` | zod schemas for the document, command batches |
| `schema/json_schema.ts` | Generated JSON Schema |
| `schema/format_issues.ts` | Shared `format_issues` helper: turns zod issues into `"path: message"` strings, used by `load_document`, `apply_command` and `apply_batch` |
| `model/canonical.ts` | Key sorting, canonical json, collection ordering |
| `model/empty_document.ts` | Empty document factory |
| `model/doc_index.ts` | Lookup maps and endpoint keys |
| `model/scope.ts` | `ScopeOptions`/`in_scope`: harness-id scope filter shared by `validate/completeness.ts` and `derive/nets.ts`, `derive/test_data.ts`, `derive/wire_list.ts`, `derive/bom.ts` |
| `migrate/load_document.ts` | schema_version checks, migrations, parse |
| `validate/issue.ts`, `validate/structural.ts`, `validate/completeness.ts`, `validate/review_state.ts`, `validate/validate.ts` | Structural checks (`S_*`) and manufacturing-completeness checks (`M_*`, `W_*`), issue objects with code, severity, JSON path, entity id, fix hint; evidence/review staleness |
| `commands/builders.ts`, `commands/apply_command.ts`, `commands/apply_batch.ts` | Command definitions with preconditions, reducer `apply_batch(doc, batch) -> result`, inverses, idempotency by batch_id, expected_revision check |
| `derive/topology.ts`, `derive/nets.ts`, `derive/test_data.ts`, `derive/wire_list.ts`, `derive/bom.ts` | Route analysis, route/cut lengths, union-find nets with mating states (`active_matings` shared by nets and test data), bench continuity/isolation test data (fails closed: runs `validate/structural.ts` and boundary checks first and returns problems instead of data), wire list, BOM (unknown wire length is `null`, never 0) |
| `log.ts` | Logger interface injected by callers |
| `export/` | Not built yet (M2+): CSV, SVG, HTML string renderers of derived data |
| `assets/` | Not built yet: asset manifest module (the `assets` collection and `blob_ref` convention exist in `schema/document.ts` now; a dedicated manifest builder is future work) |

## Data flows

1. Edit: UI action or CLI `apply` -> command batch (caller supplies ids, timestamps, expected_revision) -> `apply_batch` -> new doc + inverse batch -> validate -> derive -> render/export.
2. Export: doc -> validate (completeness level) -> derive -> export strings -> CLI writes files / web downloads.
3. Ingest (M5): PDF -> pdf.js text + drawing operators -> candidate graph -> LLM -> proposals file (command batches + citations, origin inferred) -> core validate -> web review -> accepted batches applied with review status approved.

## Invariants

- Derived data is never stored in the document.
- The reducer is deterministic: core reads no Node or DOM API (the core tsconfig has `types: []` and `lib: ["ES2023"]`) and no clock or RNG (checked by the ast-grep purity scan run before each milestone commit, not yet in CI), and the same doc + batch gives the same canonical output within one runtime (tested in Node). Byte-identical output across Node and the browser is a design goal to be verified in M4, when the web editor exists; it is not yet a tested fact.
- Credentials never appear in documents, command logs, autosave or logs.
- OEM-derived data never lives in this repo.
