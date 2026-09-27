# loomsmith documentation index

loomsmith (working codename) is an open-source wiring harness design tool: one harness model, a CLI and a web editor, with an optional LLM pipeline that turns wiring diagram PDFs into proposed harness data. Licence Apache-2.0.

## Conventions
- Dated docs: `DDMMYYYY_topic.md` (plans, specs, reviews, point-in-time research).
- Evergreen docs: `topic.md` (architecture, data model, reference that stays valid).
- No em dashes in prose. Full paths when referencing files.
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
