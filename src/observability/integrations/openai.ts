import { Integration } from './base';
import { tracer } from '../Tracer';

type AnyFn = (...args: any[]) => any;

export class OpenAIIntegration extends Integration {
  static isAvailable(): boolean {
    try {
      require.resolve('openai');
      return true;
    } catch (_) {
      return false;
    }
  }

  setup(): void {
    let mod: any;
    try {
      mod = require('openai');
    } catch {
      return;
    }

    const patchClient = (ClientCtor: any) => {
      if (!ClientCtor?.prototype?.chat?.completions) return;
      this.patchMethod(ClientCtor.prototype.chat.completions, 'create', (orig: AnyFn): AnyFn => {
        return function patched(this: any, ...args: any[]) {
          const [params] = args;
          const span = tracer.startSpan('openai.chat.completions.create', {
            attributes: {
              provider: 'openai',
              model: params?.model,
              streaming: !!params?.stream,
            },
            tags: { integration: 'openai' },
          });
          try {
            const result = orig.apply(this, args);
            if (result?.then) {
              return result
                .then((resp: any) => {
                  span.setIO(JSON.stringify(params), resp?.choices?.[0]?.message?.content);
                  tracer.endSpan(span);
                  return resp;
                })
                .catch((err: any) => {
                  span.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                  tracer.endSpan(span);
                  throw err;
                });
            }
            span.setIO(JSON.stringify(params), result?.choices?.[0]?.message?.content);
            tracer.endSpan(span);
            return result;
          } catch (err: any) {
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
} 