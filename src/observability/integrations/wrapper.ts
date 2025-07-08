import type { OpenAI } from 'openai';
import { wrapOpenAI } from './openaiWrapper';
import { wrapVercelAI } from './vercelAIWrapper';
import { init, isInitialized } from '../../init';

// Type for wrapped clients
type WrappedClient<T> = T & {
  __zeroeval_wrapped?: boolean;
};

// Type guards for different clients
function isOpenAIClient(client: any): client is InstanceType<typeof OpenAI> {
  // Check for OpenAI-specific properties
  return (
    client?.chat?.completions?.create !== undefined &&
    client?.embeddings?.create !== undefined &&
    client?.constructor?.name === 'OpenAI'
  );
}

function isVercelAIModule(client: any): boolean {
  // Check for Vercel AI SDK functions
  return (
    typeof client === 'object' &&
    client !== null &&
    (typeof client.generateText === 'function' ||
      typeof client.streamText === 'function' ||
      typeof client.generateObject === 'function' ||
      typeof client.embed === 'function')
  );
}

/**
 * Wraps a supported AI client to automatically trace all API calls.
 * Automatically detects the client type and applies the appropriate wrapper.
 *
 * If ze.init() hasn't been called yet and ZEROEVAL_API_KEY is set in the environment,
 * the SDK will be automatically initialized.
 *
 * @param client - The AI client instance to wrap (currently supports OpenAI and Vercel AI SDK)
 * @returns A wrapped client with automatic tracing
 *
 * @example
 * ```ts
 * import { OpenAI } from 'openai';
 * import * as ze from '@zeroeval/sdk';
 *
 * // Simplest usage - both SDKs use environment variables
 * const openai = ze.wrap(new OpenAI());
 *
 * // Use the client normally - all calls will be traced
 * const completion = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 *
 * @example
 * ```ts
 * import * as ai from 'ai';
 * import * as ze from '@zeroeval/sdk';
 *
 * // Wrap the Vercel AI SDK
 * const wrappedAI = ze.wrap(ai);
 *
 * // Use the wrapped functions - all calls will be traced
 * const { text } = await wrappedAI.generateText({
 *   model: openai('gpt-4'),
 *   prompt: 'Hello!'
 * });
 * ```
 */
export function wrap<T extends object>(client: T): WrappedClient<T> {
  // Check if already wrapped
  if ((client as WrappedClient<T>).__zeroeval_wrapped) {
    return client as WrappedClient<T>;
  }

  // Auto-initialize if needed
  if (!isInitialized()) {
    const envApiKey = process.env.ZEROEVAL_API_KEY;
    if (envApiKey) {
      init({ apiKey: envApiKey });
    }
  }

  // Detect client type and apply appropriate wrapper
  if (isOpenAIClient(client)) {
    return wrapOpenAI(client) as WrappedClient<T>;
  }

  if (isVercelAIModule(client)) {
    return wrapVercelAI(client) as WrappedClient<T>;
  }

  // If we reach here, the client type is not supported
  throw new Error(
    `Unsupported client type. ze.wrap() currently supports:\n` +
      `- OpenAI clients (from 'openai' package)\n` +
      `- Vercel AI SDK (from 'ai' package)\n` +
      `\n` +
      `Received: ${(client as any)?.constructor?.name || typeof client}\n` +
      `\n` +
      `Make sure you're passing a valid client instance, e.g.:\n` +
      `  const openai = ze.wrap(new OpenAI());\n` +
      `  const ai = ze.wrap(await import('ai'));`
  );
}
