// Regression guard for the `viem` type leak (see src/x402.ts / PR #20).
//
// This simulates a consumer resolving `glassnode-api/x402` under CommonJS `node16` with
// `skipLibCheck: false` — the exact configuration that surfaced TS1541 when the shipped
// `x402.d.ts` imported `viem`. It resolves via package self-reference (the repo's own name +
// exports), so it only passes against a built `dist/`. attw does NOT cover this (it runs with
// skipLibCheck on), so this fixture is the real detector.
import type { X402FetchOptions, X402SignerAccount } from 'glassnode-api/x402';

export type Options = X402FetchOptions;
export type Signer = X402SignerAccount;
