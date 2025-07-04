// eslint-disable-next-line import/no-relative-parent-imports
import type { Integration } from './base';

export async function discoverIntegrations(): Promise<Record<string, new () => Integration>> {
  const integrations: Record<string, new () => Integration> = {};

  // Dynamically import only if packages are resolvable; wrap in try/catch to avoid startup cost.
  try {
    await import('openai');
    const { OpenAIIntegration } = await import('./openai');
    integrations.openai = OpenAIIntegration;
  } catch (_) {}

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