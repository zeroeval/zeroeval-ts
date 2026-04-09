/* global process */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Span } from './Span';
import type { SpanWriter } from './writer';
import { BackendSpanWriter } from './writer';
import { setInterval } from 'timers';
import { discoverIntegrations } from './integrations/utils';
import type { Integration } from './integrations/base';
import { getLogger, Logger } from './logger';
import {
  attachRedactionMetadata,
  createRedactionReferenceContext,
  redactAttributes,
  redactSessionIdentifier,
  redactSessionName,
  redactTags,
  resolveRedactionConfig,
} from './redaction';
import type {
  RedactionConfig,
  RedactionReferenceContext,
  ResolvedRedactionConfig,
} from './redaction';

// Check for debug mode early
if (process.env.ZEROEVAL_DEBUG?.toLowerCase() === 'true') {
  Logger.setDebugMode(true);
}

const logger = getLogger('zeroeval.tracer');

interface ConfigureOptions {
  flushInterval?: number;
  maxSpans?: number;
  collectCodeDetails?: boolean;
  integrations?: Record<string, boolean>;
  redaction?: Partial<RedactionConfig>;
}

/** Global AsyncLocalStorage for span stacks */
const als = new AsyncLocalStorage<Span[]>();

export class Tracer {
  private _writer: SpanWriter = new BackendSpanWriter();
  private _buffer: Span[] = [];
  private _flushIntervalMs = 10_000; // default 10 s
  private _maxSpans = 100;
  private _lastFlush = Date.now();

  private _activeTraceCounts: Record<string, number> = {};
  private _traceBuckets: Record<string, Span[]> = {};
  private _traceTags: Record<string, Record<string, string>> = {};
  private _sessionTags: Record<string, Record<string, string>> = {};
  private _activeSessionCounts: Record<string, number> = {};
  private _traceRedactionContexts: Record<string, RedactionReferenceContext> =
    {};

  private _integrations: Record<string, Integration> = {};
  private _shuttingDown = false;
  private _redaction: ResolvedRedactionConfig = resolveRedactionConfig();

  constructor() {
    logger.debug('Initializing tracer...');
    logger.debug(
      `Tracer config: flush_interval=${this._flushIntervalMs}ms, max_spans=${this._maxSpans}`
    );

    // schedule periodic flush
    setInterval(() => {
      if (Date.now() - this._lastFlush >= this._flushIntervalMs) {
        void this.flush().catch((error) => {
          logger.error('[ZeroEval] Periodic flush failed:', error);
        });
      }
    }, 1000).unref();

    // setup integrations asynchronously (non-blocking)
    void this._setupAvailableIntegrations();

    // graceful shutdown hooks
    process.on('beforeExit', () => this.shutdown());
    process.on('SIGINT', () => {
      this.shutdown();
      process.exit();
    });
    process.on('SIGTERM', () => {
      this.shutdown();
      process.exit();
    });
  }

  /* CONFIG ----------------------------------------------------------------*/
  configure(opts: ConfigureOptions = {}) {
    if (opts.flushInterval !== undefined) {
      this._flushIntervalMs = opts.flushInterval * 1000;
      logger.info(
        `Tracer flush_interval configured to ${opts.flushInterval}s.`
      );
    }
    if (opts.maxSpans !== undefined) {
      this._maxSpans = opts.maxSpans;
      logger.info(`Tracer max_spans configured to ${opts.maxSpans}.`);
    }
    if (opts.redaction !== undefined) {
      this._redaction = resolveRedactionConfig(opts.redaction);
      if (this._writer instanceof BackendSpanWriter) {
        this._writer.setRedactionConfig(this._redaction);
      }
    }
    logger.debug(`Tracer configuration updated:`, opts);
  }

  /* ACTIVE SPAN -----------------------------------------------------------*/
  currentSpan(): Span | undefined {
    const stack = als.getStore();
    return stack && stack[stack.length - 1];
  }

  /* TRACING ---------------------------------------------------------------*/
  startSpan(
    name: string,
    opts: {
      attributes?: Record<string, unknown>;
      sessionId?: string;
      sessionName?: string;
      tags?: Record<string, string>;
    } = {}
  ): Span {
    if (this._shuttingDown) {
      const span = new Span(
        name,
        undefined,
        this._redaction,
        createRedactionReferenceContext()
      );
      span.end();
      return span;
    }

    logger.debug(`Starting span: ${name}`);

    const parent = this.currentSpan();
    const spanTraceId = parent?.traceId ?? randomUUID();
    const referenceContext =
      parent?.getRedactionReferenceContext() ??
      this._traceRedactionContexts[spanTraceId] ??
      createRedactionReferenceContext();
    this._traceRedactionContexts[spanTraceId] = referenceContext;
    const span = new Span(name, spanTraceId, this._redaction, referenceContext);
    const redactedAttributes = redactAttributes(
      opts.attributes,
      this._redaction,
      referenceContext
    );
    const redactedTags = redactTags(
      opts.tags,
      this._redaction,
      referenceContext
    );
    const redactedSessionName = redactSessionName(
      opts.sessionName,
      this._redaction,
      referenceContext
    );
    const redactedSessionId = redactSessionIdentifier(
      opts.sessionId,
      this._redaction,
      referenceContext
    );

    if (parent) {
      span.parentId = parent.spanId;
      span.sessionId = parent.sessionId;
      span.sessionLookupId = parent.sessionLookupId;
      span.sessionName = parent.sessionName;
      // inherit tags
      span.tags = {
        ...parent.tags,
        ...(this._traceTags[parent.traceId] ?? {}),
        ...(parent.sessionLookupId
          ? (this._sessionTags[parent.sessionLookupId] ?? {})
          : {}),
        ...(redactedTags.value ?? {}),
      };
      logger.debug(`Span ${name} inherits from parent ${parent.name}`);
    } else {
      const rawSessionId = opts.sessionId ?? randomUUID();
      span.sessionLookupId = rawSessionId;
      span.sessionId = redactedSessionId.value ?? rawSessionId;
      span.sessionName = redactedSessionName.value;
      span.tags = {
        ...(this._traceTags[span.traceId] ?? {}),
        ...(span.sessionLookupId
          ? (this._sessionTags[span.sessionLookupId] ?? {})
          : {}),
        ...(redactedTags.value ?? {}),
      };
      logger.debug(
        `Span ${name} is a root span with session ${span.sessionId}`
      );
    }

    Object.assign(span.attributes, redactedAttributes.value);
    attachRedactionMetadata(span.attributes, redactedAttributes.metadata);
    attachRedactionMetadata(span.attributes, redactedTags.metadata);
    attachRedactionMetadata(span.attributes, redactedSessionName.metadata);
    attachRedactionMetadata(span.attributes, redactedSessionId.metadata);

    // push onto ALS stack
    const parentStack = als.getStore() ?? [];
    als.enterWith([...parentStack, span]);

    // trace bookkeeping
    this._activeTraceCounts[span.traceId] =
      (this._activeTraceCounts[span.traceId] || 0) + 1;

    if (!parent && span.sessionLookupId) {
      this._activeSessionCounts[span.sessionLookupId] =
        (this._activeSessionCounts[span.sessionLookupId] || 0) + 1;
    }

    return span;
  }

  endSpan(span: Span): void {
    if (!span.endTime) span.end();

    logger.debug(`Ending span: ${span.name} (duration: ${span.durationMs}ms)`);

    // pop stack
    const stack = als.getStore();
    if (stack && stack[stack.length - 1] === span) {
      stack.pop();
    }

    if (!(span.traceId in this._activeTraceCounts)) {
      return;
    }

    // bucket by trace until root finished
    const traceBucket = (this._traceBuckets[span.traceId] ||= []);
    traceBucket.push(span);

    this._activeTraceCounts[span.traceId] -= 1;
    if (this._activeTraceCounts[span.traceId] === 0) {
      // trace complete – move spans to main buffer ordered parent-first
      delete this._activeTraceCounts[span.traceId];
      const ordered = traceBucket.sort((a) => (a.parentId ? 1 : -1));
      delete this._traceBuckets[span.traceId];
      delete this._traceTags[span.traceId];
      this._buffer.push(...ordered);

      if (span.sessionLookupId) {
        this._activeSessionCounts[span.sessionLookupId] -= 1;
        if (this._activeSessionCounts[span.sessionLookupId] === 0) {
          delete this._activeSessionCounts[span.sessionLookupId];
          delete this._sessionTags[span.sessionLookupId];
        }
      }

      logger.debug(
        `Trace ${span.traceId} complete with ${ordered.length} spans`
      );
    }

    // flush if buffer full
    if (this._buffer.length >= this._maxSpans) {
      logger.debug(
        `Buffer full (${this._buffer.length} spans), triggering flush`
      );
      void this.flush().catch((error) => {
        logger.error('[ZeroEval] Buffer full flush failed:', error);
      });
    }
  }

  /* TAG HELPERS -----------------------------------------------------------*/
  addTraceTags(traceId: string, tags: Record<string, string>): void {
    const redactedTags = redactTags(
      tags,
      this._redaction,
      this._traceRedactionContexts[traceId]
    );
    logger.debug(`Adding trace tags to ${traceId}:`, redactedTags.value);
    this._traceTags[traceId] = {
      ...(this._traceTags[traceId] ?? {}),
      ...(redactedTags.value ?? {}),
    };

    // update buckets
    for (const span of this._traceBuckets[traceId] ?? [])
      Object.assign(span.tags, redactedTags.value);
    for (const span of als.getStore() ?? []) {
      if (span.traceId === traceId) {
        Object.assign(span.tags, redactedTags.value);
      }
    }
    // update buffer if spans already flushed there
    this._buffer
      .filter((s) => s.traceId === traceId)
      .forEach((s) => Object.assign(s.tags, redactedTags.value));
  }

  addSessionTags(sessionId: string, tags: Record<string, string>): void {
    const matchingSpans = [
      ...Object.values(this._traceBuckets).flat(),
      ...this._buffer,
    ];
    for (const span of als.getStore() ?? []) {
      matchingSpans.push(span);
    }

    const matchedSpan = matchingSpans.find(
      (span) => span.sessionLookupId === sessionId
    );
    const redactedTags = redactTags(
      tags,
      this._redaction,
      matchedSpan?.getRedactionReferenceContext()
    );
    const logSessionId =
      matchedSpan?.sessionId ??
      redactSessionIdentifier(
        sessionId,
        this._redaction,
        matchedSpan?.getRedactionReferenceContext()
      ).value ??
      '[session]';
    logger.debug(`Adding session tags to ${logSessionId}:`, redactedTags.value);
    this._sessionTags[sessionId] = {
      ...(this._sessionTags[sessionId] ?? {}),
      ...(redactedTags.value ?? {}),
    };

    matchingSpans
      .filter((s) => s.sessionLookupId === sessionId)
      .forEach((s) => Object.assign(s.tags, redactedTags.value));
  }

  isActiveTrace(traceId: string): boolean {
    return (
      traceId in this._activeTraceCounts ||
      traceId in this._traceBuckets ||
      this._buffer.some((span) => span.traceId === traceId)
    );
  }

  getRedactionConfig(): ResolvedRedactionConfig {
    return this._redaction;
  }

  sanitizeTags(
    tags: Record<string, string>,
    traceId?: string
  ): Record<string, string> {
    return (
      redactTags(
        tags,
        this._redaction,
        traceId ? this._traceRedactionContexts[traceId] : undefined
      ).value ?? tags
    );
  }

  /* FLUSH -----------------------------------------------------------------*/
  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;

    const spanCount = this._buffer.length;
    logger.info(`[ZeroEval] Flushing ${spanCount} spans to backend...`);

    this._lastFlush = Date.now();
    const spansToFlush = this._buffer.splice(0);
    const flushedTraceIds = new Set(spansToFlush.map((span) => span.traceId));

    try {
      const startTime = Date.now();
      await this._writer.write(spansToFlush);
      const duration = Date.now() - startTime;

      for (const traceId of flushedTraceIds) {
        delete this._traceRedactionContexts[traceId];
        if (!(traceId in this._activeTraceCounts)) {
          delete this._traceTags[traceId];
        }
      }

      const flushedSessionIds = new Set(
        spansToFlush.map((s) => s.sessionLookupId).filter(Boolean)
      );
      for (const sessionId of flushedSessionIds) {
        if (sessionId && !(sessionId in this._activeSessionCounts)) {
          delete this._sessionTags[sessionId];
        }
      }

      logger.info(
        `[ZeroEval] Successfully flushed ${spanCount} spans in ${duration}ms`
      );
    } catch (error) {
      logger.error(
        `[ZeroEval] Failed to flush ${spanCount} spans:`,
        error instanceof Error ? error.message : error
      );
      // Re-add the spans to the buffer for retry
      this._buffer.unshift(...spansToFlush);
      throw error;
    }
  }

  private async _setupAvailableIntegrations(): Promise<void> {
    logger.info('Checking for available integrations...');

    const available = (await discoverIntegrations()) ?? {};

    for (const [key, Ctor] of Object.entries(available)) {
      try {
        const inst = new Ctor();
        if ((Ctor as any).isAvailable?.() !== false) {
          logger.info(`Setting up integration: ${key}`);
          inst.setup();
          this._integrations[key] = inst;
          logger.info(`✅ Successfully set up integration: ${key}`);
        }
      } catch (err) {
        logger.error(`❌ Failed to setup integration ${key}:`, err);
      }
    }

    if (Object.keys(this._integrations).length > 0) {
      logger.info(
        `Active integrations: ${Object.keys(this._integrations).join(', ')}`
      );
    } else {
      logger.info('No active integrations found.');
    }
  }

  /** Flush remaining spans and teardown integrations */
  shutdown(): void {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    logger.info('Shutting down tracer...');

    // Attempt to flush remaining spans
    void this.flush().catch((error) => {
      logger.error('[ZeroEval] Shutdown flush failed:', error);
    });

    for (const inst of Object.values(this._integrations)) {
      try {
        inst.teardown();
      } catch (error) {
        logger.error('[ZeroEval] Integration teardown failed:', error);
      }
    }
  }
}

export const tracer = new Tracer();
