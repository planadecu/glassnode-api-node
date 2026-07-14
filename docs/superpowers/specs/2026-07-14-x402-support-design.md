# Design: x402 payment support (Node-first)

**Date:** 2026-07-14
**Status:** Approved design — ready for implementation planning
**Package:** `glassnode-api`

## Overview

Glassnode now exposes a paid, per-call API over the [x402 payment protocol](https://docs.cdp.coinbase.com/x402)
at `https://x402.glassnode.com`. Requests that require payment return `402 Payment Required`; an
x402-aware client signs a USDC payment authorization on **Base mainnet** and retries. Pricing (authoritative
value always comes from the live `402` challenge):

- Metadata endpoints (`/v1/metadata/*`): **$0.01 USDC/call**
- Metrics endpoints (`/v1/metrics/*`): **$0.05 USDC/call**

This design adds first-class x402 support to the library **without** shipping crypto/wallet code in the
core package. x402 tooling is opt-in via a subpath export and optional peer dependencies.

## Goals

- Let a Node.js caller make paid Glassnode calls through the existing `GlassnodeAPI` client.
- Keep the core package's footprint unchanged: single runtime dependency (`zod`), browser-friendly.
- Make the crypto stack (`x402-fetch`, `viem`) **optional** — installed only by users who make paid calls.
- Provide a built-in spend guard with a safe default.

## Non-goals (YAGNI)

- Browser signing (injected wallet / EIP-1193). Explicitly deferred to a later iteration; the design
  leaves room for it in the same subpath.
- Networks other than Base, or tokens other than USDC.
- Payment receipts, balance top-ups, streaming, or any wallet management beyond signing a call.

## Key decisions

1. **Approach A — subpath export + core preset.** The turnkey helper lives at the `glassnode-api/x402`
   subpath; the core entry (`glassnode-api`) never imports crypto. Chosen over an all-in-core config
   (leaks crypto into the core module graph; constructors can't `await` a dynamic import) and over a
   separate companion package (extra release pipeline for a small helper).
2. **x402 client: `x402-fetch` v1 (Coinbase lineage).** Uses
   `wrapFetchWithPayment(fetch, walletClient, maxValue?)`. Matches the "x402 Quickstart for Buyers"
   referenced by Glassnode's own x402 docs.
3. **Spend safety exposed with a default cap.** `maxPaymentPerCall` (USDC decimal string) defaults to
   `'0.06'` (just above the $0.05 metrics price), converted to `maxValue` atomic units. Tighter than
   `x402-fetch`'s own 0.1 USDC default.
4. **Node-first.** Browser parity is a separate, later effort.

## Architecture

### Module layout

| File | Change | Notes |
| --- | --- | --- |
| `src/x402.ts` | **new** | Compiled to subpath export `glassnode-api/x402`. Exports `createX402Fetch` + types. **All** optional-dep usage is behind a dynamic `import()` here. |
| `src/types/config.ts` | edit | Add `x402?: boolean` to the config schema; export `X402_API_URL = 'https://x402.glassnode.com'`. Make `apiUrl` optional (no Zod default) so "explicitly set" is detectable. |
| `src/glassnode-api.ts` | edit | Base-URL resolution only (see below). Request path, retries, and Zod validation unchanged. |
| `src/errors.ts` | edit | Add a friendly `402` message. |
| `src/index.ts` | unchanged | Deliberately does **not** re-export the helper, keeping the core entry `zod`-only. `X402_API_URL` and the `x402` config flag flow through the normal config exports (plain strings/booleans, no crypto). |

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
- **`apiKey` becomes optional under x402.** Glassnode's x402 endpoint is authorized by payment, not an API
  key (its own curl example sends no `api_key`). So:
  - Config validation: `apiKey` is required when `x402` is falsy (unchanged, backward-compatible) and
    **optional** when `x402` is `true`. Implement with a Zod `superRefine`/`refine` on the config object.
  - Request building: `request()` appends `api_key=<key>` **only when an `apiKey` is present**. When absent
    (x402-only usage) the param is omitted entirely. An API key *may* still be supplied alongside x402 if
    the caller has one; it is not forced.
- No other changes to the request loop: the injected x402-wrapped `fetch` handles `402` transparently,
  below the library's existing `maxRetries` (429/5xx) loop and before Zod validation.

### Helper: `glassnode-api/x402`

```ts
type X402FetchOptions = {
  account: LocalAccount;         // viem account, e.g. privateKeyToAccount(pk)
  maxPaymentPerCall?: string;    // USDC decimal, default '0.06'
  fetch?: typeof fetch;          // base fetch to wrap, default globalThis.fetch
  walletClient?: WalletClient;   // advanced: supply a prebuilt viem wallet client instead of `account`
};

async function createX402Fetch(options: X402FetchOptions): Promise<typeof fetch>;
```

Behavior:

1. Dynamically `import('x402-fetch')` and `import('viem')` (+ `viem/chains`). If either module is missing,
   throw a clear error: *"createX402Fetch requires the optional peer dependencies `x402-fetch` and `viem`.
   Install them: `pnpm add x402-fetch viem`."*
2. If no `walletClient` is given, build one for Base:
   `createWalletClient({ account, chain: base, transport: http() })`.
3. Convert `maxPaymentPerCall` → `maxValue` via `parseUnits(value, 6)` (USDC has 6 decimals).
4. Return `wrapFetchWithPayment(baseFetch, walletClient, maxValue)`, typed as `typeof fetch` so it drops
   straight into the `fetch` config.

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
  402 handling lives *inside* that fetch. No conflict.
- **Misconfiguration guard:** if a `402` reaches the library's request loop (e.g. `x402: true` but a plain,
  unwrapped `fetch` was passed), map it to a friendly, **non-retryable** `GlassnodeApiError`:
  *"Payment required — pass an x402-capable fetch (see `glassnode-api/x402`)."* Add `402` to the
  `STATUS_MESSAGES` map.
- **Over-cap / insufficient funds:** `wrapFetchWithPayment` throws before paying (or the payment fails);
  the error propagates with the client's message through the library's existing error handling.

## Packaging & build

- `package.json`:
  - `exports`: add a `"./x402"` subpath (`import` / `require` / `types`).
  - `peerDependencies`: `x402-fetch` and `viem`, both marked `optional: true` in `peerDependenciesMeta`.
  - `devDependencies`: add `x402-fetch` and `viem` so `src/x402.ts` type-checks and tests can run.
  - `files`: existing globs (`dist/*.js`, `dist/*.d.ts`) already capture the new subpath output.
  - Version: **minor** bump (new backward-compatible feature) + CHANGELOG entry.
- Node build (`tsc`): compiles `src/x402.ts` as part of `src/**/*`.
- Browser build (`rollup`): **do not** add `src/x402.ts` to the inputs — the browser bundle stays
  crypto-free. Browser x402 is deferred.

## Testing (Vitest)

Core (no crypto, no network):

- `x402: true` → base URL is `https://x402.glassnode.com`.
- Explicit `apiUrl` overrides `x402`.
- Neither set → `https://api.glassnode.com` (regression guard).
- A mock x402-wrapped `fetch` flows through to validated data unchanged.
- A `402` from a plain fetch → the friendly non-retryable error.
- `x402: true` with no `apiKey` constructs successfully, and the outgoing URL omits `api_key`.
- `x402: true` with an `apiKey` still appends `api_key`.
- No `x402`, no `apiKey` → constructor throws (unchanged required-key behavior).

Helper (mock the dynamic imports; no real crypto/network):

- Missing optional deps → clear install error.
- Default `maxPaymentPerCall` applied and converted to the expected `maxValue`.
- Custom `maxPaymentPerCall` passed through.
- Returns a callable `fetch`.

## Docs

- README: a "Paid calls with x402" section (Node example, spend cap, links to Glassnode x402 + the
  buyer quickstart), noting browser support is planned.
- CHANGELOG entry under the new minor version.

## References

- x402 buyer quickstart: https://docs.cdp.coinbase.com/x402/quickstart-for-buyers
- `x402-fetch` (v1) `wrapFetchWithPayment(fetch, walletClient, maxValue?, selector?)`
- Glassnode x402 skill: https://x402.glassnode.com/SKILL.md
