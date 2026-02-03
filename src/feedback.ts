/**
 * Feedback API for sending feedback on prompt completions.
 * Ports the logic from zeroeval-sdk/src/zeroeval/__init__.py and client.py
 */

import type { PromptFeedbackCreate, PromptFeedbackResponse } from './types/prompt';
import { PromptRequestError } from './errors';
import { getLogger } from './observability/logger';

const logger = getLogger('zeroeval.feedback');

function getApiUrl(): string {
  return (process.env.ZEROEVAL_API_URL ?? 'https://api.zeroeval.com').replace(/\/$/, '');
}

function getApiKey(): string | undefined {
  return process.env.ZEROEVAL_API_KEY;
}

/**
 * Options for sending feedback on a completion.
 */
export interface SendFeedbackOptions {
  /** The slug of the prompt (or task name for judges) */
  promptSlug: string;
  /** UUID of the span/completion to provide feedback on */
  completionId: string;
  /** True for positive feedback, False for negative */
  thumbsUp: boolean;
  /** Optional explanation of the feedback */
  reason?: string;
  /** Optional description of what the expected output should be */
  expectedOutput?: string;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
  /**
   * Optional judge automation ID. When provided, feedback is
   * associated with the judge's evaluation span instead of the
   * original span. Required when providing feedback for judge evaluations.
   */
  judgeId?: string;
  /**
   * Optional expected score for scored judge evaluations.
   * Only valid when judgeId points to a scored judge.
   */
  expectedScore?: number;
  /**
   * Optional direction indicating if score was "too_high" or "too_low".
   * Only valid when judgeId points to a scored judge.
   */
  scoreDirection?: 'too_high' | 'too_low';
}

/**
 * Send feedback for a specific completion.
 *
 * Use this to provide feedback on LLM completions for optimization.
 * Positive feedback indicates the output was good, negative feedback
 * indicates it needs improvement.
 *
 * @param options - Feedback options
 * @returns The created feedback record
 *
 * @example
 * ```typescript
 * await sendFeedback({
 *   promptSlug: "customer-support",
 *   completionId: "span-uuid-here",
 *   thumbsUp: true,
 *   reason: "Response was helpful and accurate"
 * });
 * ```
 */
export async function sendFeedback(options: SendFeedbackOptions): Promise<PromptFeedbackResponse> {
  const {
    promptSlug,
    completionId,
    thumbsUp,
    reason,
    expectedOutput,
    metadata,
    judgeId,
    expectedScore,
    scoreDirection,
  } = options;

  const url = `${getApiUrl()}/v1/prompts/${encodeURIComponent(promptSlug)}/completions/${completionId}/feedback`;

  logger.debug(
    `[ZeroEval] Sending feedback for completion_id=${completionId}, prompt_slug=${promptSlug}`
  );

  // Build payload with only non-undefined fields
  const body: PromptFeedbackCreate = {
    thumbs_up: thumbsUp,
  };

  if (reason !== undefined) {
    body.reason = reason;
  }
  if (expectedOutput !== undefined) {
    body.expected_output = expectedOutput;
  }
  if (metadata !== undefined) {
    body.metadata = metadata;
  }
  if (judgeId !== undefined) {
    body.judge_id = judgeId;
  }
  if (expectedScore !== undefined) {
    body.expected_score = expectedScore;
  }
  if (scoreDirection !== undefined) {
    body.score_direction = scoreDirection;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  logger.debug(`[ZeroEval] Feedback response status=${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    throw new PromptRequestError(`send_feedback failed: ${text}`, res.status, text);
  }

  return res.json();
}
