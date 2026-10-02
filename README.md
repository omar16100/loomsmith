# loomsmith

loomsmith is an open-source wiring harness design tool: one harness model, a CLI and a web editor (planned), with an optional LLM pipeline that turns wiring diagram PDFs into proposed harness data (planned).

## Status

Early development. What exists today is only the core library `@loomsmith/core` ([packages/core](packages/core)):

- document schema (schema_version 2)
- command log with undo
- structural and completeness validation
- evidence and review state
- routes and cut lengths
- nets
- bench test data
- wire list and BOM

The CLI and web editor are not built yet.

## Getting started

Requirements: Node 22.18 or later, pnpm 10.

```bash
pnpm install
pnpm check
```

`pnpm check` runs the typecheck and the test suite.

## Documentation

See [docs/index.md](docs/index.md) for the full documentation index, including [docs/data_model.md](docs/data_model.md) (file format, entities, validation codes, derivations) and [docs/c4model.md](docs/c4model.md) (architecture).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
