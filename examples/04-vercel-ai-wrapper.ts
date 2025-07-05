/* eslint-disable no-console */

// Example demonstrating the Vercel AI SDK wrapper approach
//
// To run this example:
//   OPENAI_API_KEY=your-openai-key ZEROEVAL_API_KEY=your-zeroeval-key npm run example:vercel-ai
//
// The OpenAI provider automatically uses OPENAI_API_KEY from environment
// The ZeroEval wrapper automatically uses ZEROEVAL_API_KEY from environment

import * as ai from 'ai';
import { openai } from '@ai-sdk/openai';
import * as ze from '@zeroeval/sdk';

const wrappedAI = ze.wrap(ai);

async function main() {
  // Example 1: Generate text (non-streaming)
  console.log('Example 1: Generate text');
  try {
    const { text, usage } = await wrappedAI.generateText({
      model: openai('gpt-4o-mini'),
      prompt: 'Write a haiku about TypeScript.',
      temperature: 0.7,
      maxTokens: 100,
    });

    console.log('Generated text:', text);
    console.log('Usage:', usage);
  } catch (error) {
    console.error('Error in generateText:', error);
  }

  // Example 2: Stream text
  console.log('\nExample 2: Stream text');
  try {
    const { textStream } = await wrappedAI.streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Count from 1 to 5 slowly, one number per line.' },
      ],
    });

    console.log('Streaming response:');
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n');
  } catch (error) {
    console.error('Error in streamText:', error);
  }

  // Example 3: Generate object
  console.log('\nExample 3: Generate structured object');
  try {
    const { object } = await wrappedAI.generateObject({
      model: openai('gpt-4o-mini'),
      schema: ai.jsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          hobbies: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'age', 'hobbies'],
      }),
      prompt: 'Generate a person profile for a software developer.',
    });

    console.log('Generated object:', JSON.stringify(object, null, 2));
  } catch (error) {
    console.error('Error in generateObject:', error);
  }

  // Example 4: Embeddings
  console.log('\nExample 4: Create embeddings');
  try {
    const { embedding } = await wrappedAI.embed({
      model: openai.embedding('text-embedding-3-small'),
      value: 'TypeScript is a typed superset of JavaScript.',
    });

    console.log('Embedding dimensions:', embedding.length);
    console.log('First 5 values:', embedding.slice(0, 5));
  } catch (error) {
    console.error('Error in embed:', error);
  }

  // Example 5: Using tools with generateText
  console.log('\nExample 5: Using tools');
  try {
    const { text, toolCalls, toolResults } = await wrappedAI.generateText({
      model: openai('gpt-4o-mini'),
      prompt: 'What is the weather in San Francisco?',
      tools: {
        getWeather: ai.tool({
          description: 'Get the weather for a location',
          parameters: ai.jsonSchema({
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          }),
          execute: async ({ location }) => {
            // Mock weather API
            return {
              location,
              temperature: 72,
              condition: 'sunny',
            };
          },
        }),
      },
    });

    console.log('Response:', text);
    console.log('Tool calls:', toolCalls);
    console.log('Tool results:', toolResults);
  } catch (error) {
    console.error('Error with tools:', error);
  }

  // Example 6: Alternative usage - direct function wrapping
  console.log('\nExample 6: Direct function wrapping');
  try {
    // You can also use the functions directly without wrapping the entire module
    const { generateText, streamText } = ai;
    
    // Use ze.wrap() on individual functions
    const result = await ze.wrap({ generateText }).generateText({
      model: openai('gpt-4o-mini'),
      prompt: 'Say hello in 3 different languages.',
      maxTokens: 50,
    });

    console.log('Direct wrap result:', result.text);
  } catch (error) {
    console.error('Error in direct wrap:', error);
  }
}

// Run the examples
main().catch(console.error); 