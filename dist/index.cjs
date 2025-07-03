"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/observability/Span.ts
var import_crypto, Span;
var init_Span = __esm({
  "src/observability/Span.ts"() {
    "use strict";
    import_crypto = require("crypto");
    Span = class {
      constructor(name, traceId) {
        this.spanId = (0, import_crypto.randomUUID)();
        this.startTime = Date.now();
        this.attributes = {};
        this.tags = {};
        this.traceTags = {};
        this.sessionTags = {};
        this.status = "ok";
        this.name = name;
        this.traceId = traceId ?? (0, import_crypto.randomUUID)();
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
  }
});

// src/observability/writer.ts
var BackendSpanWriter;
var init_writer = __esm({
  "src/observability/writer.ts"() {
    "use strict";
    BackendSpanWriter = class {
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
  }
});

// src/observability/integrations/base.ts
var _Integration, Integration;
var init_base = __esm({
  "src/observability/integrations/base.ts"() {
    "use strict";
    _Integration = class _Integration {
      constructor() {
        this.originals = /* @__PURE__ */ new Map();
      }
      patchMethod(obj, key, build) {
        const orig = obj[key];
        if (typeof orig !== "function" || orig[_Integration.PATCHED])
          return;
        const wrapped = build(orig);
        wrapped[_Integration.PATCHED] = true;
        if (!this.originals.has(obj))
          this.originals.set(obj, /* @__PURE__ */ new Map());
        this.originals.get(obj).set(key, orig);
        obj[key] = wrapped;
      }
      teardown() {
        for (const [obj, map] of this.originals.entries()) {
          for (const [k, fn] of map) {
            obj[k] = fn;
          }
        }
        this.originals = /* @__PURE__ */ new Map();
      }
    };
    _Integration.PATCHED = Symbol("zePatched");
    Integration = _Integration;
  }
});

// src/observability/integrations/openai.ts
var openai_exports = {};
__export(openai_exports, {
  OpenAIIntegration: () => OpenAIIntegration
});
var OpenAIIntegration;
var init_openai = __esm({
  "src/observability/integrations/openai.ts"() {
    "use strict";
    init_base();
    init_Tracer();
    OpenAIIntegration = class extends Integration {
      static isAvailable() {
        try {
          require.resolve("openai");
          return true;
        } catch (_) {
          return false;
        }
      }
      setup() {
        let mod;
        try {
          mod = require("openai");
        } catch {
          return;
        }
        const patchClient = (ClientCtor) => {
          if (!ClientCtor?.prototype?.chat?.completions)
            return;
          this.patchMethod(ClientCtor.prototype.chat.completions, "create", (orig) => {
            return function patched(...args) {
              const [params] = args;
              const span2 = tracer.startSpan("openai.chat.completions.create", {
                attributes: {
                  provider: "openai",
                  model: params?.model,
                  streaming: !!params?.stream
                },
                tags: { integration: "openai" }
              });
              try {
                const result = orig.apply(this, args);
                if (result?.then) {
                  return result.then((resp) => {
                    span2.setIO(JSON.stringify(params), resp?.choices?.[0]?.message?.content);
                    tracer.endSpan(span2);
                    return resp;
                  }).catch((err) => {
                    span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                    tracer.endSpan(span2);
                    throw err;
                  });
                }
                span2.setIO(JSON.stringify(params), result?.choices?.[0]?.message?.content);
                tracer.endSpan(span2);
                return result;
              } catch (err) {
                span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                tracer.endSpan(span2);
                throw err;
              }
            };
          });
        };
        patchClient(mod.OpenAI);
        patchClient(mod.AsyncOpenAI);
      }
    };
  }
});

// src/observability/integrations/langchain.ts
var langchain_exports = {};
__export(langchain_exports, {
  LangChainIntegration: () => LangChainIntegration
});
var LangChainIntegration;
var init_langchain = __esm({
  "src/observability/integrations/langchain.ts"() {
    "use strict";
    init_base();
    init_Tracer();
    LangChainIntegration = class extends Integration {
      static isAvailable() {
        try {
          require.resolve("langchain");
          return true;
        } catch (_) {
          try {
            require.resolve("langchain-core");
            return true;
          } catch {
            return false;
          }
        }
      }
      async setup() {
        let mod;
        try {
          mod = await import("langchain");
        } catch {
          try {
            mod = await import("langchain-core");
          } catch {
            return;
          }
        }
        const Runnable = mod.Runnable ?? mod.RunnableBase ?? mod.RunnableSequence ?? void 0;
        if (!Runnable)
          return;
        const methods = ["invoke", "ainvoke", "stream", "astream", "batch", "abatch"];
        for (const method of methods) {
          if (typeof Runnable.prototype[method] !== "function")
            continue;
          this.patchMethod(Runnable.prototype, method, (orig) => {
            const isAsync = method.toString().startsWith("a");
            const name = `langchain.${String(method)}`;
            if (isAsync) {
              return async function patched(...args) {
                const span2 = tracer.startSpan(name, {
                  attributes: { class: this?.constructor?.name, method: String(method) },
                  tags: { integration: "langchain" }
                });
                try {
                  const res = await orig.apply(this, args);
                  span2.setIO(JSON.stringify(args[0]), JSON.stringify(res));
                  tracer.endSpan(span2);
                  return res;
                } catch (err) {
                  span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                  tracer.endSpan(span2);
                  throw err;
                }
              };
            }
            return function patched(...args) {
              const span2 = tracer.startSpan(name, {
                attributes: { class: this?.constructor?.name, method: String(method) },
                tags: { integration: "langchain" }
              });
              try {
                const res = orig.apply(this, args);
                if (res?.then) {
                  return res.then((r) => {
                    span2.setIO(JSON.stringify(args[0]), JSON.stringify(r));
                    tracer.endSpan(span2);
                    return r;
                  }).catch((err) => {
                    span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                    tracer.endSpan(span2);
                    throw err;
                  });
                }
                span2.setIO(JSON.stringify(args[0]), JSON.stringify(res));
                tracer.endSpan(span2);
                return res;
              } catch (err) {
                span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                tracer.endSpan(span2);
                throw err;
              }
            };
          });
        }
      }
    };
  }
});

// src/observability/integrations/langgraph.ts
var langgraph_exports = {};
__export(langgraph_exports, {
  LangGraphIntegration: () => LangGraphIntegration
});
var LangGraphIntegration;
var init_langgraph = __esm({
  "src/observability/integrations/langgraph.ts"() {
    "use strict";
    init_base();
    init_Tracer();
    LangGraphIntegration = class extends Integration {
      static isAvailable() {
        try {
          require.resolve("langgraph");
          return true;
        } catch (_) {
          return false;
        }
      }
      async setup() {
        let mod;
        try {
          mod = await import("langgraph");
        } catch {
          return;
        }
        const Graph = mod.Graph ?? mod.StateGraph ?? void 0;
        if (!Graph)
          return;
        const patchInvoke = (obj) => {
          ["invoke", "ainvoke"].forEach((method) => {
            if (typeof obj.prototype[method] !== "function")
              return;
            this.patchMethod(obj.prototype, method, (orig) => {
              const isAsync = method.startsWith("a");
              const name = `langgraph.${method}`;
              if (isAsync) {
                return async function patched(...args) {
                  const span2 = tracer.startSpan(name, {
                    attributes: { class: this?.constructor?.name },
                    tags: { integration: "langgraph" }
                  });
                  try {
                    const res = await orig.apply(this, args);
                    span2.setIO(JSON.stringify(args[0]), JSON.stringify(res));
                    tracer.endSpan(span2);
                    return res;
                  } catch (err) {
                    span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                    tracer.endSpan(span2);
                    throw err;
                  }
                };
              }
              return function patched(...args) {
                const span2 = tracer.startSpan(name, {
                  attributes: { class: this?.constructor?.name },
                  tags: { integration: "langgraph" }
                });
                try {
                  const res = orig.apply(this, args);
                  if (res?.then) {
                    return res.then((r) => {
                      span2.setIO(JSON.stringify(args[0]), JSON.stringify(r));
                      tracer.endSpan(span2);
                      return r;
                    }).catch((err) => {
                      span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                      tracer.endSpan(span2);
                      throw err;
                    });
                  }
                  span2.setIO(JSON.stringify(args[0]), JSON.stringify(res));
                  tracer.endSpan(span2);
                  return res;
                } catch (err) {
                  span2.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                  tracer.endSpan(span2);
                  throw err;
                }
              };
            });
          });
        };
        patchInvoke(Graph);
        if (Graph.prototype?.compile) {
          this.patchMethod(Graph.prototype, "compile", (orig) => {
            return function patched(...args) {
              const compiled = orig.apply(this, args);
              patchInvoke(compiled.constructor);
              return compiled;
            };
          });
        }
      }
    };
  }
});

// src/observability/integrations/utils.ts
async function discoverIntegrations() {
  const integrations = {};
  try {
    await import("openai");
    const { OpenAIIntegration: OpenAIIntegration2 } = await Promise.resolve().then(() => (init_openai(), openai_exports));
    integrations.openai = OpenAIIntegration2;
  } catch (_) {
  }
  try {
    await import("langchain");
    const { LangChainIntegration: LangChainIntegration2 } = await Promise.resolve().then(() => (init_langchain(), langchain_exports));
    integrations.langchain = LangChainIntegration2;
  } catch (_) {
  }
  try {
    await import("langgraph");
    const { LangGraphIntegration: LangGraphIntegration2 } = await Promise.resolve().then(() => (init_langgraph(), langgraph_exports));
    integrations.langgraph = LangGraphIntegration2;
  } catch (_) {
  }
  return integrations;
}
var init_utils = __esm({
  "src/observability/integrations/utils.ts"() {
    "use strict";
  }
});

// src/observability/Tracer.ts
var import_async_hooks, import_timers, als, Tracer, tracer;
var init_Tracer = __esm({
  "src/observability/Tracer.ts"() {
    "use strict";
    import_async_hooks = require("async_hooks");
    init_Span();
    init_writer();
    import_timers = require("timers");
    init_utils();
    als = new import_async_hooks.AsyncLocalStorage();
    Tracer = class {
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
        (0, import_timers.setInterval)(() => {
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
        const span2 = new Span(name, parent?.traceId);
        if (parent) {
          span2.parentId = parent.spanId;
          span2.sessionId = parent.sessionId;
          span2.sessionName = parent.sessionName;
          span2.tags = { ...parent.tags, ...opts.tags };
        } else {
          span2.sessionId = opts.sessionId ?? require("crypto").randomUUID();
          span2.sessionName = opts.sessionName;
          span2.tags = { ...opts.tags };
        }
        Object.assign(span2.attributes, opts.attributes);
        const parentStack = als.getStore() ?? [];
        als.enterWith([...parentStack, span2]);
        this._activeTraceCounts[span2.traceId] = (this._activeTraceCounts[span2.traceId] || 0) + 1;
        return span2;
      }
      endSpan(span2) {
        var _a, _b;
        if (!span2.endTime)
          span2.end();
        const stack = als.getStore();
        if (stack && stack[stack.length - 1] === span2) {
          stack.pop();
        }
        const traceBucket = (_a = this._traceBuckets)[_b = span2.traceId] || (_a[_b] = []);
        traceBucket.push(span2);
        this._activeTraceCounts[span2.traceId] -= 1;
        if (this._activeTraceCounts[span2.traceId] === 0) {
          delete this._activeTraceCounts[span2.traceId];
          const ordered = traceBucket.sort((a) => a.parentId ? 1 : -1);
          delete this._traceBuckets[span2.traceId];
          this._buffer.push(...ordered);
        }
        if (this._buffer.length >= this._maxSpans)
          this.flush();
      }
      /* TAG HELPERS -----------------------------------------------------------*/
      addTraceTags(traceId, tags) {
        for (const span2 of this._traceBuckets[traceId] ?? [])
          Object.assign(span2.tags, tags);
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
    tracer = new Tracer();
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  getCurrentSession: () => getCurrentSession,
  getCurrentSpan: () => getCurrentSpan,
  getCurrentTrace: () => getCurrentTrace,
  init: () => init,
  setTag: () => setTag,
  span: () => span,
  tracer: () => tracer,
  withSpan: () => withSpan
});
module.exports = __toCommonJS(src_exports);

// src/observability/spanDecorator.ts
init_Tracer();
function span(opts) {
  return function(_target, _propertyKey, descriptor) {
    if (descriptor && typeof descriptor.value === "function") {
      const original = descriptor.value;
      const isAsync = original.constructor.name === "AsyncFunction";
      const wrapper = function(...args) {
        const spanInst = tracer.startSpan(opts.name, {
          attributes: opts.attributes,
          sessionId: opts.sessionId,
          sessionName: opts.sessionName,
          tags: opts.tags
        });
        try {
          const result = original.apply(this, args);
          if (isAsync && result && typeof result.then === "function") {
            return result.then((r) => {
              if (opts.inputData === void 0) {
                spanInst.setIO(JSON.stringify(args, replacer, 2), opts.outputData ?? r);
              } else {
                spanInst.setIO(opts.inputData, opts.outputData ?? r);
              }
              tracer.endSpan(spanInst);
              return r;
            }).catch((err) => {
              spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
              tracer.endSpan(spanInst);
              throw err;
            });
          }
          if (opts.inputData === void 0) {
            spanInst.setIO(JSON.stringify(args, replacer, 2), opts.outputData ?? result);
          } else {
            spanInst.setIO(opts.inputData, opts.outputData ?? result);
          }
          tracer.endSpan(spanInst);
          return result;
        } catch (err) {
          spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
          tracer.endSpan(spanInst);
          throw err;
        }
      };
      Object.defineProperty(wrapper, "name", { value: original.name });
      descriptor.value = wrapper;
      return descriptor;
    }
  };
}
function withSpan(opts, fn) {
  const spanInst = tracer.startSpan(opts.name, {
    attributes: opts.attributes,
    sessionId: opts.sessionId,
    sessionName: opts.sessionName,
    tags: opts.tags
  });
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then((res) => {
        if (opts.inputData !== void 0) {
          spanInst.setIO(opts.inputData, opts.outputData ?? res);
        }
        tracer.endSpan(spanInst);
        return res;
      }).catch((err) => {
        spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
        tracer.endSpan(spanInst);
        throw err;
      });
    }
    if (opts.inputData !== void 0) {
      spanInst.setIO(opts.inputData, opts.outputData ?? result);
    }
    tracer.endSpan(spanInst);
    return result;
  } catch (err) {
    spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
    tracer.endSpan(spanInst);
    throw err;
  }
}
function replacer(_key, value) {
  if (typeof value === "bigint")
    return value.toString();
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`;
  return value;
}

// src/index.ts
init_Tracer();

// src/init.ts
init_Tracer();
function init(opts = {}) {
  const {
    apiKey,
    apiUrl,
    flushInterval,
    maxSpans,
    collectCodeDetails,
    integrations
  } = opts;
  if (apiKey)
    process.env.ZEROEVAL_API_KEY = apiKey;
  if (apiUrl)
    process.env.ZEROEVAL_API_URL = apiUrl;
  tracer.configure({ flushInterval, maxSpans, collectCodeDetails, integrations });
}

// src/helpers.ts
init_Tracer();
function getCurrentSpan() {
  return tracer.currentSpan();
}
function getCurrentTrace() {
  return tracer.currentSpan()?.traceId;
}
function getCurrentSession() {
  return tracer.currentSpan()?.sessionId;
}
function setTag(target, tags) {
  if (!target || !tags || typeof tags !== "object")
    return;
  if (typeof target !== "string") {
    Object.assign(target.tags, tags);
  } else {
    if (tracer.isActiveTrace(target)) {
      tracer.addTraceTags(target, tags);
    } else {
      tracer.addSessionTags(target, tags);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getCurrentSession,
  getCurrentSpan,
  getCurrentTrace,
  init,
  setTag,
  span,
  tracer,
  withSpan
});
