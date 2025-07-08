import { Integration } from './base';
import { tracer } from '../Tracer';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyFn = (...args: any[]) => any;

export class LangChainIntegration extends Integration {
  static isAvailable(): boolean {
    try {
      require.resolve('langchain');
      return true;
    } catch (_) {
      try {
        require.resolve('langchain-core');
        return true;
      } catch {
        return false;
      }
    }
  }

  async setup(): Promise<void> {
    let mod: any;
    try {
      mod = await import('langchain');
    } catch {
      try {
        mod = await import('langchain-core');
      } catch {
        return;
      }
    }

    const Runnable =
      mod.Runnable ?? mod.RunnableBase ?? mod.RunnableSequence ?? undefined;
    if (!Runnable) return;

    const methods: Array<keyof any> = [
      'invoke',
      'ainvoke',
      'stream',
      'astream',
      'batch',
      'abatch',
    ];

    for (const method of methods) {
      if (typeof Runnable.prototype[method] !== 'function') continue;
      this.patchMethod(
        Runnable.prototype as any,
        method as any,
        (orig: AnyFn): AnyFn => {
          const isAsync = method.toString().startsWith('a');
          const name = `langchain.${String(method)}`;

          if (isAsync) {
            return async function patched(this: any, ...args: any[]) {
              const className = this?.constructor?.name;
              const attrs: Record<string, unknown> = {
                class: className,
                method: String(method),
              };

              if (
                typeof className === 'string' &&
                className.includes('ChatOpenAI')
              ) {
                attrs.kind = 'llm';
                attrs.provider = 'openai';
                attrs['service.name'] = 'openai';
              }

              const span = tracer.startSpan(name, {
                attributes: attrs,
                tags: { integration: 'langchain' },
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
            const className = this?.constructor?.name;
            const attrs: Record<string, unknown> = {
              class: className,
              method: String(method),
            };
            if (
              typeof className === 'string' &&
              className.includes('ChatOpenAI')
            ) {
              attrs.kind = 'llm';
              attrs.provider = 'openai';
              attrs['service.name'] = 'openai';
            }

            const span = tracer.startSpan(name, {
              attributes: attrs,
              tags: { integration: 'langchain' },
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
        }
      );
    }
  }
}
