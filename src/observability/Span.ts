import { randomUUID } from 'crypto';

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

  inputData?: unknown;
  outputData?: unknown;

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
    if (input !== undefined) this.inputData = input;
    if (output !== undefined) this.outputData = output;
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
      input_data: this.inputData,
      output_data: this.outputData,
      error_code: this.error?.code,
      error_message: this.error?.message,
      error_stack: this.error?.stack,
      status: this.status,
    };
  }
} 