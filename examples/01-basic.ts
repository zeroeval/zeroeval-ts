/* eslint-disable no-console */

// Basic usage example for the ZeroEval TS SDK.
// Run with:  npm run example:basic

import * as ze from '@zeroeval/sdk';

// ---------------------------------------------------------------------------
// Initialise the SDK – in real projects set the API key via env var or here.
// ---------------------------------------------------------------------------
ze.init({
  apiKey: 'sk_ze_RTRwdIgfZyZS_E8CRhcVjvsl5nwNG5aw1D2khwBZvPo',
  collectCodeDetails: true, // capture source
  flushInterval: 2, // flush quickly for demo
});

// ---------------------------------------------------------------------------
// Context-manager style via withSpan helper (async safe).
// ---------------------------------------------------------------------------
async function doAsyncWork(): Promise<void> {
  await ze.withSpan({ name: 'asyncWork' }, async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

// ---------------------------------------------------------------------------
// Manual tagging – span, trace, session.
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  // Root span (session auto-generated)
  await ze.withSpan({ name: 'demo.root', tags: { demo: 'true' } }, async () => {
    const sum = 2 + 3;
    console.log('2 + 3 =', sum);

    // tag whole trace
    const traceId = ze.getCurrentTrace();
    if (traceId) ze.setTag(traceId, { user: 'alice' });

    await doAsyncWork();
  });

  // force flush before exit for demo clarity
  ze.tracer.shutdown();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}); 