# Third-party notices

loomsmith is licensed under Apache-2.0 (see LICENSE).

## Copied code

Policy: only code under MIT or other Apache-2.0-compatible permissive licences may be copied into this repository, and each copied file or excerpt is listed here with its source, commit and licence text. Projects under GPL, AGPL, PolyForm or with no licence are used for ideas only, never code or data.

The authors state that no third-party code has been copied into this repository.

## Dependencies

This policy covers code copied into the repository. Package dependencies are installed by pnpm from the npm registry and are not vendored in this repository; each keeps its own licence.

- Runtime: zod (MIT).
- Development: TypeScript (Apache-2.0), Vitest (MIT), @types/node (MIT), and, transitively through Vite (a Vitest dependency), Lightning CSS (MPL-2.0).
