# ZeroEval LangChain Integration

This document describes how to use ZeroEval's LangChain integration to automatically trace LangChain and LangGraph applications.

## Installation

First, install the required dependencies:

```bash
npm install @zeroeval/sdk @langchain/core @langchain/langgraph
```

## Basic Usage

### Using the Global Handler

The simplest way to integrate ZeroEval with LangChain is to use the global handler:

```typescript
import { init } from "@zeroeval/sdk";
import {
  ZeroEvalCallbackHandler,
  setGlobalHandler,
} from "@zeroeval/sdk/langchain";

// Initialize ZeroEval
init({
  apiKey: "your-api-key",
  apiUrl: "http://localhost:8000",
});

// Create and set the global callback handler
const handler = new ZeroEvalCallbackHandler({
  sessionName: "My LangChain App",
  debug: true, // Optional: enables debug logging
});

// Set the handler globally
setGlobalHandler(handler);

// Now all LangChain/LangGraph operations will be automatically traced!
```

### Manual Handler Usage

You can also pass the handler explicitly to specific invocations:

```typescript
import { ZeroEvalCallbackHandler } from "@zeroeval/sdk/langchain";

const handler = new ZeroEvalCallbackHandler({
  sessionName: "Specific Operation",
});

// Pass to a chain
await chain.invoke({ input: "Hello" }, { callbacks: [handler] });

// Or attach to a chain
const chainWithCallbacks = chain.withConfig({
  callbacks: [handler],
});
```

## How It Works

The `ZeroEvalCallbackHandler` implements LangChain's `BaseCallbackHandler` interface and automatically traces:

1. **LLM Calls**: Tracks all LLM invocations including:

   - Input prompts
   - Model parameters (temperature, max_tokens, etc.)
   - Output responses
   - Token usage metrics
   - Errors and retries

2. **Chat Models**: Handles chat-specific features:

   - Message history
   - Tool calls
   - Function calling

3. **Chains**: Traces chain execution:

   - Input/output for each step
   - Chain composition and nesting
   - Conditional routing

4. **Tools**: Monitors tool usage:

   - Tool invocations
   - Input arguments
   - Return values
   - Errors

5. **Agents**: Tracks agent behavior:

   - Action planning
   - Tool selection
   - Iterative reasoning

6. **Retrievers**: Logs retrieval operations:
   - Queries
   - Retrieved documents
   - Relevance scores

## Configuration Options

The `ZeroEvalCallbackHandler` accepts the following options:

```typescript
interface ZeroEvalCallbackHandlerOptions {
  // Enable debug logging
  debug?: boolean;

  // Regex to exclude certain metadata properties
  excludeMetadataProps?: RegExp;

  // Session ID (auto-generated if not provided)
  sessionId?: string;

  // Human-readable session name
  sessionName?: string;
}
```

## Example: LangGraph Agent

Here's a complete example using LangGraph to build an agent:

```typescript
import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Create a tool
const weatherTool = new DynamicStructuredTool({
  name: "get_weather",
  description: "Get the current weather",
  schema: z.object({
    location: z.string(),
  }),
  func: async ({ location }) => {
    return `Weather in ${location}: Sunny, 72°F`;
  },
});

// Create the model
const model = new ChatOpenAI({
  modelName: "gpt-4",
}).bindTools([weatherTool]);

// Build the graph
const workflow = new StateGraph({
  // ... graph configuration
});

const app = workflow.compile();

// The global handler will automatically trace all operations!
const result = await app.invoke({
  messages: [{ role: "user", content: "What is the weather?" }],
});
```

## Integration with Existing Code

The beauty of the global handler approach is that it requires minimal changes to existing code:

1. Add the initialization code at the start of your application
2. Set the global handler once
3. All LangChain operations are automatically traced

No need to modify individual chains, models, or tools!

## Advanced Usage

### Multiple Sessions

You can track different parts of your application separately:

```typescript
// Set a global handler for general tracing
setGlobalHandler(
  new ZeroEvalCallbackHandler({
    sessionName: "Main Application",
  })
);

// Use specific handlers for certain operations
const criticalHandler = new ZeroEvalCallbackHandler({
  sessionName: "Critical Path",
});

await criticalChain.invoke(input, {
  callbacks: [criticalHandler],
});
```

### Conditional Tracing

```typescript
const handler = new ZeroEvalCallbackHandler({
  debug: process.env.NODE_ENV === "development",
});

if (shouldTrace) {
  setGlobalHandler(handler);
}
```

### Cleanup

To stop global tracing:

```typescript
import { clearGlobalHandler } from "@zeroeval/sdk/langchain";

clearGlobalHandler();
```

## Supported Components

The integration supports all major LangChain components:

- ✅ LLMs (OpenAI, Anthropic, etc.)
- ✅ Chat Models
- ✅ Chains (Sequential, Parallel, etc.)
- ✅ Agents (ReAct, OpenAI Functions, etc.)
- ✅ Tools and Toolkits
- ✅ Retrievers and Vector Stores
- ✅ Document Loaders and Transformers
- ✅ Memory Systems
- ✅ LangGraph Graphs and Nodes

## Troubleshooting

### Handler Not Working

1. Ensure ZeroEval is initialized before setting the handler
2. Check that the handler is set before creating chains/models
3. Verify API connectivity to the ZeroEval backend

### Missing Traces

Some operations might not trigger callbacks if:

- They're cached
- They fail before reaching the callback layer
- They're using custom implementations

### Performance Considerations

The callback handler is designed to be lightweight, but for high-throughput applications:

- Consider sampling (trace only a percentage of requests)
- Use conditional tracing based on environment
- Monitor the impact on latency

## API Reference

### `ZeroEvalCallbackHandler`

Main callback handler class that integrates with LangChain.

### `setGlobalHandler(handler: BaseCallbackHandler)`

Sets a global handler that will be used by all LangChain operations.

### `getGlobalHandler(): BaseCallbackHandler | undefined`

Returns the currently set global handler, if any.

### `clearGlobalHandler()`

Removes the global handler, stopping automatic tracing.
