import { Integration } from './base';
import { tracer } from '../Tracer';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyFn = (...args: any[]) => any;

export class LangGraphIntegration extends Integration {
  static isAvailable(): boolean {
    try {
      require.resolve('langgraph');
      return true;
    } catch (_) {
      return false;
    }
  }

  async setup(): Promise<void> {
    let mod: any;
    try {
      mod = await import('langgraph');
    } catch {
      return;
    }

    const Graph = mod.Graph ?? mod.StateGraph ?? undefined;
    if (!Graph) return;

    const patchInvoke = (obj: any) => {
      ['invoke', 'ainvoke'].forEach((method) => {
        if (typeof obj.prototype[method] !== 'function') return;
        this.patchMethod(obj.prototype, method, (orig: AnyFn): AnyFn => {
          const isAsync = method.startsWith('a');
          const name = `langgraph.${method}`;

          if (isAsync) {
            return async function patched(this: any, ...args: any[]) {
              const span = tracer.startSpan(name, {
                attributes: { class: this?.constructor?.name },
                tags: { integration: 'langgraph' },
              });
              try {
                const res = await orig.apply(this, args);
                span.setIO(JSON.stringify(args[0]), JSON.stringify(res));
                tracer.endSpan(span);
                return res;
              } catch (err: any) {
                span.setError({
                  code: err?.name,
                  message: err?.message,
                  stack: err?.stack,
                });
                tracer.endSpan(span);
                throw err;
              }
            };
          }

          return function patched(this: any, ...args: any[]) {
            const span = tracer.startSpan(name, {
              attributes: { class: this?.constructor?.name },
              tags: { integration: 'langgraph' },
            });
            try {
              const res = orig.apply(this, args);
              if (res?.then) {
                return res
                  .then((r: any) => {
                    span.setIO(JSON.stringify(args[0]), JSON.stringify(r));
                    tracer.endSpan(span);
                    return r;
                  })
                  .catch((err: any) => {
                    span.setError({
                      code: err?.name,
                      message: err?.message,
                      stack: err?.stack,
                    });
                    tracer.endSpan(span);
                    throw err;
                  });
              }
              span.setIO(JSON.stringify(args[0]), JSON.stringify(res));
              tracer.endSpan(span);
              return res;
            } catch (err: any) {
              span.setError({
                code: err?.name,
                message: err?.message,
                stack: err?.stack,
              });
              tracer.endSpan(span);
              throw err;
            }
          };
        });
      });
    };

    patchInvoke(Graph);
    if (Graph.prototype?.compile) {
      this.patchMethod(Graph.prototype, 'compile', (orig: AnyFn): AnyFn => {
        return function patched(this: any, ...args: any[]) {
          const compiled = orig.apply(this, args);
          patchInvoke(compiled.constructor);
          return compiled;
        };
      });
    }
  }
}
