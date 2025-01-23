import prompts from "prompts";
import pc from "picocolors";
import { CredentialsManager } from "../utils/credentials";
import { ConfigManager } from "../utils/config";
import { ProviderService } from "../utils/provider-service";
import type { Message } from "../utils/types";
import type { Provider } from "../utils/credentials";

const credentials = new CredentialsManager();
const config = new ConfigManager();

interface CommandOptions {
  provider?: string;
  dryRun?: boolean;
  skipConfirmation?: boolean;
}

async function copyToClipboard(text: string): Promise<void> {
  const { spawn } = await import("child_process");
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      // macOS
      const pbcopy = spawn("pbcopy");
      pbcopy.stdin.write(text);
      pbcopy.stdin.end();
    } else if (platform === "win32") {
      // Windows
      const clip = spawn("clip");
      clip.stdin.write(text);
      clip.stdin.end();
    } else {
      // Linux and others (requires xclip or xsel)
      const xclip = spawn("xclip", ["-selection", "clipboard"]);
      xclip.stdin.write(text);
      xclip.stdin.end();
    }
    console.log(pc.green("\n✓ Copied to clipboard"));
  } catch (error) {
    console.error(
      pc.red("\nError copying to clipboard:"),
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

async function confirmCommand(
  command: string,
  dryRun: boolean,
): Promise<"execute" | "edit" | "copy" | "cancel"> {
  // Show command preview
  console.log("\nGenerated command:");
  console.log(pc.cyan(`  ${command}`));

  if (dryRun) {
    console.log(pc.yellow("\nDry run mode - command will not be executed"));
    return "cancel";
  }

  // Check for potentially dangerous commands
  const dangerousPatterns = [
    /\brm\b/,
    /\bdd\b/,
    /\bmkfs\b/,
    /\bformat\b/,
    /\bfdisk\b/,
    /\bwipe\b/,
    /\bshred\b/,
    /\btruncate\b/,
  ];

  const isDangerous = dangerousPatterns.some((pattern) =>
    pattern.test(command),
  );
  if (isDangerous) {
    console.log(
      pc.yellow(
        "\n⚠️  Warning: This command may be destructive. Use with caution.",
      ),
    );
  }

  const response = await prompts({
    type: "select",
    name: "value",
    message: "What would you like to do?",
    choices: [
      { title: "Execute command", value: "execute" },
      { title: "Copy to clipboard", value: "copy" },
      { title: "Edit command", value: "edit" },
      { title: "Cancel", value: "cancel" },
    ],
  });

  return response.value;
}

async function editCommand(command: string): Promise<string> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: "Edit command",
    initial: command,
    validate: (value) => {
      if (!value.trim()) {
        return "Command cannot be empty";
      }

      // Check for basic shell syntax
      const dangerousChars = /[;&|><$`\\]/;
      if (dangerousChars.test(value)) {
        return "Command contains potentially dangerous characters. Please use simple commands.";
      }

      // Check command exists (for first word)
      const cmd = value.trim().split(" ")[0];
      if (!/^[a-zA-Z0-9_\-\.]+$/.test(cmd)) {
        return "Invalid command name";
      }

      return true;
    },
  });

  return response.value;
}

async function validateCommand(command: string): Promise<boolean> {
  // Check for basic syntax errors
  const syntaxErrors = [
    /[&|;><]\s*$/, // Incomplete redirections/pipes
    /\b\w+\s*=\s*$/, // Incomplete variable assignments
    /^[\s|&;><!]/, // Invalid start characters
    /\(\s*\)/, // Empty subshells
  ];

  for (const pattern of syntaxErrors) {
    if (pattern.test(command)) {
      console.error(pc.red("\nError: Command appears to have syntax errors"));
      return false;
    }
  }

  // Check for potentially harmful commands
  const blockedCommands = [
    /\bsudo\b.*rm\b.*-rf\b.*\/\b/, // Dangerous root deletion
    /\bmv\b.*\/\b.*\/dev\/null\b/, // Moving to /dev/null
    /\bdd\b.*of=\/dev\/([hs]d[a-z]|nvme\d+n\d+)/, // Direct disk writes
    /\bmkfs\b.*-f\b/, // Force format
    /\bshred\b.*-[uz]\b/, // Secure deletion
  ];

  for (const pattern of blockedCommands) {
    if (pattern.test(command)) {
      console.error(
        pc.red("\nError: Command is potentially harmful and has been blocked"),
      );
      return false;
    }
  }

  return true;
}

export async function generateCommand(
  description: string,
  options: CommandOptions = {},
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
      content: `You are a shell command expert. Generate shell commands that follow these rules:
1. Only output the exact shell command, no explanations
2. Use modern shell syntax and best practices
3. Make commands safe and handle errors gracefully
4. Include necessary flags and options
5. Consider performance implications
6. Make commands as specific as possible
7. Use --dry-run or similar safety flags when appropriate
8. For directory operations, handle empty directories and non-existent paths
9. For file operations, handle spaces and special characters
10. Add error handling with 2>/dev/null where appropriate`,
    };

    // Prepare user message
    const userMessage = {
      role: "user" as const,
      content: `Generate a shell command to: ${description}. Make sure it handles errors and empty results gracefully.`,
    };

    // Get command from AI
    let command = "";
    for await (const chunk of service.streamChat([
      systemMessage,
      userMessage,
    ])) {
      command += chunk;
    }

    // Clean up command (remove newlines, etc.)
    command = command.replace(/\s+/g, " ").trim();

    // Handle command
    while (true) {
      const action = await confirmCommand(command, options.dryRun || false);

      switch (action) {
        case "execute": {
          const { spawn } = await import("child_process");
          const shell = process.env.SHELL || "/bin/sh";
          const child = spawn(shell, ["-c", command], {
            stdio: "inherit",
            env: { ...process.env, SHELL: shell },
          });

          await new Promise<void>((resolve, reject) => {
            child.on("error", reject);
            child.on("exit", (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Command failed with exit code ${code}`));
              }
            });
          });

          console.log(pc.green("\n✓ Command executed successfully"));
          return;
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
