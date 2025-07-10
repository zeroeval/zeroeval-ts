import { signalWriter } from './signalWriter';
import type { Signal, SignalCreate } from './signals';
import { convertSignalsForBackend } from './signals';
import { Span } from './Span';
import { getLogger } from './logger';

const logger = getLogger('zeroeval.writer');

type PendingFns = {
  popPendingTraceSignals: (id: string) => Record<string, Signal> | undefined;
  popPendingSessionSignals: (id: string) => Record<string, Signal> | undefined;
};

export interface SpanWriter {
  write(spans: any[]): void | Promise<void>;
}

export class BackendSpanWriter implements SpanWriter {
  private getApiUrl(): string {
    return (process.env.ZEROEVAL_API_URL ?? 'https://api.zeroeval.com').replace(
      /\/$/,
      ''
    );
  }

  private getApiKey(): string | undefined {
    return process.env.ZEROEVAL_API_KEY;
  }

  async write(spans: any[]): Promise<void> {
    if (!spans.length) return;

    const endpoint = `${this.getApiUrl()}/spans`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // Collect signals from spans and collect trace/session ids
    const spansWithSignals: Array<{
      spanId: string;
      signals: Record<string, Signal>;
    }> = [];
    const traceIds = new Set<string>();
    const sessionIds = new Set<string>();

    const payload = spans.map((s: any) => {
      const base = typeof s.toJSON === 'function' ? s.toJSON() : s;

      if (base.signals && Object.keys(base.signals).length > 0) {
        spansWithSignals.push({ spanId: base.span_id, signals: base.signals });
      }
      traceIds.add(base.trace_id);
      if (base.session_id) sessionIds.add(base.session_id);

      return {
        id: base.span_id,
        session_id: base.session_id,
        trace_id: base.trace_id,
        parent_span_id: base.parent_id,
        name: base.name,
        started_at: base.start_time,
        ended_at: base.end_time,
        duration_ms: base.duration_ms,
        attributes: base.attributes,
        status: base.status,
        input_data: base.input_data,
        output_data: base.output_data,
        code: base.code ?? base.attributes?.code,
        code_filepath: base.code_filepath ?? base.attributes?.code_filepath,
        code_lineno: base.code_lineno ?? base.attributes?.code_lineno,
        error_code: base.error_code,
        error_message: base.error_message,
        error_stack: String(base.error_stack ?? ''),
        tags: base.tags,
        trace_tags: base.trace_tags,
        session_tags: base.session_tags,
      };
    });

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        logger.error(`[ZeroEval] Failed posting spans: ${res.status} ${text}`);
      } else {
        // Send span-level signals
        await this.sendSpanSignals(spansWithSignals);
        // After spans persisted, send buffered trace/session signals
        await this.flushTraceSessionSignals(
          Array.from(traceIds),
          Array.from(sessionIds)
        );
      }
    } catch (err) {
      logger.error('[ZeroEval] Error posting spans', err);
    }
  }

  private async sendSpanSignals(
    spansWithSignals: Array<{ spanId: string; signals: Record<string, Signal> }>
  ): Promise<void> {
    if (spansWithSignals.length === 0) return;

    // Prepare bulk signal creates for all spans
    const bulkSignals: SignalCreate[] = [];

    for (const { spanId, signals } of spansWithSignals) {
      for (const [name, signal] of Object.entries(signals)) {
        bulkSignals.push({
          entity_type: 'span',
          entity_id: spanId,
          name,
          value: signal.value,
          signal_type: signal.type,
        });
      }
    }

    if (bulkSignals.length > 0) {
      try {
        await signalWriter.createBulkSignals(bulkSignals);
      } catch (err) {
        logger.error('[ZeroEval] Error sending span signals', err);
      }
    }
  }

  private async flushTraceSessionSignals(
    traceIds: string[],
    sessionIds: string[]
  ): Promise<void> {
    if (traceIds.length === 0 && sessionIds.length === 0) return;

    const { popPendingTraceSignals, popPendingSessionSignals } = (await import(
      './pendingSignals'
    )) as PendingFns;

    const bulk: SignalCreate[] = [];

    for (const tid of traceIds) {
      const signals = popPendingTraceSignals(tid);
      if (!signals) continue;
      for (const [name, sig] of Object.entries(signals)) {
        bulk.push({
          entity_type: 'trace',
          entity_id: tid,
          name,
          value: sig.value,
          signal_type: sig.type,
        });
      }
    }

    for (const sid of sessionIds) {
      const signals = popPendingSessionSignals(sid);
      if (!signals) continue;
      for (const [name, sig] of Object.entries(signals)) {
        bulk.push({
          entity_type: 'session',
          entity_id: sid,
          name,
          value: sig.value,
          signal_type: sig.type,
        });
      }
    }

    if (bulk.length > 0) {
      try {
        await signalWriter.createBulkSignals(bulk);
      } catch (err) {
        logger.error('[ZeroEval] Error posting trace/session signals', err);
      }
    }
  }
}
