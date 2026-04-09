import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../src/init';
import { Span } from '../../src/observability/Span';
import { tracer } from '../../src/observability/Tracer';
import { Logger } from '../../src/observability/logger';
import { BackendSpanWriter } from '../../src/observability/writer';
import {
  createRedactionReferenceContext,
  redactAttributes,
  resolveRedactionConfig,
} from '../../src/observability/redaction';
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

    expect(json.input_data).toContain('[REDACTED_EMAIL_A]');
    expect(json.input_data).toContain('[REDACTED_PHONE_A]');
    expect(json.input_data).toContain('[REDACTED_PAN_A]');
    expect(json.input_data).toContain('[REDACTED_SECRET_A]');
    expect(json.output_data).toContain('[REDACTED_EMAIL_A]');
    expect(json.output_data).toContain('[REDACTED_IP_A]');
    expect(json.error_message).toContain('[REDACTED_SECRET_B]');
    expect(json.error_message).not.toContain('alice@example.com');
    expect(json.error_message).not.toContain('123-45-6789');
    expect(json.attributes).toHaveProperty('zeroeval_redaction');
  });

  it('should preserve references for repeated exact sensitive values within one span', () => {
    const mockWriter = new MockSpanWriter();
    (tracer as any)._writer = mockWriter;
    (tracer as any)._shuttingDown = false;
    tracer.configure({
      redaction: { enabled: true },
    });

    const repeatedEmail = 'seb@zeroeval.com';
    const span = tracer.startSpan('reference-span', {
      attributes: {
        email: repeatedEmail,
      },
      tags: {
        support_email: repeatedEmail,
      },
    });

    span.setIO(
      `input ${repeatedEmail}`,
      `output ${repeatedEmail} and other@example.com`
    );
    span.setError({
      message: `error ${repeatedEmail}`,
    });
    tracer.endSpan(span);
    void tracer.flush();

    const payload = mockWriter.spans[0];
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain('[REDACTED_EMAIL_A]');
    expect(serialized).toContain('[REDACTED_EMAIL_B]');
    expect(serialized.match(/\[REDACTED_EMAIL_A\]/g)?.length).toBeGreaterThan(
      3
    );
    expect(payload.attributes.email).toBe('[REDACTED_EMAIL_A]');
    expect(payload.tags.support_email).toBe('[REDACTED_EMAIL_A]');
    expect(payload.output_data).toContain('[REDACTED_EMAIL_B]');
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

    expect(json.input_data).toContain('[REDACTED_PHONE_A]');
    expect(json.output_data).toContain('[REDACTED_SECRET_A]');
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

    expect(json.input_data).toContain('[REDACTED_EMAIL_A]');
    expect(json.input_data).toContain('[Circular]');
    expect(json.output_data).toContain('[REDACTED_EMAIL_A]');
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
    expect(mockWriter.spans[0].input_data).toContain('[REDACTED_EMAIL_A]');
    expect(mockWriter.spans[0].output_data).toContain('[REDACTED_SECRET_A]');
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
    expect(requestBodies[0]).toContain('[REDACTED_EMAIL_A]');
    expect(requestBodies[0]).toContain('[REDACTED_PAN_A]');
    expect(requestBodies[0]).not.toContain('alice@example.com');
    expect(requestBodies[0]).not.toContain('4111 1111 1111 1111');

    const combinedLogs = consoleLogSpy.mock.calls
      .flat()
      .map((item) => String(item))
      .join('\n');

    expect(combinedLogs).toContain('[REDACTED_EMAIL_A]');
    expect(combinedLogs).not.toContain('alice@example.com');
    expect(combinedLogs).not.toContain('live-token');
  });

  it('should preserve existing placeholders during writer fail-safe redaction', async () => {
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

    await writer.write([
      {
        span_id: 'span-2',
        trace_id: 'trace-2',
        name: 'writer-placeholder-preservation',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        duration_ms: 1,
        status: 'ok',
        attributes: {},
        input_data: 'Known [REDACTED_EMAIL_A] plus alice@example.com',
        output_data: '[REDACTED_SECRET_A]',
        tags: {},
        trace_tags: {},
        session_tags: {},
      },
    ]);

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toContain('[REDACTED_EMAIL_A]');
    expect(requestBodies[0]).toContain('[REDACTED_SECRET_A]');
    expect(requestBodies[0]).not.toContain('alice@example.com');
  });

  it('should preserve string-typed wire format for JSON-looking payload strings in writer fail-safe redaction', async () => {
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

    await writer.write([
      {
        span_id: 'span-3',
        trace_id: 'trace-3',
        name: 'writer-string-wire-format',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        duration_ms: 1,
        status: 'ok',
        attributes: {},
        input_data:
          '{"email":"alice@example.com","known":"[REDACTED_EMAIL_A]"}',
        output_data:
          '{"token":"Bearer shared-token","known":"[REDACTED_SECRET_A]"}',
        tags: {},
        trace_tags: {},
        session_tags: {},
      },
    ]);

    expect(requestBodies).toHaveLength(1);
    const payload = JSON.parse(requestBodies[0]);

    expect(typeof payload[0].input_data).toBe('string');
    expect(typeof payload[0].output_data).toBe('string');
    expect(payload[0].input_data).toContain('[REDACTED_EMAIL_A]');
    expect(payload[0].output_data).toContain('[REDACTED_SECRET_A]');
    expect(payload[0].input_data).not.toContain('alice@example.com');
    expect(payload[0].output_data).not.toContain('shared-token');
  });

  it('should respect per-field redaction flags in writer fail-safe redaction', async () => {
    const writer = new BackendSpanWriter();
    writer.setRedactionConfig({
      enabled: true,
      redactInputs: false,
      redactOutputs: true,
    });

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

    await writer.write([
      {
        span_id: 'span-4',
        trace_id: 'trace-4',
        name: 'writer-redaction-flags',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        duration_ms: 1,
        status: 'ok',
        attributes: {},
        input_data: 'alice@example.com',
        output_data: 'alice@example.com',
        tags: {},
        trace_tags: {},
        session_tags: {},
      },
    ]);

    const payload = JSON.parse(requestBodies[0]);

    expect(payload[0].input_data).toBe('alice@example.com');
    expect(payload[0].output_data).toContain('[REDACTED_EMAIL_A]');
  });

  it('should not inflate metadata for already-redacted sensitive-key object values', () => {
    const config = resolveRedactionConfig({ enabled: true });
    const referenceContext = createRedactionReferenceContext();
    const attributes = {
      authorization: '[REDACTED_SECRET_A]',
    };

    const redacted = redactAttributes(attributes, config, referenceContext);

    expect(redacted.value).toBe(attributes);
    expect(redacted.metadata).toBeUndefined();
  });

  it('should redact camelCase and PascalCase sensitive keys by normalized key name', () => {
    const config = resolveRedactionConfig({ enabled: true });
    const referenceContext = createRedactionReferenceContext();

    const redacted = redactAttributes(
      {
        accessToken: 'Bearer access-secret',
        refreshToken: 'refresh-secret',
        clientSecret: 'client-secret',
        confirmEmail: 'alice@example.com',
        userEmail: 'alice@example.com',
        userPhone: '+1 (415) 555-1212',
        SessionName: 'alice@example.com',
      },
      config,
      referenceContext
    );

    expect(redacted.value?.accessToken).toBe('[REDACTED_SECRET_A]');
    expect(redacted.value?.refreshToken).toBe('[REDACTED_SECRET_B]');
    expect(redacted.value?.clientSecret).toBe('[REDACTED_SECRET_C]');
    expect(redacted.value?.confirmEmail).toBe('[REDACTED_EMAIL_A]');
    expect(redacted.value?.userEmail).toBe('[REDACTED_EMAIL_A]');
    expect(redacted.value?.userPhone).toBe('[REDACTED_PHONE_A]');
    expect(redacted.value?.SessionName).toBe('[REDACTED_EMAIL_A]');
  });

  it('should normalize fully-populated config objects before reuse checks', () => {
    const resolved = resolveRedactionConfig({
      enabled: true,
      redactInputs: true,
      redactOutputs: true,
      redactAttributes: true,
      redactErrors: true,
      redactSessionNames: true,
      redactTagValues: true,
      sensitiveKeys: ['accessToken', 'ClientSecret'],
      customPatterns: ['secret-value'],
    });

    expect(resolved.sensitiveKeys).toEqual(
      expect.arrayContaining(['access_token', 'client_secret', 'email'])
    );
    expect(resolved.customPatterns[0]).toBeInstanceOf(RegExp);
    expect(resolved.customPatterns[0].source).toContain('secret-value');
  });

  it('should reuse identical authorization and cookie header values and separate different ones', () => {
    const span = new Span('header-redaction', undefined, {
      enabled: true,
    });

    span.setIO(
      [
        'Authorization: Bearer shared-token',
        'authorization: Bearer shared-token',
        'Cookie: session=abc123',
        'cookie: session=abc123',
        'Authorization: Bearer other-token',
        'Cookie: session=xyz999',
      ].join('\n'),
      undefined
    );

    const json = span.toJSON();
    const secretTokens = Array.from(
      json.input_data.matchAll(
        /(Authorization|authorization|Cookie|cookie): (\[REDACTED_SECRET_[A-Z]+\])/g
      )
    ).map((match) => ({
      name: match[1],
      token: match[2],
    }));

    expect(secretTokens).toEqual([
      { name: 'Authorization', token: expect.any(String) },
      { name: 'authorization', token: expect.any(String) },
      { name: 'Cookie', token: expect.any(String) },
      { name: 'cookie', token: expect.any(String) },
      { name: 'Authorization', token: expect.any(String) },
      { name: 'Cookie', token: expect.any(String) },
    ]);
    expect(secretTokens[0].token).toBe(secretTokens[1].token);
    expect(secretTokens[2].token).toBe(secretTokens[3].token);
    expect(secretTokens[0].token).not.toBe(secretTokens[4].token);
    expect(secretTokens[2].token).not.toBe(secretTokens[5].token);
    expect(json.input_data).not.toContain('shared-token');
    expect(json.input_data).not.toContain('abc123');
  });
});
