import { GlassnodeConfigError, GlassnodeInputError, GlassnodePaymentError } from './errors.js';
import { redactApiKey } from './redact.js';

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

/**
 * Convert a USDC decimal string (e.g. `'0.06'`) to atomic units (6 decimals). Truncates extra decimals.
 *
 * @throws {GlassnodeInputError} `value` is not a non-negative decimal string (`argument: 'value'`).
 */
export function usdcDecimalToAtomic(value: string): bigint {
  return parseUsdc(value, 'value');
}

function parseUsdc(value: string, argument: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new GlassnodeInputError(`Invalid USDC amount: "${value}"`, { argument });
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
 *
 * Errors:
 * - Invalid `maxPaymentPerCall` → rejects with `GlassnodeInputError` (`argument: 'maxPaymentPerCall'`).
 * - Optional peer deps not installed → rejects with `GlassnodeConfigError` (import error on `.cause`).
 *
 * The returned fetch rejects with a `GlassnodePaymentError` when the payment layer fails before a
 * paid response is obtained — e.g. the server's price is above `maxPaymentPerCall`, the signer
 * throws, or the `402` carries no usable payment requirements. `GlassnodeAPI` surfaces it as-is
 * and never retries it. A rejection of the underlying `fetch` itself (connection failure, timeout
 * abort) is passed through unchanged, so the client still reports and retries it as a
 * `GlassnodeNetworkError`. A `402` the server returns after payment is not an error here; the
 * client reports it as `GlassnodeApiError` (status 402).
 */
export async function createX402Fetch(options: X402FetchOptions): Promise<typeof fetch> {
  const {
    account,
    maxPaymentPerCall = DEFAULT_MAX_PAYMENT_PER_CALL,
    fetch: baseFetch = globalThis.fetch,
  } = options;

  const maxAtomic = parseUsdc(maxPaymentPerCall, 'maxPaymentPerCall');

  const [x402fetchMod, evmMod] = await Promise.all([
    import('@x402/fetch'),
    import('@x402/evm'),
  ]).catch((err) => {
    throw new GlassnodeConfigError(
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

  const paymentClient = client;

  return async (input, init) => {
    // Track rejections of the *base* fetch for this call, so they can be told apart from failures
    // raised by the payment layer (which @x402/fetch throws as plain `Error`s, without a cause).
    // The wrapper is built per call so concurrent calls never share this state; it is cheap
    // (@x402/fetch only constructs a thin x402HTTPClient around the shared client).
    let baseFailure: { error: unknown } | undefined;
    const trackedBaseFetch: typeof fetch = async (...args) => {
      try {
        return await baseFetch(...args);
      } catch (error) {
        baseFailure = { error };
        throw error;
      }
    };
    const paidFetch = wrapFetchWithPayment(trackedBaseFetch, paymentClient) as typeof fetch;
    try {
      return await paidFetch(input, init);
    } catch (error) {
      // A transport failure of the base fetch: pass it through untouched (network error, retryable).
      if (baseFailure && baseFailure.error === error) throw error;
      throw toPaymentError(error);
    }
  };
}

/**
 * Wrap a payment-layer failure. The message is x402's own (which names the failing step, e.g.
 * "Failed to create payment payload: …"), with any `api_key` query value redacted. @x402/fetch's
 * own messages carry no key or signature material (a signer's error text is included verbatim);
 * the raw error stays on `.cause`.
 */
function toPaymentError(error: unknown): GlassnodePaymentError {
  const detail =
    error instanceof Error && error.message ? redactApiKey(error.message) : 'unknown error';
  const hint = /filtered out by policies/.test(detail)
    ? ' (the price exceeds maxPaymentPerCall)'
    : '';
  return new GlassnodePaymentError(`x402 payment failed: ${detail}${hint}`, { cause: error });
}
