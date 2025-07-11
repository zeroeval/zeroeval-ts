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

  private _integrations: Record<string, Integration> = {};
  private _shuttingDown = false;

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
    logger.debug(`Starting span: ${name}`);

    const parent = this.currentSpan();
    const span = new Span(name, parent?.traceId);

    if (parent) {
      span.parentId = parent.spanId;
      span.sessionId = parent.sessionId;
      span.sessionName = parent.sessionName;
      // inherit tags
      span.tags = { ...parent.tags, ...opts.tags };
      logger.debug(`Span ${name} inherits from parent ${parent.name}`);
    } else {
      span.sessionId = opts.sessionId ?? randomUUID();
      span.sessionName = opts.sessionName;
      span.tags = { ...opts.tags };
      logger.debug(
        `Span ${name} is a root span with session ${span.sessionId}`
      );
    }

    Object.assign(span.attributes, opts.attributes);

    // push onto ALS stack
    const parentStack = als.getStore() ?? [];
    als.enterWith([...parentStack, span]);

    // trace bookkeeping
    this._activeTraceCounts[span.traceId] =
      (this._activeTraceCounts[span.traceId] || 0) + 1;

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

    // bucket by trace until root finished
    const traceBucket = (this._traceBuckets[span.traceId] ||= []);
    traceBucket.push(span);

    this._activeTraceCounts[span.traceId] -= 1;
    if (this._activeTraceCounts[span.traceId] === 0) {
      // trace complete – move spans to main buffer ordered parent-first
      delete this._activeTraceCounts[span.traceId];
      const ordered = traceBucket.sort((a) => (a.parentId ? 1 : -1));
      delete this._traceBuckets[span.traceId];
      this._buffer.push(...ordered);

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
    logger.debug(`Adding trace tags to ${traceId}:`, tags);

    // update buckets
    for (const span of this._traceBuckets[traceId] ?? [])
      Object.assign(span.tags, tags);
    // update buffer if spans already flushed there
    this._buffer
      .filter((s) => s.traceId === traceId)
      .forEach((s) => Object.assign(s.tags, tags));
  }

  addSessionTags(sessionId: string, tags: Record<string, string>): void {
    logger.debug(`Adding session tags to ${sessionId}:`, tags);

    const all = [...Object.values(this._traceBuckets).flat(), ...this._buffer];
    all
      .filter((s) => s.sessionId === sessionId)
      .forEach((s) => Object.assign(s.tags, tags));
  }

  isActiveTrace(traceId: string): boolean {
    return traceId in this._activeTraceCounts || traceId in this._traceBuckets;
  }

  /* FLUSH -----------------------------------------------------------------*/
  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;

    const spanCount = this._buffer.length;
    logger.info(`[ZeroEval] Flushing ${spanCount} spans to backend...`);

    this._lastFlush = Date.now();
    const spansToFlush = this._buffer.splice(0);

    try {
      const startTime = Date.now();
      await this._writer.write(spansToFlush);
      const duration = Date.now() - startTime;

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

    const available = await discoverIntegrations();

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
