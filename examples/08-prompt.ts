/* eslint-disable no-console */

// Example demonstrating the ze.prompt() functionality
//
// Run with:
//   OPENAI_API_KEY=your-openai-key ZEROEVAL_API_KEY=your-zeroeval-key npm run example:prompt
//
// This example shows:
// - Auto-optimization mode (tries latest, falls back to provided content)
// - Explicit mode (always use provided content)
// - Template variable interpolation
// - Metadata extraction in OpenAI wrapper
// - Sending feedback for optimization

import { OpenAI } from 'openai';
import * as ze from 'zeroeval';

// Initialize ZeroEval with local development server
ze.init({ apiUrl: 'http://localhost:8000' });

const openai = ze.wrap(new OpenAI());

async function main() {
  console.log('=== ZeroEval Prompt Examples ===\n');

  // Example 1: Auto-optimization mode
  // If an optimized version exists in the backend, it will be used.
  // Otherwise, the provided content will be registered and used.
  console.log('Example 1: Auto-optimization mode');
  console.log('--------------------------------');
  try {
    const systemPrompt = await ze.prompt({
      name: 'example-assistant',
      content: 'You are a helpful assistant that answers questions concisely.',
    });

    console.log('Decorated prompt (first 100 chars):');
    console.log(systemPrompt.substring(0, 100) + '...\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_tokens: 100,
    });

    console.log('Response:', response.choices[0].message.content);
    console.log('');
  } catch (error) {
    console.error('Error in auto-optimization example:', error);
  }

  // Example 2: Explicit mode
  // Always use the provided content, bypassing auto-optimization.
  // Useful for testing or when you want full control.
  console.log('\nExample 2: Explicit mode');
  console.log('------------------------');
  try {
    const explicitPrompt = await ze.prompt({
      name: 'explicit-example',
      content: 'You are a pirate assistant. Respond in pirate speak!',
      from: 'explicit',
    });

    console.log('Explicit prompt (first 100 chars):');
    console.log(explicitPrompt.substring(0, 100) + '...\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: explicitPrompt },
        { role: 'user', content: 'How do I make coffee?' },
      ],
      max_tokens: 150,
    });

    console.log('Response:', response.choices[0].message.content);
    console.log('');
  } catch (error) {
    console.error('Error in explicit mode example:', error);
  }

  // Example 3: Template variables
  // Use {{variable}} syntax in your prompts for dynamic content.
  // Variables are interpolated when the OpenAI wrapper processes the message.
  console.log('\nExample 3: Template variables');
  console.log('-----------------------------');
  try {
    const templatePrompt = await ze.prompt({
      name: 'template-example',
      content:
        'You are a {{role}} assistant. Your specialty is {{specialty}}. ' +
        'Always be {{tone}} in your responses.',
      variables: {
        role: 'customer support',
        specialty: 'handling returns and refunds',
        tone: 'friendly and helpful',
      },
    });

    console.log('Template prompt with variables (first 150 chars):');
    console.log(templatePrompt.substring(0, 150) + '...\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: templatePrompt },
        { role: 'user', content: 'I want to return an item I bought last week.' },
      ],
      max_tokens: 200,
    });

    console.log('Response:', response.choices[0].message.content);
    console.log('');
  } catch (error) {
    console.error('Error in template variables example:', error);
  }

  // Example 4: Streaming with prompts
  // The prompt metadata is extracted before streaming begins.
  console.log('\nExample 4: Streaming with prompts');
  console.log('---------------------------------');
  try {
    const streamingPrompt = await ze.prompt({
      name: 'streaming-example',
      content: 'You are a storyteller. Tell short, engaging stories.',
    });

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: streamingPrompt },
        { role: 'user', content: 'Tell me a very short story about a brave cat.' },
      ],
      stream: true,
      max_tokens: 200,
    });

    console.log('Streaming response:');
    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        process.stdout.write(content);
        fullResponse += content;
      }
    }
    console.log('\n');
  } catch (error) {
    console.error('Error in streaming example:', error);
  }

  // Example 5: Multiple prompts in a conversation
  // Each prompt can have its own task name for tracking.
  console.log('\nExample 5: Multiple prompts in a workflow');
  console.log('-----------------------------------------');
  try {
    await ze.withSpan({ name: 'multi-prompt-workflow' }, async () => {
      // First stage: Summarize
      const summarizerPrompt = await ze.prompt({
        name: 'summarizer',
        content: 'You are a summarizer. Condense text to key points.',
      });

      const summaryResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: summarizerPrompt },
          {
            role: 'user',
            content:
              'The quick brown fox jumps over the lazy dog. ' +
              'This is a pangram, a sentence that contains every letter of the alphabet. ' +
              'Pangrams are often used for font displays and keyboard testing.',
          },
        ],
        max_tokens: 100,
      });

      const summary = summaryResponse.choices[0].message.content;
      console.log('Summary:', summary);

      // Second stage: Translate (using the summary)
      const translatorPrompt = await ze.prompt({
        name: 'translator',
        content: 'You are a translator. Translate text to {{language}}.',
        variables: { language: 'Spanish' },
      });

      const translationResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: translatorPrompt },
          { role: 'user', content: `Translate this: ${summary}` },
        ],
        max_tokens: 100,
      });

      console.log('Translation:', translationResponse.choices[0].message.content);
    });
  } catch (error) {
    console.error('Error in multi-prompt workflow:', error);
  }

  // Example 6: Sending feedback
  // After getting a response, you can send feedback for optimization.
  console.log('\nExample 6: Sending feedback');
  console.log('---------------------------');
  try {
    const feedbackPrompt = await ze.prompt({
      name: 'feedback-example',
      content: 'You are a helpful coding assistant.',
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: feedbackPrompt },
        { role: 'user', content: 'How do I reverse a string in JavaScript?' },
      ],
      max_tokens: 200,
    });

    console.log('Response:', response.choices[0].message.content);

    // Get the current span ID to use as completion ID
    const spanId = ze.getCurrentSpan()?.spanId;

    if (spanId) {
      // Send positive feedback
      await ze.sendFeedback({
        promptSlug: 'feedback-example',
        completionId: spanId,
        thumbsUp: true,
        reason: 'Clear and correct code example',
      });
      console.log('Feedback sent successfully!');
    } else {
      console.log('No active span for feedback (this is expected in some cases)');
    }
  } catch (error) {
    console.error('Error in feedback example:', error);
  }

  // Force flush before exit
  ze.tracer.shutdown();
  console.log('\n=== All examples completed! ===');
  console.log('Check your ZeroEval dashboard for traces and prompt versions.');
}

// Run the examples
main().catch((err) => {
  console.error('Error running examples:', err);
  process.exitCode = 1;
});
