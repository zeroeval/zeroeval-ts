/* eslint-disable no-console */

// Example demonstrating the new OpenAI wrapper approach
//
// Run with explicit initialization:
//   npm run example:openai
//
// Or with auto-initialization via environment variable (no ze.init needed):
//   ZEROEVAL_API_KEY=your-key npm run example:openai
//
// The wrapper will automatically initialize the SDK if ZEROEVAL_API_KEY is set

import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import * as ze from '@zeroeval/sdk';

async function main() {
  // Create a wrapped OpenAI client
  const openai = ze.wrapOpenAI(
    new OpenAI({
      apiKey: "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",
    })
  );

  // Example 1: Basic chat completion (non-streaming)
  console.log('Example 1: Basic chat completion');
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2 + 2?' },
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    console.log('Response:', completion.choices[0].message.content);
    console.log('Usage:', completion.usage);
  } catch (error) {
    console.error('Error in basic completion:', error);
  }

  // Example 2: Streaming chat completion
  console.log('\nExample 2: Streaming chat completion');
  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'Count from 1 to 5 slowly.' },
      ],
      stream: true,
    });

    console.log('Streaming response:');
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        console.log(content);
      }
    }
    console.log('\n');
  } catch (error) {
    console.error('Error in streaming completion:', error);
  }

  // Example 3: Embeddings
  console.log('\nExample 3: Creating embeddings');
  try {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'The quick brown fox jumps over the lazy dog',
    });

    console.log('Embedding created, dimensions:', embedding.data[0].embedding.length);
  } catch (error) {
    console.error('Error creating embedding:', error);
  }

  // Example 4: Using within a traced span
  console.log('\nExample 4: Using within a traced span');
  await ze.withSpan({ name: 'process_with_ai' }, async () => {
    // Set some tags for the trace
    const traceId = ze.getCurrentTrace();
    if (traceId) {
      ze.setTag(traceId, { feature: 'ai_processing', user: 'demo' });
    }

    // Multiple AI calls within the same span
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'What is the capital of France?' },
    ];

    const response1 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    messages.push({
      role: response1.choices[0].message.role,
      content: response1.choices[0].message.content
    });
    messages.push({ role: 'user', content: 'What is its population?' });

    const response2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    console.log('Final response:', response2.choices[0].message.content);
  });

  // Force flush before exit
  ze.tracer.shutdown();
  console.log('\nAll examples completed! Check your ZeroEval dashboard for traces.');
}

// Run the examples
main().catch((err) => {
  console.error('Error running examples:', err);
  process.exitCode = 1;
}); 