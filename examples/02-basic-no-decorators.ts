/* eslint-disable no-console */

// Basic usage example for the ZeroEval TS SDK without decorators.
// Run with: npm run example:basic-no-decorators

import * as ze from 'zeroeval';

// ---------------------------------------------------------------------------
// Initialise the SDK – in real projects set the API key via env var or here.
// ---------------------------------------------------------------------------
ze.init({
  apiKey: process.env.ZEROEVAL_API_KEY,
  collectCodeDetails: true,
  flushInterval: 2,
});

// ---------------------------------------------------------------------------
// Function without decorator - using withSpan instead
// ---------------------------------------------------------------------------
async function add(a: number, b: number): Promise<number> {
  return ze.withSpan({ name: 'math.add' }, () => {
    return a + b;
  });
}

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
    const sum = await add(2, 3);
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