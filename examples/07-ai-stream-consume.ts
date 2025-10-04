/* eslint-disable no-console */

// Example: Using ZeroEval's Vercel AI wrapper with OpenAI provider
// - Demonstrates streamText with dataStream.merge pattern
// - Shows debugging for consumeStream availability
// - Exercises toUIMessageStream() if available
//
// TROUBLESHOOTING "consumeStream is not a function":
// - consumeStream() is a method that should be added by the ZeroEval wrapper
// - If it's not available, the wrapper may need updating
// - As a workaround, manually consume result.textStream or result.fullStream
//
// WORKAROUND for the user's pattern:
// If you need to replicate this pattern:
//   result.consumeStream();
//   dataStream.merge(result.toUIMessageStream({ sendReasoning: false }));
// 
// Try this instead:
//   // Don't call consumeStream() - it doesn't exist
//   // For dataStream.merge, check if createDataStream is available in your AI SDK version
//   // If not, you can pipe the toUIMessageStream directly to your response
//
// Run (example):
//   OPENAI_API_KEY=your-openai-key ZEROEVAL_API_KEY=your-ze-key \
//   node --loader ts-node/esm examples/07-ai-stream-consume.ts

import * as ze from 'zeroeval';
import * as ai from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

async function main() {
  // Create OpenAI provider with explicit API key
  // IMPORTANT: Replace 'your-openai-api-key-here' with your actual OpenAI API key
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key-here',
  });

  // Wrap the entire AI SDK module (adds tracing automatically)
  const wrappedAI = ze.wrap(ai);

  console.log('Starting streamText with OpenAI (gpt-4o-mini) ...\n');

  const result = await wrappedAI.streamText({
    model: openai('gpt-4o-mini'),
    system: 'You are a concise assistant.',
    messages: [
      { role: 'user', content: 'Give me three product name ideas for a dev tool.' },
    ],
    // Optional telemetry matching user's pattern
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat-api-stream',
      metadata: {
        environment: process.env.NODE_ENV ?? 'development',
        sessionId: 'example-session-123',
        userId: 'example-user-456',
        tags: ['example', 'streaming', 'openai'],
      },
    },
  });

  // Debug: Log what methods are available on the result object
  console.log('Available methods on result object:');
  console.log('- consumeStream:', typeof (result as any).consumeStream);
  console.log('- toUIMessageStream:', typeof (result as any).toUIMessageStream);
  console.log('- textStream:', typeof result.textStream);
  console.log('- fullStream:', typeof result.fullStream);
  console.log('- toDataStreamResponse:', typeof (result as any).toDataStreamResponse);
  console.log('- toAIStreamResponse:', typeof (result as any).toAIStreamResponse);
  console.log('\nAll properties:', Object.keys(result));
  console.log('');

  // Pattern 1: Try consumeStream() if available (ZeroEval wrapper feature)
  if (typeof (result as any).consumeStream === 'function') {
    console.log('✅ consumeStream is available! Calling it...');
    await (result as any).consumeStream();
  } else {
    console.log('❌ consumeStream is NOT a function.');
    console.log('This might mean the ZeroEval wrapper needs to be updated to add this method.\n');
  }

  // Pattern 2: toUIMessageStream (user's pattern)
  if (typeof (result as any).toUIMessageStream === 'function') {
    console.log('toUIMessageStream is available! Testing it...');
    
    // Get the UI message stream
    const uiStream = (result as any).toUIMessageStream({
      sendReasoning: false,
    });
    
    console.log('UI stream type:', typeof uiStream);
    console.log('Is it iterable?', uiStream && typeof uiStream[Symbol.asyncIterator] === 'function');
    
    // Note: In the user's code, they use dataStream.merge() which is from 
    // createDataStream(). That might be available in different AI SDK versions.
    // For debugging, let's just iterate the stream directly:
    if (uiStream && typeof uiStream[Symbol.asyncIterator] === 'function') {
      console.log('\nIterating UI stream chunks:');
      for await (const chunk of uiStream) {
        console.log('UI chunk:', JSON.stringify(chunk).slice(0, 100) + '...');
      }
    }
  } else {
    console.log('toUIMessageStream is NOT available.');
  }
  
  // Pattern 3: Fallback to manual stream consumption
  if (!result.textStream) {
    console.log('\n❌ No textStream available either!');
  } else {
    console.log('\n✅ textStream is available. Manual consumption:');
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n');
  }

  // RECOMMENDED WORKAROUND for the user's specific use case
  console.log('\n=== RECOMMENDED PATTERN FOR YOUR USE CASE ===');
  console.log('Since consumeStream() is not available, remove that line.');
  console.log('For streaming to clients, you have these options:\n');
  console.log('Option 1: Use toDataStreamResponse() if available');
  console.log('Option 2: Use toAIStreamResponse() if available');
  console.log('Option 3: Manually pipe toUIMessageStream() to your response');
  console.log('Option 4: Use result.textStream directly\n');
  
  console.log('Example fix for your code:');
  console.log(`
  const result = wrappedZe.streamText({ ... });
  
  // Remove this line - consumeStream() doesn't exist
  // result.consumeStream();
  
  // If you have access to createDataStream:
  // const dataStream = createDataStream();
  // dataStream.merge(result.toUIMessageStream({ sendReasoning: false }));
  
  // Otherwise, use one of these:
  // return result.toDataStreamResponse();  // For Next.js App Router
  // return result.toAIStreamResponse();    // For older AI SDK versions
  // or manually consume result.textStream
  `);

  console.log('\nDone. Check your ZeroEval dashboard for spans.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


