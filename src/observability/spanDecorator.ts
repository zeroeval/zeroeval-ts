import { tracer } from './Tracer';
import { Span } from './Span';

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
export function span(opts: SpanOptions): MethodDecorator & ((target: any, ...args: any[]) => any) {
  // Decorator path ------------------------------------------------------
  return function (_target: any, _propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
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
                spanInst.setIO(opts.inputData ?? args, opts.outputData ?? r);
                tracer.endSpan(spanInst);
                return r;
              })
              .catch((err: any) => {
                spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
                tracer.endSpan(spanInst);
                throw err;
              });
          }
          // sync path
          spanInst.setIO(opts.inputData ?? args, opts.outputData ?? result);
          tracer.endSpan(spanInst);
          return result;
        } catch (err: any) {
          spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
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
export function withSpan<T>(opts: SpanOptions, fn: () => Promise<T> | T): Promise<T> | T {
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
          spanInst.setIO(opts.inputData, opts.outputData ?? res);
          tracer.endSpan(spanInst);
          return res;
        })
        .catch((err) => {
          spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
          tracer.endSpan(spanInst);
          throw err;
        });
    }
    spanInst.setIO(opts.inputData, opts.outputData ?? result);
    tracer.endSpan(spanInst);
    return result as T;
  } catch (err: any) {
    spanInst.setError({ code: err?.name, message: err?.message, stack: err?.stack });
    tracer.endSpan(spanInst);
    throw err;
  }
} 