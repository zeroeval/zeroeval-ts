import {
  BaseCallbackHandler,
  BaseCallbackHandlerInput,
} from '@langchain/core/callbacks/base';
import { AgentAction, AgentFinish } from '@langchain/core/dist/agents';
import { DocumentInterface } from '@langchain/core/dist/documents/document';
import { Serialized } from '@langchain/core/dist/load/serializable';
import { BaseMessage } from '@langchain/core/dist/messages/base';
import {
  ChatGeneration,
  ChatResult,
  Generation,
  LLMResult,
} from '@langchain/core/dist/outputs';
import { ChainValues } from '@langchain/core/dist/utils/types';
import { ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { tracer } from '../../Tracer';
import { Span } from '../../Span';

export interface ZeroEvalCallbackHandlerOptions {
  debug?: boolean;
  excludeMetadataProps?: RegExp;
  maxConcurrentSpans?: number;
  spanCleanupIntervalMs?: number;
}

class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;
  private maxSize: number;

  constructor(factory: () => T, reset: (obj: T) => void, maxSize = 100) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }

  acquire(): T {
    return this.pool.pop() || this.factory();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
  }
}

class LazySerializer {
  private value: unknown;
  private serialized?: string;

  constructor(value: unknown) {
    this.value = value;
  }

  toString(): string {
    if (!this.serialized) {
      this.serialized =
        typeof this.value === 'string'
          ? this.value
          : JSON.stringify(this.value);
    }
    return this.serialized;
  }
}

export class ZeroEvalCallbackHandler
  extends BaseCallbackHandler
  implements BaseCallbackHandlerInput
{
  name = 'ZeroEvalCallbackHandler';
  private spans: Map<string, Span>;
  private rootRunId?: string;
  private options: Required<ZeroEvalCallbackHandlerOptions>;

  private metadataPool: ObjectPool<Record<string, unknown>>;
  private cleanupTimer?: NodeJS.Timeout;
  private spanStartTimes: Map<string, number>;
  private cachedRegex: RegExp;

  private static readonly chooseFirst = (...values: unknown[]) => {
    for (const value of values) {
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  };

  constructor(options?: ZeroEvalCallbackHandlerOptions) {
    super();

    this.spans = new Map();
    this.spanStartTimes = new Map();

    this.options = {
      debug: options?.debug ?? false,
      excludeMetadataProps:
        options?.excludeMetadataProps ??
        /^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)/,
      maxConcurrentSpans: options?.maxConcurrentSpans ?? 1000,
      spanCleanupIntervalMs: options?.spanCleanupIntervalMs ?? 60000,
    };

    this.cachedRegex = this.options.excludeMetadataProps;

    this.metadataPool = new ObjectPool<Record<string, unknown>>(
      () => ({}) as Record<string, unknown>,
      (obj) => {
        Object.keys(obj).forEach((key) => delete obj[key]);
      }
    );

    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOrphanedSpans();
    }, this.options.spanCleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  private cleanupOrphanedSpans(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;

    for (const [runId, startTime] of this.spanStartTimes) {
      if (now - startTime > maxAge) {
        const span = this.spans.get(runId);
        if (span) {
          span.setError({
            message: 'Span orphaned - auto-cleaned after timeout',
          });
          tracer.endSpan(span);
        }
        this.spans.delete(runId);
        this.spanStartTimes.delete(runId);
      }
    }
  }

  protected startSpan({
    runId,
    parentRunId,
    name,
    type,
    input,
    tags,
    metadata,
  }: {
    runId: string;
    parentRunId?: string;
    name: string;
    type?: string;
    input?: unknown;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    if (this.spans.has(runId)) {
      if (this.options.debug) {
        console.warn(`Span already exists for runId ${runId}`);
      }
      return;
    }

    if (this.spans.size >= this.options.maxConcurrentSpans) {
      console.warn(
        `Max concurrent spans (${this.options.maxConcurrentSpans}) reached`
      );
      return;
    }

    if (!parentRunId) {
      this.rootRunId = runId;
    }

    const attributes = this.metadataPool.acquire();
    if (type) attributes.type = type;
    if (tags) attributes.tags = tags;

    if (type === 'llm') {
      attributes.kind = 'llm';

      if (attributes.provider === undefined) {
        attributes.provider = 'openai';
      }

      if (attributes['service.name'] === undefined) {
        attributes['service.name'] = attributes.provider;
      }
    }

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (!this.cachedRegex.test(key)) {
          attributes[key] = value;
        }
      }
    }

    if (this.options.debug) {
      attributes.runId = runId;
      attributes.parentRunId = parentRunId;
    }

    const spanTags: Record<string, string> = { integration: 'langchain' };
    if (type) spanTags[`langchain.${type}`] = 'true';

    const span = tracer.startSpan(name, {
      attributes,
      tags: spanTags,
    });

    if (input !== undefined) {
      const lazyInput = new LazySerializer(input);
      span.setIO(lazyInput.toString(), undefined);
    }

    this.spans.set(runId, span);
    this.spanStartTimes.set(runId, Date.now());

    this.metadataPool.release(attributes);
  }

  protected endSpan({
    runId,
    output,
    error,
    tags,
    metadata,
  }: {
    runId: string;
    output?: unknown;
    error?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): void {
    const span = this.spans.get(runId);
    if (!span) {
      if (this.options.debug) {
        console.warn(`No span exists for runId ${runId}`);
      }
      return;
    }

    this.spans.delete(runId);
    this.spanStartTimes.delete(runId);

    if (runId === this.rootRunId) {
      this.rootRunId = undefined;
    }

    if (output !== undefined) {
      const lazyOutput = new LazySerializer(output);
      span.setIO(span.inputData, lazyOutput.toString());
    }

    if (error) {
      span.setError({ message: error });
    }

    if (tags || metadata) {
      const additionalAttrs = this.metadataPool.acquire();
      if (tags) additionalAttrs.tags = tags;

      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          if (!this.cachedRegex.test(key)) {
            additionalAttrs[key] = value;
          }
        }
      }

      Object.assign(span.attributes, additionalAttrs);
      this.metadataPool.release(additionalAttrs);
    }

    // End the span to get duration, then calculate throughput
    span.end();

    // Calculate throughput after ending the span when we have the duration
    if (
      span.attributes.outputTokens &&
      span.durationMs &&
      span.durationMs > 0
    ) {
      const outputTokens = span.attributes.outputTokens as number;
      // Calculate tokens per second
      span.attributes.throughput =
        Math.round((outputTokens / (span.durationMs / 1000)) * 100) / 100;
    }

    tracer.endSpan(span);
  }

  private beginTracerSegment({
    runId,
    parentRunId,
    type,
    name,
    input,
    tags,
    metadata,
  }: {
    runId: string;
    parentRunId?: string;
    type: string;
    name: string;
    input: unknown;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    this.startSpan({
      runId,
      parentRunId,
      name,
      type,
      input,
      tags,
      metadata,
    });
  }

  private finishTracerSegment({
    runId,
    output,
    error,
    tags,
    metadata,
  }: {
    runId: string;
    output?: unknown;
    error?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    this.endSpan({ runId, output, error, tags, metadata });
  }

  private deriveComponentName(serialized: Serialized, fallback: string) {
    const lastId = serialized.id[serialized.id.length - 1];
    return lastId?.toString() ?? fallback;
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: {
      options: RunnableConfig;
      invocation_params?: Record<string, unknown>;
      batch_size: number;
      cache?: boolean;
    },
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): Promise<void> {
    const normalizedMetadata = metadata ? this.metadataPool.acquire() : {};

    if (metadata) Object.assign(normalizedMetadata, metadata);

    const invocationParams = extraParams?.invocation_params || {};
    const callParams = this.normalizeCallParamsOptimized(
      llm,
      invocationParams,
      metadata
    );
    Object.assign(normalizedMetadata, callParams);

    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'llm',
      name: runName ?? this.deriveComponentName(llm, 'LLM'),
      input: prompts,
      tags,
      metadata: normalizedMetadata,
    });

    if (metadata) this.metadataPool.release(normalizedMetadata);
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, error: err.message, tags });
    }
  }

  async handleLLMEnd(
    output: LLMResult | ChatResult,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    const span = this.spans.get(runId);
    if (!span) return;

    const { llmOutput, generations, ...metadata } = output;
    const tokenUsage =
      llmOutput?.tokenUsage || llmOutput?.estimatedTokens || {};

    if (
      tokenUsage.totalTokens ||
      tokenUsage.promptTokens ||
      tokenUsage.completionTokens
    ) {
      // Set tokens in the format expected by the UI
      if (tokenUsage.promptTokens) {
        span.attributes.inputTokens = tokenUsage.promptTokens;
      }
      if (tokenUsage.completionTokens) {
        span.attributes.outputTokens = tokenUsage.completionTokens;
      }

      // Also keep the metrics for backward compatibility
      if (!span.attributes.metrics) {
        span.attributes.metrics = {};
      }
      const metrics = span.attributes.metrics as Record<string, unknown>;
      if (tokenUsage.totalTokens) metrics.tokens = tokenUsage.totalTokens;
      if (tokenUsage.promptTokens)
        metrics.prompt_tokens = tokenUsage.promptTokens;
      if (tokenUsage.completionTokens)
        metrics.completion_tokens = tokenUsage.completionTokens;
    }

    this.finishTracerSegment({
      runId,
      output: this.flattenGenerationsOptimized(generations),
      tags,
      metadata,
    });
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: {
      options: RunnableConfig;
      invocation_params?: Record<string, unknown>;
      batch_size: number;
      cache?: boolean;
    },
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): Promise<void> {
    const normalizedMetadata = this.metadataPool.acquire();

    if (metadata) Object.assign(normalizedMetadata, metadata);

    const invocationParams = extraParams?.invocation_params || {};
    const callParams = this.normalizeCallParamsOptimized(
      llm,
      invocationParams,
      metadata
    );
    Object.assign(normalizedMetadata, callParams);

    if (invocationParams.tools) {
      normalizedMetadata.tools = invocationParams.tools;
    }

    // Add messages to metadata for LLM spans to match OpenAI wrapper
    const flattenedMessages = this.flattenMessagesInputOptimized(messages);
    normalizedMetadata.messages = flattenedMessages;

    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'llm',
      name: runName ?? this.deriveComponentName(llm, 'Chat Model'),
      input: this.flattenMessagesInputOptimized(messages),
      tags,
      metadata: normalizedMetadata,
    });

    this.metadataPool.release(normalizedMetadata);
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string
  ): Promise<void> {
    if (tags?.includes('langsmith:hidden')) {
      return;
    }

    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'chain',
      name: runName ?? this.deriveComponentName(chain, 'Chain'),
      input: this.normalizeChainInputsOptimized(inputs),
      tags,
      metadata: {
        ...metadata,
        ...this.normalizeCallParamsOptimized(chain, {}, metadata),
      },
    });
  }

  async handleChainError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: {
      inputs?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, error: err.toString(), tags });
    }
  }

  async handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> }
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({
        runId,
        tags,
        output: this.normalizeChainOutputsOptimized(outputs),
      });
    }
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): Promise<void> {
    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'tool',
      name: runName ?? this.deriveComponentName(tool, 'Tool'),
      input: this.parseMaybeJsonOptimized(input),
      tags,
      metadata: {
        ...metadata,
        ...this.normalizeCallParamsOptimized(tool, {}, metadata),
      },
    });
  }

  async handleToolError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, error: err.message, tags });
    }
  }

  async handleToolEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({
        runId,
        output: this.normalizeToolOutputOptimized(output),
        tags,
      });
    }
  }

  async handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'agent',
      name: action.tool,
      input: action,
      tags,
    });
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, output: action, tags });
    }
  }

  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): Promise<void> {
    this.beginTracerSegment({
      runId,
      parentRunId,
      type: 'retriever',
      name: name ?? this.deriveComponentName(retriever, 'Retriever'),
      input: query,
      tags,
      metadata: {
        ...metadata,
        ...this.normalizeCallParamsOptimized(retriever, {}, metadata),
      },
    });
  }

  async handleRetrieverEnd(
    documents: DocumentInterface[],
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, output: documents, tags });
    }
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.finishTracerSegment({ runId, error: err.message, tags });
    }
  }

  // Optimized helper functions
  private normalizeCallParamsOptimized(
    llm: Serialized,
    invocationParams: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): Record<string, unknown> {
    const args = this.metadataPool.acquire();

    const model = ZeroEvalCallbackHandler.chooseFirst(
      invocationParams?.model,
      metadata?.ls_model_name,
      llm.name
    );
    if (model !== undefined) args.model = model;

    const temperature = ZeroEvalCallbackHandler.chooseFirst(
      invocationParams?.temperature,
      metadata?.ls_temperature
    );
    if (temperature !== undefined) args.temperature = temperature;

    const params: [string, unknown][] = [
      ['top_p', invocationParams?.top_p ?? invocationParams?.topP],
      ['top_k', invocationParams?.top_k ?? invocationParams?.topK],
      [
        'max_tokens',
        invocationParams?.max_tokens ?? invocationParams?.maxOutputTokens,
      ],
      ['frequency_penalty', invocationParams?.frequency_penalty],
      ['presence_penalty', invocationParams?.presence_penalty],
      ['response_format', invocationParams?.response_format],
      ['tool_choice', invocationParams?.tool_choice],
      ['function_call', invocationParams?.function_call],
      ['n', invocationParams?.n],
      ['stop', invocationParams?.stop ?? invocationParams?.stop_sequence],
    ];

    for (const [key, value] of params) {
      if (value !== undefined && value !== null) {
        args[key] = value;
      }
    }

    const result = Object.keys(args).length ? { ...args } : invocationParams;
    this.metadataPool.release(args);
    return result;
  }

  private flattenGenerationsOptimized(
    generations: Generation[][] | ChatGeneration[]
  ): unknown[] {
    const result: unknown[] = [];

    for (const batch of generations) {
      if (Array.isArray(batch)) {
        for (const gen of batch) {
          const parsed = this.parseGenOptimized(gen);
          if (parsed !== undefined) result.push(parsed);
        }
      } else {
        const parsed = this.parseGenOptimized(batch);
        if (parsed !== undefined) result.push(parsed);
      }
    }

    return result;
  }

  private parseGenOptimized(generation: Generation | ChatGeneration): unknown {
    if ('message' in generation) {
      return this.extractMessageContentOptimized(generation.message);
    }
    return generation.text;
  }

  private flattenMessagesInputOptimized(messages: BaseMessage[][]): unknown[] {
    const result: unknown[] = [];

    for (const batch of messages) {
      for (const message of batch) {
        result.push(this.extractMessageContentOptimized(message));
      }
    }

    return result;
  }

  private extractMessageContentOptimized(
    message: BaseMessage
  ): Record<string, unknown> {
    const result = this.metadataPool.acquire();

    result.content = message.content;

    const messageType = message._getType();
    let role = message.name ?? messageType;

    if (messageType === 'human') role = 'user';
    else if (messageType === 'ai') role = 'assistant';
    else if (messageType === 'system') role = 'system';

    result.role = role;

    const anyMessage = message as any;
    if (anyMessage.tool_calls) result.tool_calls = anyMessage.tool_calls;
    if (anyMessage.status) result.status = anyMessage.status;
    if (anyMessage.artifact) result.artifact = anyMessage.artifact;

    const copy = { ...result };
    this.metadataPool.release(result);

    return copy;
  }

  private parseMaybeJsonOptimized(input: string): unknown {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }

  private normalizeToolOutputOptimized(output: unknown | ToolMessage): unknown {
    return output instanceof ToolMessage
      ? this.extractMessageContentOptimized(output)
      : output;
  }

  private normalizeChainOutputsOptimized(output: unknown): unknown {
    const parsed = (Array.isArray(output) ? output : [output]).map((item) =>
      this.parseChainElementOptimized(item)
    );
    return parsed.length === 1 ? parsed[0] : parsed;
  }

  private normalizeChainInputsOptimized(inputs: ChainValues): unknown {
    const parsed = (Array.isArray(inputs) ? inputs : [inputs]).map((item) =>
      this.parseChainElementOptimized(item)
    );
    return parsed.length === 1 ? parsed[0] : parsed;
  }

  private parseChainElementOptimized(output: any): any {
    if (typeof output === 'string') {
      return output;
    }

    if (!output) {
      return output;
    }

    if (output.content) {
      return output.content;
    }

    if (output.messages) {
      return output.messages.map((msg: any) =>
        this.parseChainElementOptimized(msg)
      );
    }

    if (output.value) {
      return output.value;
    }

    if (output.kwargs) {
      return this.parseChainElementOptimized(output.kwargs);
    }

    if (typeof output === 'object' && output) {
      const result = this.metadataPool.acquire();
      for (const [key, value] of Object.entries(output)) {
        result[key] = this.parseChainElementOptimized(value);
      }
      const copy = { ...result };
      this.metadataPool.release(result);
      return copy;
    }

    return output;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    for (const span of this.spans.values()) {
      span.setError({ message: 'Handler destroyed with active span' });
      tracer.endSpan(span);
    }

    this.spans.clear();
    this.spanStartTimes.clear();
  }
}
