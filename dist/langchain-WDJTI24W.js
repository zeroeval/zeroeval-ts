import {
  Integration
} from "./chunk-ATTYGEN4.js";
import {
  __require,
  tracer
} from "./chunk-PDBLJJLJ.js";

// src/observability/integrations/langchain.ts
var LangChainIntegration = class extends Integration {
  static isAvailable() {
    try {
      __require.resolve("langchain");
      return true;
    } catch (_) {
      try {
        __require.resolve("langchain-core");
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
            const span = tracer.startSpan(name, {
              attributes: { class: this?.constructor?.name, method: String(method) },
              tags: { integration: "langchain" }
            });
            try {
              const res = await orig.apply(this, args);
              span.setIO(JSON.stringify(args[0]), JSON.stringify(res));
              tracer.endSpan(span);
              return res;
            } catch (err) {
              span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
              tracer.endSpan(span);
              throw err;
            }
          };
        }
        return function patched(...args) {
          const span = tracer.startSpan(name, {
            attributes: { class: this?.constructor?.name, method: String(method) },
            tags: { integration: "langchain" }
          });
          try {
            const res = orig.apply(this, args);
            if (res?.then) {
              return res.then((r) => {
                span.setIO(JSON.stringify(args[0]), JSON.stringify(r));
                tracer.endSpan(span);
                return r;
              }).catch((err) => {
                span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                tracer.endSpan(span);
                throw err;
              });
            }
            span.setIO(JSON.stringify(args[0]), JSON.stringify(res));
            tracer.endSpan(span);
            return res;
          } catch (err) {
            span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
            tracer.endSpan(span);
            throw err;
          }
        };
      });
    }
  }
};
export {
  LangChainIntegration
};
