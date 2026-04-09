import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../src/init';
import { Span } from '../../src/observability/Span';
import { tracer } from '../../src/observability/Tracer';
import { Logger } from '../../src/observability/logger';
import { BackendSpanWriter } from '../../src/observability/writer';
import { MockSpanWriter } from '../setup';

describe('PII redaction', () => {
  let originalFetch: typeof global.fetch | undefined;
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnvValue = process.env.ZEROEVAL_REDACT_PII;
    delete process.env.ZEROEVAL_REDACT_PII;
  });

  afterEach(async () => {
    process.env.ZEROEVAL_REDACT_PII = originalEnvValue;
    tracer.configure({
      redaction: { enabled: false },
    });
    Logger.setDebugMode(false);
    vi.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof global.fetch }).fetch;
    }
    await tracer.flush();
  });

  it('should redact manual setIO payloads and error messages', () => {
    const span = new Span('manual-redaction', undefined, {
      enabled: true,
    });

    span.setIO(
      {
        email: 'alice@example.com',
        phone: '+1 (415) 555-1212',
        payment: '4111 1111 1111 1111',
        auth: 'Bearer token-123',
      },
      'Reply to alice@example.com from 2001:db8::1'
    );
    span.setError({
      code: 'TEST_ERROR',
      message:
        'Cookie: sessionid=abc123; user_email=alice@example.com; ssn=123-45-6789',
    });

    const json = span.toJSON();

    expect(json.input_data).toContain('[REDACTED_EMAIL]');
    expect(json.input_data).toContain('[REDACTED_PHONE]');
    expect(json.input_data).toContain('[REDACTED_PAN]');
    expect(json.input_data).toContain('[REDACTED_SECRET]');
    expect(json.output_data).toContain('[REDACTED_EMAIL]');
    expect(json.output_data).toContain('[REDACTED_IP]');
    expect(json.error_message).toContain('[REDACTED_SECRET]');
    expect(json.error_message).not.toContain('alice@example.com');
    expect(json.error_message).not.toContain('123-45-6789');
    expect(json.attributes).toHaveProperty('zeroeval_redaction');
  });

  it('should preserve existing behavior when redaction is disabled', () => {
    const span = new Span('disabled-redaction');
    span.setIO(
      { email: 'alice@example.com', token: 'Bearer token-123' },
      'Call +1 (415) 555-1212'
    );

    const json = span.toJSON();

    expect(json.input_data).toContain('alice@example.com');
    expect(json.input_data).toContain('Bearer token-123');
    expect(json.output_data).toContain('+1 (415) 555-1212');
    expect(json.attributes).not.toHaveProperty('zeroeval_redaction');
  });

  it('should redact free-text string payloads', () => {
    const span = new Span('string-redaction', undefined, {
      enabled: true,
    });

    span.setIO(
      'Call me at +1 (415) 555-1212',
      'JWT eyJhbGciOiJIUzI1NiJ9.foo.bar'
    );

    const json = span.toJSON();

    expect(json.input_data).toContain('[REDACTED_PHONE]');
    expect(json.output_data).toContain('[REDACTED_SECRET]');
  });

  it('should handle circular payloads without throwing and keep output serializable', () => {
    const span = new Span('circular-redaction', undefined, {
      enabled: true,
    });
    const payload: Record<string, unknown> = {
      email: 'alice@example.com',
    };
    payload.self = payload;

    expect(() => span.setIO(payload, payload)).not.toThrow();

    const json = span.toJSON();

    expect(json.input_data).toContain('[REDACTED_EMAIL]');
    expect(json.input_data).toContain('[Circular]');
    expect(json.output_data).toContain('[REDACTED_EMAIL]');
    expect(json.output_data).toContain('[Circular]');
  });

  it('should honor ZEROEVAL_REDACT_PII in init()', async () => {
    const mockWriter = new MockSpanWriter();
    (tracer as any)._writer = mockWriter;
    (tracer as any)._shuttingDown = false;
    process.env.ZEROEVAL_REDACT_PII = 'true';

    init({ apiKey: 'test-key' });

    const span = tracer.startSpan('env-redaction');
    span.setIO('Contact alice@example.com', 'Token sk-secret-123456789');
    tracer.endSpan(span);
    await tracer.flush();

    expect(mockWriter.spans).toHaveLength(1);
    expect(mockWriter.spans[0].input_data).toContain('[REDACTED_EMAIL]');
    expect(mockWriter.spans[0].output_data).toContain('[REDACTED_SECRET]');
  });

  it('should redact writer debug logs before logging or sending spans', async () => {
    const writer = new BackendSpanWriter();
    writer.setRedactionConfig({ enabled: true });

    const requestBodies: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url, init) => {
      requestBodies.push(String(init?.body ?? ''));
      return {
        ok: true,
        status: 200,
        text: async () => 'ok',
        headers: { forEach: () => undefined },
      } as Response;
    });

    Logger.setDebugMode(true);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await writer.write([
      {
        span_id: 'span-1',
        trace_id: 'trace-1',
        name: 'writer-redaction',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        duration_ms: 1,
        status: 'ok',
        session_id: 'alice@example.com',
        session_name: 'Alice alice@example.com',
        attributes: {
          authorization: 'Bearer live-token',
        },
        input_data: 'Reach alice@example.com',
        output_data: '4111 1111 1111 1111',
        error_message: 'Cookie: secret=abc',
        error_stack: 'Cookie: secret=abc',
        tags: {
          customer_email: 'alice@example.com',
        },
        trace_tags: {},
        session_tags: {},
      },
    ]);

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toContain('[REDACTED_EMAIL]');
    expect(requestBodies[0]).toContain('[REDACTED_PAN]');
    expect(requestBodies[0]).not.toContain('alice@example.com');
    expect(requestBodies[0]).not.toContain('4111 1111 1111 1111');

    const combinedLogs = consoleLogSpy.mock.calls
      .flat()
      .map((item) => String(item))
      .join('\n');

    expect(combinedLogs).toContain('[REDACTED_EMAIL]');
    expect(combinedLogs).not.toContain('alice@example.com');
    expect(combinedLogs).not.toContain('live-token');
  });
});
