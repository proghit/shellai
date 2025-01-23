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
import { promises as fs } from "fs";
import path from "path";

const credentials = new CredentialsManager();
const config = new ConfigManager();

interface ScriptOptions {
  provider?: string;
  dryRun?: boolean;
  type?: "bash" | "python" | "node";
  output?: string;
}

const SCRIPT_TEMPLATES = {
  bash: `#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Script content here
`,
  python: `#!/usr/bin/env python3

import sys
import os

def main():
    # Script content here
    pass

if __name__ == "__main__":
    main()
`,
  node: `#!/usr/bin/env node

async function main() {
    // Script content here
}

main().catch(console.error);
`,
};

export async function generateScript(
  description: string,
  options: ScriptOptions = {},
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

    // Determine script type
    const scriptType = options.type || "bash";
    const template = SCRIPT_TEMPLATES[scriptType];

    // Prepare system message
    const systemMessage = {
      role: "system" as const,
      content: `You are a script generation expert. Generate a ${scriptType} script that follows these rules:
1. Only output the exact script content, no explanations
2. Use modern syntax and best practices
3. Include proper error handling
4. Add necessary imports and dependencies
5. Consider performance implications
6. Make the script robust and maintainable
7. Add helpful comments for complex logic
8. Handle edge cases appropriately
9. Follow language-specific conventions`,
    };

    // Prepare user message
    const userMessage = {
      role: "user" as const,
      content: `Generate a ${scriptType} script to: ${description}`,
    };

    // Get script from AI
    let script = template;
    const spinner = yoctoSpinner({
      text: `Generating ${scriptType} script...`,
    }).start();
    let content = "";
    try {
      for await (const chunk of service.streamChat([
        systemMessage,
        userMessage,
      ])) {
        content += chunk;
      }
      spinner.stop();
    } catch (err) {
      spinner.stop();
      throw err;
    }

    // Clean up script content
    content = content.trim();

    // Insert AI-generated content at the appropriate place in the template
    script = script.replace("# Script content here", content);

    // Handle script
    while (true) {
      const action = await confirmCommand(
        script,
        scriptType,
        options.dryRun || false,
      );

      switch (action) {
        case "execute": {
          try {
            // Save script to temporary file
            const tempDir = await fs.mkdtemp(
              path.join(process.cwd(), ".temp-"),
            );
            const scriptPath = path.join(tempDir, `script.${scriptType}`);
            await fs.writeFile(scriptPath, script, { mode: 0o755 });

            // Execute script
            await executeCommand(scriptPath, service, 0, {
              type: "script",
              splitArgs: true,
            });

            // Clean up
            await fs.rm(tempDir, { recursive: true, force: true });
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
          await copyToClipboard(script);
          return;
        }

        case "edit": {
          script = await editCommand(script);
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
