import {
  ZeroEvalCallbackHandler,
  setGlobalCallbackHandler,
} from "zeroeval/langchain";

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

setGlobalCallbackHandler(new ZeroEvalCallbackHandler());

interface AgentState {
  messages: BaseMessage[];
}

const weatherTool = new DynamicStructuredTool({
  name: "get_weather",
  description: "Get the current weather in a given location",
  schema: z.object({
    location: z.string().describe("The city and state, e.g. San Francisco, CA"),
  }),
  func: async ({ location }) => {
    return `The weather in ${location} is sunny and 72°F`;
  },
});

const model = new ChatOpenAI({
  modelName: "gpt-4-turbo-preview",
  temperature: 0,
}).bindTools([weatherTool]);

async function callModel(state: AgentState) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

function shouldContinue(state: AgentState) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools";
  }

  return "end";
}

const toolNode = new ToolNode<AgentState>([weatherTool]);

const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => [],
    },
  },
})
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    end: "__end__",
  })
  .addEdge("tools", "agent");

const app = workflow.compile();

async function main() {
  console.log("Running LangGraph Weather Agent with ZeroEval tracing...\n");

  try {
    const result = await app.invoke({
      messages: [new HumanMessage("What is the weather in San Francisco, CA?")],
    });

    console.log("\nFinal result:");
    console.log(result.messages[result.messages.length - 1].content);

    const result2 = await app.invoke(
      {
        messages: [new HumanMessage("What about the weather in New York, NY?")],
      },
      {
        callbacks: [
          new ZeroEvalCallbackHandler({
            debug: false,
          }),
        ],
      }
    );

    console.log("\nSecond result:");
    console.log(result2.messages[result2.messages.length - 1].content);

    console.log("\n\nRunning simple chain example...\n");

    const prompt = ChatPromptTemplate.fromTemplate(
      "Tell me a {adjective} joke about {topic}"
    );
    const chain = prompt.pipe(model);

    const chainResult = await chain.invoke({
      adjective: "funny",
      topic: "programming",
    });

    console.log("\nChain result:");
    console.log(chainResult.content);
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
