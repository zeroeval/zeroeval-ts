/**
 * Response from backend prompt endpoints
 * Maps to PromptGetResponse in backend/src/routes/prompts_route.py
 */
export interface PromptResponse {
  prompt: string; // prompt slug
  task_id: string | null; // actual task UUID from backend
  version_id: string;
  version: number;
  tag: string | null;
  is_latest: boolean;
  content: string;
  metadata: Record<string, unknown>;
  model_id: string | null;
  content_hash: string | null;
  evaluation_type: 'binary' | 'scored' | null;
  score_min: number | null;
  score_max: number | null;
  pass_threshold: number | null;
  temperature: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Internal SDK representation of a prompt
 */
export interface Prompt {
  content: string;
  version: number | null;
  versionId: string | null;
  taskId: string | null;
  promptSlug: string | null;
  tag: string | null;
  isLatest: boolean;
  model: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  source: 'server' | 'fallback';
}

/**
 * Options for ze.prompt()
 */
export interface PromptOptions {
  /** Task name associated with the prompt */
  name: string;
  /** Raw prompt content (used as fallback or for explicit mode) */
  content?: string;
  /** Template variables to interpolate {{variable}} tokens */
  variables?: Record<string, string>;
  /**
   * Version control mode:
   * - "latest": Fetch the latest version (fails if none exists)
   * - "explicit": Always use provided content (bypasses auto-optimization)
   * - "<hash>": Fetch a specific version by 64-char SHA-256 content hash
   */
  from?: 'latest' | 'explicit' | string;
}

/**
 * Metadata embedded in decorated prompts
 * Format: <zeroeval>{JSON}</zeroeval>{content}
 */
export interface PromptMetadata {
  task: string;
  variables?: Record<string, string>;
  prompt_slug?: string;
  prompt_version?: number;
  prompt_version_id?: string;
  content_hash?: string;
}

/**
 * Request body for ensure endpoint
 * POST /v1/tasks/{task_name}/prompt/versions/ensure
 */
export interface PromptVersionCreate {
  content: string;
  content_hash: string;
  metadata?: Record<string, unknown> | null;
  model_id?: string | null;
}

/**
 * Feedback request body
 * POST /v1/prompts/{prompt_slug}/completions/{completion_id}/feedback
 */
export interface PromptFeedbackCreate {
  thumbs_up: boolean;
  reason?: string | null;
  expected_output?: string | null;
  metadata?: Record<string, unknown> | null;
  judge_id?: string | null;
  expected_score?: number | null;
  score_direction?: 'too_high' | 'too_low' | null;
}

/**
 * Feedback response from backend
 */
export interface PromptFeedbackResponse {
  id: string;
  completion_id: string;
  prompt_id: string;
  prompt_version_id: string;
  project_id: string;
  thumbs_up: boolean;
  reason: string | null;
  expected_output: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  expected_score: number | null;
  score_direction: string | null;
}
