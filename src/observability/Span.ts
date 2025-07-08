import { randomUUID } from 'crypto';
import type { Signal } from './signals';

export interface ErrorInfo {
  code?: string;
  message?: string;
  stack?: string;
}

export class Span {
  readonly spanId: string = randomUUID();
  readonly traceId: string;
  parentId?: string;

  readonly name: string;
  readonly startTime: number = Date.now();
  endTime?: number;

  sessionId?: string;
  sessionName?: string;

  attributes: Record<string, unknown> = {};
  tags: Record<string, string> = {};
  traceTags: Record<string, string> = {};
  sessionTags: Record<string, string> = {};
  signals: Record<string, Signal> = {};

  inputData?: string;
  outputData?: string;

  error?: ErrorInfo;
  status: 'ok' | 'error' = 'ok';

  constructor(name: string, traceId?: string) {
    this.name = name;
    this.traceId = traceId ?? randomUUID();
  }

  end(): void {
    this.endTime = Date.now();
  }

  get durationMs(): number | undefined {
    return this.endTime ? this.endTime - this.startTime : undefined;
  }

  setError(info: ErrorInfo): void {
    this.error = info;
    this.status = 'error';
  }

  setIO(input?: unknown, output?: unknown): void {
    if (input !== undefined) {
      this.inputData =
        typeof input === 'string' ? input : JSON.stringify(input);
    }
    if (output !== undefined) {
      this.outputData =
        typeof output === 'string' ? output : JSON.stringify(output);
    }
  }

  addSignal(
    name: string,
    value: string | boolean | number,
    type?: 'boolean' | 'numerical'
  ): void {
    // Auto-detect type if not provided
    let signalType = type;
    if (!signalType) {
      if (typeof value === 'boolean') {
        signalType = 'boolean';
      } else if (typeof value === 'number') {
        signalType = 'numerical';
      } else {
        // For strings, try to detect
        const strVal = String(value).toLowerCase();
        if (strVal === 'true' || strVal === 'false') {
          signalType = 'boolean';
        } else if (!isNaN(Number(value))) {
          signalType = 'numerical';
        } else {
          signalType = 'boolean';
        }
      }
    }

    this.signals[name] = {
      value,
      type: signalType,
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      span_id: this.spanId,
      trace_id: this.traceId,
      parent_id: this.parentId,
      name: this.name,
      start_time: new Date(this.startTime).toISOString(),
      end_time: this.endTime ? new Date(this.endTime).toISOString() : undefined,
      duration_ms: this.durationMs,
      session_id: this.sessionId,
      session_name: this.sessionName,
      attributes: this.attributes,
      tags: this.tags,
      trace_tags: this.traceTags,
      session_tags: this.sessionTags,
      signals: this.signals,
      input_data: this.inputData,
      output_data: this.outputData,
      error_code: this.error?.code,
      error_message: this.error?.message,
      error_stack: this.error?.stack,
      status: this.status,
    };
  }
}
