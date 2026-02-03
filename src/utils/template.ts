/**
 * Template utilities for variable interpolation.
 * Ports the logic from zeroeval-sdk/src/zeroeval/template.py
 */

import { PromptRequestError } from '../errors';

/** Pattern for valid identifier names */
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Pattern for {{variable}} with optional whitespace */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Escape placeholders for \{{ and \}} */
const ESC_L = '__ZE_ESC_L__';
const ESC_R = '__ZE_ESC_R__';

export interface RenderOptions {
  /**
   * How to handle missing variables:
   * - "error": Throw PromptRequestError
   * - "leave": Leave placeholder unchanged
   */
  missing: 'error' | 'leave';
}

/**
 * Render a template by interpolating {{variable}} placeholders with values.
 *
 * Supports:
 * - Escaped braces: \{{ and \}} are preserved
 * - Whitespace in placeholders: {{ var }} works
 * - Missing variable handling via options.missing
 *
 * @param content - Template string with {{variable}} placeholders
 * @param variables - Object mapping variable names to values
 * @param options - Rendering options (default: { missing: 'error' })
 * @returns Rendered string with variables interpolated
 */
export function renderTemplate(
  content: string,
  variables: Record<string, string | number | boolean>,
  options: RenderOptions = { missing: 'error' }
): string {
  if (options.missing !== 'error' && options.missing !== 'leave') {
    throw new Error("missing must be 'error' or 'leave'");
  }

  // Validate variable keys early
  for (const key of Object.keys(variables)) {
    if (!IDENTIFIER_RE.test(key)) {
      throw new Error(`Invalid variable name: ${key}`);
    }
  }

  // Handle escaped braces: \{{ and \}}
  let tmp = content.replace(/\\{\\{/g, ESC_L).replace(/\\}\\}/g, ESC_R);
  // Also handle literal \{{ in the source
  tmp = tmp.replace(/\\\{\{/g, ESC_L).replace(/\\\}\}/g, ESC_R);

  // Replace {{variable}} with values
  const rendered = tmp.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (name in variables) {
      return String(variables[name]);
    }
    if (options.missing === 'error') {
      throw new PromptRequestError(`Missing variable: ${name}`, null);
    }
    return `{{${name}}}`;
  });

  // Restore escaped braces
  return rendered.replace(new RegExp(ESC_L, 'g'), '{{').replace(new RegExp(ESC_R, 'g'), '}}');
}

/**
 * Extract all variable names from a template.
 *
 * @param content - Template string with {{variable}} placeholders
 * @returns Set of variable names found in the template
 */
export function extractVariables(content: string): Set<string> {
  const names = new Set<string>();

  // Temporarily remove escaped braces
  let tmp = content.replace(/\\{\\{/g, '').replace(/\\}\\}/g, '');
  tmp = tmp.replace(/\\\{\{/g, '').replace(/\\\}\}/g, '');

  // Find all variable placeholders
  let match: RegExpExecArray | null;
  const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  while ((match = pattern.exec(tmp)) !== null) {
    names.add(match[1]);
  }

  return names;
}
