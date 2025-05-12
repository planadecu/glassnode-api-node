# Glassnode API

A Node.js client for the [Glassnode API](https://docs.glassnode.com/).

## Installation

```bash
npm install glassnode-api
```

## Usage

```typescript
import { GlassnodeAPI } from 'glassnode-api';

// Create an instance with your API key
const api = new GlassnodeAPI({
  apiKey: 'YOUR_API_KEY',
  // Optional: Override the API URL
  // apiUrl: 'https://api.glassnode.com'
});

// Fetch asset metadata
async function getAssets() {
  try {
    const response = await api.getAssetMetadata();
    console.log(response.data);
  } catch (error) {
    console.error('Error fetching asset metadata:', error);
  }
}

// Fetch metric metadata
async function getMetrics() {
  try {
    const response = await api.getMetricMetadata();
    console.log(response.data);
  } catch (error) {
    console.error('Error fetching metric metadata:', error);
  }
}
```

## Examples

Check the `examples` directory for usage examples. To run the examples:

1. Navigate to the examples directory
2. Create a `.env` file based on `.env.example` with your API key
3. Install dependencies with `npm install`
4. Run an example with `npx ts-node metadata.ts`

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## License

MIT
