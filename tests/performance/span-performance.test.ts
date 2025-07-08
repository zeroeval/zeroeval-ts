import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestTracer, measureTime, measureTimeAsync } from '../setup';
import { span, withSpan } from '../../src/observability/spanDecorator';

describe('Span Performance', () => {
  let tracer: any;
  let mockWriter: any;
  let originalMaxSpans: number;

  beforeEach(() => {
    ({ tracer, mockWriter } = createTestTracer());
    originalMaxSpans = tracer._maxSpans;
  });

  afterEach(() => {
    tracer._maxSpans = originalMaxSpans;
  });

  describe('CPU performance', () => {
    it('should create many spans with good performance', () => {
      const numSpans = 1000;

      const duration = measureTime(() => {
        for (let i = 0; i < numSpans; i++) {
          const span = tracer.startSpan(`span_${i}`);
          tracer.endSpan(span);
        }
        tracer.flush();
      });

      // Should create 1000 spans in under 2 seconds (more lenient than Python due to JS overhead)
      expect(duration).toBeLessThan(2000);
      expect(mockWriter.spans).toHaveLength(numSpans);

      // Should achieve at least 500 spans/second (adjusted for JS)
      const spansPerSecond = numSpans / (duration / 1000);
      expect(spansPerSecond).toBeGreaterThan(500);
    });

    it('should handle withSpan calls efficiently', () => {
      const iterations = 1000;

      const duration = measureTime(() => {
        for (let i = 0; i < iterations; i++) {
          withSpan({ name: 'speed_test' }, () => 42);
        }
        tracer.flush();
      });

      // Should create spans at reasonable speed
      expect(duration).toBeLessThan(3000);
      expect(mockWriter.spans).toHaveLength(iterations);

      const spansPerSecond = iterations / (duration / 1000);
      expect(spansPerSecond).toBeGreaterThan(300);
    });
  });

  describe('memory efficiency', () => {
    it('should not leak memory with repeated span creation', () => {
      function createBatch() {
        for (let i = 0; i < 100; i++) {
          withSpan({ name: `leak_test_${i}` }, () => {
            // Simulate some work
            const data = new Array(100).fill(i);
            return data.reduce((a, b) => a + b, 0);
          });
        }
        tracer.flush();
      }

      // Warm up
      createBatch();
      mockWriter.clear();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Measure initial memory
      const initialMemory = process.memoryUsage().heapUsed;

      // Create multiple batches
      for (let batch = 0; batch < 5; batch++) {
        createBatch();
      }

      // Force garbage collection again
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be reasonable (less than 5MB for 500 spans)
      expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024);
      expect(mockWriter.spans).toHaveLength(500);
    });
  });

  describe('concurrent performance', () => {
    it('should handle concurrent spans efficiently', async () => {
      const numConcurrent = 10;
      const spansPerTask = 50;

      async function createSpans(taskId: number) {
        for (let i = 0; i < spansPerTask; i++) {
          await withSpan<void>(
            { name: `task_${taskId}_span_${i}` },
            async () => {
              // Simulate async work
              await new Promise((resolve) => setImmediate(resolve));
            }
          );
        }
      }

      const duration = await measureTimeAsync(async () => {
        const tasks = [];
        for (let i = 0; i < numConcurrent; i++) {
          tasks.push(createSpans(i));
        }
        await Promise.all(tasks);
        tracer.flush();
      });

      const totalSpans = numConcurrent * spansPerTask;
      expect(mockWriter.spans).toHaveLength(totalSpans);

      // Should handle concurrent spans efficiently
      expect(duration).toBeLessThan(5000);

      const spansPerSecond = totalSpans / (duration / 1000);
      expect(spansPerSecond).toBeGreaterThan(100);
    });
  });

  describe('buffer efficiency', () => {
    it('should manage buffer efficiently with auto-flush', () => {
      tracer._maxSpans = 50; // Small buffer for testing

      const totalSpans = 200;
      const duration = measureTime(() => {
        for (let i = 0; i < totalSpans; i++) {
          const span = tracer.startSpan(`buffer_test_${i}`);
          tracer.endSpan(span);
        }
        tracer.flush();
      });

      // Should have all spans despite small buffer
      expect(mockWriter.spans).toHaveLength(totalSpans);

      // Should still be performant with auto-flushing
      expect(duration).toBeLessThan(1000);
    });

    it('should handle buffer overflow gracefully', () => {
      tracer._maxSpans = 10;
      const spans: any[] = [];

      // Create spans without ending them (to prevent auto-flush)
      for (let i = 0; i < 20; i++) {
        spans.push(tracer.startSpan(`overflow_${i}`));
      }

      // End all spans at once
      const duration = measureTime(() => {
        spans.forEach((span) => tracer.endSpan(span));
        tracer.flush();
      });

      expect(mockWriter.spans).toHaveLength(20);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('deep nesting performance', () => {
    it('should handle deeply nested spans efficiently', () => {
      const depth = 100;

      function createNested(currentDepth: number) {
        if (currentDepth <= 0) return;

        const span = tracer.startSpan(`nested_${currentDepth}`);
        createNested(currentDepth - 1);
        tracer.endSpan(span);
      }

      const duration = measureTime(() => {
        createNested(depth);
        tracer.flush();
      });

      // Should handle deep nesting efficiently
      expect(duration).toBeLessThan(500);
      expect(mockWriter.spans).toHaveLength(depth);

      // Verify nesting structure
      for (let i = depth; i > 1; i--) {
        const parent = mockWriter.spans.find(
          (s: any) => s.name === `nested_${i}`
        );
        const child = mockWriter.spans.find(
          (s: any) => s.name === `nested_${i - 1}`
        );
        expect(child.parent_id).toBe(parent.span_id);
      }
    });

    it('should handle wide span trees efficiently', () => {
      const width = 100;
      const childrenPerNode = 10;

      const duration = measureTime(() => {
        const root = tracer.startSpan('root');

        for (let i = 0; i < width; i++) {
          const parent = tracer.startSpan(`parent_${i}`);

          for (let j = 0; j < childrenPerNode; j++) {
            const child = tracer.startSpan(`child_${i}_${j}`);
            tracer.endSpan(child);
          }

          tracer.endSpan(parent);
        }

        tracer.endSpan(root);
        tracer.flush();
      });

      const totalSpans = 1 + width + width * childrenPerNode;
      expect(mockWriter.spans).toHaveLength(totalSpans);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('real-world scenarios', () => {
    it('should perform well with typical web request pattern', async () => {
      async function simulateWebRequest(requestId: number) {
        return await withSpan(
          { name: `request_${requestId}`, tags: { type: 'http' } },
          async () => {
            // Auth check
            await withSpan({ name: 'auth_check' }, async () => {
              await new Promise((r) => setTimeout(r, 1));
            });

            // Database queries
            const queries = await Promise.all([
              withSpan({ name: 'db_query_user' }, async () => {
                await new Promise((r) => setTimeout(r, 2));
                return { userId: requestId };
              }),
              withSpan({ name: 'db_query_permissions' }, async () => {
                await new Promise((r) => setTimeout(r, 3));
                return { permissions: ['read', 'write'] };
              }),
            ]);

            // Business logic
            const result = await withSpan(
              { name: 'process_request' },
              async () => {
                await new Promise((r) => setTimeout(r, 1));
                return { ...queries[0], ...queries[1], processed: true };
              }
            );

            // Response formatting
            return await withSpan({ name: 'format_response' }, async () => {
              return JSON.stringify(result);
            });
          }
        );
      }

      const numRequests = 50;
      const duration = await measureTimeAsync(async () => {
        const requests = [];
        for (let i = 0; i < numRequests; i++) {
          requests.push(simulateWebRequest(i));
        }
        await Promise.all(requests);
        tracer.flush();
      });

      // Each request creates 6 spans
      expect(mockWriter.spans).toHaveLength(numRequests * 6);

      // Should handle typical web patterns efficiently
      expect(duration).toBeLessThan(10000);

      const requestsPerSecond = numRequests / (duration / 1000);
      expect(requestsPerSecond).toBeGreaterThan(5);
    });

    it('should perform well with streaming data patterns', async () => {
      async function* dataStream(count: number) {
        for (let i = 0; i < count; i++) {
          yield i;
          await new Promise((r) => setImmediate(r));
        }
      }

      const itemCount = 100;
      const duration = await measureTimeAsync(async () => {
        await withSpan({ name: 'stream_processing' }, async () => {
          const results = [];

          for await (const item of dataStream(itemCount)) {
            const result = await withSpan(
              { name: `process_item_${item}` },
              async () => item * 2
            );
            results.push(result);
          }

          return results;
        });

        tracer.flush();
      });

      // 1 parent + 100 item processing spans
      expect(mockWriter.spans).toHaveLength(itemCount + 1);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid span creation and destruction', () => {
      const cycles = 1000;

      const duration = measureTime(() => {
        for (let i = 0; i < cycles; i++) {
          // Create and immediately end span
          tracer.endSpan(tracer.startSpan(`rapid_${i}`));
        }
        tracer.flush();
      });

      expect(mockWriter.spans).toHaveLength(cycles);
      expect(duration).toBeLessThan(1000);
    });

    it('should handle large span attributes efficiently', () => {
      const largeData = {
        array: new Array(1000).fill('data'),
        nested: {
          deep: {
            value: 'x'.repeat(1000),
          },
        },
      };

      const duration = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          withSpan(
            {
              name: `large_attrs_${i}`,
              attributes: largeData,
            },
            () => 'result'
          );
        }
        tracer.flush();
      });

      expect(mockWriter.spans).toHaveLength(100);
      expect(duration).toBeLessThan(2000);
    });
  });
});
