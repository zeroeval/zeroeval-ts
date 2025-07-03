/*
 * ZeroEval TS SDK – public API
 * Re-exports minimal observability surface (span decorator, tracer) so
 * consumers can simply `import * as ze from '@zeroeval/sdk'`.
 */

export { span } from './observability/spanDecorator';
export { withSpan } from './observability/spanDecorator';
export { tracer } from './observability/Tracer';
export { init } from './init';
export {
  getCurrentSpan,
  getCurrentTrace,
  getCurrentSession,
  setTag,
} from './helpers'; 