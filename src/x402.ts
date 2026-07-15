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
