/**
 * Hash utilities for prompt content normalization and SHA-256 hashing.
 * Ports the logic from zeroeval-sdk/src/zeroeval/utils/hash.py
 */

/**
 * Convert CRLF and CR to LF
 */
function normalizeNewlines(text: string): string {
  if (!text.includes('\r')) {
    return text;
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Remove trailing whitespace on each line
 */
function stripTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/**
 * Normalize prompt content prior to hashing.
 *
 * Rules:
 * - Convert CRLF/CR to LF
 * - Strip trailing whitespace on each line
 * - Strip leading/trailing whitespace overall
 * - Do not modify {{variable}} tokens
 */
export function normalizePromptText(text: string): string {
  if (typeof text !== 'string') {
    text = String(text);
  }
  let normalized = normalizeNewlines(text);
  normalized = stripTrailingWhitespace(normalized);
  normalized = normalized.trim();
  return normalized;
}

/**
 * Return lowercase hex SHA-256 of the normalized text.
 * Uses Web Crypto API for hashing.
 */
export async function sha256Hex(text: string): Promise<string> {
  const normalized = normalizePromptText(text);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);

  // Use Web Crypto API (works in Node.js 18+ and browsers)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
