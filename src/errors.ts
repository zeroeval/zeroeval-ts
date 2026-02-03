/**
 * Error thrown when a prompt or version is not found
 */
export class PromptNotFoundError extends Error {
  constructor(
    public readonly slug: string,
    public readonly version?: number,
    public readonly tag?: string
  ) {
    const parts = [slug];
    if (version !== undefined) parts.push(`v${version}`);
    if (tag) parts.push(`tag=${tag}`);
    super(`Prompt not found: ${parts.join(' ')}`);
    this.name = 'PromptNotFoundError';
  }
}

/**
 * Error thrown when a prompt API request fails
 */
export class PromptRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'PromptRequestError';
  }
}
