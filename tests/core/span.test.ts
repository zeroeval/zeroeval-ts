import { describe, it, expect, beforeEach } from 'vitest';
import { Span } from '../../src/observability/Span';

describe('Span', () => {
  describe('basic properties', () => {
    it('should create a span with required fields', () => {
      const span = new Span('test-span');

      expect(span.name).toBe('test-span');
      expect(span.spanId).toBeTruthy();
      expect(span.traceId).toBeTruthy();
      expect(span.startTime).toBeGreaterThan(0);
      expect(span.endTime).toBeUndefined();
      expect(span.status).toBe('ok');
    });

    it('should generate unique IDs for each span', () => {
      const span1 = new Span('span1');
      const span2 = new Span('span2');

      expect(span1.spanId).not.toBe(span2.spanId);
      expect(span1.traceId).not.toBe(span2.traceId);
    });

    it('should use provided trace ID', () => {
      const traceId = 'custom-trace-id';
      const span = new Span('test', traceId);

      expect(span.traceId).toBe(traceId);
    });
  });

  describe('end and duration', () => {
    it('should set endTime when ended', () => {
      const span = new Span('test');
      expect(span.endTime).toBeUndefined();
      expect(span.durationMs).toBeUndefined();

      span.end();

      expect(span.endTime).toBeGreaterThan(0);
      expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    });

    it('should calculate duration correctly', async () => {
      const span = new Span('test');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      span.end();

      expect(span.durationMs).toBeDefined();
      expect(span.durationMs).toBeGreaterThanOrEqual(50);
      expect(span.durationMs).toBeLessThan(100);
    });
  });

  describe('error handling', () => {
    it('should set error information', () => {
      const span = new Span('test');

      span.setError({
        code: 'ERR_TEST',
        message: 'Test error message',
        stack: 'Error: Test error\n  at test.js:10',
      });

      expect(span.status).toBe('error');
      expect(span.error).toEqual({
        code: 'ERR_TEST',
        message: 'Test error message',
        stack: 'Error: Test error\n  at test.js:10',
      });
    });
  });

  describe('input/output data', () => {
    it('should handle string input/output', () => {
      const span = new Span('test');

      span.setIO('input string', 'output string');

      expect(span.inputData).toBe('input string');
      expect(span.outputData).toBe('output string');
    });

    it('should stringify non-string input/output', () => {
      const span = new Span('test');
      const input = { key: 'value', number: 42 };
      const output = [1, 2, 3];

      span.setIO(input, output);

      expect(span.inputData).toBe(JSON.stringify(input));
      expect(span.outputData).toBe(JSON.stringify(output));
    });

    it('should handle undefined input/output', () => {
      const span = new Span('test');

      span.setIO(undefined, 'output');
      expect(span.inputData).toBeUndefined();
      expect(span.outputData).toBe('output');

      span.setIO('input', undefined);
      expect(span.inputData).toBe('input');
      expect(span.outputData).toBe('output'); // Should not change
    });
  });

  describe('signals', () => {
    it('should add boolean signal', () => {
      const span = new Span('test');

      span.addSignal('success', true);

      expect(span.signals.success).toEqual({
        value: true,
        type: 'boolean',
      });
    });

    it('should add numerical signal', () => {
      const span = new Span('test');

      span.addSignal('score', 95.5);

      expect(span.signals.score).toEqual({
        value: 95.5,
        type: 'numerical',
      });
    });

    it('should auto-detect signal type from string', () => {
      const span = new Span('test');

      // Boolean strings
      span.addSignal('boolString1', 'true');
      span.addSignal('boolString2', 'false');

      // Numerical strings
      span.addSignal('numString1', '42');
      span.addSignal('numString2', '3.14');

      // Other strings default to boolean
      span.addSignal('otherString', 'hello');

      expect(span.signals.boolString1.type).toBe('boolean');
      expect(span.signals.boolString2.type).toBe('boolean');
      expect(span.signals.numString1.type).toBe('numerical');
      expect(span.signals.numString2.type).toBe('numerical');
      expect(span.signals.otherString.type).toBe('boolean');
    });

    it('should override auto-detection with explicit type', () => {
      const span = new Span('test');

      span.addSignal('forceBoolean', 42, 'boolean');
      span.addSignal('forceNumerical', 'true', 'numerical');

      expect(span.signals.forceBoolean).toEqual({
        value: 42,
        type: 'boolean',
      });
      expect(span.signals.forceNumerical).toEqual({
        value: 'true',
        type: 'numerical',
      });
    });
  });

  describe('toJSON serialization', () => {
    it('should serialize all span properties', () => {
      const span = new Span('test-span', 'trace-123');
      span.parentId = 'parent-456';
      span.sessionId = 'session-789';
      span.sessionName = 'Test Session';

      span.attributes = { userId: '123', action: 'test' };
      span.tags = { env: 'test' };
      span.traceTags = { version: '1.0' };
      span.sessionTags = { user: 'tester' };

      span.setIO('input', 'output');
      span.addSignal('success', true);
      span.setError({ code: 'TEST_ERR', message: 'Error' });
      span.end();

      const json = span.toJSON();

      expect(json).toMatchObject({
        span_id: span.spanId,
        trace_id: 'trace-123',
        parent_id: 'parent-456',
        name: 'test-span',
        start_time: expect.any(String),
        end_time: expect.any(String),
        duration_ms: expect.any(Number),
        session_id: 'session-789',
        session_name: 'Test Session',
        attributes: { userId: '123', action: 'test' },
        tags: { env: 'test' },
        trace_tags: { version: '1.0' },
        session_tags: { user: 'tester' },
        signals: { success: { value: true, type: 'boolean' } },
        input_data: 'input',
        output_data: 'output',
        error_code: 'TEST_ERR',
        error_message: 'Error',
        status: 'error',
      });
    });

    it('should format timestamps as ISO strings', () => {
      const span = new Span('test');
      span.end();

      const json = span.toJSON();

      // Check ISO format
      expect(json.start_time).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
      expect(json.end_time).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      // Verify they can be parsed back
      const startDate = new Date(json.start_time as string);
      const endDate = new Date(json.end_time as string);

      expect(startDate.getTime()).toBe(span.startTime);
      expect(endDate.getTime()).toBe(span.endTime);
    });

    it('should handle incomplete spans', () => {
      const span = new Span('incomplete');

      const json = span.toJSON();

      expect(json.end_time).toBeUndefined();
      expect(json.duration_ms).toBeUndefined();
      expect(json.error_code).toBeUndefined();
      expect(json.error_message).toBeUndefined();
      expect(json.error_stack).toBeUndefined();
    });
  });
});
