// eslint-disable-next-line import/no-relative-parent-imports
import type { Integration } from './base';
import { extractZeroEvalMetadata } from '../../utils/metadata';
import { renderTemplate } from '../../utils/template';
import type { PromptMetadata } from '../../types/prompt';

/**
 * Result of processing messages to extract ZeroEval metadata.
 */
export interface ProcessedMessagesResult {
  processedMessages:
    | Array<{ role: string; content: string | unknown }>
    | undefined;
  metadata: PromptMetadata | null;
  originalSystemContent: string | null;
}

/**
 * Process messages to extract ZeroEval metadata and interpolate variables.
 * Shared by OpenAI and Vercel AI wrappers.
 *
 * - Extracts <zeroeval> metadata from the first system message
 * - Deep copies messages to avoid mutation
 * - Strips metadata tags from system message
 * - Interpolates {{variables}} if metadata.variables is provided
 */
export function processMessagesWithMetadata(
  messages: Array<{ role: string; content: string | unknown }> | undefined
): ProcessedMessagesResult {
  if (!messages || messages.length === 0) {
    return {
      processedMessages: messages,
      metadata: null,
      originalSystemContent: null,
    };
  }

  // Deep copy to avoid mutation
  const processed = JSON.parse(JSON.stringify(messages)) as Array<{
    role: string;
    content: string | unknown;
  }>;

  // Check first message for system role and metadata
  const firstMsg = processed[0];
  if (firstMsg?.role !== 'system' || typeof firstMsg.content !== 'string') {
    return {
      processedMessages: processed,
      metadata: null,
      originalSystemContent: null,
    };
  }

  const originalSystemContent = firstMsg.content;
  const { metadata, cleanContent } = extractZeroEvalMetadata(firstMsg.content);

  if (!metadata) {
    return {
      processedMessages: processed,
      metadata: null,
      originalSystemContent,
    };
  }

  // Update system message with clean content (metadata stripped)
  firstMsg.content = cleanContent;

  // Interpolate variables in all messages if variables are provided
  if (metadata.variables && Object.keys(metadata.variables).length > 0) {
    for (const msg of processed) {
      if (typeof msg.content === 'string') {
        msg.content = renderTemplate(msg.content, metadata.variables, {
          missing: 'leave',
        });
      }
    }
  }

  return { processedMessages: processed, metadata, originalSystemContent };
}

export async function discoverIntegrations(): Promise<
  Record<string, new () => Integration>
> {
  const integrations: Record<string, new () => Integration> = {};

  // Note: OpenAI integration is now handled via the wrapOpenAI function instead of monkey patching

  try {
    await import('langchain');
    const { LangChainIntegration } = await import('./langchain');
    integrations.langchain = LangChainIntegration;
  } catch (_) {}

  // LangGraph is optional – only treat as integration if package resolvable
  try {
    await import('langgraph');
    const { LangGraphIntegration } = await import('./langgraph');
    integrations.langgraph = LangGraphIntegration;
  } catch (_) {}

  return integrations;
}
