# Claude Instructions

This document provides context for Claude when working with this project.

## Project Structure

- `/src` - Source code
  - `/src/types` - TypeScript type definitions (Zod schemas + inferred types)
- `/test` - Test files (Vitest)
- `/examples` - Example usage patterns
- `/dist` - Compiled output (not checked into git)

## Development Workflow

- Use pnpm as package manager
- Run tests with `pnpm test` (Vitest, single run); `pnpm run test:watch` and `pnpm run test:coverage` are also available
- Lint code with `pnpm run lint`
- Format code with `pnpm run format`
- Build the project with `pnpm run build`
- Build browser bundles with `pnpm run build:browser`

### Node.js versions — two distinct baselines

Keep these separate; they answer different questions:

- **Consumers of the published package** need **Node.js >= 18**. This is the contract in
  `package.json` `engines`. The shipped code uses only universal APIs plus global `fetch`
  (stable since Node 18) — no `node:` builtins. To enforce this at compile time, `@types/node`
  is pinned to the **floor** (`^18`), not the latest, so the compiler rejects any API newer
  than Node 18. Do **not** bump `@types/node` to track the dev runtime — bump it only if the
  minimum supported Node is intentionally raised (a breaking change → major/`engines` bump).
- **Developers of this repo** run **Node.js 24** (`.nvmrc`, CI workflows). The dev toolchain
  sets the floor here: `vitest` 5 requires Node `>= 22.12`, so the test suite cannot run on
  Node 18/20 — that constraint is dev-only and never reaches consumers (vitest is a
  devDependency).

## Coding Standards

- TypeScript for all source files
- Vitest for testing (config in `vitest.config.ts`; coverage thresholds live there)
- ESLint and Prettier for code quality
- Husky for git hooks
- Zod for runtime validation of API responses and config

### TypeScript version

- Pinned to TypeScript **6.x** (`^6.0.3`), **not** 7.x. `typescript-eslint` still declares its
  `typescript` peer as `>=4.8.4 <6.1.0` (verified on the current latest, `8.70.0` — its canary
  is also 8.x), so TypeScript 7.0 breaks `pnpm run lint` in CI and the Husky pre-commit hook.
  `6.0.3` is already the newest stable 6.x, so TypeScript needs no bump. Only move to 7.x once
  `typescript-eslint` ships a release whose peer range accepts it.

## API Client

The main class is `GlassnodeAPI` which takes a configuration object:

- `apiKey` (required) - Glassnode API key
- `apiUrl` (optional) - Base URL, defaults to `https://api.glassnode.com`
- `apiKeyLocation` (optional) - `'query'` (default, `api_key` query param) or `'header'` (`X-Api-Key`
  header, keeps the key out of URLs). `'header'` is server-side only: the API's CORS preflight does
  not allow `X-Api-Key`, so browsers block it. With `'header'`, `fetchFn` gets `(url, { headers })`
  (+ `signal` if `timeout`); with no key, no header is sent.
- `logger` (optional) - Callback for debug logging (e.g. `console.log`)
- `fetch` (optional) - Custom fetch function for testing or custom HTTP behavior
- `maxRetries` (optional) - Number of retries for 429/5xx errors (default 0)
- `retryDelay` (optional) - Base delay in ms between retries (default 1000, doubles each attempt, then full jitter)
- `maxRetryDelay` (optional) - Upper bound in ms for a single retry wait (default 30000)
- `timeout` (optional) - Per-request timeout in ms; each attempt aborts via `AbortSignal.timeout()` (default none)
- `hooks` (optional) - Structured observability callbacks `{ onRequest, onResponse, onRetry, onError }`
  (types in `src/types/hooks.ts`). Called synchronously, never awaited; a throwing/rejecting hook is
  swallowed (reported to `logger`). Payloads carry a per-call `callId`, the redacted URL and no
  headers — the API key must never reach a hook payload.

## Versioning

Follow [semver](https://semver.org/):

- **Major** (1.0.0 → 2.0.0): Breaking changes (removed/renamed exports, changed method signatures)
- **Minor** (0.4.0 → 0.5.0): New features, new methods, new config options (backward-compatible)
- **Patch** (0.5.0 → 0.5.1): Bug fixes, docs, internal refactors (no API changes)

**Before every commit**, you MUST:

1. Bump `version` in `package.json` (patch, minor, or major as appropriate)
2. Add a corresponding entry to `CHANGELOG.md` describing the changes

## Build Targets

- **Node.js (CJS)**: `tsc` → `dist/` (CommonJS; the `require` entry). Relative imports in `src/`
  carry explicit `.js` extensions so the same source also emits valid ESM.
- **Node.js (ESM)**: `tsc -p tsconfig.esm.json` → `dist/esm/` (unbundled ES modules with `zod`
  externalized; the `import` entry). A generated `dist/esm/package.json` (`{"type":"module"}`) marks
  the folder as ESM. `exports` uses per-condition `types` (ESM `.d.ts` for `import`, CJS for
  `require`) — verified with `publint` + `@arethetypeswrong/cli` in CI.
- **Browser**: Rollup produces UMD (+ a minified ESM) bundle in `dist/` for the `browser`/`module`
  fields; source maps are generated `hidden` and not published.
- Config: `tsconfig.json` (CJS), `tsconfig.esm.json` (ESM), `tsconfig.browser.json` (browser),
  `tsconfig.test.json` (tests/IDE), `tsconfig.examples.json` (type-checks `examples/` against
  `src/` using root deps; CI runs `pnpm exec tsc -p tsconfig.examples.json`). The package sets
  `"type": "commonjs"`.

## Publishing

- Publishing is automated by `.github/workflows/publish.yml` on every push to `main`.
- It uses **npm Trusted Publishing (OIDC)** with provenance — there is **no `NPM_TOKEN`
  secret**. The workflow needs `permissions.id-token: write`, and a Trusted Publisher must
  be configured for the `glassnode-api` package on npmjs.com (repo
  `planadecu/glassnode-api-node`, workflow `publish.yml`).
- npm CLI `>= 11.5.1` performs the OIDC exchange, so the workflow installs the latest npm
  and publishes with `npm publish` (not `pnpm publish`, which uses the setup-node
  placeholder token and 404s). The setup-node `.npmrc` is overwritten before publishing so
  npm authenticates via OIDC instead of the placeholder token.
- The workflow bumps the patch version and commits it (`[skip ci]`). You should still bump
  `version` + `CHANGELOG.md` manually per the Versioning rules above for the substantive
  change; CI adds the release patch bump on top.
