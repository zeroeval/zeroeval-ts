import { BaseCallbackHandler, BaseCallbackHandlerInput } from "@langchain/core/callbacks/base";
import { AgentAction, AgentFinish } from "@langchain/core/dist/agents";
import { DocumentInterface } from "@langchain/core/dist/documents/document";
import { Serialized } from "@langchain/core/dist/load/serializable";
import { BaseMessage } from "@langchain/core/dist/messages/base";
import {
  ChatGeneration,
  ChatResult,
  Generation,
  LLMResult,
} from "@langchain/core/dist/outputs";
import { ChainValues } from "@langchain/core/dist/utils/types";
import { ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tracer } from "../../Tracer";
import { Span } from "../../Span";

/**
 * A ZeroEval tracer for LangChain.js that logs LLM calls, chains, and tools.
 */
export interface ZeroEvalCallbackHandlerOptions {
  debug?: boolean;
  excludeMetadataProps?: RegExp;
  sessionId?: string;
  sessionName?: string;
}

export class ZeroEvalCallbackHandler
  extends BaseCallbackHandler
  implements BaseCallbackHandlerInput
{
  name = "ZeroEvalCallbackHandler";
  private spans: Map<string, Span>;
  private rootRunId?: string;
  private options: ZeroEvalCallbackHandlerOptions;

  constructor(options?: ZeroEvalCallbackHandlerOptions) {
    super();

    this.spans = new Map();

    this.options = {
      debug: options?.debug ?? false,
      excludeMetadataProps:
        options?.excludeMetadataProps ??
        /^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)/,
      sessionId: options?.sessionId,
      sessionName: options?.sessionName,
    };
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
      console.warn(
        `Span already exists for runId ${runId} (this is likely a bug)`,
      );
      return;
    }

    if (!parentRunId) {
      this.rootRunId = runId;
    }

    const parentSpan = parentRunId ? this.spans.get(parentRunId) : undefined;
    
    const span = tracer.startSpan(name, {
      attributes: {
        type,
        ...(tags ? { tags } : {}),
        ...this.cleanMetadata(metadata),
        ...(this.options.debug ? { runId, parentRunId } : {}),
      },
      sessionId: this.options.sessionId,
      sessionName: this.options.sessionName,
      tags: {
        integration: "langchain",
        ...(type ? { [`langchain.${type}`]: "true" } : {}),
      },
    });

    if (input !== undefined) {
      span.setIO(JSON.stringify(input), undefined);
    }

    this.spans.set(runId, span);
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
    if (!this.spans.has(runId)) {
      throw new Error(
        `No span exists for runId ${runId} (this is likely a bug)`,
      );
    }

    const span = this.spans.get(runId)!;

    this.spans.delete(runId);
    if (runId === this.rootRunId) {
      this.rootRunId = undefined;
    }

    if (output !== undefined) {
      const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
      span.setIO(span.inputData as string, outputStr);
    }

    if (error) {
      span.setError({ message: error });
    }

    if (tags || metadata) {
      Object.assign(span.attributes, {
        ...(tags ? { tags } : {}),
        ...this.cleanMetadata(metadata),
      });
    }

    tracer.endSpan(span);
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
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? llm.id.at(-1)?.toString() ?? "LLM",
      type: "llm",
      input: JSON.stringify(prompts),
      tags,
      metadata: {
        ...metadata,
        ...extractCallArgs(
          llm,
          extraParams?.invocation_params || {},
          metadata,
        ),
      },
    });
  }

  cleanMetadata(metadata?: Record<string, unknown>) {
    return (
      metadata &&
      Object.fromEntries(
        Object.entries(metadata).filter(
          ([key, _]) => !this.options.excludeMetadataProps?.test(key),
        ),
      )
    );
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.message,
        tags,
      });
    }
  }

  async handleLLMEnd(
    output: LLMResult | ChatResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      const { llmOutput, generations, ...metadata } = output;

      const tokenUsage =
        llmOutput?.tokenUsage || llmOutput?.estimatedTokens || {};

      const span = this.spans.get(runId)!;
      
      // Add token metrics to span attributes
      if (tokenUsage.totalTokens || tokenUsage.promptTokens || tokenUsage.completionTokens) {
        span.attributes.metrics = {
          tokens: tokenUsage.totalTokens,
          prompt_tokens: tokenUsage.promptTokens,
          completion_tokens: tokenUsage.completionTokens,
        };
      }

      this.endSpan({
        runId,
        output: JSON.stringify(outputFromGenerations(generations)),
        tags,
        metadata: this.cleanMetadata(metadata),
      });
    }
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
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? llm.id.at(-1)?.toString() ?? "Chat Model",
      type: "llm",
      input: JSON.stringify(inputFromMessages(messages)),
      tags,
      metadata: {
        ...metadata,
        ...extractCallArgs(
          llm,
          extraParams?.invocation_params || {},
          metadata,
        ),
        tools: extraParams?.invocation_params?.tools,
      },
    });
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string,
  ): Promise<void> {
    if (tags?.includes("langsmith:hidden")) {
      return;
    }

    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? chain.id.at(-1)?.toString() ?? "Chain",
      type: "chain",
      input: JSON.stringify(inputFromChainValues(inputs)),
      tags,
      metadata: {
        ...metadata,
        ...extractCallArgs(chain, {}, metadata),
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
    },
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.toString(),
        tags,
      });
    }
  }

  async handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> },
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        tags,
        output: JSON.stringify(outputFromChainValues(outputs)),
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
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? tool.id.at(-1)?.toString() ?? "Tool",
      type: "tool",
      input: JSON.stringify(safeParseSerializedJson(input)),
      tags,
      metadata: {
        ...metadata,
        ...extractCallArgs(tool, {}, metadata),
      },
    });
  }

  async handleToolError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.message,
        tags,
      });
    }
  }

  async handleToolEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: JSON.stringify(outputFromToolOutput(output)),
        tags,
      });
    }
  }

  async handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: action.tool,
      type: "agent",
      input: JSON.stringify(action),
      tags,
    });
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: JSON.stringify(action),
        tags,
      });
    }
  }

  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: name ?? retriever.id.at(-1)?.toString() ?? "Retriever",
      type: "retriever",
      input: JSON.stringify(query),
      tags,
      metadata: {
        ...metadata,
        ...extractCallArgs(retriever, {}, metadata),
      },
    });
  }

  async handleRetrieverEnd(
    documents: DocumentInterface[],
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: JSON.stringify(documents),
        tags,
      });
    }
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.message,
        tags,
      });
    }
  }
}

// Helper functions
const extractCallArgs = (
  llm: Serialized,
  invocationParams: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Record<string, unknown> => {
  const args = cleanObject({
    model: pick(invocationParams?.model, metadata?.ls_model_name, llm.name),
    temperature: pick(invocationParams?.temperature, metadata?.ls_temperature),
    top_p: pick(invocationParams?.top_p, invocationParams?.topP),
    top_k: pick(invocationParams?.top_k, invocationParams?.topK),
    max_tokens: pick(
      invocationParams?.max_tokens,
      invocationParams?.maxOutputTokens,
    ),
    frequency_penalty: invocationParams?.frequency_penalty,
    presence_penalty: invocationParams?.presence_penalty,
    response_format: invocationParams?.response_format,
    tool_choice: invocationParams?.tool_choice,
    function_call: invocationParams?.function_call,
    n: invocationParams?.n,
    stop: pick(invocationParams?.stop, invocationParams?.stop_sequence),
  });

  return !Object.keys(args).length ? invocationParams : args;
};

const pick = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null);

const outputFromGenerations = (
  generations: Generation[][] | ChatGeneration[],
) => {
  const parsed = generations.flatMap((batch) => {
    return Array.isArray(batch)
      ? batch.map(parseGeneration)
      : parseGeneration(batch);
  });

  return parsed;
};

const parseGeneration = (generation: Generation | ChatGeneration) => {
  if ("message" in generation) {
    return getMessageContent(generation.message);
  }

  if (generation.text) {
    return generation.text;
  }
};

const inputFromMessages = (messages: BaseMessage[][]) => {
  const parsed = messages.flatMap((batch) => batch.map(getMessageContent));
  return parsed;
};

const getMessageContent = (message: BaseMessage) => {
  let role = message.name ?? message._getType();

  if (message._getType() === "human") {
    role = "user";
  } else if (message._getType() === "ai") {
    role = "assistant";
  } else if (message._getType() === "system") {
    role = "system";
  }

  return cleanObject({
    content: message.content,
    role,
    // @ts-expect-error Message may be any BaseMessage concrete implementation
    tool_calls: message.tool_calls,
    // @ts-expect-error Message may be any ToolMessage
    status: message.status,
    // @ts-expect-error Message may be any ToolMessage
    artifact: message.artifact,
  });
};

const cleanObject = (obj: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) {
        return false;
      }
      return true;
    }),
  );

const safeParseSerializedJson = (input: string) => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

const outputFromToolOutput = (output: unknown | ToolMessage) =>
  output instanceof ToolMessage ? getMessageContent(output) : output;

const outputFromChainValues = (output: unknown) => {
  const parsed = (Array.isArray(output) ? output : [output]).flatMap(
    parseChainValue,
  );
  return parsed.length === 1 ? parsed[0] : parsed;
};

const parseChainValue = (output: any): any => {
  if (typeof output === "string") {
    return output;
  }

  if (!output) {
    return output;
  }

  if (output.content) {
    return output.content;
  }

  if (output.messages) {
    return output.messages.map(parseChainValue);
  }

  if (output.value) {
    return output.value;
  }

  if (output.kwargs) {
    return parseChainValue(output.kwargs);
  }

  if (typeof output === "object" && output) {
    return Object.fromEntries(
      Object.entries(output).map(([key, value]) => [
        key,
        parseChainValue(value),
      ]),
    );
  }

  return output;
};

const inputFromChainValues = (inputs: ChainValues) => {
  const parsed = (Array.isArray(inputs) ? inputs : [inputs]).flatMap(
    parseChainValue,
  );
  return parsed.length === 1 ? parsed[0] : parsed;
}; 