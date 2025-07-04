# ZeroEval TypeScript SDK (Work-in-Progress)

This package is a work-in-progress translation of the Python **zeroeval** SDK focused **solely on the observability layer** (tracing & telemetry).

```bash
pnpm install @zeroeval/sdk     # or npm / yarn
```

Quick start:

```ts
import * as ze from '@zeroeval/sdk';

ze.init({ apiKey: 'YOUR_API_KEY' });

@ze.span({ name: 'demo.hello' })
function hello(name: string) {
  return `Hello ${name}!`;
}

hello('world');
```

Everything will be flushed automatically or on `process.exit`.

> ☞ Only the **observability** surface is implemented right now. Datasets, experiments and CLI helpers will join in future releases.

## Development

Local examples are included in the `examples/` folder and runnable via npm scripts.

1. Install dependencies and build once:

   ```bash
   npm install
   npm run build    # optional – scripts rebuild automatically
   ```

2. Run an example:

   ```bash
   npm run example:basic               # Decorator-based example
   npm run example:basic-no-decorators # Non-decorator example
   ```

The example scripts rebuild the SDK before execution, so you can omit the manual `npm run build` step during active development if you prefer.
