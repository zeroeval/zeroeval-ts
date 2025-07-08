import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockSpanWriter } from '../setup';
import { span, withSpan } from '../../src/observability/spanDecorator';
import { tracer } from '../../src/observability/Tracer';

describe('Span Decorator', () => {
  let mockWriter: any;
  let originalTracer: any;

  beforeEach(() => {
    // Create mock writer and replace on global tracer
    mockWriter = new MockSpanWriter();
    (tracer as any)._writer = mockWriter;
    (tracer as any)._shuttingDown = false;
  });

  afterEach(() => {
    // Clean up
    (tracer as any).flush();
    mockWriter.clear();
  });

  describe('@span decorator', () => {
    it('should wrap a function and record a span', () => {
      // Create decorated function
      class TestClass {
        @span({ name: 'decorated_method' })
        add(a: number, b: number): number {
          return a + b;
        }
      }

      const instance = new TestClass();
      const result = instance.add(1, 2);

      tracer.flush();

      expect(result).toBe(3);
      expect(mockWriter.spans).toHaveLength(1);

      const s = mockWriter.spans[0];
      expect(s.name).toBe('decorated_method');
      expect(s.status).toBe('ok');
      // Input data should be JSON array of arguments
      expect(s.input_data).toContain('1');
      expect(s.input_data).toContain('2');
      expect(s.output_data).toBe('3');
    });

    it('should correctly record an exception', () => {
      class TestClass {
        @span({ name: 'failing_method' })
        throwError(): void {
          throw new Error('This is a test error');
        }
      }

      const instance = new TestClass();

      expect(() => instance.throwError()).toThrow('This is a test error');

      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);

      const s = mockWriter.spans[0];
      expect(s.name).toBe('failing_method');
      expect(s.status).toBe('error');
      expect(s.error_code).toBe('Error');
      expect(s.error_message).toBe('This is a test error');
      expect(s.error_stack).toContain('Error: This is a test error');
    });

    it('should wrap an async function correctly', async () => {
      class TestClass {
        @span({ name: 'async_method' })
        async multiply(a: number, b: number): Promise<number> {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return a * b;
        }
      }

      const instance = new TestClass();
      const result = await instance.multiply(3, 4);

      tracer.flush();

      expect(result).toBe(12);
      expect(mockWriter.spans).toHaveLength(1);

      const s = mockWriter.spans[0];
      expect(s.name).toBe('async_method');
      expect(s.status).toBe('ok');
      expect(s.output_data).toBe('12');
      expect(s.duration_ms).toBeGreaterThan(9); // Should take at least 10ms
    });

    it('should handle async function exceptions', async () => {
      class TestClass {
        @span({ name: 'async_failing_method' })
        async throwAsyncError(): Promise<void> {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new TypeError('Async type error');
        }
      }

      const instance = new TestClass();

      await expect(instance.throwAsyncError()).rejects.toThrow(
        'Async type error'
      );

      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);

      const s = mockWriter.spans[0];
      expect(s.name).toBe('async_failing_method');
      expect(s.status).toBe('error');
      expect(s.error_code).toBe('TypeError');
      expect(s.error_message).toBe('Async type error');
    });

    it('should handle custom input/output data', () => {
      class TestClass {
        @span({
          name: 'custom_io_method',
          inputData: 'custom input',
          outputData: 'custom output',
        })
        process(data: any): string {
          return `processed: ${data}`;
        }
      }

      const instance = new TestClass();
      const result = instance.process({ key: 'value' });

      tracer.flush();

      expect(result).toBe('processed: [object Object]');
      expect(mockWriter.spans).toHaveLength(1);

      const s = mockWriter.spans[0];
      expect(s.input_data).toBe('custom input');
      expect(s.output_data).toBe('custom output');
    });

    it('should handle nested decorated functions', () => {
      class TestClass {
        @span({ name: 'outer_method' })
        outer(x: number): number {
          return this.inner(x) * 2;
        }

        @span({ name: 'inner_method' })
        inner(x: number): number {
          return x + 10;
        }
      }

      const instance = new TestClass();
      const result = instance.outer(5);

      tracer.flush();

      expect(result).toBe(30); // (5 + 10) * 2
      expect(mockWriter.spans).toHaveLength(2);

      const outerSpan = mockWriter.spans.find(
        (s: any) => s.name === 'outer_method'
      );
      const innerSpan = mockWriter.spans.find(
        (s: any) => s.name === 'inner_method'
      );

      expect(outerSpan).toBeDefined();
      expect(innerSpan).toBeDefined();
      expect(innerSpan.parent_id).toBe(outerSpan.span_id);
      expect(innerSpan.trace_id).toBe(outerSpan.trace_id);
    });
  });

  describe('withSpan helper', () => {
    it('should create a span for synchronous function', () => {
      const result = withSpan({ name: 'sync_span' }, () => {
        return 42;
      });

      tracer.flush();

      expect(result).toBe(42);
      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('sync_span');
      expect(mockWriter.spans[0].status).toBe('ok');
    });

    it('should create a span for async function', async () => {
      const result = await withSpan({ name: 'async_span' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });

      tracer.flush();

      expect(result).toBe('async result');
      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('async_span');
      expect(mockWriter.spans[0].status).toBe('ok');
      expect(mockWriter.spans[0].duration_ms).toBeGreaterThan(9);
    });

    it('should handle exceptions in withSpan', () => {
      expect(() =>
        withSpan({ name: 'error_span' }, () => {
          throw new Error('Span error');
        })
      ).toThrow('Span error');

      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('error_span');
      expect(mockWriter.spans[0].status).toBe('error');
      expect(mockWriter.spans[0].error_message).toBe('Span error');
    });

    it('should support custom attributes and tags', () => {
      withSpan(
        {
          name: 'attributed_span',
          attributes: { userId: '123', action: 'test' },
          tags: { environment: 'test', version: '1.0' },
        },
        () => 'result'
      );

      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      const s = mockWriter.spans[0];
      expect(s.attributes).toEqual({ userId: '123', action: 'test' });
      expect(s.tags).toEqual({ environment: 'test', version: '1.0' });
    });

    it('should support session information', () => {
      withSpan(
        {
          name: 'session_span',
          sessionId: 'session-123',
          sessionName: 'Test Session',
        },
        () => 'result'
      );

      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      const s = mockWriter.spans[0];
      expect(s.session_id).toBe('session-123');
      expect(s.session_name).toBe('Test Session');
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed sync/async nested spans', async () => {
      class TestClass {
        @span({ name: 'sync_parent' })
        syncParent(): Promise<string> {
          return this.asyncChild();
        }

        @span({ name: 'async_child' })
        async asyncChild(): Promise<string> {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return this.syncGrandchild();
        }

        @span({ name: 'sync_grandchild' })
        syncGrandchild(): string {
          return 'done';
        }
      }

      const instance = new TestClass();
      const result = await instance.syncParent();

      tracer.flush();

      expect(result).toBe('done');
      expect(mockWriter.spans).toHaveLength(3);

      const parentSpan = mockWriter.spans.find(
        (s: any) => s.name === 'sync_parent'
      );
      const childSpan = mockWriter.spans.find(
        (s: any) => s.name === 'async_child'
      );
      const grandchildSpan = mockWriter.spans.find(
        (s: any) => s.name === 'sync_grandchild'
      );

      expect(childSpan.parent_id).toBe(parentSpan.span_id);
      expect(grandchildSpan.parent_id).toBe(childSpan.span_id);

      // All should share the same trace ID
      expect(childSpan.trace_id).toBe(parentSpan.trace_id);
      expect(grandchildSpan.trace_id).toBe(parentSpan.trace_id);
    });

    it('should handle recursive functions', () => {
      class TestClass {
        @span({ name: 'factorial' })
        factorial(n: number): number {
          if (n <= 1) return 1;
          return n * this.factorial(n - 1);
        }
      }

      const instance = new TestClass();
      const result = instance.factorial(3);

      tracer.flush();

      expect(result).toBe(6); // 3! = 6
      expect(mockWriter.spans).toHaveLength(3); // 3 recursive calls

      // All should be part of the same trace
      const traceId = mockWriter.spans[0].trace_id;
      expect(mockWriter.spans.every((s: any) => s.trace_id === traceId)).toBe(
        true
      );
    });

    it('should handle concurrent decorated method calls', async () => {
      class TestClass {
        @span({ name: 'concurrent_method' })
        async process(id: number): Promise<number> {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 10)
          );
          return id * 2;
        }
      }

      const instance = new TestClass();

      // Call multiple methods concurrently
      const promises = [1, 2, 3, 4, 5].map((id) => instance.process(id));
      const results = await Promise.all(promises);

      tracer.flush();

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(mockWriter.spans).toHaveLength(5);

      // Each should have its own trace ID (no parent)
      const traceIds = new Set(mockWriter.spans.map((s: any) => s.trace_id));
      expect(traceIds.size).toBe(5);
    });
  });
});
