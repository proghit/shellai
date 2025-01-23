import prompts from "prompts";
import type { PromptObject } from "prompts";
import pc from "picocolors";
import { CredentialsManager } from "../utils/credentials";
import { ConfigManager } from "../utils/config";
import { ProviderService } from "../utils/provider-service";
import {
  streamResponse,
  printUserMessage,
  printAssistantPrefix,
  printTips,
} from "../utils/stream-handler";
import type { Message } from "../utils/types";
import type { Provider } from "../utils/credentials";

const credentials = new CredentialsManager();
const config = new ConfigManager();

export async function chat(initialProvider?: string, initialMessage?: string) {
  try {
    // Get provider and model
    const provider = initialProvider
      ? (initialProvider as Provider)
      : await config.getDefaultProvider();

    if (!provider) {
      console.error(
        pc.red("\nNo provider specified and no default provider configured."),
        "\nPlease configure a provider first with:",
        pc.cyan("\n  shellai config"),
      );
      process.exit(1);
    }

    const apiKey = await credentials.getCredentials(provider);
    if (!apiKey) {
      console.error(
        pc.red(`\nNo API key found for ${provider}.`),
        "\nPlease configure the provider first with:",
        pc.cyan("\n  shellai config"),
      );
      process.exit(1);
    }

    const model = await config.getDefaultModel(provider);
    if (!model) {
      console.error(
        pc.red(`\nNo default model configured for ${provider}.`),
        "\nPlease configure the model first with:",
        pc.cyan("\n  shellai config"),
      );
      process.exit(1);
    }

    // Initialize provider service
    const service = new ProviderService(provider, apiKey, model);

    // Start chat loop
    const messages: Message[] = [];
    printTips();

    // Handle initial message if provided
    if (initialMessage?.trim()) {
      printUserMessage(initialMessage);
      messages.push({ role: "user", content: initialMessage });

      try {
        const response = await streamResponse(service.streamChat(messages), {
          prefix: "\nAssistant: ",
          newline: true,
          spinnerText: "Thinking...",
        });
        messages.push({ role: "assistant", content: response });
      } catch (error) {
        console.error(
          pc.red("\nError:"),
          error instanceof Error ? error.message : "Unknown error occurred",
        );
        process.exit(1);
      }
    }

    while (true) {
      // Get user input
      const question: PromptObject = {
        type: "text",
        name: "input",
        message: pc.bold("You"),
        validate: (value: string) =>
          value.trim() ? true : "Message cannot be empty",
      };

      const userInput = await prompts(question);

      // Handle exit
      if (
        !userInput.input ||
        userInput.input.toString().toLowerCase() === "exit"
      ) {
        console.log("\nGoodbye! 👋");
        process.exit(0);
      }

      // Add user message and get response
      messages.push({ role: "user", content: userInput.input.toString() });

      try {
        const response = await streamResponse(service.streamChat(messages), {
          prefix: "Assistant: ",
          newline: true,
          spinnerText: "Thinking...",
        });
        messages.push({ role: "assistant", content: response });
      } catch (error) {
        console.error(
          pc.red("\nError:"),
          error instanceof Error ? error.message : "Unknown error occurred",
        );
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      pc.red("\nError:"),
      error instanceof Error ? error.message : "Unknown error occurred",
    );
    process.exit(1);
  }
}
