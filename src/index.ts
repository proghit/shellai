#!/usr/bin/env bun
import { Command } from "commander";
import pc from "picocolors";
import { Anthropic } from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Provider } from "./utils/credentials";
import { CredentialsManager } from "./utils/credentials";
import { ConfigManager } from "./utils/config";
import { getProviderModels } from "./utils/provider-models";
import { configureProvider } from "./commands/config";
import { handleMessage } from "./commands/message";
import { createInterface } from "readline";
import { chat } from "./commands/chat";
import { generateCommand } from "./commands/gen";
import { generateScript } from "./commands/gen-script";
import { generateRegex } from "./commands/gen-regex";
import { generateGitCommand } from "./commands/gen-git";
import prompts from "prompts";

const credentials = new CredentialsManager();
const config = new ConfigManager();

// Handle graceful exits
function cleanup() {
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

process.on("SIGINT", () => {
  console.log("\n\nExiting...");
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nExiting...");
  cleanup();
  process.exit(0);
});

const program = new Command();

program
  .name("shellai")
  .description("AI-powered shell assistant")
  .version("0.1.0");

// Default message mode
program
  .argument("[message...]", "Message to send to AI")
  .option("-p, --provider <provider>", "AI provider to use")
  .option("-m, --model <model>", "AI model to use")
  .action(async (message: string[], options) => {
    let selectedProvider: Provider | undefined;

    try {
      // Check for first run
      if (await config.isFirstRun()) {
        console.log(
          pc.yellow("\nWelcome to ShellAI! Let's set up your configuration."),
        );

        // Get provider selection
        const providerResponse = await prompts({
          type: "select",
          name: "value",
          message: "Select a provider to configure",
          choices: [
            { title: "Anthropic (Claude)", value: "anthropic" },
            { title: "OpenAI (GPT)", value: "openai" },
            { title: "Google (Gemini)", value: "gemini" },
          ],
        });

        if (!providerResponse.value) {
          console.log("\nOperation cancelled");
          process.exit(0);
        }

        selectedProvider = providerResponse.value as Provider;

        // Get API key
        const apiKeyResponse = await prompts({
          type: "password",
          name: "value",
          message: `Enter API key for ${selectedProvider}`,
          validate: (value) =>
            value.trim() ? true : "API key cannot be empty",
        });

        if (!apiKeyResponse.value) {
          console.log("\nOperation cancelled");
          process.exit(0);
        }

        // Save credentials
        await credentials.saveCredentials(
          selectedProvider,
          apiKeyResponse.value,
        );
        await config.setDefaultProvider(selectedProvider);

        // Get model selection
        const models = await getProviderModels(
          selectedProvider,
          apiKeyResponse.value,
        );
        const modelResponse = await prompts({
          type: "select",
          name: "value",
          message: "Select a default model",
          choices: models.map((m) => ({ title: m, value: m })),
        });

        if (modelResponse.value) {
          await config.setDefaultModel(selectedProvider, modelResponse.value);
        }

        // Mark setup as complete
        await config.completeInitialSetup();

        console.log(pc.green("\n✓ Configuration complete!"));

        if (!message?.length) {
          await config.showHelp();
          return;
        }
      }

      if (!message?.length) {
        await config.showHelp();
        return;
      }

      // Get provider - from argument, default, or ask user
      if (!options.provider) {
        const { configured } = await credentials.listProviders();
        const defaultProvider = await config.getDefaultProvider();

        if (configured.length === 0) {
          console.error(
            pc.red("\nNo providers configured."),
            "\nRun 'shellai config' to configure a provider",
          );
          process.exit(1);
        }

        if (defaultProvider) {
          selectedProvider = defaultProvider;
        } else if (configured.length === 1) {
          selectedProvider = configured[0];
        } else {
          console.log("\nMultiple providers configured. Choose one to use:");
          configured.forEach((p, i) => console.log(`${i + 1}. ${p}`));

          const answer = await prompts({
            type: "select",
            name: "value",
            message: "Select provider",
            choices: configured.map((p) => ({ title: p, value: p })),
          });

          if (!answer.value) {
            console.log("\nOperation cancelled");
            process.exit(0);
          }

          selectedProvider = answer.value as Provider;

          // Ask to set as default
          const setDefault = await prompts({
            type: "confirm",
            name: "value",
            message: "Set as default provider?",
            initial: true,
          });

          if (setDefault.value) {
            await config.setDefaultProvider(selectedProvider);
            console.log(
              pc.green(`\n✓ Set ${selectedProvider} as the default provider`),
            );
          }
        }
      } else if (
        !["anthropic", "openai", "gemini"].includes(options.provider)
      ) {
        console.error(
          pc.red(`\nError: Invalid provider "${options.provider}"`),
        );
        process.exit(1);
      } else {
        selectedProvider = options.provider as Provider;
      }

      if (!selectedProvider) {
        console.error(pc.red("\nError: No provider selected"));
        process.exit(1);
      }

      // Get API key
      const apiKey = await credentials.getCredentials(selectedProvider);
      if (!apiKey) {
        console.error(
          pc.red(`\nError: No API key configured for ${selectedProvider}`),
          "\nRun 'shellai config' to configure providers",
        );
        process.exit(1);
      }

      // Get available models and default model
      const availableModels = await getProviderModels(selectedProvider, apiKey);
      const defaultModel = await config.getDefaultModel(selectedProvider);
      const model = options.model || defaultModel || availableModels[0];

      if (!availableModels.includes(model)) {
        console.error(
          pc.red(`\nError: Invalid model "${model}" for ${selectedProvider}`),
          `\nAvailable models: ${availableModels.join(", ")}`,
        );
        process.exit(1);
      }

      let client;
      switch (selectedProvider) {
        case "anthropic":
          client = new Anthropic({ apiKey });
          break;
        case "openai":
          client = new OpenAI({ apiKey });
          break;
        case "gemini":
          client = new GoogleGenerativeAI(apiKey);
          break;
      }

      await handleMessage(client, message.join(" "), {
        provider: selectedProvider,
        model,
      });
    } catch (error: any) {
      if (error?.status === 401 && selectedProvider) {
        console.error(
          pc.red(`\nError: Invalid API key for ${selectedProvider}.`),
          "\nRun 'shellai config' to reconfigure the provider.",
        );
      } else {
        console.error(
          pc.red("\nError:"),
          error instanceof Error ? error.message : "Unknown error occurred",
        );
      }
      process.exit(1);
    }
  });

// Config command
program
  .command("config")
  .description("Configure AI providers and models")
  .argument("[provider]", "Provider to configure (anthropic, openai, gemini)")
  .action(configureProvider);

// Chat mode command
program
  .command("chat")
  .description("Start a chat session with the AI")
  .argument("[message...]", "Initial message to send (optional)")
  .option(
    "-p, --provider <provider>",
    "Provider to use (anthropic, openai, gemini)",
  )
  .action(async (message: string[], options) => {
    await chat(options.provider, message?.join(" "));
  });

// Generate command
const gen = program
  .command("gen")
  .description("Generate various things using AI")
  .action(() => {
    gen.help();
  })
  .addCommand(
    new Command("command")
      .description("Generate a shell command")
      .argument("[description...]", "Description of what the command should do")
      .option("-p, --provider <provider>", "AI provider to use")
      .option("-d, --dry-run", "Show the command without executing")
      .option("-y, --yes", "Skip confirmation")
      .action((description: string[], options) => {
        generateCommand(description.join(" "), options);
      }),
  )
  .addCommand(
    new Command("script")
      .description("Generate a script file")
      .argument("[description...]", "Description of what the script should do")
      .option("-p, --provider <provider>", "AI provider to use")
      .option("-t, --type <type>", "Script type (bash/python/node)", "bash")
      .option("-o, --output <file>", "Output file path")
      .action((description: string[], options) => {
        generateScript(description.join(" "), options);
      }),
  )
  .addCommand(
    new Command("regex")
      .description("Generate a regular expression")
      .argument(
        "[description...]",
        "Description of what the regex should match",
      )
      .option("-p, --provider <provider>", "AI provider to use")
      .option("-t, --test <string>", "Test string to match against")
      .option("-f, --flags <flags>", "Regex flags (e.g. 'g', 'i', 'm')")
      .action((description: string[], options) => {
        generateRegex(description.join(" "), options);
      }),
  )
  .addCommand(
    new Command("git")
      .description("Generate a git command")
      .argument(
        "[description...]",
        "Description of what the git command should do",
      )
      .option("-p, --provider <provider>", "AI provider to use")
      .option("-d, --dry-run", "Show the command without executing")
      .action((description: string[], options) => {
        generateGitCommand(description.join(" "), options);
      }),
  );

program.parse();
