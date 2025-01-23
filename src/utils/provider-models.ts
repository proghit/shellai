import { Anthropic } from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
import type { Provider } from "./credentials";

// Fallback models in case API is not available
export const FALLBACK_MODELS = {
  anthropic: [
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
    "claude-2.1",
    "claude-2.0",
    "claude-instant-1.2",
  ],
  openai: ["gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
  gemini: ["gemini-pro", "gemini-pro-vision"],
} as Record<Provider, string[]>;

export async function getProviderModels(
  provider: Provider,
  apiKey: string,
): Promise<string[]> {
  try {
    switch (provider) {
      case "openai": {
        const client = new OpenAI({ apiKey });
        const models = await client.models.list();
        return models.data
          .filter((model) => model.id.startsWith("gpt-"))
          .map((model) => model.id)
          .sort();
      }

      case "anthropic": {
        const client = new Anthropic({ apiKey });
        const models = await client.models.list();
        return models.data.map((model) => model.id);
      }

      case "gemini": {
        // Gemini doesn't have a models endpoint
        // Using fallback models
        return [...FALLBACK_MODELS.gemini];
      }

      default:
        return [];
    }
  } catch (error) {
    // If API call fails, return fallback models
    return [...FALLBACK_MODELS[provider]];
  }
}
