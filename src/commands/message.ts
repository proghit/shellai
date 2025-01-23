import { Anthropic } from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import type { Provider } from "../utils/credentials";
import { ProviderService } from "../utils/provider-service";
import { streamResponse } from "../utils/stream-handler";

interface MessageOptions {
  provider: Provider;
  model: string;
}

export async function handleMessage(
  client: Anthropic | OpenAI | GoogleGenerativeAI,
  message: string,
  options: MessageOptions,
): Promise<void> {
  try {
    // Initialize provider service
    const service = new ProviderService(
      options.provider,
      client.apiKey as string,
      options.model,
    );

    // Stream AI response
    await streamResponse(
      service.streamChat([{ role: "user", content: message }]),
      {
        newline: true,
        spinnerText: "Generating response...",
      },
    );
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}
