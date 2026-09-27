# loomsmith C4 model

Category: Architecture. Source of truth for containers, components, dependencies and data flows. Update on every architecture change. Design rationale: /Users/macmini/projects/loomsmith/docs/27092026_loomsmith_design.md.

Last updated: 27 Sep 2026 (M0, nothing implemented yet; everything below is the target architecture).

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

| Container | Tech | Responsibility | Depends on |
|---|---|---|---|
| `packages/core` | TypeScript, zod v4, no DOM/fs/network/clock/RNG | Schema, command log reducer, validation, derivations, exports as strings, migrations, asset manifest, logger interface | none at runtime except zod |
| `packages/cli` | Node 22+ | File IO, id/timestamp generation, commands `validate`, `migrate`, `export`, `new`, `apply`, `ingest` | core, ingest |
| `packages/ingest` | TypeScript, pdf.js, Anthropic SDK (M3/M5) | PDF parse -> candidate graph -> LLM resolution -> proposals file | core |
| `apps/web` | Vite, React, SVG | Editor, IndexedDB autosave, File System Access API, proposal review | core |
| `examples/` | JSON | Synthetic golden fixtures | core schema |
| `eval/` | JSON + reports | Ingest spike labels and metrics; OEM pages referenced by hash only | ingest |

## Level 3: core components

| Component | Responsibility |
|---|---|
| `schema/` | zod schemas for the document, command batches, proposals; generated JSON Schema |
| `model/` | Types, id helpers (ids passed in), canonical ordering, lookup indexes |
| `commands/` | Command definitions with preconditions, reducer `apply_batch(doc, batch) -> result`, inverses, idempotency by batch_id, expected_revision check |
| `validate/` | Structural checks and manufacturing-completeness checks, issue objects with code, severity, JSON path, entity id, fix hint |
| `derive/` | Nets, route lengths, cut lengths with tolerance, BOM, wire list, test data for a bench boundary |
| `export/` | CSV, SVG, HTML string renderers of derived data |
| `migrate/` | schema_version migrations, history checkpointing |
| `assets/` | Asset manifest: logical id, sha256, media type, page/bbox convention |
| `log.ts` | Logger interface injected by callers |

## Data flows

1. Edit: UI action or CLI `apply` -> command batch (caller supplies ids, timestamps, expected_revision) -> `apply_batch` -> new doc + inverse batch -> validate -> derive -> render/export.
2. Export: doc -> validate (completeness level) -> derive -> export strings -> CLI writes files / web downloads.
3. Ingest (M5): PDF -> pdf.js text + drawing operators -> candidate graph -> LLM -> proposals file (command batches + citations, origin inferred) -> core validate -> web review -> accepted batches applied with review status approved.

## Invariants

- Derived data is never stored in the document.
- The reducer is deterministic: same doc + batch gives byte-identical output in Node and browser.
- Credentials never appear in documents, command logs, autosave or logs.
- OEM-derived data never lives in this repo.
