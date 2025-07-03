import {
  tracer
} from "./chunk-PDBLJJLJ.js";

// src/observability/spanDecorator.ts
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

// src/init.ts
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
export {
  getCurrentSession,
  getCurrentSpan,
  getCurrentTrace,
  init,
  setTag,
  span,
  tracer,
  withSpan
};
