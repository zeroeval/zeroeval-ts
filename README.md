# ZeroEval TypeScript SDK

[ZeroEval](https://zeroeval.com) is an evals, A/B testing and monitoring platform for AI products.

For full documentation visit https://docs.zeroeval.com.

## Features

• **Span decorator & tracer API** – instrument any function with a single line and capture sessions, traces and spans easily.

• **Integrations** – OpenAI client, Vercel AI SDK, and LangChain/LangGraph are traced automatically (optional peer deps).

• **Works everywhere** – Node 18+, Bun, browser (Vite / Next.js).

### Feature comparison

| Feature           | TypeScript SDK | Python SDK   |
| ----------------- | -------------- | ------------ |
| **Observability** | ✅ Supported   | ✅ Supported |
| **Datasets**      | ⚠️ WIP         | ✅ Supported |
| **Experiments**   | ⚠️ WIP         | ✅ Supported |

## Installation

```bash
npm install zeroeval
```

Optional dependencies for integrations:

```bash
npm install openai
npm install ai @ai-sdk/openai
npm install langchain
```

## Authentication

1. **Environment variable** (recommended)
   ```bash
   export ZEROEVAL_API_KEY=YOUR_KEY
   ```
2. **In code**
   ```ts
   import * as ze from "zeroeval";
   ze.init({ apiKey: "YOUR_KEY" });
   ```

The SDK auto-initialises on first span if `ZEROEVAL_API_KEY` is set.

## Quick-start

```ts
import * as ze from "zeroeval";
import { OpenAI } from "openai";

ze.init();

const openai = ze.wrap(new OpenAI());

// Traced automatically
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(completion.choices[0].message.content);
```

## Integrations

### OpenAI

```ts
import * as ze from "zeroeval";
import { OpenAI } from "openai";

ze.init();

const openai = ze.wrap(new OpenAI());
```

### LangChain / LangGraph

```ts
import {
  ZeroEvalCallbackHandler,
  setGlobalCallbackHandler,
} from "zeroeval/langchain";

setGlobalCallbackHandler(new ZeroEvalCallbackHandler());
```

### Vercel AI SDK

```ts
import * as ze from "zeroeval";
import { openai } from "@ai-sdk/openai";

const wrappedAI = ze.wrap(ai);

const result = await wrappedAI.generateText({
  model: openai("gpt-4o-mini"),
  prompt: "Hello, world!",
});
```

## License

[Apache 2.0](./LICENSE)
