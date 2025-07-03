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
