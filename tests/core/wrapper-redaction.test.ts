import { HumanMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init } from '../../src/init';
import { tracer } from '../../src/observability/Tracer';
import { ZeroEvalCallbackHandler } from '../../src/observability/integrations/langchain/ZeroEvalCallbackHandler';
import { wrapOpenAI } from '../../src/observability/integrations/openaiWrapper';
import { wrapVercelAI } from '../../src/observability/integrations/vercelAIWrapper';
import { wrapClaudeAgentQuery } from '../../src/observability/integrations/claudeAgentWrapper';
import { MockSpanWriter } from '../setup';

describe('wrapper redaction', () => {
  let mockWriter: MockSpanWriter;

  beforeEach(() => {
    mockWriter = new MockSpanWriter();
    (tracer as any)._writer = mockWriter;
    (tracer as any)._shuttingDown = false;
    (tracer as any)._buffer = [];
    (tracer as any)._traceBuckets = {};
    (tracer as any)._activeTraceCounts = {};
    (tracer as any)._traceTags = {};
    (tracer as any)._sessionTags = {};
    (tracer as any)._activeSessionCounts = {};
    (tracer as any)._traceRedactionContexts = {};
    init({ apiKey: 'test-key', redaction: { enabled: true } });
    (tracer as any)._writer = mockWriter;
  });

  afterEach(async () => {
    await tracer.flush();
    tracer.configure({
      redaction: { enabled: false },
    });
    mockWriter.clear();
  });

  it('should redact OpenAI wrapper messages and outputs', async () => {
    const client = wrapOpenAI({
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: 'Reach me at bob@example.com or +1 (415) 555-1212',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 12,
            },
          }),
        },
      },
    } as any);

    await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content:
            'Email bob@example.com and use Authorization: Bearer live-secret',
        },
      ],
    });
    await tracer.flush();

    expect(mockWriter.spans).toHaveLength(1);
    const span = mockWriter.spans[0];
    expect(span.attributes.messages[0].content).toBe(
      'Email bob@example.com and use Authorization: Bearer live-secret'
    );
    expect(span.input_data).not.toContain('bob@example.com');
    expect(span.output_data).toContain('[REDACTED_EMAIL_A]');
    expect(span.output_data).toContain('[REDACTED_PHONE_A]');
  });

  it('should redact Vercel AI wrapper prompts and outputs', async () => {
    const ai = wrapVercelAI({
      generateText: async () => ({
        text: 'JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo.bar',
        usage: {
          promptTokens: 5,
          completionTokens: 7,
        },
      }),
    });

    await ai.generateText({
      model: 'gpt-4.1-mini',
      prompt: 'Call me at +1 (415) 555-1212',
    });
    await tracer.flush();

    expect(mockWriter.spans).toHaveLength(1);
    const span = mockWriter.spans[0];
    expect(span.input_data).toContain('[REDACTED_PHONE_A]');
    expect(span.output_data).toContain('[REDACTED_SECRET_A]');
  });

  it('should redact LangChain callback handler inputs, outputs, and tool args', async () => {
    const handler = new ZeroEvalCallbackHandler();

    await handler.handleChatModelStart(
      {
        id: ['langchain', 'chat_models', 'ChatOpenAI'],
        name: 'ChatOpenAI',
      } as any,
      [[new HumanMessage('Contact bob@example.com')]],
      'run-1',
      undefined,
      {
        options: {} as any,
        invocation_params: {
          model: 'gpt-4o',
          tools: [
            {
              type: 'function',
              function: {
                name: 'lookup_user',
                arguments:
                  '{"email":"bob@example.com","token":"Bearer secret-token"}',
              },
            },
          ],
        },
        batch_size: 1,
      },
      undefined,
      {
        arguments:
          '{"email":"bob@example.com","authorization":"Bearer secret-token"}',
      }
    );

    await handler.handleLLMEnd(
      {
        llmOutput: {
          tokenUsage: {
            promptTokens: 10,
            completionTokens: 4,
          },
        },
        generations: [[{ text: 'Caller +1 (415) 555-1212' }]],
      } as any,
      'run-1'
    );
    await tracer.flush();
    handler.destroy();

    expect(mockWriter.spans).toHaveLength(1);
    const span = mockWriter.spans[0];
    const serializedAttributes = JSON.stringify(span.attributes);

    expect(span.input_data).toContain('[REDACTED_EMAIL_A]');
    expect(span.output_data).toContain('[REDACTED_PHONE_A]');
    expect(serializedAttributes).toContain('bob@example.com');
    expect(serializedAttributes).toContain('secret-token');
  });

  it('should preserve existing input placeholders when LangChain callback handler ends a span', async () => {
    const handler = new ZeroEvalCallbackHandler();

    await handler.handleChainStart(
      {
        id: ['langchain', 'chains', 'ExampleChain'],
        name: 'ExampleChain',
      } as any,
      {
        email: 'bob@example.com',
      },
      'run-chain-1'
    );

    await handler.handleChainEnd(
      {
        result: 'ok',
      } as any,
      'run-chain-1'
    );

    await tracer.flush();
    handler.destroy();

    expect(mockWriter.spans).toHaveLength(1);
    expect(mockWriter.spans[0].input_data).toContain('[REDACTED_EMAIL_A]');
    expect(mockWriter.spans[0].input_data).not.toContain('[REDACTED_SECRET');
  });

  it('should redact Claude Agent wrapper prompt and output', async () => {
    const fakeQuery = function fakeQuery() {
      async function* gen() {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Reach me at bob@example.com or +1 (415) 555-1212' },
            ],
          },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 'cs1',
        };
        yield {
          type: 'result',
          subtype: 'success',
          duration_ms: 100,
          is_error: false,
          num_turns: 1,
          result: 'done',
          total_cost_usd: 0.001,
          usage: {},
          uuid: 'u2',
          session_id: 'cs1',
        };
      }
      return gen();
    };

    const wrapped = wrapClaudeAgentQuery(fakeQuery as any);
    for await (const _ of wrapped({
      prompt: 'Email bob@example.com about the JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo.bar',
    })) {
      // consume
    }
    await tracer.flush();

    expect(mockWriter.spans).toHaveLength(1);
    const span = mockWriter.spans[0];
    expect(span.input_data).not.toContain('bob@example.com');
    expect(span.output_data).toContain('[REDACTED_EMAIL_A]');
    expect(span.output_data).toContain('[REDACTED_PHONE_A]');
  });

  it('should fall back to an empty object for falsy Vercel generateObject results', async () => {
    const ai = wrapVercelAI({
      generateObject: async () => ({
        object: '',
        usage: {
          promptTokens: 2,
          completionTokens: 1,
        },
      }),
    });

    await ai.generateObject({
      model: 'gpt-4.1-mini',
      prompt: 'return empty object',
    });
    await tracer.flush();

    expect(mockWriter.spans).toHaveLength(1);
    expect(mockWriter.spans[0].output_data).toBe('{}');
  });
});
