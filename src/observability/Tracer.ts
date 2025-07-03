import { AsyncLocalStorage } from 'async_hooks';
import { Span } from './Span';
import { SpanWriter, BackendSpanWriter } from './writer';
import { setInterval } from 'timers';
import { discoverIntegrations } from './integrations/utils';
import type { Integration } from './integrations/base';

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
    // schedule periodic flush
    setInterval(() => {
      if (Date.now() - this._lastFlush >= this._flushIntervalMs) {
        this.flush();
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
    if (opts.flushInterval !== undefined) this._flushIntervalMs = opts.flushInterval * 1000;
    if (opts.maxSpans !== undefined) this._maxSpans = opts.maxSpans;
    // Other options ignored for now (collectCodeDetails, integrations)
  }

  /* ACTIVE SPAN -----------------------------------------------------------*/
  currentSpan(): Span | undefined {
    const stack = als.getStore();
    return stack && stack[stack.length - 1];
  }

  /* TRACING ---------------------------------------------------------------*/
  startSpan(name: string, opts: { attributes?: Record<string, unknown>; sessionId?: string; sessionName?: string; tags?: Record<string, string> } = {}): Span {
    const parent = this.currentSpan();
    const span = new Span(name, parent?.traceId);

    if (parent) {
      span.parentId = parent.spanId;
      span.sessionId = parent.sessionId;
      span.sessionName = parent.sessionName;
      // inherit tags
      span.tags = { ...parent.tags, ...opts.tags };
    } else {
      span.sessionId = opts.sessionId ?? require('crypto').randomUUID();
      span.sessionName = opts.sessionName;
      span.tags = { ...opts.tags };
    }

    Object.assign(span.attributes, opts.attributes);

    // push onto ALS stack
    const parentStack = als.getStore() ?? [];
    als.enterWith([...parentStack, span]);

    // trace bookkeeping
    this._activeTraceCounts[span.traceId] = (this._activeTraceCounts[span.traceId] || 0) + 1;

    return span;
  }

  endSpan(span: Span): void {
    if (!span.endTime) span.end();

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
    }

    // flush if buffer full
    if (this._buffer.length >= this._maxSpans) this.flush();
  }

  /* TAG HELPERS -----------------------------------------------------------*/
  addTraceTags(traceId: string, tags: Record<string, string>): void {
    // update buckets
    for (const span of this._traceBuckets[traceId] ?? []) Object.assign(span.tags, tags);
    // update buffer if spans already flushed there
    this._buffer.filter((s) => s.traceId === traceId).forEach((s) => Object.assign(s.tags, tags));
  }

  addSessionTags(sessionId: string, tags: Record<string, string>): void {
    const all = [
      ...Object.values(this._traceBuckets).flat(),
      ...this._buffer,
    ];
    all.filter((s) => s.sessionId === sessionId).forEach((s) => Object.assign(s.tags, tags));
  }

  isActiveTrace(traceId: string): boolean {
    return traceId in this._activeTraceCounts || traceId in this._traceBuckets;
  }

  /* FLUSH -----------------------------------------------------------------*/
  flush(): void {
    if (this._buffer.length === 0) return;
    this._lastFlush = Date.now();
    this._writer.write(this._buffer.splice(0));
  }

  private async _setupAvailableIntegrations(): Promise<void> {
    const available = await discoverIntegrations();
    for (const [key, Ctor] of Object.entries(available)) {
      try {
        const inst = new Ctor();
        if ((Ctor as any).isAvailable?.() !== false) {
          inst.setup();
          this._integrations[key] = inst;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[ZeroEval] Failed to setup integration ${key}`, err);
      }
    }
  }

  /** Flush remaining spans and teardown integrations */
  shutdown(): void {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    try {
      this.flush();
    } catch (_) {}

    for (const inst of Object.values(this._integrations)) {
      try {
        inst.teardown();
      } catch (_) {}
    }
  }
}

export const tracer = new Tracer(); 