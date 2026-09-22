/**
 * Minimal structural shape of the signer x402 needs: an EVM address and an EIP-712 typed-data
 * signer. A viem account (e.g. `privateKeyToAccount(pk)`) satisfies this — the method syntax keeps
 * viem's account assignable. Declared structurally so the public `./x402` types do not depend on
 * `viem` (an optional peer), which otherwise breaks `moduleResolution: node16` type-checking for
 * consumers with `skipLibCheck: false`.
 */
export interface X402SignerAccount {
  /** 0x-prefixed EVM address of the signer. */
  address: `0x${string}`;
  /**
   * Sign EIP-712 typed data; returns a 0x-prefixed signature. `unknown` (with method syntax, which
   * is bivariant) keeps viem's narrower `signTypedData` assignable while remaining callable by
   * anyone implementing a custom signer or test double.
   */
  signTypedData(parameters: unknown): Promise<`0x${string}`>;
}

/** Options for {@link createX402Fetch}. */
export interface X402FetchOptions {
  /** Account used to sign payment authorizations (e.g. a viem `privateKeyToAccount(pk)`). */
  account: X402SignerAccount;
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
