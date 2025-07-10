import { tracer } from './Tracer';

export interface SpanOptions {
  name: string;
  sessionId?: string;
  sessionName?: string;
  tags?: Record<string, string>;
  attributes?: Record<string, unknown>;
  inputData?: unknown;
  outputData?: unknown;
}

// Utility overloads -----------------------------------------------------
export function span(
  opts: SpanOptions
): MethodDecorator & ((target: any, ...args: any[]) => any) {
  // Decorator path ------------------------------------------------------
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    if (descriptor && typeof descriptor.value === 'function') {
      const original = descriptor.value;
      const isAsync = original.constructor.name === 'AsyncFunction';

      const wrapper = function (this: any, ...args: any[]) {
        const spanInst = tracer.startSpan(opts.name, {
          attributes: opts.attributes,
          sessionId: opts.sessionId,
          sessionName: opts.sessionName,
          tags: opts.tags,
        });
        try {
          const result = original.apply(this, args);
          if (isAsync && result && typeof result.then === 'function') {
            return result
              .then((r: any) => {
                // capture args if inputData not provided
                if (opts.inputData === undefined) {
                  const output =
                    opts.outputData !== undefined
                      ? typeof opts.outputData === 'string'
                        ? opts.outputData
                        : JSON.stringify(opts.outputData, replacer, 2)
                      : typeof r === 'string'
                        ? r
                        : JSON.stringify(r, replacer, 2);
                  spanInst.setIO(JSON.stringify(args, replacer, 2), output);
                } else {
                  const output =
                    opts.outputData !== undefined ? opts.outputData : r;
                  spanInst.setIO(opts.inputData, output);
                }
                tracer.endSpan(spanInst);
                return r;
              })
              .catch((err: any) => {
                spanInst.setError({
                  code: err?.name,
                  message: err?.message,
                  stack: err?.stack,
                });
                tracer.endSpan(spanInst);
                throw err;
              });
          }
          // sync path
          if (opts.inputData === undefined) {
            const output =
              opts.outputData !== undefined
                ? typeof opts.outputData === 'string'
                  ? opts.outputData
                  : JSON.stringify(opts.outputData, replacer, 2)
                : typeof result === 'string'
                  ? result
                  : JSON.stringify(result, replacer, 2);
            spanInst.setIO(JSON.stringify(args, replacer, 2), output);
          } else {
            const output =
              opts.outputData !== undefined ? opts.outputData : result;
            spanInst.setIO(opts.inputData, output);
          }
          tracer.endSpan(spanInst);
          return result;
        } catch (err: any) {
          spanInst.setError({
            code: err?.name,
            message: err?.message,
            stack: err?.stack,
          });
          tracer.endSpan(spanInst);
          throw err;
        }
      };
      Object.defineProperty(wrapper, 'name', { value: original.name });
      descriptor.value = wrapper;
      return descriptor;
    }
    // Fallback: used as plain function wrapper => treat as context
  } as any;
}

// Context-like helper ---------------------------------------------------
export function withSpan<T>(
  opts: SpanOptions,
  fn: () => Promise<T> | T
): Promise<T> | T {
  const spanInst = tracer.startSpan(opts.name, {
    attributes: opts.attributes,
    sessionId: opts.sessionId,
    sessionName: opts.sessionName,
    tags: opts.tags,
  });
  try {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<T>)
        .then((res) => {
          if (opts.inputData !== undefined || opts.outputData !== undefined) {
            const output =
              opts.outputData !== undefined ? opts.outputData : res;
            spanInst.setIO(opts.inputData, output);
          }
          tracer.endSpan(spanInst);
          return res;
        })
        .catch((err) => {
          spanInst.setError({
            code: err?.name,
            message: err?.message,
            stack: err?.stack,
          });
          tracer.endSpan(spanInst);
          throw err;
        });
    }
    if (opts.inputData !== undefined || opts.outputData !== undefined) {
      const output = opts.outputData !== undefined ? opts.outputData : result;
      spanInst.setIO(opts.inputData, output);
    }
    tracer.endSpan(spanInst);
    return result as T;
  } catch (err: any) {
    spanInst.setError({
      code: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    tracer.endSpan(spanInst);
    throw err;
  }
}

// util replacer to avoid circular
function replacer(_key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function')
    return `[Function ${value.name || 'anonymous'}]`;
  return value;
}
