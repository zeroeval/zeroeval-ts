import {
  Integration
} from "./chunk-ATTYGEN4.js";
import {
  __require,
  tracer
} from "./chunk-PDBLJJLJ.js";

// src/observability/integrations/openai.ts
var OpenAIIntegration = class extends Integration {
  static isAvailable() {
    try {
      __require.resolve("openai");
      return true;
    } catch (_) {
      return false;
    }
  }
  setup() {
    let mod;
    try {
      mod = __require("openai");
    } catch {
      return;
    }
    const patchClient = (ClientCtor) => {
      if (!ClientCtor?.prototype?.chat?.completions)
        return;
      this.patchMethod(ClientCtor.prototype.chat.completions, "create", (orig) => {
        return function patched(...args) {
          const [params] = args;
          const span = tracer.startSpan("openai.chat.completions.create", {
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
                span.setIO(JSON.stringify(params), resp?.choices?.[0]?.message?.content);
                tracer.endSpan(span);
                return resp;
              }).catch((err) => {
                span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                tracer.endSpan(span);
                throw err;
              });
            }
            span.setIO(JSON.stringify(params), result?.choices?.[0]?.message?.content);
            tracer.endSpan(span);
            return result;
          } catch (err) {
            span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
            tracer.endSpan(span);
            throw err;
          }
        };
      });
    };
    patchClient(mod.OpenAI);
    patchClient(mod.AsyncOpenAI);
  }
};
export {
  OpenAIIntegration
};
