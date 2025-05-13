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

Explore our [detailed examples](./examples/README.md) to learn how to use the Glassnode API client effectively. The examples demonstrate:

- Fetching and validating asset metadata
- Working with metric lists and metadata
- Calling metrics with parameters

To run the examples:

1. Navigate to the examples directory
2. Create a `.env` file with your API key: `GLASSNODE_API_KEY=your_key_here`
3. Install dependencies with `npm install`
4. Run an example with `npx ts-node metadata.validation.ts`

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
