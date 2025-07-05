import type { OpenAI } from 'openai';
import { tracer } from '../Tracer';

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
export function wrapOpenAI<T extends OpenAIClient>(client: T): WrappedOpenAI<T> {
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
                  const completionsValue = Reflect.get(completionsTarget, completionsProp);
                  
                  if (completionsProp === 'create') {
                    return wrapCompletionsCreate(completionsValue.bind(completionsTarget));
                  }
                  
                  // Add other completion methods as needed
                  if (completionsProp === 'retrieve' || completionsProp === 'update' || 
                      completionsProp === 'list' || completionsProp === 'delete') {
                    return wrapGenericMethod(
                      completionsValue.bind(completionsTarget),
                      `openai.chat.completions.${String(completionsProp)}`
                    );
                  }
                  
                  return completionsValue;
                }
              });
            }
            
            return chatValue;
          }
        });
      }
      
      // Handle other top-level APIs
      if (prop === 'embeddings' && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(embeddingsTarget, embeddingsProp) {
            const embeddingsValue = Reflect.get(embeddingsTarget, embeddingsProp);
            
            if (embeddingsProp === 'create' && typeof embeddingsValue === 'function') {
              return wrapGenericMethod(
                embeddingsValue.bind(embeddingsTarget),
                'openai.embeddings.create'
              );
            }
            
            return embeddingsValue;
          }
        });
      }
      
      // Handle images API
      if (prop === 'images' && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(imagesTarget, imagesProp) {
            const imagesValue = Reflect.get(imagesTarget, imagesProp);
            
            if ((imagesProp === 'generate' || imagesProp === 'edit' || imagesProp === 'createVariation') && 
                typeof imagesValue === 'function') {
              return wrapGenericMethod(
                imagesValue.bind(imagesTarget),
                `openai.images.${String(imagesProp)}`
              );
            }
            
            return imagesValue;
          }
        });
      }
      
      // Handle audio API
      if (prop === 'audio' && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(audioTarget, audioProp) {
            const audioValue = Reflect.get(audioTarget, audioProp);
            
            // Handle audio.transcriptions and audio.translations
            if ((audioProp === 'transcriptions' || audioProp === 'translations') && 
                typeof audioValue === 'object' && audioValue !== null) {
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
                }
              });
            }
            
            return audioValue;
          }
        });
      }
      
      return value;
    }
  }) as WrappedOpenAI<T>;
  
  return wrappedClient;
}

/**
 * Wraps the chat.completions.create method with tracing
 */
function wrapCompletionsCreate(originalMethod: Function): Function {
  return async function wrappedCreate(...args: any[]) {
    const [params] = args;
    const isStreaming = !!params?.stream;
    
    const span = tracer.startSpan('openai.chat.completions.create', {
      attributes: {
        provider: 'openai',
        model: params?.model,
        streaming: isStreaming,
        temperature: params?.temperature,
        max_tokens: params?.max_tokens,
        messages_count: Array.isArray(params?.messages) ? params.messages.length : 0,
      },
      tags: { integration: 'openai' },
    });
    
    try {
      const result = await originalMethod(...args);
      
      // Handle streaming responses
      if (isStreaming && result && typeof result[Symbol.asyncIterator] === 'function') {
        // Return a wrapped stream that traces chunks
        return wrapStream(result, span, params);
      }
      
      // Handle non-streaming responses
      if (!isStreaming && result) {
        const output = result.choices?.[0]?.message?.content || 
                      JSON.stringify(result.choices?.[0]?.message);
        span.setIO(JSON.stringify(params), output);
        
        // Add usage information if available
        if (result.usage) {
          span.attributes.prompt_tokens = result.usage.prompt_tokens;
          span.attributes.completion_tokens = result.usage.completion_tokens;
          span.attributes.total_tokens = result.usage.total_tokens;
        }
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
function wrapGenericMethod(originalMethod: Function, spanName: string): Function {
  return async function wrappedMethod(...args: any[]) {
    const [params] = args;
    
    const span = tracer.startSpan(spanName, {
      attributes: {
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
async function* wrapStream(stream: AsyncIterable<any>, span: any, params: any): AsyncIterable<any> {
  const chunks: any[] = [];
  let errorOccurred = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      yield chunk;
    }
    
    // After stream completes, aggregate the chunks for tracing
    const fullContent = chunks
      .map(chunk => chunk.choices?.[0]?.delta?.content || '')
      .filter(content => content)
      .join('');
    
    span.setIO(JSON.stringify(params), fullContent || 'Stream completed');
    
    // Try to get usage from the last chunk
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk?.usage) {
      span.attributes.prompt_tokens = lastChunk.usage.prompt_tokens;
      span.attributes.completion_tokens = lastChunk.usage.completion_tokens;
      span.attributes.total_tokens = lastChunk.usage.total_tokens;
    }
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