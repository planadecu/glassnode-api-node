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

## Build Targets

- **Node.js**: `tsc` compiles to `dist/` (CommonJS via NodeNext)
- **Browser**: Rollup produces UMD and ESM minified bundles in `dist/`
- Config: `tsconfig.json` (Node), `tsconfig.browser.json` (browser), `tsconfig.test.json` (tests/IDE)
