# loomsmith design spec

Category: Design / spec. Status: approved by owner 27 Sep 2026 (plan-mode approval). Source plan: the approved design notes (not in this repo). Reviews: an external review (codex, gpt-6-astra) rounds 1 and 2, 27 Sep 2026 (not in this repo).

## Context
- Need: a tool that supports harness design and repair (rebuilding an existing loom, designing a new one). Pilot: the owner's pilot vehicle (a 1990s car); its data stays outside this repo. The open-source tools reviewed each cover part of the workflow (Appendix).
- Owner decisions: general tool (rebuild existing looms + design new) for the DIY/classic-car community; shared core + CLI + web editor from day one; TypeScript everywhere; may become a SaaS; LLM option that turns schematic diagrams into a harness model; "think from first principles, pick the best options".
- Reviews: codex astra (gpt-6-astra) round 1 (direction) and round 2 (this plan), 27 Sep 2026.

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
| Approach | Fresh monorepo; borrow MIT code only, notices kept in THIRD_PARTY_NOTICES.md | 0xDevDav/harness-designer infers wires from table rows; reshaping it around a wire model would be a major refactor |
| Reuse | MIT: 0xDevDav/harness-designer (cavity table and cut length ideas), harness-studio (validation ideas), electrical-plan-editor (routing ideas). GPL/AGPL/PolyForm/unlicensed: policy is ideas only, no code or data copied | keeps copied code compatible with Apache-2.0; licences per project in the Appendix |
| Name | `loomsmith` working codename | the name `openwiringharness` would clash with [lukebikes/OpenWiringHarness](https://github.com/lukebikes/OpenWiringHarness) (AGPL-3.0) |
| Licence | Apache-2.0 for core/CLI/web; no CLA; future paid cloud in a separate private repo; future parts data CC-BY-4.0 | explicit patent grant + termination ([licence text](https://www.apache.org/licenses/LICENSE-2.0.txt)), allows proprietary cloud, compatible with borrowed MIT code ([ASF licence categories](https://www.apache.org/legal/resolved.html)), MIT notices kept |
| OEM data | Policy: OEM wiring diagram (EWD) and service manual content is never committed to this repo; vehicle data lives outside this repository | project policy |
| Stack | TS strict, pnpm workspaces, Node 22+, Vitest, Vite + React + SVG, zod v4 (types + runtime validation + generated JSON Schema), Playwright | one schema source; static offline web app |
| Format | JSON `*.loom.json`; `format: "loomsmith"`, integer `schema_version`, explicit migrations, reject future versions; opaque tenant-independent ids + human labels; canonical ordering of unordered collections (meaningful sequences like routes keep order) | clean diffs, agent-friendly, sync-ready |
| Units | `length_mm`, `cross_section_mm2`, `current_a`, `voltage_v`, `temperature_c`; original wire designation kept as written (e.g. "20 AWG", "0.5 mm2") | preserve the original wire designation; never re-derive it from the area |
| Naming | snake_case files, functions, variables, JSON keys; PascalCase types | owner rule |
| Logging | injected structured logger in core; CLI `--verbose`/`--json`; web debug toggle; never logs credentials | owner rule |
| Privacy | telemetry off by default; API keys never in documents, command logs, autosave or diagnostics | SaaS-ready trust |
| Hosting (later) | web on Cloudflare Pages | existing infra |

## Architecture (becomes docs/c4model.md)
Target file map. Entries marked (planned) do not exist yet; current status is in `docs/c4model.md`.
```
loomsmith/
  packages/core/src/   schema/ model/ commands/ validate/ derive/ migrate/ log.ts; export/ assets/ (planned)
  packages/cli/        (planned) loomsmith validate | migrate | export | new | apply | ingest
  packages/ingest/     (planned) PDF parse -> candidate graph -> LLM resolution -> proposals file
  apps/web/            (planned) editor (+ proposal review)
  examples/synthetic_milestone/   golden fixture (synthetic, labelled as such)
  eval/                (planned) ingest spike fixtures + metrics (OEM pages referenced by hash, not committed)
  docs/  index.md c4model.md 27092026_loomsmith_design.md 27092026_loomsmith_plan.md data_model.md; ingest.md (planned)
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
- Lengths: nominal_mm or null, tol_mm, datum, origin. As implemented in schema v2 (plus/minus
  tolerance bands, a datum per segment end, an estimate range and signed per-end allowances),
  see `docs/data_model.md` and `docs/28092026_length_capture_plan.md`.

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
- Input: a vintage OEM wiring diagram book (vector PDF) supplied by the user; it stays on the user's machine and is never committed to this repo.
- Pipeline: pdf.js text items + drawing operators -> reconstruct transforms, normalise overlapping strokes, separate symbols from conductors -> candidate graph (keep ambiguity, never merge nets prematurely) -> LLM resolves label ownership, off-page continuations, splices, grounds, harness assignment -> proposals file (commands + page/bbox citations, origin inferred) -> core validate -> bounded repair loop -> review in web (source crop beside each item; accept/edit/reject).
- Scope limit: ingest proposes connectivity and harness assignment only; physical lengths are entered from measurements of the loom.
- Known hard cases to test first: conductors crossing without a junction marker (synthetic example: on a test page drawn for this purpose, the branch from splice S1 to connector C2 crosses the conductor from C1 to C3 with no junction dot, so the two nets must stay separate), striped conductors drawn as multiple strokes, lines inside component symbols, off-page continuations.
- Eval: overlay candidates on the page; measure candidate-graph recall separately from LLM resolution. Track connection precision/recall, false net merges, abstentions, citation correctness, correction time vs manual entry.
- Gates: spike (5 pages, 2 held out) go if precision >= 0.95 and recall >= 0.85 AND review+correction is faster than manual entry. Before M5 release: 15-20 varied pages, hundreds of endpoint connections, whole circuit groups held out.
- Models: provider adapter; default provider an LLM (Claude models, see the [model overview](https://platform.claude.com/docs/en/models/overview)); the model per pass is chosen at implementation against that documentation. v1: provider calls from CLI only (key via env var); web only reviews proposals. SaaS later: metered server side.
- Later: raster (scanned) pages via vision; MCP server over the command API.

## Milestones
- M0 scaffold: this repo, git init, feature branch, docs (index, c4model, design, plan), todo.md, Apache-2.0 LICENSE, CI config.
- M1 model draft: zod schema + command log + validation + derivations; golden synthetic fixture (splice, repeated colours, unknown measurement, unknown wire spec, double-wire termination, base/stripe colours, terminal/seal quantities, mated connectors across two harnesses, schematic-only wire).
- M1b pre-freeze check: owner picks one bounded sub-harness of the owner's pilot vehicle (a 1990s car) and captures photos + measurements; model it by hand (connections from the wiring diagram, lengths measured) outside this repo. Schema frozen only when the fixture and the pilot model both fit.
- M2 CLI: validate, migrate, export (wire_list.csv, bom.csv, test_data.csv, test_worksheet.html, assembly.svg), new, apply; `--json`.
- M3 ingest spike (parallel with M2, before substantial web work): 5 pages of a vintage OEM wiring diagram book (vector PDF), candidate overlay, hand labels, metrics, go/no-go report; fixtures and eval artifacts kept in eval/.
- M4 web editor v1: open/save (File System Access API + download fallback), IndexedDB autosave + crash recovery, tables (connectors, cavities, contacts, wires, segments), SVG topology view, issues panel, undo/redo, exports via core.
- M5 ingest v1 (if go): `loomsmith ingest` produces proposals; web review UI; expanded eval set.
- M6 pilot: build outputs for the M1b sub-harness, bench continuity check against worksheet.
- Later: electrical analysis (source/load/protection, voltage drop incl. return path, derating, "no supported size" never silently capped), parts library + fit checks, 1:1 tiled formboard print, tester adapter (e.g. Cirris), KBL/VEC subset for a named recipient (the VEC and the ecad-wiki content are published under MIT unless stated otherwise for specific content, per [prostep-ivip-e-V/vec](https://github.com/prostep-ivip-e-V/vec); some example files carry other licences, see [ecad-wiki samples](https://ecad-wiki.prostep.org/sample/)), AI edit panel, MCP server, supplier fetch via CLI, cloud sync / teams (SaaS).

## Out of v1
3D, autorouting, automatic gauge/fuse selection, distributor fetch, variants, raster OCR, browser-side LLM calls, plugins, inventory, VEC/KBL, accounts/cloud, CRDT merging.

## Risks
- Vehicle evidence: build/market/options recorded before deriving wiring.
- Connector orientation never inferred from mirrored renders.
- Connector parts: identification, compatibility and procurement tracked separately.
- LLM false connection that passes validation: crossing tests, citations, held-out circuit groups, human approval.
- Generated test data covers continuity and isolation only; crimp quality is outside its scope. SRS connectors are excluded from the default generated test data.
- Owner availability for M1b loom inspection (physical access to the car).

## Verification
- Vitest: every validation rule, derivation, command precondition, batch rollback, undo/inverse, replay, migration; run in Node and in browser (Vitest browser mode) for parity.
- Golden fixture snapshots of every export; CLI e2e diff against golden files.
- Playwright: open fixture -> edit -> export equals CLI export for the same revision.
- Ingest: eval report per model/prompt version on held-out pages.
- Pilot: multimeter continuity check against the worksheet for the chosen bench setup.
- Codex astra review each milestone; docs (index, c4model, plan, todo) updated each milestone.

## Process
- After approval: save codex r1/r2 outputs outside this repo; write docs/27092026_loomsmith_design.md (spec) and the implementation plan as docs/27092026_loomsmith_plan.md; register in docs/index.md.
- Git: local repo, feature branches, codex review before commits; GitHub repo creation (private) and any publishing only after owner OK.

## Appendix: other tools reviewed (survey 25 Sep 2026)
Licences and features as stated in each linked upstream repository; they may change upstream.
- Visual: [0xDevDav/harness-designer](https://github.com/0xDevDav/harness-designer) MIT (autolinked cavity tables, validation, cut lengths; wires inferred from table rows); [HarnessDesigner](https://github.com/HarnessDesigner/HarnessDesigner) GPL-2.0 (parts database, pegboard); [AlexAgo83/electrical-plan-editor](https://github.com/AlexAgo83/electrical-plan-editor) MIT (routing, multiple harnesses, AI panel); [harnessIT](https://github.com/cheeze36/harnessIT) MIT.
- Code-first: [almond-bot/harness-studio](https://github.com/almond-bot/harness-studio) MIT (segment lengths, validation, tree topology); [WireViz](https://github.com/wireviz/WireViz) GPL-3.0; [cableviz](https://github.com/delta-being/cableviz) GPL-3.0 (tolerances); [loome](https://github.com/erik-hasse/loome) PolyForm Noncommercial 1.0.0 ([licence file](https://raw.githubusercontent.com/erik-hasse/loome/main/LICENSE.md)) (stable wire ids, fuse schedule, builder checklist).
- Add-ons: [WireForm](https://github.com/Garth-42/WireForm) GPL-3.0-only; [wireviz-mcp](https://github.com/chrisflesher/wireviz-mcp) GPL-3.0; inventree-wireviz MIT ([package metadata](https://github.com/inventree/inventree-wireviz/blob/main/setup.py)); [HarnessHelper](https://github.com/lukebikes/HarnessHelper) AGPL-3.0.
- Standards: KBL, VDA 4964 ([ecad-wiki](https://ecad-wiki.prostep.org/specifications/kbl/)); VEC, VDA 4968 ([ecad-wiki](https://ecad-wiki.prostep.org/specifications/vec/)).
- Possible future references (not used yet; publisher links and editions to be added before any technical use): STEP AP242 ed2, IPC/WHMA-A-620, ISO 6722, USCAR-2/21, DIN 72552.
