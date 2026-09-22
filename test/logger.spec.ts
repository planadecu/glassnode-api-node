import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GlassnodeAPI } from '../src/glassnode-api';
import {
  GlassnodeApiError,
  GlassnodeError,
  GlassnodeNetworkError,
  GlassnodeValidationError,
} from '../src/errors';
import type { GlassnodeConfig } from '../src/types/config';
import type { GlassnodeHooks } from '../src/types/hooks';
import { mockMetricListResponse } from './mocks/metadata.mock';

const KEY = 'test-key';
const HOOK_NAMES = ['onRequest', 'onResponse', 'onRetry', 'onError'] as const;

/** Where a failing logger fails: on one kind of message (by its prefix), or on every message. */
const SITES = ['API call:', 'Retry ', 'Hook ', 'every message'] as const;
type Site = (typeof SITES)[number];
/** How it fails: a synchronous throw, or a returned rejected promise. */
const KINDS = ['throw', 'reject'] as const;
type Kind = (typeof KINDS)[number];

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  // No jitter, so retry waits (and the "Retry … after Xms" messages) are deterministic.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.restoreAllMocks();
});

/** Let pending rejection handlers (and Node's unhandled-rejection detection) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

function okResponse(body: unknown = mockMetricListResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function statusResponse(status: number, retryAfter?: string): Response {
  return new Response('', {
    status,
    headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  });
}

/** A logger that records every message and fails (per `site`/`kind`) on the matching ones. */
function failingLogger(site: Site | undefined, kind: Kind) {
  const messages: string[] = [];
  // A plain function, not vi.fn(): a spy attaches its own handler to a returned promise, which
  // would hide an unhandled rejection.
  const logger = (message: string) => {
    messages.push(message);
    if (site === undefined) return undefined;
    if (site !== 'every message' && !message.startsWith(site)) return undefined;
    const error = new Error(`logger down on ${JSON.stringify(message)}`);
    if (kind === 'throw') throw error;
    return Promise.reject(error);
  };
  return { logger: logger as unknown as (message: string, ...args: unknown[]) => void, messages };
}

type Scenario = {
  name: string;
  fetch: () => ReturnType<typeof vi.fn>;
  config?: Partial<GlassnodeConfig>;
  /** Hooks that fail, so the "Hook … failed:" logger path runs. */
  failingHooks?: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    name: 'success',
    fetch: () => vi.fn().mockResolvedValue(okResponse()),
  },
  {
    name: 'retry then success',
    fetch: () =>
      vi.fn().mockResolvedValueOnce(statusResponse(503, '0')).mockResolvedValueOnce(okResponse()),
    config: { maxRetries: 2 },
  },
  {
    name: 'network error then success',
    fetch: () =>
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse()),
    config: { maxRetries: 1, retryDelay: 1 },
  },
  {
    name: 'retries exhausted (GlassnodeApiError 503)',
    fetch: () => vi.fn().mockImplementation(async () => statusResponse(503, '0')),
    config: { maxRetries: 2 },
  },
  {
    name: 'non-retryable GlassnodeApiError 400',
    fetch: () => vi.fn().mockResolvedValue(statusResponse(400)),
    config: { maxRetries: 3 },
  },
  {
    name: 'GlassnodeNetworkError after retries',
    fetch: () => vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    config: { maxRetries: 1, retryDelay: 1 },
  },
  {
    name: 'GlassnodeValidationError',
    fetch: () => vi.fn().mockResolvedValue(okResponse({ not: 'a list' })),
  },
  {
    name: 'retry then success with failing hooks',
    fetch: () =>
      vi.fn().mockResolvedValueOnce(statusResponse(503, '0')).mockResolvedValueOnce(okResponse()),
    config: { maxRetries: 1 },
    failingHooks: true,
  },
];

/** Run a scenario and describe its observable outcome. */
async function run(scenario: Scenario, site: Site | undefined, kind: Kind) {
  const fetchFn = scenario.fetch();
  const hookCalls: string[] = [];
  const hooks = Object.fromEntries(
    HOOK_NAMES.map((name) => [
      name,
      () => {
        hookCalls.push(name);
        if (scenario.failingHooks) throw new Error(`hook ${name} down`);
      },
    ])
  ) as GlassnodeHooks;
  const { logger, messages } = failingLogger(site, kind);
  const api = new GlassnodeAPI({
    apiKey: KEY,
    fetch: fetchFn as unknown as typeof fetch,
    logger,
    hooks,
    ...scenario.config,
  });
  let outcome: { ok: true; value: unknown } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await api.getMetricList() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  await settle();
  const describeOutcome: Record<string, unknown> = outcome.ok
    ? { ok: true, value: outcome.value }
    : {
        ok: false,
        isGlassnodeError: outcome.error instanceof GlassnodeError,
        name: (outcome.error as Error).name,
        errorClass: (outcome.error as object).constructor,
        message: (outcome.error as Error).message,
        status: (outcome.error as { status?: number }).status,
      };
  return {
    outcome: describeOutcome,
    fetchCalls: fetchFn.mock.calls.length,
    hookCalls,
    messages,
  };
}

describe('logger: a failing logger never changes a call', () => {
  for (const scenario of SCENARIOS) {
    for (const kind of KINDS) {
      for (const site of SITES) {
        it(`${scenario.name}: logger that ${kind}s on ${site}`, async () => {
          const baseline = await run(scenario, undefined, kind);
          const withFailingLogger = await run(scenario, site, kind);
          expect(withFailingLogger).toEqual(baseline);
          expect(unhandled).toEqual([]);
        });
      }
    }
  }

  it('the scenarios cover every logger message and each expected outcome', async () => {
    const all = await Promise.all(SCENARIOS.map((s) => run(s, undefined, 'throw')));
    const messages = all.flatMap((r) => r.messages);
    expect(messages.some((m) => m === 'API call:')).toBe(true);
    expect(messages.some((m) => m.startsWith('Retry '))).toBe(true);
    expect(messages.some((m) => m.startsWith('Hook '))).toBe(true);
    const constructors = all.map((r) => r.outcome.errorClass);
    expect(constructors).toContain(GlassnodeApiError);
    expect(constructors).toContain(GlassnodeNetworkError);
    expect(constructors).toContain(GlassnodeValidationError);
  });

  it('a logger that throws on "API call:" does not reject the call (regression)', async () => {
    const api = new GlassnodeAPI({
      apiKey: KEY,
      fetch: vi.fn().mockResolvedValue(okResponse()),
      logger: () => {
        throw new Error('logger down');
      },
    });
    await expect(api.getMetricList()).resolves.toEqual(mockMetricListResponse);
  });

  it('a logger that throws on the retry message still retries (regression)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(503, '0'))
      .mockResolvedValueOnce(okResponse());
    const api = new GlassnodeAPI({
      apiKey: KEY,
      fetch: fetchFn,
      maxRetries: 1,
      logger: (message: string) => {
        if (message.startsWith('Retry ')) throw new Error('logger down');
      },
    });
    await expect(api.getMetricList()).resolves.toEqual(mockMetricListResponse);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a failing logger does not stop onRetry/onError from firing', async () => {
    const onRetry = vi.fn();
    const onError = vi.fn();
    const api = new GlassnodeAPI({
      apiKey: KEY,
      fetch: vi.fn().mockImplementation(async () => statusResponse(503, '0')),
      maxRetries: 1,
      hooks: { onRetry, onError },
      logger: () => {
        throw new Error('logger down');
      },
    });
    await expect(api.getMetricList()).rejects.toBeInstanceOf(GlassnodeApiError);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a logger returning a never-settling promise is not awaited', async () => {
    const logger = vi.fn(() => new Promise<void>(() => {}));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(503, '0'))
      .mockResolvedValueOnce(okResponse());
    const api = new GlassnodeAPI({
      apiKey: KEY,
      fetch: fetchFn,
      maxRetries: 1,
      logger: logger as unknown as (message: string) => void,
    });
    await expect(api.getMetricList()).resolves.toEqual(mockMetricListResponse);
    expect(logger).toHaveBeenCalledTimes(3);
  });

  it('odd thenables from a logger (throwing `then` getter or `then` call) are ignored', async () => {
    const getterThrows = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('then getter down');
      },
    });
    const callThrows = {
      then() {
        throw new Error('then call down');
      },
    };
    for (const returned of [getterThrows, callThrows]) {
      const api = new GlassnodeAPI({
        apiKey: KEY,
        fetch: vi.fn().mockResolvedValue(okResponse()),
        logger: (() => returned) as unknown as (message: string) => void,
      });
      await expect(api.getMetricList()).resolves.toEqual(mockMetricListResponse);
    }
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('logger output is unchanged when it does not throw', async () => {
    const logger = vi.fn();
    const api = new GlassnodeAPI({
      apiKey: KEY,
      fetch: vi
        .fn()
        .mockResolvedValueOnce(statusResponse(503, '0'))
        .mockResolvedValueOnce(okResponse()),
      maxRetries: 1,
      logger,
      hooks: {
        onRequest: () => {
          throw new Error('boom');
        },
      },
    });
    await api.getMetricList();
    expect(logger.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['API call:', 'https://api.glassnode.com/v1/metadata/metrics?api_key=***'],
      ['Hook onRequest failed:', expect.any(Error)],
      ['Retry 1/1 after 0ms'],
      ['API call:', 'https://api.glassnode.com/v1/metadata/metrics?api_key=***'],
      ['Hook onRequest failed:', expect.any(Error)],
    ]);
    expect(logger.mock.calls[2]).toHaveLength(1);
  });
});
