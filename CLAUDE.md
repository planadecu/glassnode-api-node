# Claude Instructions

This document provides context for Claude when working with this project.

## Project Structure

- `/src` - Source code
  - `/src/types` - TypeScript type definitions (Zod schemas + inferred types)
- `/test` - Test files (Jest)
- `/examples` - Example usage patterns
- `/dist` - Compiled output (not checked into git)

## Development Workflow

- Use Node.js v24
- Use pnpm as package manager
- Run tests with `pnpm test`
- Lint code with `pnpm run lint`
- Format code with `pnpm run format`
- Build the project with `pnpm run build`
- Build browser bundles with `pnpm run build:browser`

## Coding Standards

- TypeScript for all source files
- Jest for testing
- ESLint and Prettier for code quality
- Husky for git hooks
- Zod for runtime validation of API responses and config

## API Client

The main class is `GlassnodeAPI` which takes a configuration object:
- `apiKey` (required) - Glassnode API key
- `apiUrl` (optional) - Base URL, defaults to `https://api.glassnode.com`
- `logger` (optional) - Callback for debug logging (e.g. `console.log`)
- `fetch` (optional) - Custom fetch function for testing or custom HTTP behavior
- `maxRetries` (optional) - Number of retries for 429/5xx errors (default 0)
- `retryDelay` (optional) - Base delay in ms between retries (default 1000, doubles each attempt)

## Versioning

Follow [semver](https://semver.org/):
- **Major** (1.0.0 → 2.0.0): Breaking changes (removed/renamed exports, changed method signatures)
- **Minor** (0.4.0 → 0.5.0): New features, new methods, new config options (backward-compatible)
- **Patch** (0.5.0 → 0.5.1): Bug fixes, docs, internal refactors (no API changes)

**Before every commit**, you MUST:
1. Bump `version` in `package.json` (patch, minor, or major as appropriate)
2. Add a corresponding entry to `CHANGELOG.md` describing the changes

## Build Targets

- **Node.js**: `tsc` compiles to `dist/` (CommonJS via NodeNext)
- **Browser**: Rollup produces UMD and ESM minified bundles in `dist/`
- Config: `tsconfig.json` (Node), `tsconfig.browser.json` (browser), `tsconfig.test.json` (tests/IDE)
