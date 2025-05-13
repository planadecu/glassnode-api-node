# Glassnode API Examples

This directory contains example scripts that demonstrate how to use the Glassnode API Node.js client.

## Setup

Before running the examples:

1. Make sure you have an API key from [Glassnode](https://docs.glassnode.com/)
2. Create a `.env` file in this directory with your API key:
   ```
   GLASSNODE_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Available Examples

### Metadata Validation (`metadata.validation.ts`)

Demonstrates how to:
- Fetch and validate asset metadata 
- Get a list of available metrics
- Fetch metadata for specific metrics (exchange balance example)
- Work with metric parameters

Run with:
```bash
npx ts-node metadata.validation.ts
```

### Metric Dumping (`metric.dump.ts`)

Shows how to:
- Fetch a list of all available metrics
- Get metadata for each metric
- Call metrics with parameters
- Process and display the results

Run with:
```bash
npx ts-node metric.dump.ts
```

## Dependencies

The examples use:
- `dotenv` - For loading environment variables
- `ts-node` - For running TypeScript files directly
- `zod` - For schema validation (used in metadata.validation.ts)

## Adding New Examples

To add a new example:
1. Create a new TypeScript file in this directory
2. Import the Glassnode API client: `import { GlassnodeAPI } from '../src'`
3. Set up the client with your API key
4. Implement your example code
5. Run with `npx ts-node your-example-file.ts` 