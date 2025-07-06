import { 
  init, 
  span, 
  tracer,
  sendSignal,
  sendTraceSignal,
  sendSessionSignal,
  sendSpanSignal,
  sendBulkSignals
} from 'zeroeval';

init();

// Example 1: Using signals with span decorator
async function processUser(userId: string) {
    const span = tracer.startSpan('processUser', {
        attributes: { userId }
    });

    try {
        // Send a signal to the current span
        await sendSpanSignal('user_id', userId);
        
        // Simulate some processing
        const isVipUser = Math.random() > 0.8;
        await sendSpanSignal('is_vip', isVipUser);

        if (isVipUser) {
            await sendSpanSignal('vip_discount', 0.2);
          }
          
          // Send a signal to the trace
          await sendTraceSignal('processing_type', 'user');
          
          // Send a signal to the session
          await sendSessionSignal('total_users_processed', 1);
          
          return { userId, isVipUser };
    } finally {
        tracer.endSpan(span);
    }
}

// Example 2: Manual span creation with signals
async function analyzeData(data: any[]) {
  const span = tracer.startSpan('analyzeData', {
    attributes: { dataSize: data.length }
  });
  
  try {
    // Add signals to the span
    span.addSignal('data_size', data.length);
    span.addSignal('has_data', data.length > 0);
    
    // Process data...
    const result = data.reduce((sum, item) => sum + item.value, 0);
    span.addSignal('total_value', result);
    
    return result;
  } finally {
    tracer.endSpan(span);
  }
}

// Example 3: Sending signals directly to specific entities
async function sendMetrics() {
  const traceId = 'some-trace-id';
  const sessionId = 'some-session-id';
  const spanId = 'some-span-id';
  
  // Send individual signals
  await sendSignal('trace', traceId, 'execution_time_ms', 1234);
  await sendSignal('session', sessionId, 'user_engagement_score', 0.85);
  await sendSignal('span', spanId, 'cache_hit', true);
  
  // Send bulk signals
  await sendBulkSignals([
    {
      entity_type: 'trace',
      entity_id: traceId,
      name: 'api_calls_count',
      value: 5,
      signal_type: 'numerical'
    },
    {
      entity_type: 'session',
      entity_id: sessionId,
      name: 'is_authenticated',
      value: true,
      signal_type: 'boolean'
    }
  ]);
}

// Example 4: Complete workflow with signals
async function main() {
  // Start a new session
  const rootSpan = tracer.startSpan('main', {
    sessionName: 'user-processing-session'
  });
  
  try {
    // Process multiple users
    const users = ['user1', 'user2', 'user3'];
    
    for (const userId of users) {
      await processUser(userId);
    }
    
    // Analyze some data
    const data = [
      { value: 10 },
      { value: 20 },
      { value: 30 }
    ];
    const total = await analyzeData(data);
    
    // Send session-level signals
    await sendSessionSignal('total_processed', users.length);
    await sendSessionSignal('success', true);
    
  } finally {
    tracer.endSpan(rootSpan);
  }
  
  // Flush any remaining spans/signals
  tracer.flush();
}

// Run the example
main().catch(console.error); 