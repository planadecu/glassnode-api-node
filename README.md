# Glassnode API

A TypeScript client for the [Glassnode API](https://docs.glassnode.com/), supporting both Node.js and browser environments.

## Installation

### Node.js

```bash
# pnpm
pnpm add glassnode-api

# npm
npm install glassnode-api

# yarn
yarn add glassnode-api
```

### Browser (UMD)

```html
<script src="https://unpkg.com/glassnode-api/dist/glassnode-api.umd.min.js"></script>
<script>
  const api = new GlassnodeAPI.GlassnodeAPI({ apiKey: 'YOUR_API_KEY' });
</script>
```

### Browser (ESM)

```html
<script type="module">
  import { GlassnodeAPI } from 'https://unpkg.com/glassnode-api/dist/glassnode-api.esm.min.js';

  const api = new GlassnodeAPI({ apiKey: 'YOUR_API_KEY' });
</script>
```

## Usage

```typescript
import { GlassnodeAPI } from 'glassnode-api';

const api = new GlassnodeAPI({
  apiKey: 'YOUR_API_KEY',
  // Optional: Override the API URL
  // apiUrl: 'https://api.glassnode.com'
});

// Fetch asset metadata
const assets = await api.getAssetMetadata();

// Fetch metric metadata
const metric = await api.getMetricMetadata('/distribution/balance_exchanges', { a: 'BTC' });

// Get list of all available metrics
const metrics = await api.getMetricList();

// Call a metric directly
const data = await api.callMetric('/market/price_usd_close', { a: 'BTC', s: '1609459200' });
```

## API

### `new GlassnodeAPI(config)`

| Parameter | Type     | Required | Description                                            |
| --------- | -------- | -------- | ------------------------------------------------------ |
| `apiKey`  | `string` | Yes      | Your Glassnode API key                                 |
| `apiUrl`  | `string` | No       | API base URL (defaults to `https://api.glassnode.com`) |

### Methods

| Method                             | Returns                           | Description                         |
| ---------------------------------- | --------------------------------- | ----------------------------------- |
| `getAssetMetadata()`               | `Promise<AssetMetadataResponse>`  | Get metadata for all assets         |
| `getMetricMetadata(path, params?)` | `Promise<MetricMetadataResponse>` | Get metadata for a specific metric  |
| `getMetricList()`                  | `Promise<MetricListResponse>`     | Get a list of all available metrics |
| `callMetric<T>(path, params?)`     | `Promise<T>`                      | Call a metric endpoint directly     |

## Examples

See the [examples directory](./examples/README.md) for detailed usage patterns.

```bash
cd examples
cp .env.example .env  # add your API key
pnpm dlx ts-node metadata.validation.ts
```

## Development

```bash
# Install dependencies
pnpm install

# Build (Node.js + browser bundles)
pnpm run build && pnpm run build:browser

# Run tests
pnpm test

# Lint
pnpm run lint

# Format
pnpm run format
```

## License

MIT
