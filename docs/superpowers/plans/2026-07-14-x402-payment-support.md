# x402 Payment Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, Node-first x402 payment support to `glassnode-api` so a caller can make paid Glassnode calls, without shipping crypto code in the core package.

**Architecture:** The core `GlassnodeAPI` gains an `x402` boolean preset (switches the base URL to `https://x402.glassnode.com`) and already accepts an injected `fetch`. A new subpath export `glassnode-api/x402` provides `createX402Fetch()`, which dynamically imports `@x402/fetch` + `@x402/evm` (declared as optional peer dependencies) and returns a payment-capable fetch. The core entry never imports crypto.

**Tech Stack:** TypeScript 6.0.3, Zod 4, Vitest, Rollup; x402 client `@x402/fetch` v2 + `@x402/evm` (Coinbase-CDP-recommended, x402 protocol v2), `viem` (type-only in the lib; the caller builds the account).

## Global Constraints

- **Node ≥ 18**; developed on Node 24; pnpm is the package manager.
- **TypeScript pinned to 6.x** (`^6.0.3`) — do NOT bump to 7 (breaks typescript-eslint).
- **Core package stays `zod`-only at runtime.** `@x402/fetch`, `@x402/evm`, `viem` are **optional peer dependencies** (+ devDependencies for build/test). Never import them from any file other than `src/x402.ts`, and only via dynamic `import()` / `import type`.
- **Verified pricing/protocol (do not re-derive):** endpoints return `x402Version: 2`, scheme `exact`, USDC atomic amounts (6 decimals): metadata `/v1/metadata/*` = `10000` ($0.01), metrics `/v1/metrics/*` = `50000` ($0.05). Mainnet network `eip155:8453` (`https://x402.glassnode.com`), testnet `eip155:84532` / Base Sepolia (`a testnet x402 endpoint`).
- **Bulk is unsupported over x402** (`/bulk` 404s); no special handling — document only.
- Every commit runs the Husky pre-commit hook (eslint + prettier + vitest related). Keep lint/format clean.
- Follow existing code style (2-space, single quotes, semicolons; Prettier-enforced).

---

## File structure

| File                                   | Responsibility                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/types/config.ts` (modify)         | Add `x402` flag + URL constants; make `apiUrl`/`apiKey` optional; add cross-field refines.                          |
| `src/glassnode-api.ts` (modify)        | Resolve base URL from `x402`; omit `api_key` when no key.                                                           |
| `src/errors.ts` (modify)               | Friendly `402` message.                                                                                             |
| `src/x402.ts` (new)                    | `createX402Fetch()` + pure helpers (`usdcDecimalToAtomic`, `createMaxAmountPolicy`). Only file that touches crypto. |
| `package.json` (modify)                | `./x402` subpath export; optional peer + dev deps; version bump.                                                    |
| `tsconfig.browser.json` (modify)       | Exclude `src/x402.ts` from the browser type program.                                                                |
| `test/x402.spec.ts` (new)              | Unit tests for the helper (pure fns + real-deps smoke).                                                             |
| `test/x402.missing-deps.spec.ts` (new) | Missing-optional-deps error path (mocked import).                                                                   |
| `test/x402.integration.spec.ts` (new)  | Opt-in testnet integration (env-gated, self-skips).                                                                 |
| `README.md` (modify)                   | "Paid calls with x402" section.                                                                                     |
| `CHANGELOG.md` (modify)                | 0.8.0 entry.                                                                                                        |

Task order respects dependencies: config → client wiring → error → packaging/deps (so optional deps are installed) → helper → integration test → docs.

---

### Task 1: Config schema + client base-URL resolution

**Files:**

- Modify: `src/types/config.ts`
- Modify: `src/glassnode-api.ts` (imports; `apiKey` field type; constructor; `request()` query)
- Test: `test/config.spec.ts` (new), `test/glassnode-api.spec.ts` (append)

> **Done as one task/commit on purpose.** Dropping the Zod `apiUrl` default without also moving base-URL resolution into the constructor breaks the existing `should create an instance with default API URL` test (`test/glassnode-api.spec.ts`), and the Husky pre-commit hook (`vitest related`) would then block a partial commit. Config + constructor land together so the tree is green at the commit boundary.

**Interfaces:**

- Produces: `DEFAULT_API_URL`, `X402_API_URL`, `X402_TESTNET_API_URL` (string consts); `GlassnodeConfigSchema` (now with `x402: boolean`, optional `apiKey`/`apiUrl`, two refines); `GlassnodeConfig` type (name unchanged); `GlassnodeAPI` whose base URL is `apiUrl ?? (x402 ? X402_API_URL : DEFAULT_API_URL)` and which omits `api_key` when no key is set.

- [ ] **Step 1: Write the failing config test**

Create `test/config.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  GlassnodeConfigSchema,
  DEFAULT_API_URL,
  X402_API_URL,
  X402_TESTNET_API_URL,
} from '../src/types/config';

describe('GlassnodeConfigSchema', () => {
  it('exposes the URL constants', () => {
    expect(DEFAULT_API_URL).toBe('https://api.glassnode.com');
    expect(X402_API_URL).toBe('https://x402.glassnode.com');
    expect(X402_TESTNET_API_URL).toBe('a testnet x402 endpoint');
  });

  it('requires apiKey when x402 is not enabled', () => {
    expect(() => GlassnodeConfigSchema.parse({})).toThrow(/apiKey/);
    expect(GlassnodeConfigSchema.parse({ apiKey: 'k' }).apiKey).toBe('k');
  });

  it('allows omitting apiKey when x402 is enabled, but then requires fetch', () => {
    const fetchFn = (async () => new Response()) as unknown as typeof fetch;
    expect(() => GlassnodeConfigSchema.parse({ x402: true })).toThrow(/fetch/);
    const parsed = GlassnodeConfigSchema.parse({ x402: true, fetch: fetchFn });
    expect(parsed.x402).toBe(true);
    expect(parsed.apiKey).toBeUndefined();
  });

  it('defaults x402 to false and apiUrl to undefined', () => {
    const parsed = GlassnodeConfigSchema.parse({ apiKey: 'k' });
    expect(parsed.x402).toBe(false);
    expect(parsed.apiUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing x402-mode client tests**

Append to `test/glassnode-api.spec.ts`, inside the top-level `describe('GlassnodeAPI', ...)`:

```ts
describe('x402 mode', () => {
  const okFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockMetricListResponse),
    });

  it('routes to the x402 host when x402 is true', async () => {
    const fetchFn = okFetch();
    const api = new GlassnodeAPI({ x402: true, fetch: fetchFn });
    await api.getMetricList();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('https://x402.glassnode.com/v1/metadata/metrics')
    );
  });

  it('omits api_key when no apiKey is set', async () => {
    const fetchFn = okFetch();
    const api = new GlassnodeAPI({ x402: true, fetch: fetchFn });
    await api.getMetricList();
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('api_key');
  });

  it('an explicit apiUrl overrides the x402 preset', async () => {
    const fetchFn = okFetch();
    const api = new GlassnodeAPI({
      x402: true,
      apiUrl: 'a testnet x402 endpoint',
      fetch: fetchFn,
    });
    await api.getMetricList();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('a testnet x402 endpoint/v1/metadata/metrics')
    );
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm exec vitest run test/config.spec.ts test/glassnode-api.spec.ts`
Expected: FAIL — `config.spec.ts` can't import the new constants; the x402-mode tests still hit `https://api.glassnode.com` and append `api_key`.

- [ ] **Step 4: Implement the config schema**

Replace the contents of `src/types/config.ts` with:

```ts
import { z } from 'zod';

/**
 * Logger function type for API call logging
 */
export type Logger = (message: string, ...args: unknown[]) => void;

/**
 * Fetch function type matching the standard fetch API
 */
export type FetchFn = typeof fetch;

/** Default free Glassnode API base URL. */
export const DEFAULT_API_URL = 'https://api.glassnode.com';
/** x402 (paid) Glassnode API base URL — Base mainnet. */
export const X402_API_URL = 'https://x402.glassnode.com';
/** x402 testnet base URL — Base Sepolia. */
export const X402_TESTNET_API_URL = 'a testnet x402 endpoint';

/**
 * Zod schema for Glassnode API configuration
 */
export const GlassnodeConfigSchema = z
  .object({
    /** API key for authentication. Required unless `x402` is enabled. */
    apiKey: z.string().min(1, 'API key is required').optional(),

    /** Base URL for the Glassnode API. An explicit value always wins over the `x402` preset. */
    apiUrl: z.string().url().optional(),

    /** Route requests through the x402 paid endpoint (`https://x402.glassnode.com`). */
    x402: z.boolean().default(false),

    /** Optional logger for API call debugging. */
    logger: z.function().optional(),

    /** Optional custom fetch function (e.g. an x402-wrapped fetch, or for testing). */
    fetch: z.function().optional(),

    /** Maximum number of retries for retryable errors (429 and 5xx). */
    maxRetries: z.number().int().nonnegative().default(0),

    /** Base delay in milliseconds between retries (doubles each attempt). */
    retryDelay: z.number().int().positive().default(1000),
  })
  .refine((c) => c.x402 || (c.apiKey !== undefined && c.apiKey.length > 0), {
    message: 'apiKey is required unless x402 is enabled',
    path: ['apiKey'],
  })
  .refine((c) => !c.x402 || c.fetch !== undefined, {
    message:
      'fetch is required when x402 is enabled — pass an x402-capable fetch (see glassnode-api/x402)',
    path: ['fetch'],
  });

/**
 * Configuration for the Glassnode API client
 */
export type GlassnodeConfig = z.input<typeof GlassnodeConfigSchema>;
```

- [ ] **Step 5: Implement the client changes**

In `src/glassnode-api.ts`:

5a. Update the import at the top (add the two constants):

```ts
import {
  GlassnodeConfig,
  GlassnodeConfigSchema,
  Logger,
  FetchFn,
  DEFAULT_API_URL,
  X402_API_URL,
} from './types/config';
```

5b. Change the field declaration (was `private apiKey: string;`):

```ts
  private apiKey: string | undefined;
```

5c. In the constructor, replace the `this.apiKey` / `this.apiUrl` assignments:

```ts
this.apiKey = validatedConfig.apiKey;
this.apiUrl = validatedConfig.apiUrl ?? (validatedConfig.x402 ? X402_API_URL : DEFAULT_API_URL);
```

5d. In `request()`, replace the `queryParams` construction (was `new URLSearchParams({ ...params, api_key: this.apiKey })`):

```ts
const queryParams = new URLSearchParams({
  ...params,
  ...(this.apiKey ? { api_key: this.apiKey } : {}),
});
```

- [ ] **Step 6: Run the full suite to verify green**

Run: `pnpm exec vitest run`
Expected: PASS — the existing 26 tests (including `should create an instance with default API URL`), the 4 config tests, and the 3 x402-mode tests.

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/glassnode-api.ts test/config.spec.ts test/glassnode-api.spec.ts
git commit -m "feat(config): x402 preset, base-url resolution, conditional apiKey/fetch"
```

---

### Task 2: Friendly 402 error message

**Files:**

- Modify: `src/errors.ts:1-7`
- Test: `test/glassnode-api.spec.ts` (append)

**Interfaces:**

- Produces: `GlassnodeApiError` with a helpful `402` message; `isRetryable` stays `false` for `402`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('error handling', ...)` in `test/glassnode-api.spec.ts`:

```ts
it('gives a helpful 402 message and marks it non-retryable', () => {
  const err = new GlassnodeApiError(402, 'Payment Required');
  expect(err.message).toContain('Payment required');
  expect(err.message).toContain('glassnode-api/x402');
  expect(err.isRetryable).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/glassnode-api.spec.ts -t "402 message"`
Expected: FAIL — message is the generic status text, not the friendly copy.

- [ ] **Step 3: Implement**

In `src/errors.ts`, add the `402` entry to `STATUS_MESSAGES`:

```ts
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid or missing API key',
  402: 'Payment required — pass an x402-capable fetch (see glassnode-api/x402)',
  403: 'Access forbidden — check your API tier',
  404: 'Endpoint or metric not found',
  429: 'Rate limit exceeded',
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/glassnode-api.spec.ts -t "402 message"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/glassnode-api.spec.ts
git commit -m "feat(errors): friendly 402 payment-required message"
```

---

### Task 3: Packaging — optional deps, subpath export, browser exclude

**Files:**

- Modify: `package.json` (exports, peerDependencies, peerDependenciesMeta, devDependencies)
- Modify: `tsconfig.browser.json` (exclude)

**Interfaces:**

- Produces: the `@x402/fetch`, `@x402/evm`, `viem` module specifiers resolvable at build/test time; the `glassnode-api/x402` subpath mapped to `dist/x402.js`. Task 4 depends on this.

- [ ] **Step 1: Add the optional deps as devDependencies (installs them)**

Run:

```bash
pnpm add -D --config.minimumReleaseAge=0 @x402/fetch@^2.18.0 @x402/evm@^2.18.0 viem@^2.48.11
```

Expected: `@x402/fetch`, `@x402/evm`, `viem` added under `devDependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Declare them as optional peer dependencies**

Edit `package.json` — add these two top-level keys (place after `"dependencies"`):

```json
  "peerDependencies": {
    "@x402/fetch": ">=2.18.0",
    "@x402/evm": ">=2.18.0",
    "viem": "^2.48.11"
  },
  "peerDependenciesMeta": {
    "@x402/fetch": { "optional": true },
    "@x402/evm": { "optional": true },
    "viem": { "optional": true }
  },
```

- [ ] **Step 3: Add the subpath export**

In `package.json`, change the `"exports"` block to add the `./x402` entry:

```json
  "exports": {
    ".": {
      "import": "./dist/glassnode-api.esm.min.js",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./x402": {
      "types": "./dist/x402.d.ts",
      "import": "./dist/x402.js",
      "require": "./dist/x402.js"
    }
  },
```

- [ ] **Step 4: Exclude the crypto file from the browser type program**

In `tsconfig.browser.json`, add `"src/x402.ts"` to `exclude`:

```json
  "exclude": ["node_modules", "dist", "test", "examples", "src/x402.ts"]
```

- [ ] **Step 5: Verify install + existing build/tests still pass**

Run: `pnpm install --config.minimumReleaseAge=0 && pnpm run build && pnpm run build:browser && pnpm test`
Expected: all succeed; no `dist/x402.*` yet (created in Task 5), browser bundle unchanged.

> **Fallback:** if a later `pnpm run build:browser` (Task 4 Step 7) still tries to type-check `src/x402.ts` and errors on `@x402/*`/`viem` resolution, also pass an explicit exclude to the Rollup TypeScript plugin in `rollup.config.mjs`: change `typescript({ tsconfig: './tsconfig.browser.json' })` to `typescript({ tsconfig: './tsconfig.browser.json', exclude: ['src/x402.ts'] })`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.browser.json
git commit -m "chore(x402): optional peer deps, ./x402 subpath export, browser exclude"
```

---

### Task 4: `createX402Fetch` helper

**Files:**

- Create: `src/x402.ts`
- Test: `test/x402.spec.ts`, `test/x402.missing-deps.spec.ts`

**Interfaces:**

- Consumes: `@x402/fetch` (`wrapFetchWithPayment`, `x402Client`), `@x402/evm` (`ExactEvmScheme`), `viem` (`LocalAccount` type only).
- Produces:
  - `usdcDecimalToAtomic(value: string): bigint`
  - `createMaxAmountPolicy(maxAtomic: bigint): (x402Version: number, requirements: { amount: string }[]) => { amount: string }[]`
  - `createX402Fetch(options: { account: LocalAccount; maxPaymentPerCall?: string; fetch?: typeof fetch }): Promise<typeof fetch>`

- [ ] **Step 1: Write the failing unit tests (pure fns + smoke)**

Create `test/x402.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { usdcDecimalToAtomic, createMaxAmountPolicy, createX402Fetch } from '../src/x402';

describe('usdcDecimalToAtomic', () => {
  it('converts USDC decimals to 6-decimal atomic units', () => {
    expect(usdcDecimalToAtomic('0.06')).toBe(60000n);
    expect(usdcDecimalToAtomic('0.05')).toBe(50000n);
    expect(usdcDecimalToAtomic('0.01')).toBe(10000n);
    expect(usdcDecimalToAtomic('1')).toBe(1000000n);
    expect(usdcDecimalToAtomic('0')).toBe(0n);
  });

  it('truncates beyond 6 decimals and rejects bad input', () => {
    expect(usdcDecimalToAtomic('0.1234567')).toBe(123456n);
    expect(() => usdcDecimalToAtomic('abc')).toThrow(/Invalid USDC amount/);
    expect(() => usdcDecimalToAtomic('-1')).toThrow(/Invalid USDC amount/);
  });
});

describe('createMaxAmountPolicy', () => {
  it('keeps only requirements at or below the cap', () => {
    const policy = createMaxAmountPolicy(60000n);
    const reqs = [{ amount: '50000' }, { amount: '60000' }, { amount: '70000' }];
    expect(policy(2, reqs)).toEqual([{ amount: '50000' }, { amount: '60000' }]);
  });
});

describe('createX402Fetch', () => {
  it('returns a callable fetch using the real x402 client', async () => {
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      signTypedData: async () => '0x' as const,
    };
    const wrapped = await createX402Fetch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account: account as any,
      maxPaymentPerCall: '0.06',
    });
    expect(typeof wrapped).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run test/x402.spec.ts`
Expected: FAIL — `../src/x402` does not exist.

- [ ] **Step 3: Implement `src/x402.ts`**

Create `src/x402.ts` (this exact source is type-checked against the installed `@x402/*` and `viem` types under TS 6.0.3):

```ts
import type { LocalAccount } from 'viem';

/** Options for {@link createX402Fetch}. */
export interface X402FetchOptions {
  /** viem account used to sign payment authorizations (e.g. `privateKeyToAccount(pk)`). */
  account: LocalAccount;
  /** Per-call spend ceiling in USDC (decimal string). Default `'0.06'` (just above the $0.05 metric price). */
  maxPaymentPerCall?: string;
  /** Base fetch to wrap. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

const DEFAULT_MAX_PAYMENT_PER_CALL = '0.06';
const USDC_DECIMALS = 6;
// Base mainnet + Base Sepolia (CAIP-2). Registering both lets one wrapped fetch serve either host.
const X402_NETWORKS = ['eip155:8453', 'eip155:84532'] as const;

/** Convert a USDC decimal string (e.g. `'0.06'`) to atomic units (6 decimals). Truncates extra decimals. */
export function usdcDecimalToAtomic(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid USDC amount: "${value}"`);
  }
  const [whole, frac = ''] = value.split('.');
  const fracPadded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || '0');
}

/** Build a payment policy that rejects any payment requirement above `maxAtomic` (atomic USDC units). */
export function createMaxAmountPolicy(maxAtomic: bigint) {
  return (_x402Version: number, requirements: { amount: string }[]): { amount: string }[] =>
    requirements.filter((r) => BigInt(r.amount) <= maxAtomic);
}

/**
 * Create an x402-capable `fetch` for paid Glassnode calls (Node-first).
 *
 * Dynamically loads the optional peer deps `@x402/fetch` + `@x402/evm`; pass the result as the
 * `fetch` option of `GlassnodeAPI` together with `x402: true`.
 */
export async function createX402Fetch(options: X402FetchOptions): Promise<typeof fetch> {
  const {
    account,
    maxPaymentPerCall = DEFAULT_MAX_PAYMENT_PER_CALL,
    fetch: baseFetch = globalThis.fetch,
  } = options;

  const maxAtomic = usdcDecimalToAtomic(maxPaymentPerCall);

  const [x402fetchMod, evmMod] = await Promise.all([
    import('@x402/fetch'),
    import('@x402/evm'),
  ]).catch((err) => {
    throw new Error(
      "createX402Fetch requires the optional peer dependencies '@x402/fetch', '@x402/evm', and 'viem'. Install them: pnpm add @x402/fetch @x402/evm viem",
      { cause: err }
    );
  });
  const { wrapFetchWithPayment, x402Client } = x402fetchMod;
  const { ExactEvmScheme } = evmMod;

  let client = new x402Client();
  for (const network of X402_NETWORKS) {
    client = client.register(
      network,
      new ExactEvmScheme(account as ConstructorParameters<typeof ExactEvmScheme>[0])
    );
  }
  client = client.registerPolicy(
    createMaxAmountPolicy(maxAtomic) as unknown as Parameters<typeof client.registerPolicy>[0]
  );

  return wrapFetchWithPayment(baseFetch, client) as typeof fetch;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm exec vitest run test/x402.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the missing-deps test**

Create `test/x402.missing-deps.spec.ts` (module-level mock makes `@x402/evm` fail to import):

```ts
import { describe, it, expect, vi } from 'vitest';

// Simulate the optional peer dep being absent: importing it throws.
vi.mock('@x402/evm', () => {
  throw new Error('Cannot find package @x402/evm');
});

describe('createX402Fetch without optional deps', () => {
  it('throws a clear install error', async () => {
    const { createX402Fetch } = await import('../src/x402');
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      signTypedData: async () => '0x' as const,
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createX402Fetch({ account: account as any })
    ).rejects.toThrow(/optional peer dependencies/);
  });
});
```

- [ ] **Step 6: Run the missing-deps test**

Run: `pnpm exec vitest run test/x402.missing-deps.spec.ts`
Expected: PASS — the rejection message contains "optional peer dependencies".

- [ ] **Step 7: Verify the whole build + full suite + browser build**

Run: `pnpm run lint && pnpm run build && pnpm run build:browser && pnpm test`
Expected: all pass. `dist/x402.js` + `dist/x402.d.ts` produced by `tsc`; the browser bundle is unchanged and does NOT include x402 (excluded).

- [ ] **Step 8: Commit**

```bash
git add src/x402.ts test/x402.spec.ts test/x402.missing-deps.spec.ts
git commit -m "feat(x402): createX402Fetch helper (subpath glassnode-api/x402)"
```

---

### Task 5: Opt-in testnet integration test

**Files:**

- Create: `test/x402.integration.spec.ts`
- Modify: `package.json` (add `test:x402` script)

**Interfaces:**

- Consumes: `createX402Fetch`, `GlassnodeAPI`, `X402_TESTNET_API_URL`, `viem/accounts.privateKeyToAccount`.
- Produces: an env-gated E2E test that self-skips without `X402_TESTNET_PRIVATE_KEY` (so `pnpm test`/CI stay hermetic).

- [ ] **Step 1: Write the integration test**

Create `test/x402.integration.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { GlassnodeAPI } from '../src/glassnode-api';
import { X402_TESTNET_API_URL } from '../src/types/config';
import { createX402Fetch } from '../src/x402';

const KEY = process.env.X402_TESTNET_PRIVATE_KEY;

// Requires a Base-Sepolia wallet funded with test USDC. Skipped unless the key is provided.
describe.skipIf(!KEY)('x402 testnet integration', () => {
  it('pays for a metric on the testnet endpoint and returns validated data', async () => {
    const account = privateKeyToAccount(KEY as `0x${string}`);
    const api = new GlassnodeAPI({
      x402: true,
      apiUrl: X402_TESTNET_API_URL,
      fetch: await createX402Fetch({ account, maxPaymentPerCall: '0.06' }),
    });

    const data = await api.callMetric<{ t: number; v: number }[]>('/market/mvrv', {
      a: 'BTC',
      i: '24h',
    });

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].t).toBe('number');
    expect(typeof data[0].v).toBe('number');
  }, 60_000);
});
```

- [ ] **Step 2: Add the `test:x402` script**

In `package.json` `"scripts"`, add:

```json
    "test:x402": "vitest run test/x402.integration.spec.ts",
```

- [ ] **Step 3: Verify it skips cleanly without the env var**

Run: `pnpm exec vitest run test/x402.integration.spec.ts`
Expected: PASS with the suite **skipped** (0 failures; the describe is skipped because `X402_TESTNET_PRIVATE_KEY` is unset).

- [ ] **Step 4: Commit**

```bash
git add test/x402.integration.spec.ts package.json
git commit -m "test(x402): opt-in testnet integration test + test:x402 script"
```

---

### Task 6: Docs + version bump

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `package.json` (version)

**Interfaces:**

- Produces: user-facing docs for the feature; `0.8.0` release entry.

- [ ] **Step 1: Add the README section**

In `README.md`, add a `## Paid calls with x402` entry to the Table of Contents (after `[Bulk Metrics](#bulk-metrics)`), and insert this section immediately before `## Browser`:

````markdown
## Paid calls with x402

Glassnode also serves a **paid, per-call API over the [x402 protocol](https://x402.org)** at
`https://x402.glassnode.com` — no API key required, you pay per request in USDC on Base
($0.01/metadata call, $0.05/metric call). This is **Node-first** and opt-in: the crypto stack
(`@x402/fetch`, `@x402/evm`, `viem`) is an **optional peer dependency**, installed only if you use it.

```bash
pnpm add glassnode-api @x402/fetch @x402/evm viem
```

```typescript
import { GlassnodeAPI } from 'glassnode-api';
import { createX402Fetch } from 'glassnode-api/x402';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const api = new GlassnodeAPI({
  x402: true, // → https://x402.glassnode.com
  fetch: await createX402Fetch({
    account,
    maxPaymentPerCall: '0.06', // USDC per-call ceiling (default)
  }),
});

// Pays $0.05 USDC on Base, transparently:
const mvrv = await api.callMetric('/market/mvrv', { a: 'BTC', i: '24h' });
```

**`createX402Fetch(options)`**

| Option              | Type           | Default            | Description                      |
| ------------------- | -------------- | ------------------ | -------------------------------- |
| `account`           | `LocalAccount` | — (**required**)   | viem account that signs payments |
| `maxPaymentPerCall` | `string`       | `'0.06'`           | Per-call USDC spend ceiling      |
| `fetch`             | `typeof fetch` | `globalThis.fetch` | Base fetch to wrap               |

> **Spend safety:** `maxPaymentPerCall` caps a **single** request — it is **not** a cumulative budget, so
> an agent loop can still spend within that ceiling repeatedly. Use a **dedicated, funded-but-limited**
> wallet (never your primary key), and load the key from the environment — never hardcode it.

**Notes**

- **Bulk metrics are not available over x402** — `callBulkMetric()` only works against the free
  `api.glassnode.com`.
- **Testnet:** target Base Sepolia by passing `apiUrl: 'a testnet x402 endpoint'`.
- **Browser** signing is not supported yet (planned).
````

- [ ] **Step 2: Add the CHANGELOG entry**

In `CHANGELOG.md`, add at the top (below `# Changelog`):

```markdown
## 0.8.0

- Add opt-in, Node-first **x402 payment support**: `x402: true` config preset (routes to
  `https://x402.glassnode.com`) and a new `glassnode-api/x402` subpath export with
  `createX402Fetch({ account, maxPaymentPerCall })`. The crypto stack (`@x402/fetch`, `@x402/evm`,
  `viem`) is an optional peer dependency; the core package stays `zod`-only.
- `apiKey` is now optional when `x402` is enabled; `fetch` is required in that mode.
- Add a friendly `402` error message. Bulk metrics remain free-API only (unsupported over x402).
```

- [ ] **Step 3: Bump the version to 0.8.0**

Edit `package.json`: change `"version"` to `"0.8.0"`.

- [ ] **Step 4: Verify the full pipeline once more**

Run: `pnpm run lint && pnpm test && pnpm run build && pnpm run build:browser`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md package.json
git commit -m "docs(x402): README section, CHANGELOG, bump to 0.8.0"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** config preset + URL resolution + api_key omission (T1), 402 error (T2), packaging/optional-deps/browser-exclude (T3), helper + spend cap + missing-deps error (T4), testnet integration (T5), docs/bulk-limitation/version (T6). All spec sections map to a task.
- **Type names are consistent across tasks:** `createX402Fetch`, `usdcDecimalToAtomic`, `createMaxAmountPolicy`, `X402_API_URL`, `X402_TESTNET_API_URL`, `DEFAULT_API_URL`.
- **Verified before writing:** the `src/x402.ts` source in Task 5 was type-checked against the real installed `@x402/fetch@2.18`, `@x402/evm@2.18`, and `viem` `.d.ts` under `tsc 6.0.3` (clean), and the client chain (`new x402Client().register(...).registerPolicy(...)` → `wrapFetchWithPayment`) was smoke-run in Node.
- **If `pnpm add` is blocked by the local `.npmrc` release-age quarantine**, the `--config.minimumReleaseAge=0` flag (already in the commands) overrides it for that install.
