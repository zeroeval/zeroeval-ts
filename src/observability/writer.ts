import { signalWriter } from './signalWriter';
import type { Signal, SignalCreate } from './signals';
import { getLogger, Logger } from './logger';
import { getApiUrl, getApiKey } from '../utils/api';
import {
  attachRedactionMetadata,
  createRedactionReferenceContext,
  redactAttributes,
  redactErrorInfo,
  redactInputValue,
  redactOutputValue,
  redactSessionIdentifier,
  redactSessionName,
  redactTags,
  resolveRedactionConfig,
  safeSerialize,
} from './redaction';
import type {
  RedactionConfig,
  RedactionReferenceContext,
  ResolvedRedactionConfig,
} from './redaction';

const logger = getLogger('zeroeval.writer');

type PendingFns = {
  popPendingTraceSignals: (id: string) => Record<string, Signal> | undefined;
  popPendingSessionSignals: (id: string) => Record<string, Signal> | undefined;
};

export interface SpanWriter {
  write(spans: any[]): void | Promise<void>;
}

export class BackendSpanWriter implements SpanWriter {
  private redactionConfig: ResolvedRedactionConfig = resolveRedactionConfig();

  setRedactionConfig(config?: Partial<RedactionConfig>): void {
    this.redactionConfig = resolveRedactionConfig(config);
  }

  async write(spans: any[]): Promise<void> {
    if (!spans.length) return;

    const endpoint = `${getApiUrl()}/spans`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // Collect signals from spans and collect trace/session ids
    const spansWithSignals: Array<{
      spanId: string;
      signals: Record<string, Signal>;
    }> = [];
    const traceIds = new Set<string>();
    const sessionIds = new Set<string>();
    const traceReferenceContexts = new Map<string, RedactionReferenceContext>();

    const payload = spans.map((s: any) => {
      const base = typeof s.toJSON === 'function' ? s.toJSON() : s;
      const referenceContext =
        typeof s?.getRedactionReferenceContext === 'function'
          ? s.getRedactionReferenceContext()
          : undefined;
      const traceReferenceContext =
        referenceContext ??
        traceReferenceContexts.get(base.trace_id) ??
        createRedactionReferenceContext();
      traceReferenceContexts.set(base.trace_id, traceReferenceContext);
      const attributes = redactAttributes(
        base.attributes,
        this.redactionConfig,
        traceReferenceContext
      );
      const tags = redactTags(
        base.tags,
        this.redactionConfig,
        traceReferenceContext
      );
      const traceTags = redactTags(
        base.trace_tags,
        this.redactionConfig,
        traceReferenceContext
      );
      const sessionTags = redactTags(
        base.session_tags,
        this.redactionConfig,
        traceReferenceContext
      );
      const inputData = redactInputValue(
        base.input_data,
        this.redactionConfig,
        traceReferenceContext
      );
      const outputData = redactOutputValue(
        base.output_data,
        this.redactionConfig,
        traceReferenceContext
      );
      const errorInfo = redactErrorInfo(
        {
          code: base.error_code,
          message: base.error_message,
          stack: base.error_stack,
        },
        this.redactionConfig,
        traceReferenceContext
      );
      const sessionName = redactSessionName(
        base.session_name,
        this.redactionConfig,
        traceReferenceContext
      );
      const sessionId = redactSessionIdentifier(
        base.session_id,
        this.redactionConfig,
        traceReferenceContext
      );
      const mergedAttributes = {
        ...(attributes.value ?? {}),
      };

      attachRedactionMetadata(mergedAttributes, attributes.metadata);
      attachRedactionMetadata(mergedAttributes, tags.metadata);
      attachRedactionMetadata(mergedAttributes, traceTags.metadata);
      attachRedactionMetadata(mergedAttributes, sessionTags.metadata);
      attachRedactionMetadata(mergedAttributes, inputData.metadata);
      attachRedactionMetadata(mergedAttributes, outputData.metadata);
      attachRedactionMetadata(mergedAttributes, errorInfo.metadata);
      attachRedactionMetadata(mergedAttributes, sessionName.metadata);
      attachRedactionMetadata(mergedAttributes, sessionId.metadata);

      if (base.signals && Object.keys(base.signals).length > 0) {
        spansWithSignals.push({ spanId: base.span_id, signals: base.signals });
      }
      traceIds.add(base.trace_id);
      if (base.session_id) sessionIds.add(base.session_id);

      // Extract kind from attributes (default to 'generic')
      const kind = base.attributes?.kind ?? 'generic';

      return {
        id: base.span_id,
        session_id: sessionId.value,
        session_name: sessionName.value,
        trace_id: base.trace_id,
        parent_span_id: base.parent_id,
        name: base.name,
        kind: kind,
        started_at: base.start_time,
        ended_at: base.end_time,
        duration_ms: base.duration_ms,
        attributes: mergedAttributes,
        status: base.status,
        input_data:
          typeof inputData.value === 'string'
            ? inputData.value
            : safeSerialize(inputData.value),
        output_data:
          typeof outputData.value === 'string'
            ? outputData.value
            : safeSerialize(outputData.value),
        code: base.code ?? base.attributes?.code,
        code_filepath: base.code_filepath ?? base.attributes?.code_filepath,
        code_lineno: base.code_lineno ?? base.attributes?.code_lineno,
        error_code: errorInfo.value?.code,
        error_message: errorInfo.value?.message,
        error_stack: String(errorInfo.value?.stack ?? ''),
        tags: tags.value,
        trace_tags: traceTags.value,
        session_tags: sessionTags.value,
      };
    });

    // Log request details
    logger.debug(`[ZeroEval] Sending ${payload.length} spans to ${endpoint}`);
    if (Logger.isDebugEnabled()) {
      logger.debug('[ZeroEval] Request headers:', {
        ...headers,
        Authorization: headers.Authorization
          ? `Bearer ${Logger.maskApiKey(apiKey)}`
          : undefined,
      });
      logger.debug(
        '[ZeroEval] Request body:',
        JSON.stringify(payload, null, 2)
      );
    }

    try {
      const startTime = Date.now();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const duration = Date.now() - startTime;

      // Log response details
      logger.debug(
        `[ZeroEval] Response received in ${duration}ms - Status: ${res.status}`
      );

      const text = await res.text();
      if (Logger.isDebugEnabled()) {
        // Log response headers in a Node.js compatible way
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        logger.debug(`[ZeroEval] Response headers:`, responseHeaders);
        logger.debug(`[ZeroEval] Response body:`, text);
      }

      if (!res.ok) {
        logger.error(`[ZeroEval] Failed posting spans: ${res.status} ${text}`);
      } else {
        logger.info(
          `[ZeroEval] Successfully posted ${payload.length} spans to ${endpoint}`
        );

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
      if (Logger.isDebugEnabled()) {
        logger.debug('[ZeroEval] Error details:', {
          endpoint,
          spanCount: payload.length,
          error:
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                }
              : err,
        });
      }
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
