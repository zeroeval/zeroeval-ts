var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/observability/Tracer.ts
import { AsyncLocalStorage } from "async_hooks";

// src/observability/Span.ts
import { randomUUID } from "crypto";
var Span = class {
  constructor(name, traceId) {
    this.spanId = randomUUID();
    this.startTime = Date.now();
    this.attributes = {};
    this.tags = {};
    this.traceTags = {};
    this.sessionTags = {};
    this.status = "ok";
    this.name = name;
    this.traceId = traceId ?? randomUUID();
  }
  end() {
    this.endTime = Date.now();
  }
  get durationMs() {
    return this.endTime ? this.endTime - this.startTime : void 0;
  }
  setError(info) {
    this.error = info;
    this.status = "error";
  }
  setIO(input, output) {
    if (input !== void 0)
      this.inputData = input;
    if (output !== void 0)
      this.outputData = output;
  }
  toJSON() {
    return {
      span_id: this.spanId,
      trace_id: this.traceId,
      parent_id: this.parentId,
      name: this.name,
      start_time: new Date(this.startTime).toISOString(),
      end_time: this.endTime ? new Date(this.endTime).toISOString() : void 0,
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
      status: this.status
    };
  }
};

// src/observability/writer.ts
var BackendSpanWriter = class {
  constructor() {
    this.apiUrl = (process.env.ZEROEVAL_API_URL ?? "https://api.zeroeval.com").replace(/\/$/, "");
  }
  getApiKey() {
    return process.env.ZEROEVAL_API_KEY;
  }
  async write(spans) {
    if (!spans.length)
      return;
    const endpoint = `${this.apiUrl}/spans`;
    const headers = {
      "Content-Type": "application/json"
    };
    const apiKey = this.getApiKey();
    if (apiKey)
      headers.Authorization = `Bearer ${apiKey}`;
    const payload = spans.map((s) => {
      const base = typeof s.toJSON === "function" ? s.toJSON() : s;
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
        error_stack: String(base.error_stack ?? ""),
        tags: base.tags,
        trace_tags: base.trace_tags,
        session_tags: base.session_tags
      };
    });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[ZeroEval] Failed posting spans: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error("[ZeroEval] Error posting spans", err);
    }
  }
};

// src/observability/Tracer.ts
import { setInterval } from "timers";

// src/observability/integrations/utils.ts
async function discoverIntegrations() {
  const integrations = {};
  try {
    await import("openai");
    const { OpenAIIntegration } = await import("./openai-GFXF5UCF.js");
    integrations.openai = OpenAIIntegration;
  } catch (_) {
  }
  try {
    await import("langchain");
    const { LangChainIntegration } = await import("./langchain-PNGID7NA.js");
    integrations.langchain = LangChainIntegration;
  } catch (_) {
  }
  try {
    await import("langgraph");
    const { LangGraphIntegration } = await import("./langgraph-MJW7VU5C.js");
    integrations.langgraph = LangGraphIntegration;
  } catch (_) {
  }
  return integrations;
}

// src/observability/Tracer.ts
var als = new AsyncLocalStorage();
var Tracer = class {
  constructor() {
    this._writer = new BackendSpanWriter();
    this._buffer = [];
    this._flushIntervalMs = 1e4;
    // default 10 s
    this._maxSpans = 100;
    this._lastFlush = Date.now();
    this._activeTraceCounts = {};
    this._traceBuckets = {};
    this._integrations = {};
    this._shuttingDown = false;
    setInterval(() => {
      if (Date.now() - this._lastFlush >= this._flushIntervalMs) {
        this.flush();
      }
    }, 1e3).unref();
    void this._setupAvailableIntegrations();
    process.on("beforeExit", () => this.shutdown());
    process.on("SIGINT", () => {
      this.shutdown();
      process.exit();
    });
    process.on("SIGTERM", () => {
      this.shutdown();
      process.exit();
    });
  }
  /* CONFIG ----------------------------------------------------------------*/
  configure(opts = {}) {
    if (opts.flushInterval !== void 0)
      this._flushIntervalMs = opts.flushInterval * 1e3;
    if (opts.maxSpans !== void 0)
      this._maxSpans = opts.maxSpans;
  }
  /* ACTIVE SPAN -----------------------------------------------------------*/
  currentSpan() {
    const stack = als.getStore();
    return stack && stack[stack.length - 1];
  }
  /* TRACING ---------------------------------------------------------------*/
  startSpan(name, opts = {}) {
    const parent = this.currentSpan();
    const span = new Span(name, parent?.traceId);
    if (parent) {
      span.parentId = parent.spanId;
      span.sessionId = parent.sessionId;
      span.sessionName = parent.sessionName;
      span.tags = { ...parent.tags, ...opts.tags };
    } else {
      span.sessionId = opts.sessionId ?? __require("crypto").randomUUID();
      span.sessionName = opts.sessionName;
      span.tags = { ...opts.tags };
    }
    Object.assign(span.attributes, opts.attributes);
    const parentStack = als.getStore() ?? [];
    als.enterWith([...parentStack, span]);
    this._activeTraceCounts[span.traceId] = (this._activeTraceCounts[span.traceId] || 0) + 1;
    return span;
  }
  endSpan(span) {
    var _a, _b;
    if (!span.endTime)
      span.end();
    const stack = als.getStore();
    if (stack && stack[stack.length - 1] === span) {
      stack.pop();
    }
    const traceBucket = (_a = this._traceBuckets)[_b = span.traceId] || (_a[_b] = []);
    traceBucket.push(span);
    this._activeTraceCounts[span.traceId] -= 1;
    if (this._activeTraceCounts[span.traceId] === 0) {
      delete this._activeTraceCounts[span.traceId];
      const ordered = traceBucket.sort((a) => a.parentId ? 1 : -1);
      delete this._traceBuckets[span.traceId];
      this._buffer.push(...ordered);
    }
    if (this._buffer.length >= this._maxSpans)
      this.flush();
  }
  /* TAG HELPERS -----------------------------------------------------------*/
  addTraceTags(traceId, tags) {
    for (const span of this._traceBuckets[traceId] ?? [])
      Object.assign(span.tags, tags);
    this._buffer.filter((s) => s.traceId === traceId).forEach((s) => Object.assign(s.tags, tags));
  }
  addSessionTags(sessionId, tags) {
    const all = [
      ...Object.values(this._traceBuckets).flat(),
      ...this._buffer
    ];
    all.filter((s) => s.sessionId === sessionId).forEach((s) => Object.assign(s.tags, tags));
  }
  isActiveTrace(traceId) {
    return traceId in this._activeTraceCounts || traceId in this._traceBuckets;
  }
  /* FLUSH -----------------------------------------------------------------*/
  flush() {
    if (this._buffer.length === 0)
      return;
    this._lastFlush = Date.now();
    this._writer.write(this._buffer.splice(0));
  }
  async _setupAvailableIntegrations() {
    const available = await discoverIntegrations();
    for (const [key, Ctor] of Object.entries(available)) {
      try {
        const inst = new Ctor();
        if (Ctor.isAvailable?.() !== false) {
          inst.setup();
          this._integrations[key] = inst;
        }
      } catch (err) {
        console.warn(`[ZeroEval] Failed to setup integration ${key}`, err);
      }
    }
  }
  /** Flush remaining spans and teardown integrations */
  shutdown() {
    if (this._shuttingDown)
      return;
    this._shuttingDown = true;
    try {
      this.flush();
    } catch (_) {
    }
    for (const inst of Object.values(this._integrations)) {
      try {
        inst.teardown();
      } catch (_) {
      }
    }
  }
};
var tracer = new Tracer();

export {
  __require,
  tracer
};
