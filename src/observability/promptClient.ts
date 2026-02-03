/**
 * Prompt client for interacting with the ZeroEval backend prompt APIs.
 * Ports the logic from zeroeval-sdk/src/zeroeval/client.py
 */

import { TTLCache } from '../utils/cache';
import { getApiUrl, getApiKey } from '../utils/api';
import type {
  Prompt,
  PromptResponse,
  PromptVersionCreate,
} from '../types/prompt';
import { PromptNotFoundError, PromptRequestError } from '../errors';
import { getLogger } from './logger';

const logger = getLogger('zeroeval.promptClient');

/**
 * Client for prompt-related API operations.
 */
class PromptClient {
  private promptCache: TTLCache<string, Prompt>;
  private modelCache: TTLCache<string, string | null>;

  constructor() {
    this.promptCache = new TTLCache<string, Prompt>({
      ttlMs: 60000,
      maxSize: 512,
    });
    this.modelCache = new TTLCache<string, string | null>({
      ttlMs: 60000,
      maxSize: 256,
    });
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = getApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  /**
   * Make an API request to the backend.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${getApiUrl()}${path}`;
    const headers = this.getHeaders();

    logger.debug(`[ZeroEval] ${method} ${url}`);

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error(`[ZeroEval] Request failed: ${res.status} ${text}`);
      throw new PromptRequestError(
        `Request failed: ${res.status}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  /**
   * Convert backend response to internal Prompt type.
   */
  private responseToPrompt(response: PromptResponse): Prompt {
    return {
      content: response.content,
      version: response.version,
      versionId: response.version_id,
      tag: response.tag,
      isLatest: response.is_latest,
      model: response.model_id
        ? response.model_id.startsWith('zeroeval/')
          ? response.model_id
          : `zeroeval/${response.model_id}`
        : null,
      contentHash: response.content_hash,
      metadata: response.metadata,
      source: 'server',
    };
  }

  /**
   * Normalize version_id from response, handling nested metadata.
   */
  private normalizeVersionId(
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!data.version_id) {
      const meta = data.metadata as Record<string, unknown> | undefined;
      if (meta && typeof meta === 'object') {
        const vid = meta.version_id ?? meta.prompt_version_id;
        if (vid) {
          data.version_id = vid;
        }
      }
    }
    return data;
  }

  /**
   * Get the latest prompt version for a task.
   * GET /v1/tasks/{task_name}/prompt/latest
   */
  async getTaskPromptLatest(taskName: string): Promise<Prompt> {
    const cacheKey = `latest:${taskName}`;
    const cached = this.promptCache.get(cacheKey);
    if (cached) {
      logger.debug(`[ZeroEval] Cache hit for latest prompt: ${taskName}`);
      return cached;
    }

    let response: PromptResponse;
    try {
      response = await this.request<PromptResponse>(
        'GET',
        `/v1/tasks/${encodeURIComponent(taskName)}/prompt/latest`
      );
    } catch (err) {
      if (err instanceof PromptRequestError && err.status === 404) {
        throw new PromptNotFoundError(taskName);
      }
      throw err;
    }

    const normalized = this.normalizeVersionId(
      response as unknown as Record<string, unknown>
    );
    const prompt = this.responseToPrompt(
      normalized as unknown as PromptResponse
    );
    this.promptCache.set(cacheKey, prompt);
    return prompt;
  }

  /**
   * Ensure a prompt version exists for a task.
   * Creates the prompt if it doesn't exist.
   * POST /v1/tasks/{task_name}/prompt/versions/ensure
   */
  async ensureTaskPromptVersion(
    taskName: string,
    data: PromptVersionCreate
  ): Promise<Prompt> {
    // Try to inherit model_id from latest version
    let modelId: string | null = null;
    try {
      const latest = await this.getTaskPromptLatest(taskName);
      if (latest.model) {
        // Strip zeroeval/ prefix for the API
        modelId = latest.model.replace(/^zeroeval\//, '');
      }
    } catch {
      // No existing version, continue without model inheritance
      logger.debug(
        `[ZeroEval] No existing version for ${taskName}, not inheriting model`
      );
    }

    const response = await this.request<PromptResponse>(
      'POST',
      `/v1/tasks/${encodeURIComponent(taskName)}/prompt/versions/ensure`,
      { ...data, model_id: modelId }
    );

    const normalized = this.normalizeVersionId(
      response as unknown as Record<string, unknown>
    );
    return this.responseToPrompt(normalized as unknown as PromptResponse);
  }

  /**
   * Get a prompt version by content hash.
   * GET /v1/tasks/{task_name}/prompt/versions/by-hash/{content_hash}
   */
  async getTaskPromptVersionByHash(
    taskName: string,
    contentHash: string
  ): Promise<Prompt> {
    const cacheKey = `hash:${taskName}:${contentHash}`;
    const cached = this.promptCache.get(cacheKey);
    if (cached) {
      logger.debug(`[ZeroEval] Cache hit for prompt hash: ${contentHash}`);
      return cached;
    }

    let response: PromptResponse;
    try {
      response = await this.request<PromptResponse>(
        'GET',
        `/v1/tasks/${encodeURIComponent(taskName)}/prompt/versions/by-hash/${contentHash}`
      );
    } catch (err) {
      if (err instanceof PromptRequestError && err.status === 404) {
        throw new PromptNotFoundError(taskName);
      }
      throw err;
    }

    const normalized = this.normalizeVersionId(
      response as unknown as Record<string, unknown>
    );
    const prompt = this.responseToPrompt(
      normalized as unknown as PromptResponse
    );
    this.promptCache.set(cacheKey, prompt);
    return prompt;
  }

  /**
   * Get the model bound to a prompt version.
   * GET /v1/prompt-versions/{version_id}/model
   *
   * Returns the model string (prefixed with "zeroeval/") or null if not found.
   * Caches negative results to avoid repeated requests.
   */
  async getModelForPromptVersion(versionId: string): Promise<string | null> {
    // Check cache first (including negative results)
    const cached = this.modelCache.get(versionId);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const response = await this.request<{ model: string | null }>(
        'GET',
        `/v1/prompt-versions/${versionId}/model`
      );

      let model = response.model;
      if (model && typeof model === 'string') {
        if (!model.startsWith('zeroeval/')) {
          model = `zeroeval/${model}`;
        }
      } else {
        model = null;
      }

      this.modelCache.set(versionId, model);
      return model;
    } catch {
      // Cache negative result to avoid hammering
      this.modelCache.set(versionId, null);
      return null;
    }
  }

  /**
   * Clear all caches.
   */
  clearCaches(): void {
    this.promptCache.clear();
    this.modelCache.clear();
  }
}

// Singleton instance
let promptClient: PromptClient | null = null;

/**
 * Get the singleton PromptClient instance.
 */
export function getPromptClient(): PromptClient {
  if (!promptClient) {
    promptClient = new PromptClient();
  }
  return promptClient;
}
