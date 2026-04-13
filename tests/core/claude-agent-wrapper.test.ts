import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestTracer } from '../setup';
import {
  wrapClaudeAgentQuery,
  wrapClaudeAgentSdk,
  isClaudeAgentSdkModule,
} from '../../src/observability/integrations/claudeAgentWrapper';
import { init } from '../../src/init';
import { tracer } from '../../src/observability/Tracer';
import type { MockSpanWriter } from '../setup';

// ---------------------------------------------------------------------------
// Fake SDK message factories
// ---------------------------------------------------------------------------

function makeAssistantMessage(
  text: string,
  sessionId = 'claude-session-1',
  toolUses: Array<{ name: string; id: string }> = []
) {
  const content: Array<Record<string, unknown>> = [];
  for (const tu of toolUses) {
    content.push({ type: 'tool_use', name: tu.name, id: tu.id });
  }
  if (text) {
    content.push({ type: 'text', text });
  }
  return {
    type: 'assistant' as const,
    message: { content, model: 'claude-sonnet-4-6' },
    parent_tool_use_id: null,
    uuid: 'uuid-asst-1',
    session_id: sessionId,
  };
}

function makeResultMessage(
  sessionId = 'claude-session-1',
  overrides: Record<string, unknown> = {}
) {
  return {
    type: 'result' as const,
    subtype: 'success',
    duration_ms: 1200,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 1,
    result: 'Done.',
    stop_reason: 'end_turn',
    total_cost_usd: 0.005,
    usage: { input_tokens: 100, output_tokens: 50 },
    modelUsage: {},
    permission_denials: [],
    uuid: 'uuid-result-1',
    session_id: sessionId,
    ...overrides,
  };
}

function makeStreamEvent(sessionId = 'claude-session-1') {
  return {
    type: 'stream_event' as const,
    event: { type: 'content_block_delta' },
    parent_tool_use_id: null,
    uuid: 'uuid-stream-1',
    session_id: sessionId,
  };
}

function makeRateLimitEvent(
  status = 'allowed_warning',
  utilization = 0.85,
  sessionId = 'claude-session-1'
) {
  return {
    type: 'rate_limit_event' as const,
    rate_limit_info: {
      status,
      rateLimitType: 'five_hour',
      utilization,
    },
    uuid: 'uuid-rl-1',
    session_id: sessionId,
  };
}

function makeSystemInitMessage(sessionId = 'claude-session-1') {
  return {
    type: 'system' as const,
    subtype: 'init',
    session_id: sessionId,
  };
}

// ---------------------------------------------------------------------------
// Fake query function factory
// ---------------------------------------------------------------------------

function createFakeQuery(messages: Array<Record<string, unknown>>) {
  return function fakeQuery() {
    async function* gen() {
      for (const msg of messages) {
        yield msg;
      }
    }
    return gen();
  };
}

// ---------------------------------------------------------------------------
// Fake session factory
// ---------------------------------------------------------------------------

function createFakeSession(
  sessionId: string,
  streamMessages: Array<Array<Record<string, unknown>>>
) {
  let streamIdx = 0;
  let closed = false;
  const sendLog: Array<string | Record<string, unknown>> = [];

  return {
    get sessionId() {
      return sessionId;
    },
    async send(message: string | Record<string, unknown>) {
      sendLog.push(message);
    },
    stream() {
      const msgs = streamMessages[streamIdx] || [];
      streamIdx++;
      async function* gen() {
        for (const msg of msgs) {
          yield msg;
        }
      }
      return gen();
    },
    close() {
      closed = true;
    },
    get _closed() {
      return closed;
    },
    _sendLog: sendLog,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claude Agent Wrapper', () => {
  let testTracer: ReturnType<typeof createTestTracer>['tracer'];
  let mockWriter: MockSpanWriter;

  beforeEach(() => {
    const t = createTestTracer();
    testTracer = t.tracer;
    mockWriter = t.mockWriter;

    // Monkey-patch the singleton tracer used by the wrapper
    (tracer as any)._writer = mockWriter;
    (tracer as any)._shuttingDown = false;
    (tracer as any)._buffer = [];
    (tracer as any)._traceBuckets = {};
    (tracer as any)._activeTraceCounts = {};
    (tracer as any)._traceTags = {};
    (tracer as any)._sessionTags = {};
    (tracer as any)._activeSessionCounts = {};
    (tracer as any)._traceRedactionContexts = {};
  });

  afterEach(async () => {
    await tracer.flush();
    mockWriter.clear();
  });

  // -----------------------------------------------------------------------
  // Module shape detection
  // -----------------------------------------------------------------------

  describe('isClaudeAgentSdkModule', () => {
    it('should detect a module with query + session helpers', () => {
      const mod = {
        query: () => {},
        unstable_v2_createSession: () => {},
        listSessions: () => {},
      };
      expect(isClaudeAgentSdkModule(mod)).toBe(true);
    });

    it('should detect a module with query + HOOK_EVENTS', () => {
      const mod = {
        query: () => {},
        HOOK_EVENTS: ['PreToolUse'],
      };
      expect(isClaudeAgentSdkModule(mod)).toBe(true);
    });

    it('should reject an OpenAI client', () => {
      const client = {
        chat: { completions: { create: () => {} } },
        embeddings: { create: () => {} },
      };
      expect(isClaudeAgentSdkModule(client)).toBe(false);
    });

    it('should reject Vercel AI module', () => {
      const mod = { generateText: () => {}, streamText: () => {} };
      expect(isClaudeAgentSdkModule(mod)).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(isClaudeAgentSdkModule(null)).toBe(false);
      expect(isClaudeAgentSdkModule(undefined)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // wrapClaudeAgentQuery – basic query tracing
  // -----------------------------------------------------------------------

  describe('wrapClaudeAgentQuery', () => {
    it('should produce a span with result metadata on successful query', async () => {
      const fakeQuery = createFakeQuery([
        makeAssistantMessage('Hello world!'),
        makeResultMessage(),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);

      const messages: unknown[] = [];
      for await (const msg of wrapped({ prompt: 'Hi there' })) {
        messages.push(msg);
      }

      await tracer.flush();

      expect(messages).toHaveLength(2);
      expect(mockWriter.spans).toHaveLength(1);

      const span = mockWriter.spans[0];
      expect(span.name).toBe('claude_agent.query');
      expect(span.attributes.integration).toBe('claude_agent_sdk');
      expect(span.attributes.kind).toBe('agent');
      expect(span.attributes.claude_session_id).toBe('claude-session-1');
      expect(span.session_id).toBe('claude-session-1');
      expect(span.attributes.total_cost_usd).toBe(0.005);
      expect(span.attributes.num_turns).toBe(1);
      expect(span.tags.integration).toBe('claude_agent_sdk');
      expect(span.input_data).toContain('Hi there');
      expect(span.output_data).toContain('Hello world!');
    });

    it('should record error and still end span on query failure', async () => {
      const fakeQuery = function fakeQuery() {
        async function* gen() {
          yield makeAssistantMessage('partial');
          throw new Error('connection lost');
        }
        return gen();
      };

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);

      await expect(async () => {
        for await (const _ of wrapped({ prompt: 'test' })) {
          // consume
        }
      }).rejects.toThrow('connection lost');

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      const span = mockWriter.spans[0];
      expect(span.error_code).toBe('Error');
      expect(span.error_message).toBe('connection lost');
      expect(span.status).toBe('error');
    });

    it('should apply state and error when original query throws synchronously', async () => {
      const fakeQuery = function fakeQuery() {
        throw new Error('missing api key');
      };

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);

      expect(() => wrapped({ prompt: 'sync prompt' })).toThrow('missing api key');

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      const span = mockWriter.spans[0];
      expect(span.status).toBe('error');
      expect(span.error_code).toBe('Error');
      expect(span.error_message).toBe('missing api key');
      expect(span.input_data).toContain('sync prompt');
      expect(span.output_data).toBe('');
    });

    it('should count stream events', async () => {
      const fakeQuery = createFakeQuery([
        makeStreamEvent(),
        makeStreamEvent(),
        makeStreamEvent(),
        makeAssistantMessage('final'),
        makeResultMessage(),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({ prompt: 'test' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].attributes.stream_event_count).toBe(3);
    });

    it('should capture tool use blocks', async () => {
      const fakeQuery = createFakeQuery([
        makeAssistantMessage('Reading file', 'cs1', [
          { name: 'Read', id: 'tu1' },
        ]),
        makeResultMessage('cs1'),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({ prompt: 'test' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans[0].attributes.tool_uses).toEqual([
        { name: 'Read', id: 'tu1' },
      ]);
    });

    it('should capture rate limit events', async () => {
      const fakeQuery = createFakeQuery([
        makeRateLimitEvent('allowed_warning', 0.85),
        makeResultMessage(),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({ prompt: 'test' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans[0].attributes.rate_limit_events).toHaveLength(1);
      expect(
        mockWriter.spans[0].attributes.rate_limit_events[0].status
      ).toBe('allowed_warning');
    });

    it('should end span on early generator close', async () => {
      const fakeQuery = createFakeQuery([
        makeAssistantMessage('Hello'),
        makeResultMessage(),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      const gen = wrapped({ prompt: 'test' });
      await gen.next();
      await gen.return(undefined as any);

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].end_time).toBeDefined();
    });

    it('should be idempotent (no double-wrap)', () => {
      const fakeQuery = createFakeQuery([]);
      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      const doubleWrapped = wrapClaudeAgentQuery(wrapped);
      expect(doubleWrapped).toBe(wrapped);
    });

    it('should wrap canUseTool and capture permission decisions', async () => {
      const permissionAllow = { behavior: 'allow' };
      const canUseTool = async () => permissionAllow;

      const fakeQuery = function fakeQuery(params: any) {
        async function* gen() {
          if (params.options?.canUseTool) {
            await params.options.canUseTool('Bash', { command: 'ls' }, {
              toolUseID: 'tu1',
              agentID: 'a1',
            });
          }
          yield makeResultMessage();
        }
        return gen();
      };

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({
        prompt: 'test',
        options: { canUseTool },
      })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(
        mockWriter.spans[0].attributes.permission_decisions
      ).toHaveLength(1);
      expect(
        mockWriter.spans[0].attributes.permission_decisions[0].toolName
      ).toBe('Bash');
      expect(
        mockWriter.spans[0].attributes.permission_decisions[0].behavior
      ).toBe('allow');
    });

    it('should wrap hooks and capture hook events', async () => {
      const hookCb = async (input: any) => ({
        hookSpecificOutput: { hookEventName: 'PreToolUse' },
      });

      const fakeQuery = function fakeQuery(params: any) {
        async function* gen() {
          const hooks = params.options?.hooks;
          if (hooks?.PreToolUse) {
            for (const matcher of hooks.PreToolUse) {
              for (const hook of matcher.hooks) {
                await hook(
                  { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
                  'tu1',
                  {}
                );
              }
            }
          }
          yield makeResultMessage();
        }
        return gen();
      };

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({
        prompt: 'test',
        options: {
          hooks: {
            PreToolUse: [{ hooks: [hookCb] }],
          },
        },
      })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans[0].attributes.hook_events).toHaveLength(1);
      expect(
        mockWriter.spans[0].attributes.hook_events[0].eventName
      ).toBe('PreToolUse');
      expect(
        mockWriter.spans[0].attributes.hook_events[0].toolName
      ).toBe('Bash');
    });

    it('should use result text as output when no assistant text was accumulated', async () => {
      const fakeQuery = createFakeQuery([
        makeResultMessage('cs1', { result: 'Final answer from result.' }),
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({ prompt: 'test' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans[0].output_data).toContain(
        'Final answer from result.'
      );
    });
  });

  // -----------------------------------------------------------------------
  // wrapClaudeAgentSdk – module-level wrapping
  // -----------------------------------------------------------------------

  describe('wrapClaudeAgentSdk', () => {
    it('should wrap the query function on the module', async () => {
      const mod = {
        query: createFakeQuery([
          makeAssistantMessage('Hi'),
          makeResultMessage(),
        ]),
        HOOK_EVENTS: ['PreToolUse'],
      };

      const wrapped = wrapClaudeAgentSdk(mod);

      expect(wrapped.__zeroeval_wrapped).toBe(true);
      expect(wrapped.query).not.toBe(mod.query);
      expect(wrapped.HOOK_EVENTS).toBe(mod.HOOK_EVENTS);

      for await (const _ of (wrapped.query as any)({ prompt: 'Hi' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('claude_agent.query');
    });

    it('should be idempotent', () => {
      const mod = { query: createFakeQuery([]) };
      const wrapped = wrapClaudeAgentSdk(mod);
      const doubleWrapped = wrapClaudeAgentSdk(wrapped as any);
      expect(doubleWrapped).toBe(wrapped);
    });

    it('should wrap unstable_v2_createSession when present', async () => {
      const fakeSession = createFakeSession('sess-1', [
        [makeAssistantMessage('Hi', 'sess-1'), makeResultMessage('sess-1')],
      ]);

      const mod = {
        query: createFakeQuery([]),
        unstable_v2_createSession: () => fakeSession,
      };

      const wrapped = wrapClaudeAgentSdk(mod);
      const session = (wrapped.unstable_v2_createSession as any)({
        model: 'claude-sonnet-4-6',
      });

      await session.send('Hello');
      for await (const _ of session.stream()) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('claude_agent.turn');
      expect(mockWriter.spans[0].attributes.claude_session_id).toBe('sess-1');
    });

    it('should wrap unstable_v2_resumeSession when present', async () => {
      const fakeSession = createFakeSession('sess-2', [
        [makeAssistantMessage('Resumed', 'sess-2'), makeResultMessage('sess-2')],
      ]);

      const mod = {
        query: createFakeQuery([]),
        unstable_v2_resumeSession: () => fakeSession,
      };

      const wrapped = wrapClaudeAgentSdk(mod);
      const session = (wrapped.unstable_v2_resumeSession as any)('sess-2', {
        model: 'claude-sonnet-4-6',
      });

      await session.send('Continue');
      for await (const _ of session.stream()) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('claude_agent.turn');
    });
  });

  // -----------------------------------------------------------------------
  // Session tracing
  // -----------------------------------------------------------------------

  describe('session tracing', () => {
    it('should create separate traces for sequential turns', async () => {
      const fakeSession = createFakeSession('sess-1', [
        [makeAssistantMessage('Turn 1 reply', 'sess-1'), makeResultMessage('sess-1')],
        [
          makeAssistantMessage('Turn 2 reply', 'sess-1'),
          makeResultMessage('sess-1', { num_turns: 2 }),
        ],
      ]);

      const mod = {
        query: createFakeQuery([]),
        unstable_v2_createSession: () => fakeSession,
      };

      const wrapped = wrapClaudeAgentSdk(mod);
      const session = (wrapped.unstable_v2_createSession as any)({
        model: 'claude-sonnet-4-6',
      });

      await session.send('Turn 1');
      for await (const _ of session.stream()) {
        // consume
      }

      await session.send('Turn 2');
      for await (const _ of session.stream()) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(2);
      expect(mockWriter.spans[0].name).toBe('claude_agent.turn');
      expect(mockWriter.spans[1].name).toBe('claude_agent.turn');
      expect(mockWriter.spans[0].session_id).toBe('sess-1');
      expect(mockWriter.spans[1].session_id).toBe('sess-1');
      expect(mockWriter.spans[0].trace_id).not.toBe(
        mockWriter.spans[1].trace_id
      );
    });

    it('should mark pending spans as interrupted on session close', async () => {
      const fakeSession = createFakeSession('sess-1', []);

      const mod = {
        query: createFakeQuery([]),
        unstable_v2_createSession: () => fakeSession,
      };

      const wrapped = wrapClaudeAgentSdk(mod);
      const session = (wrapped.unstable_v2_createSession as any)({
        model: 'claude-sonnet-4-6',
      });

      await session.send('Hello');
      session.close();

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].attributes.interrupted).toBe(true);
    });

    it('should handle stream errors for session turns', async () => {
      const fakeSession = {
        get sessionId() {
          return 'sess-err';
        },
        async send() {},
        stream() {
          async function* gen() {
            yield makeAssistantMessage('partial', 'sess-err');
            throw new Error('stream broke');
          }
          return gen();
        },
        close() {},
      };

      const mod = {
        query: createFakeQuery([]),
        unstable_v2_createSession: () => fakeSession,
      };

      const wrapped = wrapClaudeAgentSdk(mod);
      const session = (wrapped.unstable_v2_createSession as any)({
        model: 'claude-sonnet-4-6',
      });

      await session.send('Hello');
      await expect(async () => {
        for await (const _ of session.stream()) {
          // consume
        }
      }).rejects.toThrow('stream broke');

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].status).toBe('error');
      expect(mockWriter.spans[0].error_message).toBe('stream broke');
    });
  });

  // -----------------------------------------------------------------------
  // Session ID late-binding
  // -----------------------------------------------------------------------

  describe('session ID late-binding', () => {
    it('should not overwrite session_id when no Claude session emitted', async () => {
      const fakeQuery = createFakeQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 100,
          is_error: false,
          num_turns: 1,
          result: 'ok',
          total_cost_usd: 0.001,
          usage: {},
          uuid: 'u1',
          session_id: '',
        },
      ]);

      const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
      for await (const _ of wrapped({ prompt: 'test' })) {
        // consume
      }

      await tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].attributes.claude_session_id).toBeUndefined();
    });
  });
});
