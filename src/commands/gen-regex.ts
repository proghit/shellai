import pc from "picocolors";
import prompts from "prompts";
import { ConfigManager } from "../utils/config";
import type { Provider } from "../utils/credentials";
import { CredentialsManager } from "../utils/credentials";
import { ProviderService } from "../utils/provider-service";

const credentials = new CredentialsManager();
const config = new ConfigManager();

interface RegexOptions {
  provider?: string;
  test?: string;
  flags?: string;
}

async function testRegex(
  regex: string,
  flags: string,
  test?: string,
): Promise<void> {
  let testString: string;
  if (!test) {
    const response = await prompts({
      type: "text",
      name: "value",
      message: "Enter test string",
      validate: (value) =>
        value !== undefined ? true : "Test string cannot be empty",
    });
    testString = response.value;
  } else {
    testString = test;
  }

  try {
    const re = new RegExp(regex, flags);
    const matches = testString.match(re);

    if (!matches) {
      console.log(pc.yellow("\nNo matches found"));
      return;
    }

    console.log("\nMatches found:");
    matches.forEach((match, i) => {
      if (i === 0) {
        console.log(pc.green(`  Full match: ${match}`));
      } else {
        console.log(pc.dim(`  Group ${i}: ${match}`));
      }
    });

    // Show match positions
    let lastIndex = 0;
    const lines: string[] = [];
    testString.split("").forEach((char, i) => {
      if (i === lastIndex) {
        const match = re.exec(testString.slice(i));
        if (match) {
          lines.push(pc.green("^".repeat(match[0].length)));
          lastIndex = i + match[0].length;
        } else {
          lines.push(" ");
        }
      } else {
        lines.push(" ");
      }
    });

    console.log("\nMatch positions:");
    console.log(testString);
    console.log(lines.join(""));
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(pc.red("\nError testing regex:"), error.message);
    } else {
      console.error(pc.red("\nError testing regex:"), "Unknown error occurred");
    }
  }
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

async function confirmRegex(
  regex: string,
  flags: string,
  test?: string,
): Promise<"test" | "edit" | "copy" | "done" | "cancel"> {
  // Show regex preview
  console.log("\nGenerated regex:");
  console.log(pc.cyan(`  /${regex}/${flags}`));

  const response = await prompts({
    type: "select",
    name: "value",
    message: "What would you like to do?",
    choices: [
      { title: "Test regex", value: "test" },
      { title: "Copy to clipboard", value: "copy" },
      { title: "Edit regex", value: "edit" },
      { title: "Done", value: "done" },
      { title: "Cancel", value: "cancel" },
    ],
  });

  return response.value;
}

async function editRegex(
  regex: string,
  flags: string,
): Promise<{ regex: string; flags: string }> {
  const patternResponse = await prompts({
    type: "text",
    name: "value",
    message: "Edit regex pattern",
    initial: regex,
    validate: (value) => {
      try {
        new RegExp(value);
        return true;
      } catch {
        return "Invalid regular expression";
      }
    },
  });

  const flagsResponse = await prompts({
    type: "text",
    name: "value",
    message: "Edit regex flags",
    initial: flags,
    validate: (value) => {
      try {
        new RegExp("", value);
        return true;
      } catch {
        return "Invalid flags";
      }
    },
  });

  return {
    regex: patternResponse.value,
    flags: flagsResponse.value,
  };
}

export async function generateRegex(
  description: string,
  options: RegexOptions = {},
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
      content: `You are a regex expert. Generate regular expressions that follow these rules:
1. Only output the exact regex pattern, no explanations
2. Use modern regex syntax
3. Make patterns readable and maintainable
4. Include necessary escape sequences
5. Use capturing groups when helpful
6. Avoid unnecessary complexity
7. Consider performance implications
8. Make patterns as specific as possible`,
    };

    // Prepare user message
    const userMessage = {
      role: "user" as const,
      content: `Generate a regex pattern to: ${description}${
        options.test ? `\nIt should match this example: ${options.test}` : ""
      }`,
    };

    // Get regex from AI
    let pattern = "";
    for await (const chunk of service.streamChat([
      systemMessage,
      userMessage,
    ])) {
      pattern += chunk;
    }

    // Clean up pattern (remove slashes, newlines, etc.)
    pattern = pattern.replace(/^[\s/]*|[\s/]*$/g, "");
    let flags = options.flags || "g";

    // Handle regex
    while (true) {
      const action = await confirmRegex(pattern, flags, options.test);

      switch (action) {
        case "test":
          await testRegex(pattern, flags, options.test);
          break;

        case "copy": {
          await copyToClipboard(`/${pattern}/${flags}`);
          return;
        }

        case "edit": {
          const result = await editRegex(pattern, flags);
          pattern = result.regex;
          flags = result.flags;
          break;
        }

        case "done":
          console.log(pc.green(`\n✓ Final regex: /${pattern}/${flags}`));
          return;

        case "cancel":
          console.log("\nOperation cancelled");
          return;
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
