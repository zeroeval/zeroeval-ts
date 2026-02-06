# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZeroEval TypeScript SDK — an observability, tracing, and monitoring platform SDK for AI products. Provides span-based tracing, automatic integrations (OpenAI, Vercel AI SDK, LangChain/LangGraph), signals, prompt management, and feedback APIs. Targets Node 18+, Bun, and browser environments. Dual ESM/CJS output.

## Common Commands

```bash
npm run build          # Build with tsup (ESM + CJS + .d.ts)
npm run watch          # Build in watch mode for development
npm run clean          # Remove dist/

npm test               # Run all tests (vitest)
npm run test:core      # Core tests only (tests/core/)
npm run test:perf      # Performance tests only (tests/performance/)
npx vitest run tests/core/span.test.ts  # Run a single test file

npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier write
npm run format:check   # Prettier check
npx tsc --noEmit       # Type check without emitting
```

## Architecture

### Core Tracing (AsyncLocalStorage-based context)

The SDK uses Node.js `AsyncLocalStorage` to maintain a span stack per async context, enabling automatic parent-child span relationships without explicit threading. Key flow:

1. `init()` (src/init.ts) configures the SDK and creates a singleton `Tracer`
2. `Tracer` (src/observability/Tracer.ts) manages span lifecycle, buffering (default 100 spans), and periodic flushing (default 10s) to the backend via `BackendSpanWriter`
3. `Span` (src/observability/Span.ts) represents a trace unit with UUID, trace/parent IDs, timing, tags, input/output, errors, and signals
4. `@span` decorator (src/observability/spanDecorator.ts) wraps functions to auto-capture args, return values, and errors — works as both method decorator and function wrapper

### Integration Pattern

Client wrappers use proxy-based instrumentation for transparent tracing:
- `wrap()` auto-detects client type (OpenAI vs Vercel AI) via type detection in `src/observability/integrations/wrapper.ts`
- `wrapOpenAI()` / `wrapVercelAI()` are type-specific wrappers
- LangChain uses a callback handler pattern (`ZeroEvalCallbackHandler`) exported from `zeroeval/langchain`

### Dual Entry Points

- `src/index.ts` — main SDK exports (init, span, wrap, signals, prompts, feedback)
- `src/langchain.ts` — LangChain-specific exports (callback handler, global handler management)

Both are built by tsup into `dist/{index,langchain}.{js,cjs,d.ts}`.

### Signals, Prompts, Feedback

- **Signals** (src/signals.ts): Boolean/numerical/string metrics attached to spans, traces, or sessions
- **Prompts** (src/prompt.ts): Content-addressed by SHA-256 hash, supports versioning, template variable interpolation, and metadata embedding
- **Feedback** (src/feedback.ts): API for sending feedback on LLM completions

## Testing

- **Framework:** Vitest with globals enabled (no imports needed for describe/it/expect)
- **Pool:** threads with `singleThread: true` (required for AsyncLocalStorage correctness)
- **Setup:** `vitest.setup.ts` mocks integration utils and process.on to prevent side effects
- **Coverage threshold:** 80% (lines, functions, branches, statements)
- Tests use `createTestTracer()` from test setup helpers with mock `BackendSpanWriter`

## Code Style

- TypeScript strict mode with `experimentalDecorators: true`
- `@typescript-eslint/consistent-type-imports: error` — use `import type` for type-only imports
- `@typescript-eslint/no-floating-promises: error` — all promises must be handled
- Unused vars prefixed with `_` are allowed
- Prettier: single quotes, semicolons, 80 char width, trailing commas (es5)

## Environment Variables

- `ZEROEVAL_API_KEY` — API authentication (auto-initializes SDK if set)
- `ZEROEVAL_API_URL` — Backend URL (default: https://api.zeroeval.com)
- `ZEROEVAL_DEBUG` — Enable debug logging
