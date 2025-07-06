// Signal types and functions for ZeroEval TypeScript SDK

export type SignalType = 'boolean' | 'numerical';

export interface Signal {
  value: string | boolean | number;
  type: SignalType;
}

export interface SignalCreate {
  entity_type: 'session' | 'trace' | 'span' | 'completion';
  entity_id: string;
  name: string;
  value: string | boolean | number;
  signal_type?: SignalType;
}

export interface BulkSignalsCreate {
  signals: SignalCreate[];
}

export interface SignalResponse {
  status: string;
  message: string;
  processed_count?: number;
  failed_count?: number;
  errors?: Array<{
    index: number;
    entity_type: string;
    entity_id: string;
    signal_name: string;
    error: string;
  }>;
}

/**
 * Normalize signal value to string format for consistency with backend
 */
export function normalizeSignalValue(value: string | boolean | number, signalType?: SignalType): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

/**
 * Auto-detect signal type based on value
 */
export function detectSignalType(value: string | boolean | number): SignalType {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'numerical';
  }
  // For strings, try to detect if it's a boolean string
  const strVal = String(value).toLowerCase();
  if (strVal === 'true' || strVal === 'false') {
    return 'boolean';
  }
  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num)) {
    return 'numerical';
  }
  return 'boolean'; // Default to boolean for other strings
}

/**
 * Convert signals object to the format expected by the backend
 */
export function convertSignalsForBackend(signals?: Record<string, string | boolean | number | Signal>): Record<string, Signal> | undefined {
  if (!signals) return undefined;
  
  const converted: Record<string, Signal> = {};
  
  for (const [name, signalData] of Object.entries(signals)) {
    if (typeof signalData === 'object' && 'value' in signalData && 'type' in signalData) {
      // Already in Signal format
      converted[name] = {
        value: normalizeSignalValue(signalData.value, signalData.type),
        type: signalData.type
      };
    } else {
      // Simple value - auto-detect type
      const type = detectSignalType(signalData);
      converted[name] = {
        value: normalizeSignalValue(signalData, type),
        type
      };
    }
  }
  
  return converted;
} 