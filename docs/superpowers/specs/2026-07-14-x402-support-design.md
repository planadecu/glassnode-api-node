# Design: x402 payment support (Node-first)

**Date:** 2026-07-14
**Status:** Approved design — ready for implementation planning
**Package:** `glassnode-api`

## Overview

Glassnode now exposes a paid, per-call API over the [x402 payment protocol](https://x402.org)
at `https://x402.glassnode.com` (mainnet) and `https://x402.glassnode.tech` (testnet). Requests that
require payment return `402 Payment Required` with a header-based challenge; an x402-aware client signs a
USDC payment authorization and retries.

**Verified from the live `402` challenges** (`payment-required` header, base64 JSON, `x402Version: 2`,
scheme `exact`; `accepts[].amount` is USDC atomic units, 6 decimals — always authoritative):

| Endpoint class              | Price               | Mainnet network / asset                   | Testnet network / asset                      |
| --------------------------- | ------------------- | ----------------------------------------- | -------------------------------------------- |
| Metadata (`/v1/metadata/*`) | `10000` = **$0.01** | `eip155:8453` (Base) / USDC `0x8335…2913` | `eip155:84532` (Base Sepolia) / `0x036C…F7e` |
| Metrics (`/v1/metrics/*`)   | `50000` = **$0.05** | same                                      | same                                         |

**Bulk metrics are NOT exposed over x402** — `GET /v1/metrics/.../bulk` returns `404` on the x402 host.
`callBulkMetric()` is therefore unsupported in x402 mode (see Non-goals).

This design adds first-class x402 support to the library **without** shipping crypto/wallet code in the
core package. x402 tooling is opt-in via a subpath export and optional peer dependencies.

## Goals

- Let a Node.js caller make paid Glassnode calls through the existing `GlassnodeAPI` client.
- Keep the core package's footprint unchanged: single runtime dependency (`zod`), browser-friendly.
- Make the crypto stack (`@x402/fetch`, `@x402/evm`, `viem`) **optional** — installed only by users who make paid calls.
- Provide a built-in spend guard with a safe default.

## Non-goals (YAGNI)

- Browser signing (injected wallet / EIP-1193). Explicitly deferred to a later iteration; the design
  leaves room for it in the same subpath.
- **Bulk metrics over x402.** The x402 host 404s on `/v1/metrics/.../bulk`; `callBulkMetric()` stays a
  free-API (`api.glassnode.com`) feature only. In x402 mode a bulk call will surface the normal `404`
  error; the README documents this limitation. (No special guard in v1 unless we later choose to throw a
  clearer message.)
- Networks other than Base / Base Sepolia, or tokens other than USDC.
- Payment receipts, balance top-ups, streaming, or any wallet management beyond signing a call.

## Key decisions

1. **Approach A — subpath export + core preset.** The turnkey helper lives at the `glassnode-api/x402`
   subpath; the core entry (`glassnode-api`) never imports crypto. Chosen over an all-in-core config
   (leaks crypto into the core module graph; constructors can't `await` a dynamic import) and over a
   separate companion package (extra release pipeline for a small helper).
2. **x402 client: `@x402/fetch` v2 + `@x402/evm` (Coinbase CDP-recommended).** The live Glassnode endpoints
   return **`x402Version: 2`** (header-based `payment-required` challenge, CAIP-2 networks `eip155:8453`).
   The **Coinbase CDP buyer quickstart itself now installs `@x402/fetch @x402/evm`** — the scoped v2
   packages are Coinbase's current recommendation; the unscoped `x402-fetch` v1 (x402Version 1, network
   `"base"`) is the deprecated predecessor and cannot parse a v2 challenge. So "the Coinbase client" and
   "the foundation v2 client" are the same thing (`@x402/fetch` v2). v2 setup requires registering the
   exact-EVM scheme and building a client:
   ```ts
   import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
   import { registerExactEvmScheme } from '@x402/evm/exact/client';
   ```
   Exact `x402Client` construction and the max-amount mechanism are confirmed against the installed
   `@x402/fetch`/`@x402/evm` `.d.ts` during implementation (npm readmes are empty).
3. **Spend safety exposed with a default cap.** `maxPaymentPerCall` (USDC decimal string) defaults to
   `'0.06'` (just above the $0.05 metrics price), converted to atomic units (`parseUnits(value, 6)`) and
   passed to the client's max-amount guard.
4. **Node-first.** Browser parity is a separate, later effort.

## Architecture

### Module layout

| File                   | Change    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/x402.ts`          | **new**   | Compiled to subpath export `glassnode-api/x402`. Exports `createX402Fetch` + types. **All** optional-dep usage is behind a dynamic `import()` here.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/types/config.ts`  | edit      | Add `x402?: boolean`; export `X402_API_URL = 'https://x402.glassnode.com'`, `X402_TESTNET_API_URL = 'https://x402.glassnode.tech'`, **and** a source-level `DEFAULT_API_URL = 'https://api.glassnode.com'` constant (today that literal only lives inside the Zod default). Change `apiUrl` to `z.string().url().optional()` (keep `.url()`, drop `.default()`) so "explicitly set" is detectable. Make `apiKey` `.optional()` and add object-level `.refine`s: (a) `apiKey` required when `x402` is falsy; (b) **`fetch` required when `x402` is `true`** (a plain fetch can't pay). |
| `src/glassnode-api.ts` | edit      | Base-URL resolution (see below); change the `private apiKey` field type to `string \| undefined` and the `this.apiKey =` assignment accordingly. Request path, retries, and Zod validation otherwise unchanged.                                                                                                                                                                                                                                                                                                                                                                       |
| `src/errors.ts`        | edit      | Add a friendly `402` message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/index.ts`         | unchanged | Deliberately does **not** re-export the helper, keeping the core entry `zod`-only. `X402_API_URL` and the `x402` config flag flow through the normal config exports (plain strings/booleans, no crypto).                                                                                                                                                                                                                                                                                                                                                                              |

### Core API

```ts
new GlassnodeAPI({
  apiKey?: string,
  x402?: boolean,        // default false
  apiUrl?: string,       // explicit override always wins
  fetch?: typeof fetch,  // pass an x402-wrapped fetch for paid calls
  // ...existing options unchanged
});
```

Base-URL resolution (in the constructor):

```
apiUrl ?? (x402 ? X402_API_URL : DEFAULT_API_URL)
```

- Fully backward-compatible: with neither `apiUrl` nor `x402`, the URL stays `https://api.glassnode.com`.
- **`fetch` is required when `x402: true`.** Enforced at construction via a Zod refine — without a
  payment-capable fetch every call would just `402`. The error message points to `glassnode-api/x402`.
- **Testnet:** `x402: true` defaults to mainnet; target Base Sepolia by passing
  `apiUrl: X402_TESTNET_API_URL` explicitly (an explicit `apiUrl` always wins over the preset).
- **`apiKey` becomes optional under x402.** Glassnode's x402 endpoint is authorized by payment, not an API
  key (its own curl example sends no `api_key`). So:
  - Config validation: `apiKey` is required when `x402` is falsy (unchanged, backward-compatible) and
    **optional** when `x402` is `true`. Implement with a Zod `superRefine`/`refine` on the config object.
    Note this is a **runtime-only** guard: `GlassnodeConfig = z.input<...>` will type `apiKey` as optional
    unconditionally (cross-field requiredness isn't expressible in the input type), so omitting `apiKey`
    with `x402` falsy compiles but throws at construction. (Verified: a Zod-4 object `.refine` still parses
    correctly and nothing in the repo relies on `.shape`/`.extend` of this schema.)
  - Request building: `request()` appends `api_key=<key>` **only when an `apiKey` is present**. When absent
    (x402-only usage) the param is omitted entirely. An API key _may_ still be supplied alongside x402 if
    the caller has one; it is not forced.
- No other changes to the request loop: the injected x402-wrapped `fetch` handles `402` transparently,
  below the library's existing `maxRetries` (429/5xx) loop and before Zod validation.

### Helper: `glassnode-api/x402`

```ts
import type { LocalAccount } from 'viem'; // type-only — must not trigger a runtime load

type X402FetchOptions = {
  account: LocalAccount; // viem account, e.g. privateKeyToAccount(pk)
  maxPaymentPerCall?: string; // USDC decimal, default '0.06'
  fetch?: typeof fetch; // base fetch to wrap, default globalThis.fetch
};

async function createX402Fetch(options: X402FetchOptions): Promise<typeof fetch>;
```

Behavior:

1. Dynamically `import('@x402/fetch')`, `import('@x402/evm/exact/client')`, and (for signer/units)
   `import('viem')`. If any is missing, throw a clear error: _"createX402Fetch requires the optional peer
   dependencies `@x402/fetch`, `@x402/evm`, and `viem`. Install them: `pnpm add @x402/fetch @x402/evm
viem`."_ All value imports of the optional deps stay inside the async function; only `import type`
   references appear at module scope, so importing the subpath without the peers installed does not throw
   until `createX402Fetch` is actually called.
2. **Build the v2 client:** `registerExactEvmScheme(...)` then construct the `x402Client` (exact
   construction confirmed against the installed `.d.ts`). x402 signs an off-chain EIP-3009 authorization
   (the facilitator submits on-chain), so a bare `LocalAccount` should suffice — pass `account`; only build
   a viem wallet client if the v2 client strictly requires one.
3. **Spend cap:** convert `maxPaymentPerCall` → atomic units via `parseUnits(value, 6)` (USDC, 6 decimals),
   e.g. `parseUnits('0.06', 6) === 60000n`. Verify how v2 expresses the max: if `wrapFetchWithPayment`/the
   client exposes a max-amount option, use it; if not, enforce it via a payment-requirements selector that
   **throws when `accepts[].amount` exceeds the cap** before signing. Either way the cap must be honored.
4. Return `wrapFetchWithPayment(baseFetch, client)`. Its return type is `(input, init?) => Promise<Response>`,
   which does **not** structurally include `fetch.preconnect`; cast the result `as typeof fetch` so it
   satisfies the config's `FetchFn` under `strict`.

> A `walletClient` advanced override is intentionally **cut from v1** (YAGNI) — trivially re-addable if a
> caller needs a custom transport/chain.

### Usage (target ergonomics)

```ts
import { GlassnodeAPI } from 'glassnode-api';
import { createX402Fetch } from 'glassnode-api/x402';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const api = new GlassnodeAPI({
  x402: true, // -> https://x402.glassnode.com
  fetch: await createX402Fetch({ account, maxPaymentPerCall: '0.06' }),
});

// Pays $0.05 USDC on Base, transparently:
const mvrv = await api.callMetric('/market/mvrv', { a: 'BTC', i: '24h' });
```

## Payment & error flow

- **Happy path:** the wrapped fetch intercepts `402`, verifies the price is within `maxValue`, signs a USDC
  authorization on Base, and retries. The library only ever observes the resulting `200`, then validates
  with Zod as today.
- **Composition with existing retries:** `maxRetries` handles 429/5xx and wraps the injected fetch; x402's
  402 handling lives _inside_ that fetch. No conflict.
- **Misconfiguration guard:** if a `402` reaches the library's request loop (e.g. `x402: true` but a plain,
  unwrapped `fetch` was passed), map it to a friendly, **non-retryable** `GlassnodeApiError`:
  _"Payment required — pass an x402-capable fetch (see `glassnode-api/x402`)."_ Add `402` to the
  `STATUS_MESSAGES` map.
- **Over-cap / insufficient funds:** `wrapFetchWithPayment` throws before paying (or the payment fails);
  the error propagates with the client's message through the library's existing error handling.

## Packaging & build

- `package.json`:
  - `exports`: add a `"./x402"` subpath (`import` / `require` / `types`).
  - `peerDependencies`: `@x402/fetch`, `@x402/evm`, and `viem`, all marked `optional: true` in `peerDependenciesMeta`.
  - `devDependencies`: add `@x402/fetch`, `@x402/evm`, and `viem` so `src/x402.ts` type-checks and tests can run.
  - `files`: existing globs (`dist/*.js`, `dist/*.d.ts`) already capture the new subpath output.
  - Version: **minor** bump (new backward-compatible feature) + CHANGELOG entry.
- Node build (`tsc`): compiles `src/x402.ts` as part of `src/**/*` (NodeNext resolves viem/@x402/fetch
  subpath exports fine).
- Browser build (`rollup`): **do not** add `src/x402.ts` to the inputs — the browser bundle stays
  crypto-free. **Required (release-pipeline risk):** `tsconfig.browser.json` uses `include: ["src/**/*"]`
  with `moduleResolution: node` (classic), which **cannot** resolve viem/@x402/fetch `exports`-map subpaths.
  So `src/x402.ts` must be added to `exclude` in `tsconfig.browser.json` (and, defensively, to the
  `@rollup/plugin-typescript` `exclude`), otherwise `build:browser` — and therefore `prepublishOnly` — fails
  to type-check. Add the x402 test file to the same exclude.
- **Subpath is CJS-only by design.** With no `"type": "module"`, `tsc` emits `dist/x402.js` as CommonJS and
  there is no rollup ESM bundle for the subpath; `import`/`require` both resolve to it. ESM consumers get it
  via Node named-export interop, and its inner dynamic `import()` is the correct CJS→ESM bridge to the
  ESM-only viem/@x402/fetch. No tree-shakeable ESM is expected here.

## Testing (Vitest)

Core (no crypto, no network):

- `x402: true` → base URL is `https://x402.glassnode.com`.
- Explicit `apiUrl` overrides `x402`.
- Neither set → `https://api.glassnode.com` (regression guard).
- A mock x402-wrapped `fetch` flows through to validated data unchanged.
- A `402` from a plain fetch → the friendly non-retryable error.
- A `402` is **not** retried even with `maxRetries > 0` (locks in that `402` is absent from
  `GlassnodeApiError.isRetryable`).
- `x402: true` with no `apiKey` constructs successfully, and the outgoing URL omits `api_key`.
- `x402: true` with an `apiKey` still appends `api_key`.
- No `x402`, no `apiKey` → constructor throws (unchanged required-key behavior).

Helper (mock the dynamic imports; no real crypto/network):

- Use `vi.mock('@x402/fetch', factory)` / `vi.mock('viem', factory)`. `@x402/fetch` and `viem` must be added
  as **devDependencies** so the module specifiers resolve at test time; the "missing deps" case is exercised
  by making the mock factory throw / reject (not by real absence).
- Missing optional deps → clear install error (via a throwing mock).
- Default `maxPaymentPerCall` converts to `60000n` (`parseUnits('0.06', 6)`) and is passed to the client's
  max-amount option; assert the concrete bigint.
- Custom `maxPaymentPerCall` passed through.
- Returns a callable `fetch`.

Testnet integration test (opt-in, real network — **not** in default CI):

- A single end-to-end test against `https://x402.glassnode.tech` (Base Sepolia, `eip155:84532`) that makes
  one real paid metric call and asserts a validated `200` response.
- Gated behind an env var (e.g. `X402_TESTNET_PRIVATE_KEY`): skip when unset so unit runs and CI stay
  hermetic. Requires a Base-Sepolia wallet funded with test USDC.
- Add a `test:x402` script (or a tagged Vitest project) so it runs on demand, separate from `pnpm test`.
- Purpose: prove the `@x402/fetch` v2 wiring + `createX402Fetch` actually completes a payment against a
  live x402 v2 endpoint before shipping.

## Spend safety (scope of the guard)

`maxPaymentPerCall` bounds a **single** request only — it does **not** cap cumulative spend across many
calls, so a retry storm or an agent loop can still drain a wallet within the per-call ceiling. The library
will not model a cumulative budget in v1 (a caller can wrap their own counter). The README must:

- State clearly that the guard is per-call, not a total budget.
- Recommend a **dedicated, funded-but-limited** wallet for agent use (not a primary key).
- Warn against hardcoding keys; the example loads `PRIVATE_KEY` from the environment.

## Docs

- README: a "Paid calls with x402" section (Node example, per-call spend cap + the wallet-safety warnings
  above, links to Glassnode x402 + the buyer quickstart), noting browser support is planned.
- CHANGELOG entry under the new minor version.

## References

- x402 protocol (v2, x402-foundation): https://github.com/x402-foundation/x402 — client `@x402/fetch` + `@x402/evm`
- Coinbase CDP buyer quickstart (recommends `@x402/fetch @x402/evm`): https://docs.cdp.coinbase.com/x402/quickstart-for-buyers
- Coinbase CDP x402 welcome: https://docs.cdp.coinbase.com/x402/welcome
- Glassnode x402 skill: https://x402.glassnode.com/SKILL.md
- Live challenge shape (verified 2026-07-14): `payment-required` header, base64 JSON, `x402Version: 2`,
  `accepts: [{ scheme: "exact", network: "eip155:8453" | "eip155:84532", asset: <USDC>, amount: "10000" | "50000", ... }]`
