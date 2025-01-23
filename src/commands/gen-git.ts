import pc from "picocolors";
import yoctoSpinner from "yocto-spinner";
import { CredentialsManager } from "../utils/credentials";
import { ConfigManager } from "../utils/config";
import { ProviderService } from "../utils/provider-service";
import {
  executeCommand,
  confirmCommand,
  editCommand,
  copyToClipboard,
} from "../utils/command-executor";
import type { Provider } from "../utils/credentials";

const credentials = new CredentialsManager();
const config = new ConfigManager();

interface GitOptions {
  provider?: string;
  dryRun?: boolean;
}

export async function generateGitCommand(
  description: string,
  options: GitOptions = {},
) {
  try {
    // Get provider and model
    const provider = options.provider
      ? (options.provider as Provider)
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

    // Prepare system message
    const systemMessage = {
      role: "system" as const,
      content: `You are a git expert. Generate git commands that follow these rules:
1. Only output the exact git command, no explanations
2. Use modern git syntax and best practices
3. Make commands safe and reversible when possible
4. Include necessary flags and options
5. Consider performance implications for large repositories
6. Make commands as specific as possible
7. Use --dry-run or similar safety flags when appropriate`,
    };

    // Prepare user message
    const userMessage = {
      role: "user" as const,
      content: `Generate a git command to: ${description}`,
    };

    // Get command from AI
    const spinner = yoctoSpinner({ text: "Generating git command..." }).start();
    let command = "";
    try {
      for await (const chunk of service.streamChat([
        systemMessage,
        userMessage,
      ])) {
        command += chunk;
      }
      spinner.stop();
    } catch (err) {
      spinner.stop();
      throw err;
    }

    // Clean up command (remove newlines, etc.)
    command = command.replace(/\s+/g, " ").trim();

    // Handle command
    while (true) {
      const action = await confirmCommand(
        command,
        "git",
        options.dryRun || false,
      );

      switch (action) {
        case "execute": {
          try {
            await executeCommand(command, service, 0, { type: "git" });
            return;
          } catch (error) {
            console.error(
              pc.red("\nError:"),
              error instanceof Error ? error.message : "Unknown error occurred",
            );
            process.exit(1);
          }
        }

        case "copy": {
          await copyToClipboard(command);
          return;
        }

        case "edit": {
          command = await editCommand(command);
          break;
        }

        case "cancel":
          console.log("\nOperation cancelled");
          return;
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(pc.red("\nError:"), error.message);
    } else {
      console.error(pc.red("\nError:"), "Unknown error occurred");
    }
    process.exit(1);
  }
}
