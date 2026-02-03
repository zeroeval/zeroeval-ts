/*
 * ZeroEval TS SDK – public API
 * Re-exports minimal observability surface (span decorator, tracer) so
 * consumers can simply `import * as ze from '@zeroeval/sdk'`.
 */

// Core exports
export { init, isInitialized, validateInit } from './init';
export { span } from './observability/spanDecorator';
export { withSpan } from './observability/spanDecorator';
export { tracer } from './observability/Tracer';
export {
  getCurrentSpan,
  getCurrentTrace,
  getCurrentSession,
  setTag,
} from './helpers';
export { wrap } from './observability/integrations/wrapper';
// Keep wrapOpenAI for backward compatibility
export { wrapOpenAI } from './observability/integrations/openaiWrapper';
// Export wrapVercelAI for direct usage
export { wrapVercelAI } from './observability/integrations/vercelAIWrapper';
export { Span } from './observability/Span';

// Integrations
export { LangChainIntegration } from './observability/integrations/langchain';

// Signals API
export {
  sendSignal,
  sendBulkSignals,
  sendTraceSignal,
  sendSessionSignal,
  sendSpanSignal,
  getEntitySignals,
} from './signals';
export type { Signal, SignalCreate } from './observability/signals';

// Prompt management
export { prompt } from './prompt';
export { sendFeedback } from './feedback';
export type { SendFeedbackOptions } from './feedback';

// Prompt types
export type {
  Prompt,
  PromptOptions,
  PromptMetadata,
  PromptResponse,
  PromptFeedbackCreate,
  PromptFeedbackResponse,
  PromptVersionCreate,
} from './types/prompt';

// Prompt errors
export { PromptNotFoundError, PromptRequestError } from './errors';

// Prompt utilities (for advanced users)
export { sha256Hex, normalizePromptText } from './utils/hash';
export { renderTemplate, extractVariables } from './utils/template';
export { decoratePrompt, extractZeroEvalMetadata } from './utils/metadata';
