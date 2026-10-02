# loomsmith documentation index

loomsmith (working codename) is an open-source wiring harness design tool: one harness model, a CLI and a web editor, with an optional LLM pipeline that turns wiring diagram PDFs into proposed harness data. Licence Apache-2.0.

## Conventions
- Dated docs: `DDMMYYYY_topic.md` (plans, specs, reviews, point-in-time research).
- Evergreen docs: `topic.md` (architecture, data model, reference that stays valid).
- No em dashes in prose. Repo-relative paths and links when referencing files; never local machine paths.
- Read `c4model.md` before any architecture change and update it after.

## Categories and required sections
| Category | Required sections |
|---|---|
| Architecture | Context, containers, components, data flows, invariants |
| Design / spec | Context, decisions, design, out of scope, risks, verification |
| Plan / task record | Goal, status, tasks with state, decisions, deviations |
| Reference | Scope, content, last verified date |

## Documents

| Doc | Category | Summary |
|---|---|---|
| [c4model.md](c4model.md) | Architecture | Target containers (core, cli, ingest, web), core components, data flows and invariants. |
| [27092026_loomsmith_design.md](27092026_loomsmith_design.md) | Design / spec | Approved design: first principles, decisions (Apache-2.0, TS, JSON format, snake_case), data model, evidence/review, command log contract, validation levels, test boundary, LLM ingest, milestones M0 to M6, risks, verification. |
| [27092026_loomsmith_plan.md](27092026_loomsmith_plan.md) | Plan / task record | Implementation plan with task status, decisions and deviations. |
| [data_model.md](data_model.md) | Reference | File format, entities, evidence/review model, command log contract, validation codes (`S_*`, `M_*`, `W_*`) and derivations implemented in `@loomsmith/core` (M1 plus schema v2 length capture). |
| [28092026_length_capture_plan.md](28092026_length_capture_plan.md) | Plan / task record | Schema v2 length capture: plus/minus tolerance, per-end datums, pre-measurement estimate, signed per-end allowances from a datum, v1 to v2 migration that never repairs or revives, new S/M/W codes; tasks, decisions, deviations. |
