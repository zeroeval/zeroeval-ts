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

## AI Client Integration

The SDK provides a generic `wrap()` function to automatically trace AI client API calls:

```ts
import { OpenAI } from "openai";
import * as ze from "@zeroeval/sdk";

// Simplest: Both SDKs use environment variables
// Set OPENAI_API_KEY and ZEROEVAL_API_KEY in your environment
const openai = ze.wrap(new OpenAI());

// Or with explicit initialization for more control:
ze.init({ apiKey: "your-zeroeval-key" });
const openai = ze.wrap(new OpenAI({ apiKey: "your-openai-key" }));

// Use the client normally - all calls will be traced
const completion = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello!" }],
});

// Streaming is also supported
const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  // Process chunks - they're automatically traced
}
```

The `ze.wrap()` function automatically detects the client type and applies the appropriate tracing. Currently supported:

- **OpenAI** - Full support for chat completions, embeddings, images, audio, streaming, and token usage

The wrapper approach provides better TypeScript support compared to monkey patching and traces:

- Chat completions (streaming and non-streaming)
- Embeddings
- Images (generation, edit, variations)
- Audio (transcriptions, translations)
- Token usage information
- Errors and retries

## LangChain Integration

The SDK provides seamless integration with LangChain and LangGraph through a callback handler:

```ts
import {
  ZeroEvalCallbackHandler,
  setGlobalHandler,
} from "@zeroeval/sdk/langchain";

// Set up global tracing for all LangChain operations
setGlobalHandler(new ZeroEvalCallbackHandler());

// Now all LangChain/LangGraph operations are automatically traced!
```

See [README_LANGCHAIN.md](README_LANGCHAIN.md) for detailed documentation on the LangChain integration.

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
   npm run example:openai              # OpenAI wrapper example
   npm run example:langchain           # LangChain integration example
   ```

The example scripts rebuild the SDK before execution, so you can omit the manual `npm run build` step during active development if you prefer.
