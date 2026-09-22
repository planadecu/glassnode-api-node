// Runtime smoke for the published CJS build (dist/), run on the Node floor (18) in CI where Vitest
// cannot run. Proves a real `AbortSignal.timeout()` abort surfaces as a GlassnodeNetworkError
// with `timedOut === true` on this runtime. Not published (package.json `files` is dist-only).
// Usage: pnpm run build && node scripts/smoke-timeout.mjs
/* global process, console, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GlassnodeAPI, GlassnodeNetworkError } = require('../dist/index.js');

// A fetch that never settles on its own: it only rejects, with the signal's reason, when aborted.
function hangingFetch(_url, init) {
  return new Promise((_resolve, reject) => {
    const signal = init && init.signal;
    assert.ok(signal, 'client did not pass an AbortSignal although `timeout` is set');
    signal.addEventListener('abort', () => reject(signal.reason));
  });
}

const api = new GlassnodeAPI({ apiKey: 'smoke-key', fetch: hangingFetch, timeout: 20 });

// AbortSignal.timeout()'s timer does not keep Node alive (a real fetch's socket would), so hold
// the event loop open with a watchdog that also fails the smoke if the abort never happens.
const watchdog = setTimeout(() => {
  console.error('timeout smoke FAILED: the request was never aborted');
  process.exit(1);
}, 5000);

let error;
try {
  await api.getMetricList();
} catch (e) {
  error = e;
}
clearTimeout(watchdog);

assert.ok(error, 'expected the request to reject on timeout');
assert.ok(
  error instanceof GlassnodeNetworkError,
  `expected GlassnodeNetworkError, got ${error && error.name}: ${error && error.message}`
);
assert.equal(error.timedOut, true, `expected timedOut === true (message: ${error.message})`);
console.log(`timeout smoke ok on ${process.version}: ${error.name} timedOut=${error.timedOut}`);
