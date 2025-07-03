import {
  Integration
} from "./chunk-ATTYGEN4.js";
import {
  __require,
  tracer
} from "./chunk-DECWBGCZ.js";

// src/observability/integrations/langgraph.ts
var LangGraphIntegration = class extends Integration {
  static isAvailable() {
    try {
      __require.resolve("langgraph");
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
              const span = tracer.startSpan(name, {
                attributes: { class: this?.constructor?.name },
                tags: { integration: "langgraph" }
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
              attributes: { class: this?.constructor?.name },
              tags: { integration: "langgraph" }
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
export {
  LangGraphIntegration
};
