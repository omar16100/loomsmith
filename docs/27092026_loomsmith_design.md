# loomsmith design spec

Category: Design / spec. Status: approved by owner 27 Sep 2026 (plan-mode approval). Source plan: /Users/macmini/.claude/plans/what-are-the-good-fizzy-newell.md. Reviews: /Users/macmini/projects/codex/loomsmith_direction_review_27092026.txt, /Users/macmini/projects/codex/loomsmith_plan_review_r2_27092026.txt.

## Context
- Need: 1990 Lexus LS400 UCF10R (Europe RHD) has no purchasable replacement harness (/Users/macmini/projects/ls400/docs/25092026_buyee_wiring_harness_availability.md) and its exact EWD (EWD080Y) is out of print (/Users/macmini/projects/ls400/docs/25092026_wiring_diagram_sources.md). Paid tools are $219+/mo or quote-only; ~20 open-source tools each do one part well, none does the whole job (Appendix).
- Owner decisions: general tool (rebuild existing looms + design new) for the DIY/classic-car community; shared core + CLI + web editor from day one; TypeScript everywhere; may become a SaaS; LLM option that turns schematic diagrams into a harness model; "think from first principles, pick the best options".
- Reviews: codex astra (gpt-6-astra) round 1 (direction) and round 2 (this plan), 27 Sep 2026; all findings folded in.

## First principles
1. One model, many views. Schematic, assembly drawing, wire/cut list, BOM, test data, exports all derive from one document; derived data is never stored as editable truth.
2. Three layers stay separate: electrical connectivity, physical topology (measured bundle segments), drawing layout. Moving a drawing node never changes a measured length.
3. Every change is a versioned, validated command in an atomic batch. One mechanism serves undo/redo, CLI scripting, LLM proposals, MCP, and later cloud sync.
4. Unknown stays unknown. Where a value came from and whether a human approved it are separate facts.
5. Core is a pure, deterministic reducer: no DOM, filesystem, network, clock or RNG inside (ids and timestamps are passed in). Same code in Node, browser, later Cloudflare Workers.
6. The LLM never writes the document. It proposes commands with citations; the core validates; a human approves.

## Decisions
| Topic | Decision | Why |
|---|---|---|
| Approach | Fresh monorepo; borrow MIT code only, notices kept in THIRD_PARTY_NOTICES.md | 0xDevDav reconstructs wires from table rows (no wire ids, free-text lengths); reshaping = major refactor |
| Reuse | MIT: 0xDevDav (geometry/formboard rendering ideas), harness-studio (validator message style), e-Plan (deterministic Dijkstra). GPL/AGPL/PolyForm/unlicensed: ideas only, clean-room, no code or data | licence boundaries checked by codex (HarnessDesigner DB is GPL-2.0) |
| Name | `loomsmith` working codename (0 GitHub repos, npm free, .com taken) | `openwiringharness` clashes with lukebikes/OpenWiringHarness (AGPL); fork github.com/omar16100/openwiringharness left untouched |
| Licence | Apache-2.0 for core/CLI/web; no CLA; future paid cloud in a separate private repo; future parts data CC-BY-4.0 | explicit patent grant + termination, allows proprietary cloud, compatible with borrowed MIT code (codex r2) |
| OEM data | LS400/EWD-derived data never in the public repo; lives in /Users/macmini/projects/ls400/data/harness/ | service manuals are copyrighted |
| Stack | TS strict, pnpm workspaces, Node 22+, Vitest, Vite + React + SVG, zod v4 (types + runtime validation + generated JSON Schema), Playwright | one schema source; static offline web app |
| Format | JSON `*.loom.json`; `format: "loomsmith"`, integer `schema_version`, explicit migrations, reject future versions; opaque tenant-independent ids + human labels; canonical ordering of unordered collections (meaningful sequences like routes keep order) | clean diffs, agent-friendly, sync-ready |
| Units | `length_mm`, `cross_section_mm2`, `current_a`, `voltage_v`, `temperature_c`; original designation kept ("20 AWG", Toyota "0.5") | nominal sizes are not interchangeable by area |
| Naming | snake_case files, functions, variables, JSON keys; PascalCase types | owner rule |
| Logging | injected structured logger in core; CLI `--verbose`/`--json`; web debug toggle; never logs credentials | owner rule |
| Privacy | telemetry off by default; API keys never in documents, command logs, autosave or diagnostics | SaaS-ready trust |
| Hosting (later) | web on Cloudflare Pages | existing infra |

## Architecture (becomes docs/c4model.md)
```
/Users/macmini/projects/loomsmith/
  packages/core/src/   schema/ model/ commands/ validate/ derive/ export/ migrate/ assets/ log.ts
  packages/cli/        loomsmith validate | migrate | export | new | apply | ingest
  packages/ingest/     PDF parse -> candidate graph -> LLM resolution -> proposals file
  apps/web/            editor (+ proposal review)
  examples/synthetic_milestone/   golden fixture (synthetic, labelled as such)
  eval/                ingest spike fixtures + metrics (OEM pages referenced by hash, not committed)
  docs/  index.md c4model.md 27092026_loomsmith_design.md 27092026_loomsmith_plan.md data_model.md ingest.md
  todo.md  LICENSE  THIRD_PARTY_NOTICES.md
```
Data flow: file -> parse + migrate -> doc -> command batches -> validate -> derive -> export/render.

## Data model v1
- Project, Harness. Ownership explicit: every entity belongs to one harness or to the project (matings, shared parts). Label uniqueness: connector/splice labels unique per project; wire labels unique per harness.
- ConnectorInstance: label, part_use, cavities (label, numbering), face semantics explicit (mating face vs wire-entry view, housing vs contact gender).
- Cavity -> Contact (terminal part_use, seal part_use, quantity) -> WireEnd(s). Termination = the contact or splice crimp holding one or more wire ends; more than one only if flagged allowed.
- Splice and GroundPoint: electrical entities, each mapped to a TopologyNode when physical data exists.
- Wire: id, label, two WireEnds (each -> cavity contact | splice | ground_point), spec (cross_section_mm2 or unknown, designation, base_colour, stripe_colours[], insulation), route: ordered segment ids or null (schematic-only), end and service allowances.
- TopologyNode (connector, breakout, clip, grommet, splice, ground), BundleSegment (length). Graph allowed; ambiguous routes need an explicit choice.
- Mating: two connector instances + explicit cavity map; never merges wires.
- PartDefinition / PartUse with three independent properties: identification (identified | candidate | unknown), compatibility (compatible | incompatible | unknown, with evidence), procurement (available | unavailable | reused | unknown).
- Asset manifest: logical asset id, sha256, media type, external blob reference, page/bbox convention (PDF user space, points, origin bottom-left, page index 0-based). No absolute paths or expiring URLs as canonical references. Copy/import remaps ids.
- View: layout coordinates only.
- Derived (not stored): nets, route length (unknown if any segment unknown), cut length = route + allowances with tolerance stack, BOM (housings, terminals, seals by quantity, wire by length), wire list, test data.

## Evidence and review
- Field-level: each value can carry origin (measured | documented | inferred | assumed) + source asset/page/bbox, and a separate review status (unreviewed | approved | rejected) tied to the document revision it approved.
- Changing a value invalidates its approval. Approving an inference never turns it into "measured".
- Lengths: nominal_mm or null, tol_mm, datum, origin.

## Command log contract
- Batch: batch_id, document_id, command schema version, expected_revision, list of commands; applied atomically or rejected whole.
- Stale expected_revision rejected (no merging yet). Duplicate batch_id is a no-op (idempotent).
- Every command declares preconditions; inverse commands carry their own preconditions; deletions have explicit cascade rules (e.g. deleting a connector requires its wire ends to be detached first or a cascade flag).
- ids and timestamps generated by the caller, never inside the reducer.
- Command replay versioned separately from document migrations; history is checkpointed at migrations (old history retired, snapshot kept).

## Validation (two levels)
Each issue: code, severity, JSON path, entity id, fix hint.
- Structural (always): references resolve; wire has exactly two ends; cavity occupancy respects termination rules; mating maps consistent; label uniqueness per scope; schema version.
- Manufacturing completeness (for build outputs): every wire routed and contiguous; lengths known; wire spec known; parts identified. `--allow-unknown` produces outputs stamped INCOMPLETE with unknowns shown as unknown, never zero.
- Rejected: colour-based "two-ends" rule.

## Test boundary
Test data derivation takes: selected harness(es), mating state per mating (connected | disconnected), excluded external components/circuits (SRS excluded by default). Output: expected continuity per net and isolation between nets for that bench setup, plus printable worksheet.

## LLM "schematic to harness" (sub-project 2)
- Input: local 1992 EWD PDFs (/Users/macmini/projects/ls400/manuals/1990-1994 (94) UCF10~UCF11/~Electrical Wiring Diagram 92/, 59 vector PDFs; EWD-102 p3 = "INTERIOR LIGHT" with D3, L8, "12 BM3", G–W, no embedded rasters; confirmed by codex r2).
- Pipeline: pdf.js text items + drawing operators -> reconstruct transforms, normalise overlapping strokes, separate symbols from conductors -> candidate graph (keep ambiguity, never merge nets prematurely) -> LLM resolves label ownership, off-page continuations, splices, grounds, harness assignment -> proposals file (commands + page/bbox citations, origin inferred) -> core validate -> bounded repair loop -> review in web (source crop beside each item; accept/edit/reject).
- Scope limit: EWDs give connectivity and harness assignment, not lengths; physical layer comes from measuring the loom.
- Known hard cases to test first: conductors crossing without a junction marker (e.g. EWD-102 p3, branch from B39 toward BX1 crossing the conductor to BV1), striped conductors drawn as multiple strokes, lines inside component symbols, off-page continuations.
- Eval: overlay candidates on the page; measure candidate-graph recall separately from LLM resolution. Track connection precision/recall, false net merges, abstentions, citation correctness, correction time vs manual entry.
- Gates: spike (5 pages, 2 held out) go if precision >= 0.95 and recall >= 0.85 AND review+correction is faster than manual entry. Before M5 release: 15-20 varied pages, hundreds of endpoint connections, whole circuit groups held out.
- Models: provider adapter; defaults Claude Opus 5.5 (`claude-opus-5-5`) for resolution, Sonnet 5 (`claude-sonnet-5`) for cheap passes; API details checked against the claude-api reference at implementation. v1: provider calls from CLI only (key via env var); web only reviews proposals. SaaS later: metered server side.
- Later: raster (scanned) pages via vision; MCP server over the command API.

## Milestones
- M0 scaffold: /Users/macmini/projects/loomsmith, git init, feature branch, docs (index, c4model, design, plan), todo.md, Apache-2.0 LICENSE, CI config, parsnip entity.
- M1 model draft: zod schema + command log + validation + derivations; golden synthetic fixture (splice, repeated colours, unknown measurement, unknown wire spec, double-wire termination, base/stripe colours, terminal/seal quantities, mated connectors across two harnesses, schematic-only wire).
- M1b pre-freeze check: owner picks one bounded LS400 sub-harness and captures photos + measurements; model it by hand (connections from EWD, lengths measured) in /Users/macmini/projects/ls400/data/harness/. Schema frozen only when fixture + LS400 model both fit.
- M2 CLI: validate, migrate, export (wire_list.csv, bom.csv, test_data.csv, test_worksheet.html, assembly.svg), new, apply; `--json`.
- M3 ingest spike (parallel with M2, before substantial web work): 5 LS400 EWD pages, candidate overlay, hand labels, metrics, go/no-go report; fixtures and eval artifacts kept in eval/.
- M4 web editor v1: open/save (File System Access API + download fallback), IndexedDB autosave + crash recovery, tables (connectors, cavities, contacts, wires, segments), SVG topology view, issues panel, undo/redo, exports via core.
- M5 ingest v1 (if go): `loomsmith ingest` produces proposals; web review UI; expanded eval set.
- M6 LS400 pilot: build outputs for the M1b sub-harness, bench continuity check against worksheet.
- Later: electrical analysis (source/load/protection, voltage drop incl. return path, derating, "no supported size" never silently capped), parts library + fit checks, 1:1 tiled formboard print, tester adapter (e.g. Cirris), KBL/VEC subset for a named recipient (specs MIT via ProSTEP ecad-wiki), AI edit panel, MCP server, supplier fetch via CLI, cloud sync / teams (SaaS).

## Out of v1
3D, autorouting, automatic gauge/fuse selection, distributor fetch, variants, raster OCR, browser-side LLM calls, plugins, inventory, VEC/KBL, accounts/cloud, CRDT merging.

## Risks
- Vehicle evidence: build/market/options (TRC unconfirmed) recorded before deriving wiring.
- Connector orientation never inferred from mirrored renders.
- 1990 Sumitomo/Yazaki parts: identification, compatibility and procurement tracked separately.
- LLM false connection that passes validation: crossing tests, citations, held-out circuit groups, human approval.
- Continuity pass does not prove crimp quality; SRS excluded from default tests.
- Owner availability for M1b loom inspection (physical access to the car).

## Verification
- Vitest: every validation rule, derivation, command precondition, batch rollback, undo/inverse, replay, migration; run in Node and in browser (Vitest browser mode) for parity.
- Golden fixture snapshots of every export; CLI e2e diff against golden files.
- Playwright: open fixture -> edit -> export equals CLI export for the same revision.
- Ingest: eval report per model/prompt version on held-out pages.
- LS400 pilot: multimeter continuity check against the worksheet for the chosen bench setup.
- Codex astra review each milestone; docs (index, c4model, plan, todo) updated each milestone.

## Process
- After approval: save codex r1/r2 outputs to /Users/macmini/projects/codex/ (loomsmith_direction_review_27092026.txt, loomsmith_plan_review_r2_27092026.txt); write docs/27092026_loomsmith_design.md (spec) and the implementation plan (writing-plans) as docs/27092026_loomsmith_plan.md; register in docs/index.md.
- Git: local repo, feature branches, codex review before commits; GitHub repo creation (private) and any publishing only after owner OK.

## Appendix: survey highlights (25 Sep 2026, verified via gh api)
- Visual: 0xDevDav/harness-designer MIT (autolinked cavity tables, validate, cut lengths; wires inferred from table rows); HarnessDesigner GPL-2.0 (parts DB GPL-2.0, DRC, pegboard); AlexAgo83/electrical-plan-editor MIT (Dijkstra routing, sizing with silent 120 mm2 cap, multi-harness, AI panel); DIGIWIRE MIT (Excel to Draw.io); harnessIT MIT; simple_harness GPL-3.0; HarnessForge no licence.
- Code-first: almond-bot/harness-studio MIT (segment lengths, validator with JSON path + hint; tree-only topology); WireViz GPL-3.0; cableviz GPL-3.0 (tolerances); loome PolyForm NC (stable wire ids, fuse schedule, builder checklist); cable-designer GPL-3.0 (current -> gauge within terminal range).
- Add-ons: WireViz Studio, WireForm, wireviz-mcp (GPL-3.0); inventree-wireviz MIT; HarnessHelper AGPL.
- Standards (session ls400-66): KBL VDA 4964, VEC VDA 4968, STEP AP242 ed2, IPC/WHMA-A-620, ISO 6722, USCAR-2/21, DIN 72552.
