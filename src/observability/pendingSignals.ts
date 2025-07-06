import type { Signal } from './signals';

// Internal buffers for pending signals
const traceBuffer: Record<string, Record<string, Signal>> = {};
const sessionBuffer: Record<string, Record<string, Signal>> = {};

/* ---------------- Trace signals ---------------- */
export function addPendingTraceSignal(traceId: string, name: string, signal: Signal): void {
  const bucket = (traceBuffer[traceId] ||= {});
  bucket[name] = signal;
}

export function popPendingTraceSignals(traceId: string): Record<string, Signal> | undefined {
  const sigs = traceBuffer[traceId];
  if (sigs) delete traceBuffer[traceId];
  return sigs;
}

/* ---------------- Session signals -------------- */
export function addPendingSessionSignal(sessionId: string, name: string, signal: Signal): void {
  const bucket = (sessionBuffer[sessionId] ||= {});
  bucket[name] = signal;
}

export function popPendingSessionSignals(sessionId: string): Record<string, Signal> | undefined {
  const sigs = sessionBuffer[sessionId];
  if (sigs) delete sessionBuffer[sessionId];
  return sigs;
} 