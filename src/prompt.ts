/**
 * Version-aware prompt function integrated with Prompt Library.
 * Ports the logic from zeroeval-sdk/src/zeroeval/__init__.py
 */

import { getPromptClient } from './observability/promptClient';
import { sha256Hex, normalizePromptText } from './utils/hash';
import { decoratePrompt } from './utils/metadata';
import { PromptNotFoundError, PromptRequestError } from './errors';
import type { PromptOptions, Prompt, PromptMetadata } from './types/prompt';

/** Pattern to validate 64-character hex SHA-256 hash */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Version-aware prompt helper integrated with Prompt Library.
 *
 * When `content` is provided alone, it serves as a fallback - the SDK will automatically
 * fetch the latest optimized version from the backend if one exists. This allows you
 * to hardcode a default prompt while seamlessly using tuned versions in production.
 *
 * If `from` is specified, it controls version behavior:
 * - `from: "latest"` explicitly fetches the latest version (fails if none exists)
 * - `from: "explicit"` always uses the provided `content` (bypasses auto-optimization, requires `content`)
 * - `from: "<hash>"` fetches a specific version by its 64-char SHA-256 content hash
 *
 * @param options - Prompt configuration options
 * @returns Decorated prompt string with `<zeroeval>` metadata tags
 *
 * @example
 * ```typescript
 * // Auto-optimization mode (default)
 * const systemPrompt = await prompt({
 *   name: "customer-support",
 *   content: "You are a helpful {{role}} assistant.",
 *   variables: { role: "customer service" }
 * });
 *
 * // Explicit mode - always use provided content
 * const systemPrompt = await prompt({
 *   name: "customer-support",
 *   content: "You are a helpful assistant.",
 *   from: "explicit"
 * });
 *
 * // Latest mode - require optimized version to exist
 * const systemPrompt = await prompt({
 *   name: "customer-support",
 *   from: "latest"
 * });
 * ```
 */
export async function prompt(options: PromptOptions): Promise<string> {
  const { name, content, variables, from: fromMode } = options;

  // Validation
  if (!content && !fromMode) {
    throw new Error('Must provide either "content" or "from"');
  }

  if (fromMode === 'explicit' && !content) {
    throw new Error('from: "explicit" requires "content" to be provided');
  }

  const client = getPromptClient();
  let promptObj: Prompt;
  let contentHash: string | null = null;

  // Priority order:
  // 1. If from="explicit", always use the provided content (bypass auto-optimization)
  // 2. If from is specified (latest or hash), use it (strict mode)
  // 3. If only content is provided, try to fetch latest first, fall back to ensuring content

  if (fromMode === 'explicit') {
    // Explicit mode: always use the provided content, no auto-optimization
    contentHash = await sha256Hex(content!);
    promptObj = await client.ensureTaskPromptVersion(name, {
      content: normalizePromptText(content!),
      content_hash: contentHash,
    });
  } else if (fromMode === 'latest') {
    // Latest mode: require an optimized version to exist
    try {
      promptObj = await client.getTaskPromptLatest(name);
    } catch (err) {
      if (err instanceof PromptNotFoundError) {
        throw new PromptRequestError(
          `No prompt versions found for task '${name}'. ` +
            `Create one with prompt({ name, content: ... }) or publish a version in the Prompt Library.`,
          null
        );
      }
      throw err;
    }
  } else if (fromMode && HASH_PATTERN.test(fromMode)) {
    // Hash mode: fetch specific version by content hash
    promptObj = await client.getTaskPromptVersionByHash(name, fromMode);
  } else if (content) {
    // Auto-tune mode: try latest first, fall back to content
    contentHash = await sha256Hex(content);
    try {
      promptObj = await client.getTaskPromptLatest(name);
    } catch (err) {
      // Only fall back for "not found" errors (404)
      // Re-throw server errors (500), auth failures (401), etc.
      const isNotFoundError =
        err instanceof PromptNotFoundError ||
        (err instanceof PromptRequestError && err.status === 404);

      if (isNotFoundError) {
        // No latest version exists, ensure the provided content as a version
        promptObj = await client.ensureTaskPromptVersion(name, {
          content: normalizePromptText(content),
          content_hash: contentHash,
        });
      } else {
        throw err;
      }
    }
  } else if (fromMode) {
    // Invalid from value
    throw new Error(
      'from must be "latest", "explicit", or a 64-char lowercase hex SHA-256 hash'
    );
  } else {
    throw new Error('Invalid prompt options');
  }

  // Pull linkage metadata for decoration
  let promptSlug: string | null = null;
  try {
    // Prefer the prompt slug from the response (top-level field)
    promptSlug = promptObj.promptSlug ?? null;
    // Fallback to version metadata if not available
    if (!promptSlug) {
      const metadata = promptObj.metadata || {};
      promptSlug =
        (metadata.prompt_slug as string) ?? (metadata.prompt as string) ?? null;
    }
  } catch {
    promptSlug = null;
  }

  // Build metadata for decoration
  const metadata: PromptMetadata = {
    task: name,
  };

  if (variables && Object.keys(variables).length > 0) {
    metadata.variables = variables;
  }
  if (promptSlug) {
    metadata.prompt_slug = promptSlug;
  }
  if (promptObj.version !== null) {
    metadata.prompt_version = promptObj.version;
  }
  if (promptObj.versionId) {
    metadata.prompt_version_id = promptObj.versionId;
  }
  if (promptObj.contentHash) {
    metadata.content_hash = promptObj.contentHash;
  }

  // Return decorated prompt
  return decoratePrompt(promptObj.content, metadata);
}
