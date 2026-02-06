/* eslint-disable no-console */

// Example demonstrating ZeroEval integration with Vapi Voice AI
//
// Run with:
//   VAPI_API_KEY=your-vapi-key ZEROEVAL_API_KEY=your-zeroeval-key npm run example:vapi
//
// For debugging, enable verbose logging:
//   ZEROEVAL_DEBUG=true VAPI_API_KEY=... ZEROEVAL_API_KEY=... npm run example:vapi
//
// This example shows:
// - How to use ze.prompt() to version system prompts for Vapi
// - How to create LLM-like spans for Vapi calls (since Vapi makes LLM calls internally)
// - How to send feedback for prompt optimization using the span ID as completionId
//
// KEY INSIGHT: The span must have the prompt metadata in its attributes
// (task, zeroeval object) to be recognized as a "completion" that can receive feedback.

import { VapiClient } from '@vapi-ai/server-sdk';
import * as ze from 'zeroeval';
import type { PromptMetadata } from 'zeroeval';

// Initialize ZeroEval
ze.init({ apiUrl: 'http://localhost:8000' });

// Initialize Vapi client
const vapi = new VapiClient({
  token: process.env.VAPI_API_KEY || '',
});

/**
 * Helper to extract clean content and metadata from a decorated prompt.
 * Returns both the clean content for Vapi and the metadata for span linking.
 */
function parseDecoratedPrompt(decoratedPrompt: string): {
  cleanContent: string;
  metadata: PromptMetadata | null;
} {
  const { cleanContent, metadata } = ze.extractZeroEvalMetadata(decoratedPrompt);
  return { cleanContent, metadata };
}

async function main() {
  console.log('=== ZeroEval + Vapi Integration Example ===\n');

  // ==========================================================================
  // Example 1: Create a Vapi assistant with a versioned ZeroEval prompt
  // ==========================================================================
  console.log('Example 1: Creating Vapi assistant with versioned prompt');
  console.log('----------------------------------------------------------');

  // Step 1: Get a versioned system prompt from ZeroEval
  // This registers the prompt in ZeroEval's Prompt Library for optimization
  const decoratedSystemPrompt = await ze.prompt({
    name: 'vapi-customer-support',
    content: `You are a friendly phone support assistant for TechCorp.
Your goal is to help customers with their technical issues.
Keep responses concise and under 50 words.
Always ask clarifying questions before providing solutions.
If you cannot help, offer to transfer to a human agent.`,
  });

  console.log('Registered prompt version in ZeroEval Prompt Library');

  // Step 2: Extract clean content AND metadata
  // - cleanContent goes to Vapi (no <zeroeval> tags)
  // - metadata goes into span attributes (links span to prompt for feedback)
  const { cleanContent: cleanSystemPrompt, metadata: promptMetadata } =
    parseDecoratedPrompt(decoratedSystemPrompt);

  console.log('System prompt (clean):', cleanSystemPrompt.substring(0, 100) + '...');
  console.log('Prompt metadata:', JSON.stringify(promptMetadata, null, 2));

  // Verify we have the necessary metadata for feedback
  if (!promptMetadata?.prompt_version_id) {
    console.log('\nWARNING: prompt_version_id is missing from metadata.');
    console.log('This may affect feedback linkage. The backend might need this to link spans to prompts.');
  }
  console.log('');

  // Step 3: Create or update the Vapi assistant
  let assistantId: string | undefined;

  try {
    const assistant = await vapi.assistants.create({
      name: 'TechCorp Support',
      firstMessage: 'Hello! Thanks for calling TechCorp support. How can I help you today?',
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: cleanSystemPrompt,
          },
        ],
      },
      voice: {
        provider: 'azure',
        voiceId: 'en-US-JennyNeural',
      },
    });

    assistantId = assistant.id;
    console.log('Created Vapi assistant:', assistantId);
  } catch (error) {
    console.error('Error creating assistant (expected if no Vapi key):', (error as Error).message);
  }

  // ==========================================================================
  // Example 2: Making a Vapi call with proper prompt-linked span
  // ==========================================================================
  console.log('\nExample 2: Making a Vapi call with prompt-linked span');
  console.log('-------------------------------------------------------');

  // IMPORTANT: To link a span to a prompt for feedback, the span must have:
  // - attributes.kind = 'llm'
  // - attributes.task = <prompt name>
  // - attributes.zeroeval = <full metadata object from ze.prompt()>
  let callSpanId: string | undefined;

  // Structure the conversation as proper chat messages
  // This format is what the CompletionDetailsModal expects to render correctly
  const conversationMessages = [
    { role: 'system', content: cleanSystemPrompt },
    { role: 'user', content: 'Hi, I need help resetting my password. I tried the forgot password link but never received the email.' },
  ];

  // The assistant's response (what Vapi's AI would say)
  const assistantResponse = "I'd be happy to help you reset your password! Let me look into why you didn't receive the reset email. Can you confirm the email address associated with your account?";

  // IMPORTANT: outputData must be a structured object (not a bare string) so it
  // survives the backend's JSONB serialization round-trip. The optimization pipeline
  // extracts the answer from output_data.content — a plain string like
  // outputData: assistantResponse will be lost during JSON parsing and cause
  // "No valid examples to train on" errors.

  // Build the zeroeval metadata object for span attributes
  // This is what links the span to the prompt for feedback
  const spanZeroEvalMetadata = {
    ...promptMetadata,
    // Ensure task is set (same as prompt name/slug)
    task: promptMetadata?.task || 'vapi-customer-support',
    // Add prompt_slug explicitly if not present
    prompt_slug: promptMetadata?.prompt_slug || promptMetadata?.task || 'vapi-customer-support',
  };

  console.log('Span zeroeval metadata:', JSON.stringify(spanZeroEvalMetadata, null, 2));

  await ze.withSpan(
    {
      // Use a name pattern similar to OpenAI wrapper for consistency
      name: 'llm.chat.completions.create',
      // Include integration tag - backend may use this to identify completion spans
      tags: { integration: 'vapi', provider: 'vapi' },
      // CRITICAL: Include prompt metadata in attributes to link span to prompt
      // The backend uses 'zeroeval' attribute to link spans to prompts
      attributes: {
        'service.name': 'vapi',
        kind: 'llm',
        task: spanZeroEvalMetadata.task,
        zeroeval: spanZeroEvalMetadata,
        provider: 'vapi',
        model: 'gpt-4o-mini', // The model Vapi uses internally
        // Also include messages for the completion details view
        messages: conversationMessages,
        streaming: false,
      },
      // Input: pass the messages array directly (SDK will JSON.stringify objects automatically)
      inputData: conversationMessages,
      // Output: MUST be a structured object, not a bare string.
      // The backend extracts the answer via output_data.get("content").
      // A plain string (e.g. outputData: "some text") fails JSONB round-trip parsing
      // and causes all optimization examples to be skipped.
      outputData: { role: 'assistant', content: assistantResponse },
    },
    async () => {
      // Capture span ID for feedback
      callSpanId = ze.getCurrentSpan()?.spanId;
      console.log('Call span ID (use as completionId for feedback):', callSpanId);

      // In a real scenario, you would:
      // 1. Make an outbound call via Vapi
      // const call = await vapi.calls.create({
      //   assistantId: assistantId,
      //   customer: { number: '+1234567890' },
      // });
      //
      // 2. Store the mapping: callId -> spanId in your database
      // await db.storeCallSpanMapping(call.id, callSpanId);
      //
      // 3. When the call ends (via webhook), update the span with the actual transcript
      // and send feedback based on call outcome

      console.log('(Simulated call - set VAPI_API_KEY for real calls)');
      console.log('Input messages:', JSON.stringify(conversationMessages, null, 2));
      console.log('Assistant response:', assistantResponse);
    }
  );

  // ==========================================================================
  // Example 3: Sending feedback for prompt optimization
  // ==========================================================================
  console.log('\nExample 3: Sending feedback for prompt optimization');
  console.log('-----------------------------------------------------');

  // IMPORTANT: Flush spans to the backend before sending feedback
  // Spans are buffered and only sent periodically (every 10s) or when buffer is full
  console.log('Flushing spans to backend...');
  await ze.tracer.flush();

  // Give the backend a moment to process the spans
  console.log('Waiting for backend to process spans...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (callSpanId) {
    try {
      // Simulating positive feedback from a completed call
      await ze.sendFeedback({
        promptSlug: 'vapi-customer-support',
        completionId: callSpanId,
        thumbsUp: true,
        reason: 'Customer issue resolved quickly',
        metadata: {
          callDuration: '2:30',
          issueType: 'password_reset',
          resolution: 'success',
        },
      });
      console.log('Positive feedback sent successfully!');
    } catch (error) {
      console.error('Error sending feedback:', (error as Error).message);
      console.log('\nNote: Feedback requires the span to be linked to the prompt.');
      console.log('The backend links spans via the "zeroeval" attribute in span attributes.');
    }
  }

  // ==========================================================================
  // Example 4: Using template variables for dynamic prompts
  // ==========================================================================
  console.log('\nExample 4: Template variables for dynamic prompts');
  console.log('---------------------------------------------------');

  // You can use template variables to customize prompts per customer/scenario
  const templatePrompt = await ze.prompt({
    name: 'vapi-personalized-support',
    content: `You are a {{tone}} phone support assistant for {{company}}.
You are speaking with {{customerName}}, a {{customerTier}} member.
{{specialInstructions}}
Keep responses under 40 words.`,
    variables: {
      tone: 'friendly and patient',
      company: 'TechCorp',
      customerName: 'John',
      customerTier: 'Premium',
      specialInstructions: 'Offer a 10% discount if they mention cancellation.',
    },
  });

  const { cleanContent: cleanTemplatePrompt } = parseDecoratedPrompt(templatePrompt);
  console.log('Personalized prompt:', cleanTemplatePrompt.substring(0, 150) + '...\n');

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  // Clean up: Delete the test assistant if created
  if (assistantId) {
    try {
      await vapi.assistants.delete(assistantId);
      console.log('\nCleaned up: Deleted test assistant');
    } catch (error) {
      console.error('Error cleaning up assistant:', (error as Error).message);
    }
  }

  // Force flush before exit
  ze.tracer.shutdown();
  console.log('\n=== Example completed! ===');
  console.log('Check your ZeroEval dashboard for:');
  console.log('  - Prompt versions in the Prompt Library');
  console.log('  - Traces showing Vapi operations with prompt metadata');
  console.log('  - Feedback linked to prompts for autotune optimization');
}

// Run the example
main().catch((err) => {
  console.error('Error running example:', err);
  process.exitCode = 1;
});
