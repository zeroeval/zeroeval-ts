import { tracer } from './observability/Tracer';
import type { Span } from './observability/Span';

/** Return the current active Span (or undefined). */
export function getCurrentSpan(): Span | undefined {
  return tracer.currentSpan();
}

/** Return the current trace ID (or undefined). */
export function getCurrentTrace(): string | undefined {
  return tracer.currentSpan()?.traceId;
}

/** Return the current session ID (or undefined). */
export function getCurrentSession(): string | undefined {
  return tracer.currentSpan()?.sessionId;
}

/** Attach tags to a span / trace / session following Python SDK semantics. */
export function setTag(
  target: Span | string | undefined,
  tags: Record<string, string>
): void {
  if (!target || !tags || typeof tags !== 'object') return;

  if (typeof target !== 'string') {
    // Span instance – just mutate in-place
    Object.assign(target.tags, tags);
  } else {
    // Heuristic: first check active trace ids
    if (tracer.isActiveTrace(target)) {
      tracer.addTraceTags(target, tags);
    } else {
      tracer.addSessionTags(target, tags);
    }
  }
}
