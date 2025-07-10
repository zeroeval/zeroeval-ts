import {
  ZeroEvalCallbackHandler,
  setGlobalCallbackHandler,
} from "zeroeval/langchain";
import { init } from "zeroeval"

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

setGlobalCallbackHandler(new ZeroEvalCallbackHandler());

init({
  apiKey: "sk_ze_UKGIwfckKDmIMlRt3F5r-8GYGARl7hO46W1XhLR7618",
  debug: true,
})

interface AgentState {
  messages: BaseMessage[];
}

// Define structured output schema for weather reports
const WeatherReportSchema = z.object({
  location: z.string().describe("The location of the weather report"),
  temperature: z.number().describe("Temperature in Fahrenheit"),
  conditions: z.string().describe("Weather conditions (e.g., sunny, cloudy, rainy)"),
  summary: z.string().describe("A brief summary of the weather"),
  recommendation: z.string().describe("What to wear or bring based on the weather"),
});

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
  modelName: "gpt-4o",
  temperature: 0,
}).bindTools([weatherTool]);

// Create a model with structured output for weather report generation
const structuredModel = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0,
}).withStructuredOutput(WeatherReportSchema);

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
    // First example: Tool calling with structured output processing
    const result = await app.invoke({
      messages: [new HumanMessage("What is the weather in San Francisco, CA?")],
    });

    console.log("\nFinal result:");
    console.log(result.messages[result.messages.length - 1].content);

    // Use structured output to process the weather information
    console.log("\nGenerating structured weather report...");
    const weatherInfo = result.messages[result.messages.length - 1].content;
    const structuredReport = await structuredModel.invoke(
      `Based on this weather information: "${weatherInfo}", generate a detailed weather report.`
    );

    console.log("\nStructured Weather Report:");
    console.log(JSON.stringify(structuredReport, null, 2));

    // Second example: Another location
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

    // Generate structured report for second location
    const weatherInfo2 = result2.messages[result2.messages.length - 1].content;
    const structuredReport2 = await structuredModel.invoke(
      `Based on this weather information: "${weatherInfo2}", generate a detailed weather report.`
    );

    console.log("\nStructured Weather Report for NY:");
    console.log(JSON.stringify(structuredReport2, null, 2));

    // Example 3: Direct structured output without tool calling
    console.log("\n\nDirect structured output example...\n");

    const directStructuredResult = await structuredModel.invoke(
      "Generate a weather report for London, UK. Make it rainy and cold, around 45°F."
    );

    console.log("Direct Structured Output:");
    console.log(JSON.stringify(directStructuredResult, null, 2));

    // Original chain example remains
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
