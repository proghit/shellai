import pc from "picocolors";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import yoctoSpinner from "yocto-spinner";

// Configure marked to use terminal renderer
marked.setOptions({
  // @ts-ignore: TerminalRenderer type mismatch with marked types
  renderer: new TerminalRenderer(),
});

interface StreamOptions {
  prefix?: string;
  newline?: boolean;
  spinnerText?: string;
}

export async function streamResponse(
  stream: AsyncGenerator<string>,
  options: StreamOptions = {},
): Promise<string> {
  let fullResponse = "";
  let isFirstChunk = true;
  let isCodeBlock = false;

  // Write prefix if provided
  if (options.prefix) {
    process.stdout.write(pc.bold(options.prefix));
  }

  // Start spinner if text provided
  const spinner = options.spinnerText
    ? yoctoSpinner({ text: options.spinnerText }).start()
    : null;

  try {
    for await (const chunk of stream) {
      // Stop spinner on first chunk
      if (spinner && isFirstChunk) {
        spinner.stop();
      }

      // Handle code blocks
      if (chunk.includes("```")) {
        const parts = chunk.split("```");
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) {
            // Not in code block
            if (parts[i]) process.stdout.write(parts[i]);
          } else {
            // In code block
            if (i === 1) process.stdout.write("\n");
            process.stdout.write(pc.dim(parts[i]));
            if (i === parts.length - 2) process.stdout.write("\n");
          }
        }
        isCodeBlock = parts.length % 2 === 0;
      } else if (isCodeBlock) {
        process.stdout.write(pc.dim(chunk));
      } else {
        // Handle normal text
        if (isFirstChunk) {
          isFirstChunk = false;
        }
        process.stdout.write(chunk);
      }

      fullResponse += chunk;
    }

    // Add final newline if requested
    if (options.newline) {
      process.stdout.write("\n");
    }

    return fullResponse;
  } catch (error) {
    if (spinner) {
      spinner.stop();
    }
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

export function formatMarkdown(text: string): string {
  return marked(text).toString();
}

export function printUserMessage(message: string): void {
  console.log(pc.bold("You:"), message);
}

export function printAssistantPrefix(): void {
  process.stdout.write(pc.bold("Assistant: "));
}

export function printTips(): void {
  console.log(pc.dim("\nTip: Type 'exit' to end the chat"));
  console.log(pc.dim("     Use Ctrl+C to force quit\n"));
}
