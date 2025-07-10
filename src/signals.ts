import { signalWriter } from './observability/signalWriter';
import type { Signal, SignalCreate } from './observability/signals';
import { detectSignalType } from './observability/signals';
import { tracer } from './observability/Tracer';
import {
  addPendingTraceSignal,
  addPendingSessionSignal,
} from './observability/pendingSignals';
import { getLogger } from './observability/logger';

const logger = getLogger('zeroeval.signals');

/**
 * Send a signal to a specific entity
 * @param entityType - Type of entity: 'session' | 'trace' | 'span' | 'completion'
 * @param entityId - UUID of the entity
 * @param name - Name of the signal
 * @param value - Signal value (string, boolean, or number)
 * @param signalType - Optional signal type, will be auto-detected if not provided
 */
export async function sendSignal(
  entityType: 'session' | 'trace' | 'span' | 'completion',
  entityId: string,
  name: string,
  value: string | boolean | number,
  signalType?: 'boolean' | 'numerical'
): Promise<void> {
  const signal: SignalCreate = {
    entity_type: entityType,
    entity_id: entityId,
    name,
    value,
    signal_type: signalType || detectSignalType(value),
  };

  await signalWriter.createSignal(signal);
}

/**
 * Send multiple signals in bulk
 * @param signals - Array of signal creates
 */
export async function sendBulkSignals(signals: SignalCreate[]): Promise<void> {
  await signalWriter.createBulkSignals(signals);
}

/**
 * Send a signal to the current trace
 * @param name - Name of the signal
 * @param value - Signal value (string, boolean, or number)
 * @param signalType - Optional signal type, will be auto-detected if not provided
 */
export function sendTraceSignal(
  name: string,
  value: string | boolean | number,
  signalType?: 'boolean' | 'numerical'
): void {
  const currentSpan = tracer.currentSpan();
  if (!currentSpan) {
    logger.warn(
      '[ZeroEval] No active span/trace found for sending trace signal'
    );
    return;
  }
  const sig: Signal = {
    value,
    type: signalType || detectSignalType(value),
  };
  addPendingTraceSignal(currentSpan.traceId, name, sig);
}

/**
 * Send a signal to the current session
 * @param name - Name of the signal
 * @param value - Signal value (string, boolean, or number)
 * @param signalType - Optional signal type, will be auto-detected if not provided
 */
export function sendSessionSignal(
  name: string,
  value: string | boolean | number,
  signalType?: 'boolean' | 'numerical'
): void {
  const currentSpan = tracer.currentSpan();
  if (!currentSpan || !currentSpan.sessionId) {
    logger.warn(
      '[ZeroEval] No active session found for sending session signal'
    );
    return;
  }
  const sig: Signal = {
    value,
    type: signalType || detectSignalType(value),
  };
  addPendingSessionSignal(currentSpan.sessionId, name, sig);
}

/**
 * Send a signal to the current span
 * @param name - Name of the signal
 * @param value - Signal value (string, boolean, or number)
 * @param signalType - Optional signal type, will be auto-detected if not provided
 */
export function sendSpanSignal(
  name: string,
  value: string | boolean | number,
  signalType?: 'boolean' | 'numerical'
): void {
  const currentSpan = tracer.currentSpan();
  if (!currentSpan) {
    logger.warn('[ZeroEval] No active span found for sending span signal');
    return;
  }

  // Add signal to span (will be sent when span is flushed)
  currentSpan.addSignal(name, value, signalType);
}

/**
 * Get all signals for a specific entity
 * @param entityType - Type of entity
 * @param entityId - UUID of the entity
 * @returns Array of signals
 */
export async function getEntitySignals(
  entityType: 'session' | 'trace' | 'span' | 'completion',
  entityId: string
): Promise<Signal[]> {
  const result = (await signalWriter.getEntitySignals(
    entityType,
    entityId
  )) as unknown;
  // Handle null or invalid responses
  if (!result || !Array.isArray(result)) {
    return [];
  }
  return result as Signal[];
}
