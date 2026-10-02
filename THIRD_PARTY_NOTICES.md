# Third-party notices

loomsmith is licensed under Apache-2.0 (see LICENSE).

## Copied code

Policy: only code under MIT or other Apache-2.0-compatible permissive licences may be copied into this repository, and each copied file or excerpt is listed here with its source, commit and licence text. Projects under GPL, AGPL, PolyForm or with no licence are used for ideas only, never code or data.


## Dependencies

This policy covers code copied into the repository. Package dependencies are installed by pnpm from the npm registry and are not vendored in this repository; each keeps its own licence.

- Runtime: zod 4.6.5, MIT ([licence](https://raw.githubusercontent.com/colinhacks/zod/v4.6.5/LICENSE)).
- Development: TypeScript 7.0.2, Apache-2.0 ([licence](https://raw.githubusercontent.com/microsoft/TypeScript/v7.0.2/LICENSE.txt)); Vitest 5.0.2, MIT ([licence](https://github.com/vitest-dev/vitest/blob/v5.0.2/LICENSE)); @types/node, MIT (upstream [DefinitelyTyped licence](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE)); and, transitively through Vite (a Vitest dependency), Lightning CSS 1.33.0, MPL-2.0 ([licence](https://raw.githubusercontent.com/parcel-bundler/lightningcss/v1.33.0/LICENSE)).
