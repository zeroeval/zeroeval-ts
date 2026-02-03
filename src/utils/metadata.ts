/**
 * Metadata utilities for decorating and extracting <zeroeval> metadata tags.
 * Ports the logic from zeroeval-sdk/src/zeroeval/observability/integrations/openai/integration.py
 */

import type { PromptMetadata } from '../types/prompt';

/**
 * Pattern to match <zeroeval>{...}</zeroeval> tags.
 * Uses 's' flag (dotAll) so '.' matches newlines.
 */
const ZEROEVAL_PATTERN = /<zeroeval>(.*?)<\/zeroeval>/s;

/**
 * Decorate prompt content with <zeroeval> metadata tags.
 *
 * When this prompt is used in an OpenAI API call, ZeroEval will automatically:
 * 1. Extract the task metadata from the prompt
 * 2. Link the span to the specified task
 * 3. Create the task automatically if it doesn't exist yet
 *
 * @param content - The actual prompt content
 * @param metadata - The metadata to embed
 * @returns A string with the format: <zeroeval>{JSON}</zeroeval>content
 *
 * @example
 * ```typescript
 * decoratePrompt("You are a helpful assistant.", {
 *   task: "customer-support",
 *   variables: { tone: "friendly" }
 * })
 * // Returns: '<zeroeval>{"task":"customer-support","variables":{"tone":"friendly"}}</zeroeval>You are a helpful assistant.'
 * ```
 */
export function decoratePrompt(content: string, metadata: PromptMetadata): string {
  // Build metadata object, only including non-undefined values
  const metadataObj: Record<string, unknown> = {
    task: metadata.task,
  };

  if (metadata.variables && Object.keys(metadata.variables).length > 0) {
    metadataObj.variables = metadata.variables;
  }
  if (metadata.prompt_slug) {
    metadataObj.prompt_slug = metadata.prompt_slug;
  }
  if (metadata.prompt_version !== undefined) {
    metadataObj.prompt_version = Number(metadata.prompt_version);
  }
  if (metadata.prompt_version_id) {
    metadataObj.prompt_version_id = String(metadata.prompt_version_id);
  }
  if (metadata.content_hash) {
    metadataObj.content_hash = String(metadata.content_hash);
  }

  const metadataJson = JSON.stringify(metadataObj);
  return `<zeroeval>${metadataJson}</zeroeval>${content}`;
}

/**
 * Result of extracting metadata from content.
 */
export interface ExtractResult {
  /** Extracted metadata, or null if no tags found */
  metadata: PromptMetadata | null;
  /** Content with <zeroeval> tags removed */
  cleanContent: string;
}

/**
 * Extract <zeroeval> metadata from content.
 *
 * @param content - Content that may contain <zeroeval> tags
 * @returns Object with metadata (or null) and cleaned content
 *
 * @example
 * ```typescript
 * const { metadata, cleanContent } = extractZeroEvalMetadata(
 *   '<zeroeval>{"task":"test"}</zeroeval>Hello world'
 * );
 * // metadata = { task: "test" }
 * // cleanContent = "Hello world"
 * ```
 */
export function extractZeroEvalMetadata(content: string): ExtractResult {
  const match = content.match(ZEROEVAL_PATTERN);

  if (!match) {
    return { metadata: null, cleanContent: content };
  }

  try {
    const jsonStr = match[1].trim();
    const parsed = JSON.parse(jsonStr);

    // Validate that it's an object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Metadata must be a JSON object');
    }

    // Validate required 'task' field
    if (typeof parsed.task !== 'string') {
      throw new Error('Metadata must have a "task" string field');
    }

    const metadata: PromptMetadata = {
      task: parsed.task,
    };

    // Copy optional fields
    if (parsed.variables && typeof parsed.variables === 'object') {
      metadata.variables = parsed.variables;
    }
    if (typeof parsed.prompt_slug === 'string') {
      metadata.prompt_slug = parsed.prompt_slug;
    }
    if (typeof parsed.prompt_version === 'number') {
      metadata.prompt_version = parsed.prompt_version;
    }
    if (typeof parsed.prompt_version_id === 'string') {
      metadata.prompt_version_id = parsed.prompt_version_id;
    }
    if (typeof parsed.content_hash === 'string') {
      metadata.content_hash = parsed.content_hash;
    }

    // Remove the <zeroeval> tags from content (only first occurrence)
    const cleanContent = content.replace(ZEROEVAL_PATTERN, '').trim();

    return { metadata, cleanContent };
  } catch (error) {
    // On parse error, return null metadata but keep original content
    // This matches the Python SDK's behavior of raising but we'll be more lenient
    return { metadata: null, cleanContent: content };
  }
}
