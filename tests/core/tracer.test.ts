import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestTracer, sleep } from '../setup';

describe('Tracer', () => {
  let tracer: any;
  let mockWriter: any;

  beforeEach(() => {
    ({ tracer, mockWriter } = createTestTracer());
  });

  describe('span creation', () => {
    it('should create a simple parent-child trace', () => {
      // Create parent span
      const parent = tracer.startSpan('parent');

      // Create child span
      const child = tracer.startSpan('child');

      // End spans
      tracer.endSpan(child);
      tracer.endSpan(parent);

      // Flush to writer
      tracer.flush();

      // Assert
      expect(mockWriter.spans).toHaveLength(2);

      const parentSpan = mockWriter.spans.find((s: any) => s.name === 'parent');
      const childSpan = mockWriter.spans.find((s: any) => s.name === 'child');

      expect(parentSpan.parent_id).toBeUndefined();
      expect(childSpan.parent_id).toBe(parentSpan.span_id);
      expect(childSpan.trace_id).toBe(parentSpan.trace_id);
    });

    it('should handle multiple traces independently', () => {
      // Create first trace
      const trace1Parent = tracer.startSpan('trace1-parent');
      const trace1Child = tracer.startSpan('trace1-child');
      tracer.endSpan(trace1Child);
      tracer.endSpan(trace1Parent);

      // Create second trace
      const trace2Parent = tracer.startSpan('trace2-parent');
      const trace2Child = tracer.startSpan('trace2-child');
      tracer.endSpan(trace2Child);
      tracer.endSpan(trace2Parent);

      tracer.flush();

      // Each trace should have its own trace_id
      const trace1Spans = mockWriter.spans.filter((s: any) =>
        s.name.startsWith('trace1-')
      );
      const trace2Spans = mockWriter.spans.filter((s: any) =>
        s.name.startsWith('trace2-')
      );

      expect(trace1Spans).toHaveLength(2);
      expect(trace2Spans).toHaveLength(2);

      const trace1Id = trace1Spans[0].trace_id;
      const trace2Id = trace2Spans[0].trace_id;

      expect(trace1Id).not.toBe(trace2Id);
      expect(trace1Spans.every((s: any) => s.trace_id === trace1Id)).toBe(true);
      expect(trace2Spans.every((s: any) => s.trace_id === trace2Id)).toBe(true);
    });
  });

  describe('auto-flush', () => {
    it('should auto-flush when buffer reaches max capacity', () => {
      // Set low limit for testing
      tracer._maxSpans = 5;

      // Create spans up to the limit
      for (let i = 0; i < 5; i++) {
        const span = tracer.startSpan(`span-${i}`);
        tracer.endSpan(span);
      }

      // Should have auto-flushed
      expect(mockWriter.spans).toHaveLength(5);

      // Create one more span
      const extraSpan = tracer.startSpan('extra');
      tracer.endSpan(extraSpan);

      // Should still have 5 (not flushed yet)
      expect(mockWriter.spans).toHaveLength(5);

      // Manual flush to get the extra span
      tracer.flush();
      expect(mockWriter.spans).toHaveLength(6);
    });
  });

  describe('shutdown', () => {
    it('should flush remaining spans on shutdown', () => {
      const span = tracer.startSpan('before-shutdown');
      tracer.endSpan(span);

      // Shutdown should flush
      tracer.shutdown();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].name).toBe('before-shutdown');
    });

    it('should prevent new spans after shutdown', () => {
      tracer.shutdown();

      // Try to create a span after shutdown
      const span = tracer.startSpan('after-shutdown');
      tracer.endSpan(span);

      tracer.flush();

      // Should not have any spans
      expect(mockWriter.spans).toHaveLength(0);
    });
  });

  describe('async context management', () => {
    it('should maintain separate context for concurrent async operations', async () => {
      async function createTraceWithDelay(name: string, delay: number) {
        const parent = tracer.startSpan(`${name}-parent`);
        await sleep(delay);

        const child = tracer.startSpan(`${name}-child`);
        await sleep(delay);

        tracer.endSpan(child);
        tracer.endSpan(parent);
      }

      // Start multiple async operations concurrently
      const promises = [
        createTraceWithDelay('trace1', 10),
        createTraceWithDelay('trace2', 5),
        createTraceWithDelay('trace3', 15),
      ];

      await Promise.all(promises);
      tracer.flush();

      expect(mockWriter.spans).toHaveLength(6); // 3 traces * 2 spans each

      // Verify each trace maintains its own context
      for (const traceName of ['trace1', 'trace2', 'trace3']) {
        const parent = mockWriter.spans.find(
          (s: any) => s.name === `${traceName}-parent`
        );
        const child = mockWriter.spans.find(
          (s: any) => s.name === `${traceName}-child`
        );

        expect(parent).toBeDefined();
        expect(child).toBeDefined();
        expect(child.parent_id).toBe(parent.span_id);
        expect(child.trace_id).toBe(parent.trace_id);
      }

      // Verify traces are independent
      const traceIds = new Set(mockWriter.spans.map((s: any) => s.trace_id));
      expect(traceIds.size).toBe(3);
    });

    it('should handle deeply nested async operations', async () => {
      async function nestedAsync(depth: number): Promise<void> {
        if (depth <= 0) return;

        const span = tracer.startSpan(`depth-${depth}`);
        await sleep(1);
        await nestedAsync(depth - 1);
        tracer.endSpan(span);
      }

      await nestedAsync(5);
      tracer.flush();

      expect(mockWriter.spans).toHaveLength(5);

      // Verify parent-child relationships
      for (let i = 5; i > 1; i--) {
        const parent = mockWriter.spans.find(
          (s: any) => s.name === `depth-${i}`
        );
        const child = mockWriter.spans.find(
          (s: any) => s.name === `depth-${i - 1}`
        );
        expect(child.parent_id).toBe(parent.span_id);
      }

      // All should share same trace ID
      const traceId = mockWriter.spans[0].trace_id;
      expect(mockWriter.spans.every((s: any) => s.trace_id === traceId)).toBe(
        true
      );
    });
  });

  describe('span attributes and tags', () => {
    it('should support adding attributes to spans', () => {
      const span = tracer.startSpan('attributed-span', {
        attributes: { userId: '123', requestId: 'abc-456' },
      });

      tracer.endSpan(span);
      tracer.flush();

      expect(mockWriter.spans).toHaveLength(1);
      expect(mockWriter.spans[0].attributes).toEqual({
        userId: '123',
        requestId: 'abc-456',
      });
    });

    it('should support trace-level tags', () => {
      const span1 = tracer.startSpan('span1', {
        tags: { environment: 'test' },
      });
      const span2 = tracer.startSpan('span2');

      // Add trace tags while spans are active
      tracer.addTraceTags(span1.traceId, { version: '1.0' });

      tracer.endSpan(span2);
      tracer.endSpan(span1);
      tracer.flush();

      // Both spans should have the trace tags
      expect(mockWriter.spans[0].tags).toEqual({
        environment: 'test',
        version: '1.0',
      });
      expect(mockWriter.spans[1].tags).toEqual({
        environment: 'test',
        version: '1.0',
      });
    });

    it('should support session-level tags', () => {
      const sessionId = 'session-123';

      const span1 = tracer.startSpan('span1', { sessionId });
      tracer.endSpan(span1);

      const span2 = tracer.startSpan('span2', { sessionId });
      tracer.endSpan(span2);

      // Add session tags
      tracer.addSessionTags(sessionId, { user: 'test-user' });

      tracer.flush();

      // Both spans should have the session tags
      expect(mockWriter.spans[0].tags).toEqual({ user: 'test-user' });
      expect(mockWriter.spans[1].tags).toEqual({ user: 'test-user' });
    });
  });

  describe('error handling', () => {
    it('should handle errors in span creation gracefully', () => {
      // Mock a failure in UUID generation
      const originalRandomUUID = require('crypto').randomUUID;
      require('crypto').randomUUID = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('UUID error');
        })
        .mockImplementation(originalRandomUUID);

      // Should not throw
      expect(() => {
        const span = tracer.startSpan('error-span');
        tracer.endSpan(span);
      }).not.toThrow();

      // Restore
      require('crypto').randomUUID = originalRandomUUID;
    });

    it('should handle writer errors gracefully', async () => {
      // Replace writer with one that throws
      tracer._writer = {
        write: vi.fn().mockRejectedValue(new Error('Write failed')),
      };

      const span = tracer.startSpan('test');
      tracer.endSpan(span);

      // Should not throw
      expect(() => tracer.flush()).not.toThrow();
    });
  });

  describe('currentSpan', () => {
    it('should return the current active span', () => {
      expect(tracer.currentSpan()).toBeUndefined();

      const span1 = tracer.startSpan('span1');
      expect(tracer.currentSpan()).toBe(span1);

      const span2 = tracer.startSpan('span2');
      expect(tracer.currentSpan()).toBe(span2);

      tracer.endSpan(span2);
      expect(tracer.currentSpan()).toBe(span1);

      tracer.endSpan(span1);
      expect(tracer.currentSpan()).toBeUndefined();
    });
  });

  describe('trace ordering', () => {
    it('should order spans with parents before children', () => {
      // Create spans in reverse order
      const child2 = tracer.startSpan('child2');
      const child1 = tracer.startSpan('child1');
      const parent = tracer.startSpan('parent');

      // End in different order
      tracer.endSpan(child1);
      tracer.endSpan(parent);
      tracer.endSpan(child2);

      // Now create root last
      const root = tracer.startSpan('root');
      tracer.endSpan(root);

      tracer.flush();

      // Root should come first in the buffer
      const rootIndex = mockWriter.spans.findIndex(
        (s: any) => s.name === 'root'
      );
      const parentIndex = mockWriter.spans.findIndex(
        (s: any) => s.name === 'parent'
      );
      const child1Index = mockWriter.spans.findIndex(
        (s: any) => s.name === 'child1'
      );
      const child2Index = mockWriter.spans.findIndex(
        (s: any) => s.name === 'child2'
      );

      // Parents should come before children
      expect(rootIndex).toBeLessThan(parentIndex);
      expect(rootIndex).toBeLessThan(child1Index);
      expect(rootIndex).toBeLessThan(child2Index);
    });
  });

  describe('isActiveTrace', () => {
    it('should correctly identify active traces', () => {
      const span1 = tracer.startSpan('span1');
      const traceId = span1.traceId;

      expect(tracer.isActiveTrace(traceId)).toBe(true);
      expect(tracer.isActiveTrace('non-existent')).toBe(false);

      tracer.endSpan(span1);

      // Trace should still be active until flushed
      expect(tracer.isActiveTrace(traceId)).toBe(true);

      tracer.flush();

      // After flush, trace should not be active
      expect(tracer.isActiveTrace(traceId)).toBe(false);
    });
  });
});
