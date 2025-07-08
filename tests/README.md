# ZeroEval TypeScript SDK Tests

Comprehensive test suite for the ZeroEval TypeScript SDK covering core functionality and performance.

## Test Categories

- **Core**: Essential functionality tests (`tests/core/`)
- **Performance**: CPU usage and memory efficiency tests (`tests/performance/`)

## Setup

1. **Install dependencies**:

```bash
npm install
```

2. **Install test dependencies** (if not already installed):

```bash
npm install --save-dev vitest @vitest/coverage-v8 @vitest/ui
```

## Running Tests

### All Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui
```

### Specific Test Categories

```bash
# Run only core tests
npm run test:core

# Run only performance tests
npm run test:perf

# Run a specific test file
npx vitest tests/core/tracer.test.ts
```

### Multi-Version Testing

Test across multiple Node.js versions locally (requires nvm or fnm):

```bash
# Test all versions (18.x, 20.x, 22.x)
npm run test:multi

# Test only core tests across versions
npm run test:multi:core

# Test only performance tests across versions
npm run test:multi:perf
```

The multi-version script will:

1. Detect whether you have nvm or fnm installed
2. Install required Node.js versions if needed
3. Run tests on each version
4. Restore your original Node.js version
5. Provide a summary of results

## Performance Tests

Performance tests validate:

- CPU performance (>1000 spans/sec)
- Memory efficiency (no leaks)
- Concurrent span creation
- Buffer management
- Deep nesting performance

Performance thresholds are calibrated for Node.js environments.

## Test Structure

```
tests/
├── setup.ts                    # Shared test utilities and mocks
├── core/                       # Core functionality tests
│   ├── tracer.test.ts         # Tracer tests
│   ├── span.test.ts           # Span tests
│   └── decorator.test.ts      # Decorator tests
└── performance/               # Performance tests
    └── span-performance.test.ts  # CPU and memory tests
```

## Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTracer } from '../setup';

describe('MyFeature', () => {
  let tracer: any;
  let mockWriter: any;

  beforeEach(() => {
    ({ tracer, mockWriter } = createTestTracer());
  });

  it('should do something', () => {
    // Test implementation
    expect(true).toBe(true);
  });
});
```

## Linting and Formatting

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

## CI/CD Integration

Tests run automatically on:

- Pull requests
- Pushes to main branch
- Pre-publish checks

The CI pipeline includes:

- Linting and formatting checks
- Unit tests across Node.js versions (18.x, 20.x, 22.x)
- Coverage reporting
- Performance regression detection
