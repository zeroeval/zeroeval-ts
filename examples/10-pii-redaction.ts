/* eslint-disable no-console */

// Minimal manual verification example for source-side PII redaction.
//
// Run with:
//   npm run example:pii-redaction
//
// Expected markers in the printed payload:
//   [REDACTED_EMAIL_A]
//   [REDACTED_EMAIL_B]
//   [REDACTED_PHONE_A]
//   [REDACTED_SECRET_A]

import * as ze from 'zeroeval';

ze.init({
  apiKey: 'demo-api-key',
  redaction: {
    enabled: true,
  },
});

async function main(): Promise<void> {
  const sessionId = 'alice@example.com';

  const span = ze.tracer.startSpan('demo.pii_redaction', {
    sessionId,
    sessionName: 'Alice Example <alice@example.com>',
    tags: {
      customer_email: 'alice@example.com',
      auth_token: 'Bearer super-secret-token',
      backup_email: 'alice@example.com',
    },
    attributes: {
      messages: [
        {
          role: 'user',
          content:
            'My email is alice@example.com and my phone is +1 (415) 555-1212',
        },
        {
          role: 'assistant',
          content:
            'Repeating alice@example.com with a second email bob@example.com',
        },
      ],
      authorization: 'Bearer top-secret-token',
    },
  });

  span.setIO(
    {
      email: 'alice@example.com',
      phone: '+1 (415) 555-1212',
      password: 'hunter2',
      apiKey: 'sk-live-abcdef1234567890',
      confirmEmail: 'alice@example.com',
    },
    'Send follow-up to alice@example.com and bob@example.com. Session cookie: abc123'
  );

  span.setError({
    code: 'DEMO_ERROR',
    message:
      'Authorization: Bearer top-secret-token; contact alice@example.com for help',
  });

  ze.tracer.addSessionTags(sessionId, {
    support_email: 'alice@example.com',
    escalation_email: 'bob@example.com',
  });

  ze.tracer.endSpan(span);

  console.log('Redacted span payload:\n');
  console.log(JSON.stringify(span.toJSON(), null, 2));

  // Exit without flushing so manual verification does not require backend access.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
