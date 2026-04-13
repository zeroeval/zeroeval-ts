/**
 * Example: Tracing Claude Agent SDK with ZeroEval
 *
 * Prerequisites:
 *   npm install @anthropic-ai/claude-agent-sdk
 *   export ANTHROPIC_API_KEY=your-key
 *   export ZEROEVAL_API_KEY=your-key
 *
 * Run:
 *   npm run example:claude-agent
 */

import * as ze from 'zeroeval';

ze.init();

// ---------------------------------------------------------------------------
// Option A: Wrap the whole SDK module (recommended)
// ---------------------------------------------------------------------------

async function oneShot() {
  // Dynamically import so the example compiles even without the package
  const claudeAgentSdk = await import('@anthropic-ai/claude-agent-sdk');
  const sdk = ze.wrapClaudeAgentSdk(claudeAgentSdk);

  console.log('--- One-shot query ---');
  for await (const message of sdk.query({
    prompt: 'What files are in this directory?',
    options: { allowedTools: ['Bash', 'Glob'] },
  })) {
    if ('result' in message && message.type === 'result') {
      console.log('Result:', (message as any).result);
    }
  }
}

// ---------------------------------------------------------------------------
// Option B: Wrap only the query function
// ---------------------------------------------------------------------------

async function wrappedQueryOnly() {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const tracedQuery = ze.wrapClaudeAgentQuery(query);

  console.log('--- Wrapped query function ---');
  for await (const message of tracedQuery({
    prompt: 'List all TypeScript files',
    options: { allowedTools: ['Glob'] },
  })) {
    if ('result' in message && message.type === 'result') {
      console.log('Result:', (message as any).result);
    }
  }
}

// ---------------------------------------------------------------------------
// Option C: Use ze.wrap() for auto-detection
// ---------------------------------------------------------------------------

async function autoDetect() {
  const claudeAgentSdk = await import('@anthropic-ai/claude-agent-sdk');
  const sdk = ze.wrap(claudeAgentSdk);

  console.log('--- Auto-detected via ze.wrap() ---');
  for await (const message of (sdk as any).query({
    prompt: 'Hello!',
    options: { allowedTools: [] },
  })) {
    if ('result' in message && message.type === 'result') {
      console.log('Result:', (message as any).result);
    }
  }
}

async function main() {
  try {
    await oneShot();
    await wrappedQueryOnly();
    await autoDetect();
  } catch (err) {
    console.error('Example failed:', err);
  }
}

main();
