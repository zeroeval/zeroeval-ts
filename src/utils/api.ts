/**
 * Shared API configuration utilities.
 */

const DEFAULT_API_URL = 'https://api.zeroeval.com';

/**
 * Get the ZeroEval API base URL from environment.
 * Removes trailing slash if present.
 */
export function getApiUrl(): string {
  return (process.env.ZEROEVAL_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
}

/**
 * Get the ZeroEval API key from environment.
 */
export function getApiKey(): string | undefined {
  return process.env.ZEROEVAL_API_KEY;
}
