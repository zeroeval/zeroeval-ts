import { tracer } from '../Tracer';
import { init, isInitialized } from '../../init';

// ---------------------------------------------------------------------------
// Internal types mirroring the published @anthropic-ai/claude-agent-sdk surface.
// We avoid importing the real package so the wrapper compiles without it.
// ---------------------------------------------------------------------------

interface SDKResultSuccess {
  type: 'result';
  subtype: 'success';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  permission_denials?: Array<{ tool_name: string; tool_use_id: string }>;
  terminal_reason?: string;
  uuid: string;
  session_id: string;
}

interface SDKResultError {
  type: 'result';
  subtype: string;
  is_error: boolean;
  duration_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  uuid: string;
  session_id: string;
  [key: string]: unknown;
}

type SDKResultMessage = SDKResultSuccess | SDKResultError;

interface SDKAssistantMessage {
  type: 'assistant';
  message: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}

interface SDKPartialAssistantMessage {
  type: 'stream_event';
  event: Record<string, unknown>;
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}

interface SDKRateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info: {
    status: string;
    rateLimitType?: string;
    utilization?: number;
  };
  uuid: string;
  session_id: string;
}

interface SDKSystemMessage {
  type: 'system';
  subtype: string;
  session_id?: string;
  [key: string]: unknown;
}

interface SDKUserMessage {
  type: 'user';
  message: unknown;
  session_id?: string;
  [key: string]: unknown;
}

interface SDKToolUseSummaryMessage {
  type: 'tool_use_summary';
  [key: string]: unknown;
}

interface GenericSDKMessage {
  type: string;
  session_id?: string;
  [key: string]: unknown;
}

type SDKMessage =
  | SDKResultMessage
  | SDKAssistantMessage
  | SDKPartialAssistantMessage
  | SDKRateLimitEvent
  | SDKSystemMessage
  | SDKUserMessage
  | SDKToolUseSummaryMessage
  | GenericSDKMessage;

// ---------------------------------------------------------------------------
// Callback types mirroring the SDK's CanUseTool / HookCallback
// ---------------------------------------------------------------------------

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>
) => Promise<{ behavior?: string; [key: string]: unknown }>;

type HookCallback = (
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  options: Record<string, unknown>
) => Promise<Record<string, unknown>>;

interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

interface ClaudeAgentOptions {
  canUseTool?: CanUseTool;
  hooks?: Record<string, HookCallbackMatcher[]>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Query function shape
// ---------------------------------------------------------------------------

type QueryParams = {
  prompt: string | AsyncIterable<unknown>;
  options?: ClaudeAgentOptions;
};

interface QueryReturn extends AsyncGenerator<SDKMessage, void> {
  [key: string]: unknown;
}

type QueryFn = (params: QueryParams) => QueryReturn;

// ---------------------------------------------------------------------------
// Session types (unstable v2)
// ---------------------------------------------------------------------------

interface SDKSession {
  readonly sessionId: string;
  send(message: string | Record<string, unknown>): Promise<void>;
  stream(): AsyncGenerator<SDKMessage, void>;
  close(): void;
  [Symbol.asyncDispose]?(): Promise<void>;
}

type CreateSessionFn = (options: Record<string, unknown>) => SDKSession;
type ResumeSessionFn = (
  sessionId: string,
  options: Record<string, unknown>
) => SDKSession;

// ---------------------------------------------------------------------------
// Claude Agent SDK module shape
// ---------------------------------------------------------------------------

interface ClaudeAgentSdkModule {
  query: QueryFn;
  unstable_v2_createSession?: CreateSessionFn;
  unstable_v2_resumeSession?: ResumeSessionFn;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Wrapped module type
// ---------------------------------------------------------------------------

type WrappedClaudeAgentSdk<T> = T & {
  __zeroeval_wrapped?: boolean;
};

// ---------------------------------------------------------------------------
// TurnState – accumulates telemetry for a single Claude agent turn
// ---------------------------------------------------------------------------

class TurnState {
  promptSummary = '';
  claudeSessionId: string | null = null;
  assistantText = '';
  toolUses: Array<{ name: string; id?: string }> = [];
  streamEventCount = 0;
  rateLimitEvents: Array<{
    status: string;
    type?: string;
    utilization?: number;
  }> = [];
  permissionDecisions: Array<{
    toolName: string;
    behavior: string;
    toolUseID?: string;
    agentID?: string;
  }> = [];
  hookEvents: Array<{
    eventName?: string;
    toolName?: string;
  }> = [];
  resultMeta: Record<string, unknown> = {};
}

// ---------------------------------------------------------------------------
// Pending turn tracker for session-based multi-turn tracing
// ---------------------------------------------------------------------------

class PendingTurnState {
  private turns: Array<{
    span: ReturnType<typeof tracer.startSpan>;
    state: TurnState;
  }> = [];

  push(span: ReturnType<typeof tracer.startSpan>, state: TurnState): void {
    this.turns.push({ span, state });
  }

  peek():
    | { span: ReturnType<typeof tracer.startSpan>; state: TurnState }
    | undefined {
    return this.turns[0];
  }

  pop():
    | { span: ReturnType<typeof tracer.startSpan>; state: TurnState }
    | undefined {
    return this.turns.shift();
  }

  closeAll(): void {
    for (const { span, state } of this.turns) {
      try {
        applyStateToSpan(span, state);
        span.attributes.interrupted = true;
        tracer.endSpan(span);
      } catch {
        // best-effort
      }
    }
    this.turns = [];
  }

  get length(): number {
    return this.turns.length;
  }
}

// ---------------------------------------------------------------------------
// Message enrichment
// ---------------------------------------------------------------------------

function summarizePrompt(prompt: unknown): string {
  if (typeof prompt === 'string') {
    return prompt.slice(0, 500);
  }
  return '<async-iterable>';
}

function extractMessageData(message: SDKMessage, state: TurnState): void {
  if (!message || typeof message !== 'object' || !('type' in message)) return;

  const msg = message as SDKMessage;

  switch (msg.type) {
    case 'assistant': {
      const am = msg as SDKAssistantMessage;
      if (am.session_id) state.claudeSessionId = am.session_id;
      if (am.message?.content) {
        for (const block of am.message.content) {
          if (block.type === 'tool_use' && block.name) {
            state.toolUses.push({ name: block.name, id: block.id });
          } else if (block.type === 'text' && block.text) {
            state.assistantText += block.text;
          }
        }
      }
      break;
    }

    case 'stream_event': {
      const se = msg as SDKPartialAssistantMessage;
      state.streamEventCount++;
      if (se.session_id) state.claudeSessionId = se.session_id;
      break;
    }

    case 'rate_limit_event': {
      const rle = msg as SDKRateLimitEvent;
      if (rle.session_id) state.claudeSessionId = rle.session_id;
      if (rle.rate_limit_info) {
        state.rateLimitEvents.push({
          status: rle.rate_limit_info.status,
          type: rle.rate_limit_info.rateLimitType,
          utilization: rle.rate_limit_info.utilization,
        });
      }
      break;
    }

    case 'result': {
      const rm = msg as SDKResultMessage;
      if (rm.session_id) state.claudeSessionId = rm.session_id;
      state.resultMeta = {
        duration_ms: rm.duration_ms,
        total_cost_usd: rm.total_cost_usd,
        num_turns: rm.num_turns,
        is_error: rm.is_error,
      };
      if ('stop_reason' in rm) state.resultMeta.stop_reason = rm.stop_reason;
      if ('usage' in rm) state.resultMeta.usage = rm.usage;
      if ('modelUsage' in rm) state.resultMeta.model_usage = rm.modelUsage;
      if ('terminal_reason' in rm)
        state.resultMeta.terminal_reason = rm.terminal_reason;
      if ('permission_denials' in rm && rm.permission_denials)
        state.resultMeta.permission_denials = rm.permission_denials;
      if (
        'result' in rm &&
        typeof rm.result === 'string' &&
        !state.assistantText
      ) {
        state.assistantText = rm.result;
      }
      break;
    }

    case 'user': {
      const um = msg as SDKUserMessage;
      if (um.session_id) state.claudeSessionId = um.session_id;
      break;
    }

    case 'system': {
      const sm = msg as SDKSystemMessage;
      if (sm.session_id) state.claudeSessionId = sm.session_id;
      break;
    }

    default:
      if (
        'session_id' in msg &&
        typeof msg.session_id === 'string' &&
        msg.session_id
      ) {
        state.claudeSessionId = msg.session_id;
      }
      break;
  }
}

function applyStateToSpan(
  span: ReturnType<typeof tracer.startSpan>,
  state: TurnState
): void {
  const inputSummary = state.promptSummary || '<unknown>';
  const outputSummary = state.assistantText
    ? state.assistantText.slice(0, 2000)
    : '';
  span.setIO(inputSummary, outputSummary);

  if (state.claudeSessionId) {
    span.attributes.claude_session_id = state.claudeSessionId;
    span.sessionId = state.claudeSessionId;
  }
  if (state.toolUses.length > 0) {
    span.attributes.tool_uses = state.toolUses;
  }
  if (state.streamEventCount > 0) {
    span.attributes.stream_event_count = state.streamEventCount;
  }
  if (state.rateLimitEvents.length > 0) {
    span.attributes.rate_limit_events = state.rateLimitEvents;
  }
  if (state.permissionDecisions.length > 0) {
    span.attributes.permission_decisions = state.permissionDecisions;
  }
  if (state.hookEvents.length > 0) {
    span.attributes.hook_events = state.hookEvents;
  }

  for (const [key, value] of Object.entries(state.resultMeta)) {
    if (value !== undefined && value !== null) {
      span.attributes[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Options wrapping (canUseTool / hooks enrichment)
// ---------------------------------------------------------------------------

function wrapCanUseTool(original: CanUseTool, state: TurnState): CanUseTool {
  return async (toolName, input, options) => {
    const result = await original(toolName, input, options);
    try {
      state.permissionDecisions.push({
        toolName,
        behavior: result?.behavior ?? 'unknown',
        toolUseID: (options as Record<string, unknown>).toolUseID as
          | string
          | undefined,
        agentID: (options as Record<string, unknown>).agentID as
          | string
          | undefined,
      });
    } catch {
      // best-effort
    }
    return result;
  };
}

function wrapHookCallback(
  original: HookCallback,
  state: TurnState
): HookCallback {
  return async (input, toolUseID, options) => {
    const result = await original(input, toolUseID, options);
    try {
      state.hookEvents.push({
        eventName: input?.hook_event_name as string | undefined,
        toolName: input?.tool_name as string | undefined,
      });
    } catch {
      // best-effort
    }
    return result;
  };
}

function wrapOptions(
  options: ClaudeAgentOptions | undefined,
  state: TurnState
): ClaudeAgentOptions | undefined {
  if (!options) return options;

  let needsClone = false;
  const overrides: Partial<ClaudeAgentOptions> = {};

  if (options.canUseTool) {
    overrides.canUseTool = wrapCanUseTool(options.canUseTool, state);
    needsClone = true;
  }

  if (options.hooks) {
    const wrappedHooks: Record<string, HookCallbackMatcher[]> = {};
    for (const [event, matchers] of Object.entries(options.hooks)) {
      wrappedHooks[event] = matchers.map((matcher) => ({
        ...matcher,
        hooks: matcher.hooks.map((cb) => wrapHookCallback(cb, state)),
      }));
    }
    overrides.hooks = wrappedHooks;
    needsClone = true;
  }

  if (!needsClone) return options;
  return { ...options, ...overrides };
}

// ---------------------------------------------------------------------------
// Query wrapper
// ---------------------------------------------------------------------------

function createWrappedQuery(originalQuery: QueryFn): QueryFn {
  const wrappedQuery = function wrappedClaudeQuery(
    params: QueryParams
  ): QueryReturn {
    const state = new TurnState();
    state.promptSummary = summarizePrompt(params.prompt);

    const wrappedOptions = wrapOptions(
      params.options as ClaudeAgentOptions | undefined,
      state
    );

    const span = tracer.startSpan('claude_agent.query', {
      attributes: { integration: 'claude_agent_sdk', kind: 'agent' },
      tags: { integration: 'claude_agent_sdk' },
    });

    const originalGen = originalQuery({
      ...params,
      options: wrappedOptions as QueryParams['options'],
    });

    async function* tracedGenerator(): AsyncGenerator<SDKMessage, void> {
      let error: Error | null = null;
      try {
        for await (const message of originalGen) {
          extractMessageData(message, state);
          yield message;
          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            message.type === 'result'
          ) {
            break;
          }
        }
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
        throw err;
      } finally {
        try {
          applyStateToSpan(span, state);
        } catch {
          // best-effort
        }
        if (error) {
          try {
            span.setError({
              code: error.name,
              message: error.message,
              stack: error.stack,
            });
          } catch {
            // best-effort
          }
        }
        try {
          tracer.endSpan(span);
        } catch {
          // best-effort
        }
      }
    }

    return tracedGenerator() as QueryReturn;
  };

  return wrappedQuery;
}

// ---------------------------------------------------------------------------
// Session wrapper (unstable v2)
// ---------------------------------------------------------------------------

function createWrappedSession(session: SDKSession): SDKSession {
  const pending = new PendingTurnState();

  const originalSend = session.send.bind(session);
  const originalStream = session.stream.bind(session);
  const originalClose = session.close.bind(session);

  const wrappedSend = async (
    message: string | Record<string, unknown>
  ): Promise<void> => {
    const state = new TurnState();
    state.promptSummary =
      typeof message === 'string' ? message.slice(0, 500) : '<structured>';

    const span = tracer.startSpan('claude_agent.turn', {
      attributes: { integration: 'claude_agent_sdk', kind: 'agent' },
      tags: { integration: 'claude_agent_sdk' },
    });

    pending.push(span, state);
    return originalSend(message);
  };

  const wrappedStream = function wrappedSessionStream(): AsyncGenerator<
    SDKMessage,
    void
  > {
    const originalGen = originalStream();

    async function* tracedSessionStream(): AsyncGenerator<SDKMessage, void> {
      let error: Error | null = null;
      try {
        for await (const message of originalGen) {
          const current = pending.peek();
          if (current) {
            extractMessageData(message, current.state);
          }

          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            message.type === 'result'
          ) {
            const closed = pending.pop();
            if (closed) {
              try {
                applyStateToSpan(closed.span, closed.state);
                tracer.endSpan(closed.span);
              } catch {
                // best-effort
              }
            }
          }

          yield message;
        }
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
        throw err;
      } finally {
        if (error) {
          const closed = pending.pop();
          if (closed) {
            try {
              applyStateToSpan(closed.span, closed.state);
              closed.span.setError({
                code: error.name,
                message: error.message,
                stack: error.stack,
              });
              tracer.endSpan(closed.span);
            } catch {
              // best-effort
            }
          }
        }
      }
    }

    return tracedSessionStream();
  };

  const wrappedClose = (): void => {
    pending.closeAll();
    originalClose();
  };

  return {
    get sessionId() {
      return session.sessionId;
    },
    send: wrappedSend,
    stream: wrappedStream,
    close: wrappedClose,
    async [Symbol.asyncDispose]() {
      wrappedClose();
    },
  } as SDKSession;
}

// ---------------------------------------------------------------------------
// Public API: wrapClaudeAgentQuery
// ---------------------------------------------------------------------------

export function wrapClaudeAgentQuery<T extends QueryFn>(queryFn: T): T {
  if (
    (queryFn as unknown as { __zeroeval_wrapped?: boolean }).__zeroeval_wrapped
  ) {
    return queryFn;
  }

  if (!isInitialized()) {
    const envApiKey = process.env.ZEROEVAL_API_KEY;
    if (envApiKey) {
      init({ apiKey: envApiKey });
    }
  }

  const wrapped = createWrappedQuery(queryFn);
  (wrapped as unknown as { __zeroeval_wrapped: boolean }).__zeroeval_wrapped =
    true;

  Object.defineProperty(wrapped, 'name', { value: queryFn.name || 'query' });
  return wrapped as unknown as T;
}

// ---------------------------------------------------------------------------
// Public API: wrapClaudeAgentSdk
// ---------------------------------------------------------------------------

export function wrapClaudeAgentSdk<T extends Record<string, unknown>>(
  sdkModule: T
): WrappedClaudeAgentSdk<T> {
  if ((sdkModule as WrappedClaudeAgentSdk<T>).__zeroeval_wrapped) {
    return sdkModule as WrappedClaudeAgentSdk<T>;
  }

  if (!isInitialized()) {
    const envApiKey = process.env.ZEROEVAL_API_KEY;
    if (envApiKey) {
      init({ apiKey: envApiKey });
    }
  }

  const wrapped: Record<string, unknown> = {};

  for (const key of Object.keys(sdkModule)) {
    wrapped[key] = sdkModule[key];
  }

  if (typeof sdkModule.query === 'function') {
    wrapped.query = createWrappedQuery(sdkModule.query as QueryFn);
  }

  if (typeof sdkModule.unstable_v2_createSession === 'function') {
    const origCreate = sdkModule.unstable_v2_createSession as CreateSessionFn;
    wrapped.unstable_v2_createSession = (
      options: Record<string, unknown>
    ): SDKSession => {
      return createWrappedSession(origCreate(options));
    };
  }

  if (typeof sdkModule.unstable_v2_resumeSession === 'function') {
    const origResume = sdkModule.unstable_v2_resumeSession as ResumeSessionFn;
    wrapped.unstable_v2_resumeSession = (
      sessionId: string,
      options: Record<string, unknown>
    ): SDKSession => {
      return createWrappedSession(origResume(sessionId, options));
    };
  }

  (wrapped as WrappedClaudeAgentSdk<T>).__zeroeval_wrapped = true;
  Object.setPrototypeOf(wrapped, Object.getPrototypeOf(sdkModule));

  return wrapped as WrappedClaudeAgentSdk<T>;
}

// ---------------------------------------------------------------------------
// Module shape detection for ze.wrap()
// ---------------------------------------------------------------------------

export function isClaudeAgentSdkModule(client: unknown): boolean {
  if (typeof client !== 'object' || client === null) return false;
  const obj = client as Record<string, unknown>;
  return (
    typeof obj.query === 'function' &&
    (typeof obj.unstable_v2_createSession === 'function' ||
      typeof obj.getSessionMessages === 'function' ||
      typeof obj.listSessions === 'function' ||
      typeof obj.HOOK_EVENTS !== 'undefined')
  );
}
