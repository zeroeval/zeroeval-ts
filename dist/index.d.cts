interface SpanOptions {
    name: string;
    sessionId?: string;
    sessionName?: string;
    tags?: Record<string, string>;
    attributes?: Record<string, unknown>;
    inputData?: unknown;
    outputData?: unknown;
}
declare function span(opts: SpanOptions): MethodDecorator & ((target: any, ...args: any[]) => any);
declare function withSpan<T>(opts: SpanOptions, fn: () => Promise<T> | T): Promise<T> | T;

interface ErrorInfo {
    code?: string;
    message?: string;
    stack?: string;
}
declare class Span {
    readonly spanId: string;
    readonly traceId: string;
    parentId?: string;
    readonly name: string;
    readonly startTime: number;
    endTime?: number;
    sessionId?: string;
    sessionName?: string;
    attributes: Record<string, unknown>;
    tags: Record<string, string>;
    traceTags: Record<string, string>;
    sessionTags: Record<string, string>;
    inputData?: unknown;
    outputData?: unknown;
    error?: ErrorInfo;
    status: 'ok' | 'error';
    constructor(name: string, traceId?: string);
    end(): void;
    get durationMs(): number | undefined;
    setError(info: ErrorInfo): void;
    setIO(input?: unknown, output?: unknown): void;
    toJSON(): Record<string, unknown>;
}

interface ConfigureOptions {
    flushInterval?: number;
    maxSpans?: number;
    collectCodeDetails?: boolean;
    integrations?: Record<string, boolean>;
}
declare class Tracer {
    private _writer;
    private _buffer;
    private _flushIntervalMs;
    private _maxSpans;
    private _lastFlush;
    private _activeTraceCounts;
    private _traceBuckets;
    private _integrations;
    private _shuttingDown;
    constructor();
    configure(opts?: ConfigureOptions): void;
    currentSpan(): Span | undefined;
    startSpan(name: string, opts?: {
        attributes?: Record<string, unknown>;
        sessionId?: string;
        sessionName?: string;
        tags?: Record<string, string>;
    }): Span;
    endSpan(span: Span): void;
    addTraceTags(traceId: string, tags: Record<string, string>): void;
    addSessionTags(sessionId: string, tags: Record<string, string>): void;
    isActiveTrace(traceId: string): boolean;
    flush(): void;
    private _setupAvailableIntegrations;
    /** Flush remaining spans and teardown integrations */
    shutdown(): void;
}
declare const tracer: Tracer;

interface InitOptions {
    apiKey?: string;
    apiUrl?: string;
    flushInterval?: number;
    maxSpans?: number;
    collectCodeDetails?: boolean;
    integrations?: Record<string, boolean>;
}
/**
 * Initialise the SDK. Mirrors `ze.init()` from the Python SDK.
 * Stores credentials in process.env for simplicity; callers may also
 * set env vars before requiring the SDK.
 */
declare function init(opts?: InitOptions): void;

/** Return the current active Span (or undefined). */
declare function getCurrentSpan(): Span | undefined;
/** Return the current trace ID (or undefined). */
declare function getCurrentTrace(): string | undefined;
/** Return the current session ID (or undefined). */
declare function getCurrentSession(): string | undefined;
/** Attach tags to a span / trace / session following Python SDK semantics. */
declare function setTag(target: Span | string | undefined, tags: Record<string, string>): void;

export { getCurrentSession, getCurrentSpan, getCurrentTrace, init, setTag, span, tracer, withSpan };
