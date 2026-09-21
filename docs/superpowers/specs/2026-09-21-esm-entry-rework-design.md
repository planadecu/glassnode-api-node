# Design — Rework the Node ESM entry (unbundled, zod-externalized)

**Date:** 2026-09-21
**Status:** proposed (branch `feat/esm-entry-rework`)
**Motivator:** quality review §3.6.1 / §3.6.2, confirmed by `attw` and `publint`.

## Problem

`exports["."].import` points at `dist/glassnode-api.esm.min.js` — the **Rollup browser bundle**:
minified, with `zod` **inlined**. Consequences for Node ESM consumers:

- `attw`: `glassnode-api` → `node16 (from ESM): 🚭 Unexpected module syntax`.
- `publint`: `exports["."].types` is ambiguous under the `import` condition.
- Importing the package prints `MODULE_TYPELESS_PACKAGE_JSON` (a `.js` ESM file in a package with
  no `"type"`, so Node parses as CJS, fails, re-parses as ESM).
- A **second copy of `zod`** (~90 KB, 332 refs) is bundled instead of dedup'd with the consumer's.
- Stack traces point into minified code.

The CJS/`require` path (`dist/index.js`, unminified, `zod` externalized) is correct. Only the ESM
entry is wrong, because it reuses the *browser* artifact.

## Goal

Ship a real, **unbundled** Node ESM build that externalizes `zod`, so:

- `attw` is 🟢 for `node16 (from ESM)`; `publint` has no errors.
- ESM and CJS consumers share one `zod` instance (no dual-package hazard for zod).
- No `MODULE_TYPELESS` warning; readable (unminified) ESM.
- The browser UMD bundle is unaffected.

## Chosen approach — dual `tsc` build

Emit a second, ESM copy of the library with `tsc`, alongside the existing CJS output. Rollup is kept
**only** for the browser UMD field.

### The blocker: extensionless imports

Source uses `import { X } from './types/config'` (no extension). This compiles today only because the
package emits **CommonJS** (extensionless relative imports are legal in CJS). Node ESM requires
explicit extensions at runtime. Therefore:

1. **Add `.js` extensions to every relative import/export in `src/`** (`./errors` → `./errors.js`,
   `./types/config` → `./types/config.js`, etc.). This is safe for the CJS build too (NodeNext CJS
   accepts explicit `.js`), so it is a single, format-agnostic change — do it first and confirm the
   existing CJS build + tests stay green before adding the ESM build.

### Build wiring

2. **`tsconfig.esm.json`** (extends base): `"module": "ESNext"`, `"moduleResolution": "NodeNext"`,
   `"outDir": "./dist/esm"`, `"declaration": false` (types come from the CJS build's `.d.ts`).
3. **`dist/esm/package.json` stub** = `{"type":"module"}` so Node treats `dist/esm/*.js` as ESM.
   Emit it in the build script (`node -e` write, after the esm tsc run).
4. **Scripts:**
   - `build:cjs` = `tsc` (current `build`, minus clean).
   - `build:esm` = `tsc -p tsconfig.esm.json && node -e "…write dist/esm/package.json…"`.
   - `build` = `pnpm run clean && pnpm run build:cjs && pnpm run build:esm`.
   - `build:browser` unchanged (UMD + the existing esm.min.js can stay for the `browser`/`module`
     bundler field, or be dropped — see Open questions).
5. **`package.json` `exports`:**
   ```jsonc
   ".": {
     "types": "./dist/index.d.ts",
     "import": "./dist/esm/index.js",   // NEW: unbundled Node ESM, zod externalized
     "require": "./dist/index.js"
   },
   "./x402": {
     "types": "./dist/x402.d.ts",
     "import": "./dist/esm/x402.js",
     "require": "./dist/x402.js"
   },
   "./package.json": "./package.json"
   ```
   Update `"module"` field → `./dist/esm/index.js`. Keep `"browser"` → the UMD bundle.
6. **`files`:** add `dist/esm/**/*.js` and the stub (`dist/**/*.js` already covers `dist/esm/*.js`;
   confirm the `package.json` stub is included — it is not matched by `*.js`, so add
   `"dist/esm/package.json"` explicitly).

### Alternative considered (rejected)

*Rename the Rollup ESM output to `.mjs` + externalize `zod`.* Simpler wiring but keeps a bundled,
minified ESM entry (worse stack traces) and needs a separate Rollup input to externalize `zod` for
one output only. The dual-`tsc` build is the industry-standard, cleaner result.

## Verification (all must pass before merge)

- `pnpm run build && pnpm run build:browser` clean.
- **`attw --pack .`**: `node16 (from ESM)` 🟢 for `.` and `./x402`.
- **`publint`**: no errors (warnings reviewed).
- Smoke, all three:
  - CJS: `node -e "require('./dist/index.js').GlassnodeAPI"`.
  - ESM: `node --input-type=module -e "import('./dist/esm/index.js').then(m=>{ if(!m.GlassnodeAPI) throw 0 })"`.
  - Subpath ESM: `import('./dist/esm/x402.js')`.
- `zod` externalized in the ESM entry: `grep -c "from 'zod'" dist/esm/glassnode-api.js` > 0 and no
  inlined zod source.
- Existing 53 tests + coverage unchanged.
- Tarball still small (no maps; `dist/esm` adds only a few KB of unminified JS).

## CI follow-up

Once green, **flip `publint` and `@arethetypeswrong/cli` in `ci.yml` from `continue-on-error` to hard
gates** (remove the flags), so regressions in the export map are caught.

## Risk & rollback

- Dual-package hazard is limited: `zod` is externalized in both entries (shared instance), and the
  library ships no stateful singletons of its own. `GlassnodeApiError instanceof` checks run within a
  single copy per consumer resolution.
- Rollback is a revert of the branch; the published `require` path is unchanged throughout.

## Open questions (resolve in PR)

1. Keep `dist/glassnode-api.esm.min.js` for the `module`/bundler field, or drop it now that Node ESM
   has a real entry? (Leaning: keep for bundlers via `browser`/`module`, since it's zod-inlined for
   the browser context.)
2. `moduleResolution: "NodeNext"` vs `"Bundler"` for `tsconfig.esm.json` — NodeNext is stricter and
   matches runtime; confirm it compiles with the newly-added extensions.
