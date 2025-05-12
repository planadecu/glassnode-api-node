# Claude Instructions

This document provides context for Claude when working with this project.

## Project Structure

- `/src` - Source code
  - `/src/types` - TypeScript type definitions
  - `/src/utils` - Utility functions
- `/test` - Test files (Jest)
- `/examples` - Example usage patterns
- `/dist` - Compiled output (not checked into git)

## Development Workflow

- Use Node.js v22 (LTS)
- Use npm as package manager
- Run tests with `npm test`
- Lint code with `npm run lint`
- Format code with `npm run format`
- Build the project with `npm run build`

## Coding Standards

- TypeScript for all source files
- Jest for testing
- ESLint and Prettier for code quality
- Husky for git hooks

## API Client

The main class is `GlassnodeAPI` which takes a configuration object with API key and optional API URL.
