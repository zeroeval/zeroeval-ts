import type { OpenAI } from 'openai';
import { tracer } from '../Tracer';
import { extractZeroEvalMetadata } from '../../utils/metadata';
import { renderTemplate } from '../../utils/template';
import { getPromptClient } from '../promptClient';
import type { PromptMetadata } from '../../types/prompt';

type OpenAIClient = InstanceType<typeof OpenAI>;

// Type to preserve the original OpenAI client's structure while adding our wrapper
type WrappedOpenAI<T extends OpenAIClient> = T & {
  __zeroeval_wrapped?: boolean;
};

/**
 * Wraps an OpenAI client instance to automatically trace all API calls.
 * This approach provides better TypeScript support and is more maintainable
 * than monkey patching.
 *
 * If ze.init() hasn't been called yet and ZEROEVAL_API_KEY is set in the environment,
 * the SDK will be automatically initialized.
 *
 * @param client - The OpenAI client instance to wrap
 * @returns A wrapped OpenAI client with automatic tracing
 *
 * @example
 * ```ts
 * import { OpenAI } from 'openai';
 * import { wrapOpenAI } from '@zeroeval/sdk';
 *
 * // No need to call ze.init() if ZEROEVAL_API_KEY is set
 * const client = wrapOpenAI(new OpenAI({ apiKey: 'your-key' }));
 *
 * // Use the client normally - all calls will be traced
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 */
export function wrapOpenAI<T extends OpenAIClient>(
  client: T
): WrappedOpenAI<T> {
  // Check if already wrapped to avoid double wrapping
  if ((client as WrappedOpenAI<T>).__zeroeval_wrapped) {
    return client as WrappedOpenAI<T>;
  }

  // Create a proxy to intercept method calls
  const wrappedClient = new Proxy(client as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Handle special properties
      if (prop === '__zeroeval_wrapped') {
        return true;
      }

      // Handle chat.completions.create
      if (prop === 'chat') {
        return new Proxy(value, {
          get(chatTarget, chatProp) {
            const chatValue = Reflect.get(chatTarget, chatProp);

            if (chatProp === 'completions') {
              return new Proxy(chatValue, {
                get(completionsTarget, completionsProp) {
                  const completionsValue = Reflect.get(
                    completionsTarget,
                    completionsProp
                  );

                  if (completionsProp === 'create') {
                    return wrapCompletionsCreate(
                      completionsValue.bind(completionsTarget)
                    );
                  }

                  // Add other completion methods as needed
                  if (
                    completionsProp === 'retrieve' ||
                    completionsProp === 'update' ||
                    completionsProp === 'list' ||
                    completionsProp === 'delete'
                  ) {
                    return wrapGenericMethod(
                      completionsValue.bind(completionsTarget),
                      `openai.chat.completions.${String(completionsProp)}`
                    );
                  }

                  return completionsValue;
                },
              });
            }

            return chatValue;
          },
        });
      }

      // Handle other top-level APIs
      if (
        prop === 'embeddings' &&
        typeof value === 'object' &&
        value !== null
      ) {
        return new Proxy(value, {
          get(embeddingsTarget, embeddingsProp) {
            const embeddingsValue = Reflect.get(
              embeddingsTarget,
              embeddingsProp
            );

            if (
              embeddingsProp === 'create' &&
              typeof embeddingsValue === 'function'
            ) {
              return wrapGenericMethod(
                embeddingsValue.bind(embeddingsTarget),
                'openai.embeddings.create'
              );
            }

            return embeddingsValue;
          },
        });
      }

      // Handle images API
      if (prop === 'images' && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(imagesTarget, imagesProp) {
            const imagesValue = Reflect.get(imagesTarget, imagesProp);

            if (
              (imagesProp === 'generate' ||
                imagesProp === 'edit' ||
                imagesProp === 'createVariation') &&
              typeof imagesValue === 'function'
            ) {
              return wrapGenericMethod(
                imagesValue.bind(imagesTarget),
                `openai.images.${String(imagesProp)}`
              );
            }

            return imagesValue;
          },
        });
      }

      // Handle audio API
      if (prop === 'audio' && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(audioTarget, audioProp) {
            const audioValue = Reflect.get(audioTarget, audioProp);

            // Handle audio.transcriptions and audio.translations
            if (
              (audioProp === 'transcriptions' ||
                audioProp === 'translations') &&
              typeof audioValue === 'object' &&
              audioValue !== null
            ) {
              return new Proxy(audioValue, {
                get(subTarget, subProp) {
                  const subValue = Reflect.get(subTarget, subProp);

                  if (subProp === 'create' && typeof subValue === 'function') {
                    return wrapGenericMethod(
                      subValue.bind(subTarget),
                      `openai.audio.${String(audioProp)}.create`
                    );
                  }

                  return subValue;
                },
              });
            }

            return audioValue;
          },
        });
      }

      return value;
    },
  }) as WrappedOpenAI<T>;

  return wrappedClient;
}

/**
 * Process messages to extract ZeroEval metadata and interpolate variables.
 * Returns processed messages and extracted metadata.
 */
interface ProcessedMessages {
  processedMessages: Array<{ role: string; content: string | unknown }>;
  metadata: PromptMetadata | null;
  originalSystemContent: string | null;
}

function processMessagesWithZeroEval(
  messages: Array<{ role: string; content: string | unknown }> | undefined
): ProcessedMessages {
  if (!messages || messages.length === 0) {
    return { processedMessages: messages || [], metadata: null, originalSystemContent: null };
  }

  // Deep copy to avoid mutation
  const processed = JSON.parse(JSON.stringify(messages)) as Array<{
    role: string;
    content: string | unknown;
  }>;

  // Check first message for system role and metadata
  const firstMsg = processed[0];
  if (firstMsg?.role !== 'system' || typeof firstMsg.content !== 'string') {
    return { processedMessages: processed, metadata: null, originalSystemContent: null };
  }

  const originalSystemContent = firstMsg.content;
  const { metadata, cleanContent } = extractZeroEvalMetadata(firstMsg.content);

  if (!metadata) {
    return { processedMessages: processed, metadata: null, originalSystemContent };
  }

  // Update system message with clean content (metadata stripped)
  firstMsg.content = cleanContent;

  // Interpolate variables in all messages if variables are provided
  if (metadata.variables && Object.keys(metadata.variables).length > 0) {
    for (const msg of processed) {
      if (typeof msg.content === 'string') {
        msg.content = renderTemplate(msg.content, metadata.variables, { missing: 'leave' });
      }
    }
  }

  return { processedMessages: processed, metadata, originalSystemContent };
}

/**
 * Wraps the chat.completions.create method with tracing
 */
function wrapCompletionsCreate(originalMethod: Function): Function {
  return async function wrappedCreate(...args: any[]) {
    const [params] = args;
    const isStreaming = !!params?.stream;
    const startTime = Date.now() / 1000; // Convert to seconds for consistency with Python

    // Process messages to extract ZeroEval metadata
    const { processedMessages, metadata: zeMetadata, originalSystemContent } =
      processMessagesWithZeroEval(params?.messages);

    // Patch model if prompt version has a bound model
    let patchedModel = params?.model;
    if (zeMetadata?.prompt_version_id) {
      try {
        const client = getPromptClient();
        const boundModel = await client.getModelForPromptVersion(zeMetadata.prompt_version_id);
        if (boundModel) {
          patchedModel = boundModel;
        }
      } catch {
        // Silently ignore model lookup failures, use original model
      }
    }

    // Build the modified params with processed messages and potentially patched model
    const modifiedParams = {
      ...params,
      messages: processedMessages,
      model: patchedModel,
    };

    // Enable usage tracking for streaming on OpenAI-native models
    if (
      isStreaming &&
      modifiedParams?.model &&
      typeof modifiedParams.model === 'string' &&
      !modifiedParams.model.includes('/')
    ) {
      modifiedParams.stream_options = { include_usage: true };
    }

    // Serialize processed messages for attributes (after variable interpolation)
    const serializedMessages = processedMessages
      ? processedMessages.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }))
      : [];

    // Build span attributes including ZeroEval metadata if present
    const spanAttributes: Record<string, unknown> = {
      'service.name': 'openai',
      kind: 'llm',
      provider: 'openai',
      model: patchedModel,
      messages: serializedMessages,
      streaming: isStreaming,
    };

    // Add ZeroEval metadata to span attributes if present
    if (zeMetadata) {
      spanAttributes.task = zeMetadata.task;
      spanAttributes.zeroeval = zeMetadata;
      if (originalSystemContent) {
        spanAttributes.system_prompt_template = originalSystemContent;
      }
    }

    const span = tracer.startSpan('openai.chat.completions.create', {
      attributes: spanAttributes,
      tags: { integration: 'openai' },
    });

    try {
      const result = await originalMethod(modifiedParams);

      // Handle streaming responses
      if (
        isStreaming &&
        result &&
        typeof result[Symbol.asyncIterator] === 'function'
      ) {
        // Return a wrapped stream that traces chunks
        return wrapStream(result, span, serializedMessages, startTime);
      }

      // Handle non-streaming responses
      if (!isStreaming && result) {
        const elapsed = Date.now() / 1000 - startTime;
        const output = result.choices?.[0]?.message?.content || '';

        // Add usage information if available
        if (result.usage) {
          span.attributes.inputTokens = result.usage.prompt_tokens;
          span.attributes.outputTokens = result.usage.completion_tokens;
        }

        // Calculate throughput
        const throughput =
          output.length > 0 && elapsed > 0
            ? Math.round((output.length / elapsed) * 100) / 100
            : 0;
        span.attributes.throughput = throughput;

        span.setIO(JSON.stringify(serializedMessages), output);
      }

      tracer.endSpan(span);
      return result;
    } catch (error: any) {
      span.setError({
        code: error?.name || 'UnknownError',
        message: error?.message || 'An unknown error occurred',
        stack: error?.stack,
      });
      tracer.endSpan(span);
      throw error;
    }
  };
}

/**
 * Wraps a generic OpenAI API method with tracing
 */
function wrapGenericMethod(
  originalMethod: Function,
  spanName: string
): Function {
  return async function wrappedMethod(...args: any[]) {
    const [params] = args;

    // Determine the kind based on the span name
    let kind = 'operation';
    if (spanName.includes('embeddings')) {
      kind = 'embedding';
    }

    const span = tracer.startSpan(spanName, {
      attributes: {
        'service.name': 'openai',
        kind,
        provider: 'openai',
        ...(params?.model && { model: params.model }),
      },
      tags: { integration: 'openai' },
    });

    try {
      const result = await originalMethod(...args);

      // Try to extract meaningful output for tracing
      let output: any;
      if (result?.data && Array.isArray(result.data)) {
        output = `${result.data.length} items`;
      } else if (result?.text) {
        output = result.text;
      } else if (result?.embedding) {
        output = `embedding[${result.embedding.length}]`;
      } else {
        output = JSON.stringify(result);
      }

      span.setIO(JSON.stringify(params), output);
      tracer.endSpan(span);
      return result;
    } catch (error: any) {
      span.setError({
        code: error?.name || 'UnknownError',
        message: error?.message || 'An unknown error occurred',
        stack: error?.stack,
      });
      tracer.endSpan(span);
      throw error;
    }
  };
}

/**
 * Wraps a streaming response to trace chunks
 */
async function* wrapStream(
  stream: AsyncIterable<any>,
  span: any,
  serializedMessages: any,
  startTime: number
): AsyncIterable<any> {
  const chunks: any[] = [];
  let errorOccurred = false;
  let firstTokenTime: number | null = null;
  let fullResponse = '';

  try {
    for await (const chunk of stream) {
      // Check for usage-only chunks (final chunk with token counts)
      if (!chunk.choices && chunk.usage) {
        span.attributes.inputTokens = chunk.usage.prompt_tokens;
        span.attributes.outputTokens = chunk.usage.completion_tokens;
        chunks.push(chunk);
        yield chunk;
        continue;
      }

      // Process content chunks
      if (chunk.choices?.[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        if (firstTokenTime === null) {
          firstTokenTime = Date.now() / 1000;
          // Time to first token (latency)
          span.attributes.latency =
            Math.round((firstTokenTime - startTime) * 10000) / 10000;
        }
        fullResponse += content;
      }

      chunks.push(chunk);
      yield chunk;
    }

    // Calculate throughput
    const elapsed = Date.now() / 1000 - startTime;
    const throughput =
      fullResponse.length > 0 && elapsed > 0
        ? Math.round((fullResponse.length / elapsed) * 100) / 100
        : 0;
    span.attributes.throughput = throughput;

    span.setIO(JSON.stringify(serializedMessages), fullResponse);
  } catch (error: any) {
    errorOccurred = true;
    span.setError({
      code: error?.name || 'StreamError',
      message: error?.message || 'Stream error occurred',
      stack: error?.stack,
    });
    throw error;
  } finally {
    if (!errorOccurred) {
      tracer.endSpan(span);
    }
  }
}
