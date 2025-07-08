import { vi } from 'vitest';
import { Tracer } from '../src/observability/Tracer';
import type { Span } from '../src/observability/Span';
import type { SpanWriter } from '../src/observability/writer';

// Mock writer to capture spans in memory for testing
export class MockSpanWriter implements SpanWriter {
  spans: any[] = [];

  async write(spans: Span[]): Promise<void> {
    this.spans.push(...spans.map((s) => s.toJSON()));
  }

  clear(): void {
    this.spans = [];
  }
}

// Helper to create a fresh tracer instance for each test
export function createTestTracer() {
  // Create a new instance
  const tracer = new Tracer();

  // Replace writer with mock
  const mockWriter = new MockSpanWriter();
  (tracer as any)._writer = mockWriter;
  (tracer as any)._shuttingDown = false;

  // Configure for testing
  tracer.configure({
    flushInterval: 0, // Disable auto-flush
    maxSpans: 100,
  });

  return { tracer, mockWriter };
}

// Global test utilities
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Performance test helpers
export function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

export async function measureTimeAsync(
  fn: () => Promise<void>
): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}
