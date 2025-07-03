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

To test the SDK locally during development, we use `npm link`:

1. Build and link the SDK:

   ```bash
   npm install
   npm run build
   npm link
   ```

2. Check out the `zeroeval-ts-sdk-examples` directory for examples and testing instructions.

### Watch Mode

For active development, use watch mode to automatically rebuild on changes:

```bash
npm run watch
```
