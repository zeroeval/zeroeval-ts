import { tracer } from '../Tracer';
import { init, isInitialized } from '../../init';

// Type to preserve the original function's structure while adding our wrapper
type WrappedVercelAI<T> = T & {
  __zeroeval_wrapped?: boolean;
};

// Type for the Vercel AI SDK functions we want to wrap
type VercelAIFunction = (...args: any[]) => any;

/**
 * Wraps a Vercel AI SDK function to automatically trace all calls.
 * This approach provides better TypeScript support and is more maintainable
 * than monkey patching.
 * 
 * If ze.init() hasn't been called yet and ZEROEVAL_API_KEY is set in the environment,
 * the SDK will be automatically initialized.
 * 
 * @param fn - The Vercel AI SDK function to wrap
 * @param functionName - The name of the function for tracing
 * @returns A wrapped function with automatic tracing
 */
function wrapVercelAIFunction<T extends VercelAIFunction>(
  fn: T,
  functionName: string
): WrappedVercelAI<T> {
  // Check if already wrapped to avoid double wrapping
  if ((fn as WrappedVercelAI<T>).__zeroeval_wrapped) {
    return fn as WrappedVercelAI<T>;
  }

  // Auto-initialize if needed
  if (!isInitialized()) {
    const envApiKey = process.env.ZEROEVAL_API_KEY;
    if (envApiKey) {
      init({ apiKey: envApiKey });
    }
  }

  const wrappedFn = async function wrappedVercelAIFunction(...args: Parameters<T>) {
    const [options] = args;
    
    // Extract relevant information from options
    const model = options?.model?.modelId || options?.model || 'unknown';
    const messages = options?.messages;
    const prompt = options?.prompt;
    const tools = options?.tools;
    const maxSteps = options?.maxSteps;
    const maxRetries = options?.maxRetries;
    const temperature = options?.temperature;
    const maxTokens = options?.maxTokens;
    
    // Determine the kind based on function name
    let kind = 'operation';
    if (functionName === 'generateText' || functionName === 'streamText') {
      kind = 'llm';
    } else if (functionName === 'generateObject' || functionName === 'streamObject') {
      kind = 'llm';
    } else if (functionName === 'embed' || functionName === 'embedMany') {
      kind = 'embedding';
    } else if (functionName === 'generateImage') {
      kind = 'image';
    } else if (functionName === 'generateSpeech') {
      kind = 'speech';
    } else if (functionName === 'transcribe') {
      kind = 'transcription';
    }
    
    const span = tracer.startSpan(`vercelai.${functionName}`, {
      attributes: {
        'service.name': 'vercel-ai-sdk',
        kind,
        provider: 'vercel-ai-sdk',
        model,
        ...(messages && { messages: messages }),
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
        ...(maxSteps !== undefined && { maxSteps }),
        ...(maxRetries !== undefined && { maxRetries }),
        ...(tools && { toolCount: Object.keys(tools).length }),
        ...(functionName.includes('stream') && { streaming: true }),
      },
      tags: { integration: 'vercel-ai-sdk' },
    });

    const startTime = Date.now() / 1000;
    
    try {
      // Prepare input for tracing
      let input: string;
      if (messages) {
        input = JSON.stringify(messages);
      } else if (prompt) {
        input = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      } else {
        input = JSON.stringify(options);
      }
      
      const result = await (fn as T)(...args);
      
      // Handle different result types
      if (result && typeof result === 'object') {
        const elapsed = Date.now() / 1000 - startTime;
        
        // For generateText and similar functions
        if ('text' in result) {
          const output = result.text || '';
          
          // Add usage information if available
          if (result.usage) {
            span.attributes.inputTokens = result.usage.promptTokens;
            span.attributes.outputTokens = result.usage.completionTokens;
          }
          
          // Calculate throughput
          const throughput = output.length > 0 && elapsed > 0 ? 
            Math.round((output.length / elapsed) * 100) / 100 : 0;
          span.attributes.throughput = throughput;
          
          span.setIO(input, String(output));
        }
        // For streamText and similar streaming functions
        else if ('textStream' in result || 'fullStream' in result) {
          // Return a wrapped result that traces streaming
          return wrapStreamingResult(result, span, input, startTime);
        }
        // For generateObject
        else if ('object' in result) {
          const output = result.object ? JSON.stringify(result.object) : '{}';
          
          if (result.usage) {
            span.attributes.inputTokens = result.usage.promptTokens;
            span.attributes.outputTokens = result.usage.completionTokens;
          }
          
          span.setIO(input, output);
        }
        // For embed
        else if ('embedding' in result || 'embeddings' in result) {
          const embeddingCount = result.embeddings?.length || 1;
          const output = `${embeddingCount} embedding(s) generated`;
          
          if (result.usage) {
            span.attributes.inputTokens = result.usage.promptTokens;
          }
          
          span.setIO(input, output);
        }
        // For other results
        else {
          span.setIO(input, JSON.stringify(result));
        }
      } else {
        // If result is not an object, convert to string
        span.setIO(input, String(result || ''));
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
  } as T;

  // Mark as wrapped
  (wrappedFn as WrappedVercelAI<T>).__zeroeval_wrapped = true;
  
  // Preserve function name and properties
  Object.defineProperty(wrappedFn, 'name', { value: fn.name });
  Object.setPrototypeOf(wrappedFn, Object.getPrototypeOf(fn));
  
  return wrappedFn as WrappedVercelAI<T>;
}

/**
 * Wraps a streaming result to trace chunks
 */
function wrapStreamingResult(result: any, span: any, input: string, startTime: number): any {
  // Create a proxy to intercept stream access
  return new Proxy(result, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Wrap the text stream
      if (prop === 'textStream' && value && typeof value[Symbol.asyncIterator] === 'function') {
        return wrapAsyncIterator(value, span, input, startTime, 'text');
      }
      
      // Wrap the full stream
      if (prop === 'fullStream' && value && typeof value[Symbol.asyncIterator] === 'function') {
        return wrapAsyncIterator(value, span, input, startTime, 'full');
      }
      
      // Wrap toDataStreamResponse
      if (prop === 'toDataStreamResponse' && typeof value === 'function') {
        return async function(...args: any[]) {
          const response = await value.apply(target, args);
          // End span when response is created
          tracer.endSpan(span);
          return response;
        };
      }
      
      // Wrap toDataStream
      if (prop === 'toDataStream' && typeof value === 'function') {
        return async function(...args: any[]) {
          const stream = await value.apply(target, args);
          // End span when stream is created
          tracer.endSpan(span);
          return stream;
        };
      }
      
      return value;
    }
  });
}

/**
 * Wraps an async iterator to trace streaming chunks
 */
async function* wrapAsyncIterator(
  iterator: AsyncIterable<any>,
  span: any,
  input: string,
  startTime: number,
  streamType: 'text' | 'full'
): AsyncIterable<any> {
  let fullText = '';
  let chunkCount = 0;
  let tokenCount = 0;
  let firstTokenTime: number | null = null;
  
  try {
    for await (const chunk of iterator) {
      chunkCount++;
      
      // Track time to first token for streaming
      if (firstTokenTime === null && (
        (streamType === 'text' && chunk) || 
        (streamType === 'full' && (chunk.type === 'text-delta' || chunk.type === 'text'))
      )) {
        firstTokenTime = Date.now() / 1000;
        // Time to first token (latency)
        span.attributes.latency = Math.round((firstTokenTime - startTime) * 10000) / 10000;
      }
      
      // Extract text from different chunk types
      if (streamType === 'text' && typeof chunk === 'string') {
        fullText += chunk;
      } else if (streamType === 'full' && chunk) {
        if (chunk.type === 'text-delta' && chunk.textDelta) {
          fullText += chunk.textDelta;
        } else if (chunk.type === 'text' && chunk.text) {
          fullText += chunk.text;
        }
        
        // Track token usage from chunks
        if (chunk.usage) {
          tokenCount = chunk.usage.completionTokens || tokenCount;
          if (chunk.usage.promptTokens) {
            span.attributes.inputTokens = chunk.usage.promptTokens;
          }
        }
      }
      
      yield chunk;
    }
    
    // Calculate final metrics
    const elapsed = Date.now() / 1000 - startTime;
    const throughput = fullText.length > 0 && elapsed > 0 ? 
      Math.round((fullText.length / elapsed) * 100) / 100 : 0;
    
    span.attributes.throughput = throughput;
    span.attributes.chunkCount = chunkCount;
    if (tokenCount > 0) {
      span.attributes.outputTokens = tokenCount;
    }
    
    // Ensure output is always a string
    span.setIO(input, fullText || '');
    tracer.endSpan(span);
  } catch (error: any) {
    span.setError({
      code: error?.name || 'StreamError',
      message: error?.message || 'An error occurred during streaming',
      stack: error?.stack,
    });
    tracer.endSpan(span);
    throw error;
  }
}

/**
 * Wraps Vercel AI SDK exports to automatically trace all API calls.
 * This wrapper supports the main AI SDK functions like generateText, streamText,
 * generateObject, and embed.
 * 
 * @param aiModule - The Vercel AI SDK module exports
 * @returns A wrapped module with automatic tracing
 * 
 * @example
 * ```ts
 * import * as ai from 'ai';
 * import * as ze from '@zeroeval/sdk';
 * 
 * // Wrap the entire AI SDK module
 * const wrappedAI = ze.wrapVercelAI(ai);
 * 
 * // Use the wrapped functions - all calls will be traced
 * const { text } = await wrappedAI.generateText({
 *   model: openai('gpt-4'),
 *   prompt: 'Hello!'
 * });
 * ```
 */
export function wrapVercelAI<T extends Record<string, any>>(aiModule: T): WrappedVercelAI<T> {
  // Check if already wrapped
  if ((aiModule as WrappedVercelAI<T>).__zeroeval_wrapped) {
    return aiModule as WrappedVercelAI<T>;
  }

  // List of functions we want to wrap
  const functionsToWrap = [
    'generateText',
    'streamText',
    'generateObject',
    'streamObject',
    'embed',
    'embedMany',
    'generateImage',
    'transcribe',
    'generateSpeech',
  ];

  // Create a new object with wrapped functions
  const wrappedModule: any = {};
  
  for (const key in aiModule) {
    const value = aiModule[key];
    
    if (functionsToWrap.includes(key) && typeof value === 'function') {
      // Wrap the function
      wrappedModule[key] = wrapVercelAIFunction(value, key);
    } else {
      // Copy other properties as-is
      wrappedModule[key] = value;
    }
  }
  
  // Mark the module as wrapped
  wrappedModule.__zeroeval_wrapped = true;
  
  // Set the prototype to maintain instanceof checks
  Object.setPrototypeOf(wrappedModule, Object.getPrototypeOf(aiModule));
  
  return wrappedModule as WrappedVercelAI<T>;
} 