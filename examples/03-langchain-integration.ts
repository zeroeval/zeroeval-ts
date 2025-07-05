import {
  ZeroEvalCallbackHandler,
  setGlobalHandler,
} from '@zeroeval/sdk/langchain';

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StateGraph } from '@langchain/langgraph';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

setGlobalHandler(new ZeroEvalCallbackHandler());

// Define the state for our graph
interface AgentState {
  messages: BaseMessage[];
}

// Create a simple weather tool
const weatherTool = new DynamicStructuredTool({
  name: 'get_weather',
  description: 'Get the current weather in a given location',
  schema: z.object({
    location: z.string().describe('The city and state, e.g. San Francisco, CA'),
  }),
  func: async ({ location }) => {
    // Mock weather data
    return `The weather in ${location} is sunny and 72°F`;
  },
});

// Create the model with tools
const model = new ChatOpenAI({
  modelName: 'gpt-4-turbo-preview',
  temperature: 0,
}).bindTools([weatherTool]);

// Define the agent node
async function callModel(state: AgentState) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// Define the function that determines whether to continue or end
function shouldContinue(state: AgentState) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // If there are tool calls, we continue to the tools node
  if ('tool_calls' in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  
  // Otherwise, we end
  return 'end';
}

// Create the tool node
const toolNode = new ToolNode<AgentState>([weatherTool]);

// Build the graph
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => [],
    },
  },
})
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue, {
    tools: 'tools',
    end: '__end__',
  })
  .addEdge('tools', 'agent');

// Compile the graph
const app = workflow.compile();

// Example usage
async function main() {
  console.log('Running LangGraph Weather Agent with ZeroEval tracing...\n');

  try {
    // Run the agent
    const result = await app.invoke({
      messages: [new HumanMessage('What is the weather in San Francisco, CA?')],
    });

    console.log('\nFinal result:');
    console.log(result.messages[result.messages.length - 1].content);

    // You can also pass the handler explicitly for specific invocations
    const result2 = await app.invoke(
      {
        messages: [new HumanMessage('What about the weather in New York, NY?')],
      },
      {
        callbacks: [
          new ZeroEvalCallbackHandler({
            debug: false,
          }),
        ],
      }
    );

    console.log('\nSecond result:');
    console.log(result2.messages[result2.messages.length - 1].content);

    // Using with a simple chain (non-graph)
    console.log('\n\nRunning simple chain example...\n');
    
    const prompt = ChatPromptTemplate.fromTemplate(
      'Tell me a {adjective} joke about {topic}'
    );
    const chain = prompt.pipe(model);

    const chainResult = await chain.invoke({
      adjective: 'funny',
      topic: 'programming',
    });

    console.log('\nChain result:');
    console.log(chainResult.content);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main().catch(console.error); 