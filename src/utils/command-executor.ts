import prompts from "prompts";
import pc from "picocolors";
import yoctoSpinner from "yocto-spinner";
import { ProviderService } from "./provider-service";

export async function executeCommand(
  command: string,
  service: ProviderService,
  attempts = 0,
  options: {
    type: "git" | "shell" | "script";
    splitArgs?: boolean;
  } = { type: "shell" },
): Promise<void> {
  const maxAttempts = 3;

  try {
    const { spawn } = await import("child_process");

    // Handle different command types
    let child;
    if (options.type === "git") {
      // For git commands, use shell mode if it contains special characters
      const hasSpecialChars = /[&|;]/.test(command);
      if (hasSpecialChars) {
        child = spawn(command, [], {
          stdio: ["inherit", "inherit", "pipe"],
          shell: true,
        });
      } else {
        child = spawn("git", command.split(" ").slice(1), {
          stdio: ["inherit", "inherit", "pipe"],
        });
      }
    } else {
      // For shell and script commands
      const args = options.splitArgs ? command.split(" ").slice(1) : [];
      const cmd = options.splitArgs ? command.split(" ")[0] : command;
      child = spawn(cmd, args, {
        stdio: ["inherit", "inherit", "pipe"],
        shell: options.type === "shell",
      });
    }

    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("error", (err) => {
        reject(new Error(err.message));
      });
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(stderr.trim() || `Command failed with exit code ${code}`),
          );
        }
      });
    });

    console.log(pc.green("\n✓ Command executed successfully"));
  } catch (error) {
    // Show the failed command and error
    console.log(pc.red("\nCommand failed:"));
    console.log(pc.cyan(`  ${command}`));
    console.log(
      pc.red("Error:"),
      error instanceof Error ? error.message : "Unknown error occurred",
    );

    if (attempts >= maxAttempts - 1) {
      console.log(pc.red(`\nFailed after ${maxAttempts} attempts. Giving up.`));
      throw error;
    }

    const currentAttempt = attempts + 1;
    const spinner = yoctoSpinner({
      text: pc.yellow(
        `Attempt ${currentAttempt}/${maxAttempts}: Asking AI for help...`,
      ),
    }).start();

    try {
      // Prepare error message for AI
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const userMessage = {
        role: "user" as const,
        content: `The ${options.type} command "${command}" failed with error: ${errorMessage}. Please provide a corrected command that will work. Only respond with the exact command to run, no explanations.`,
      };

      // Get corrected command from AI
      let correctedCommand = "";
      for await (const chunk of service.streamChat([userMessage])) {
        correctedCommand += chunk;
      }

      // Clean up command
      correctedCommand = correctedCommand.replace(/\s+/g, " ").trim();

      spinner.stop();

      if (correctedCommand === command) {
        console.log(pc.red("\nAI couldn't find a better solution"));
        throw new Error("AI couldn't find a better solution");
      }

      console.log("\nSuggested fix:");
      console.log(pc.cyan(`  ${correctedCommand}`));

      // Ask for confirmation
      const response = await prompts({
        type: "confirm",
        name: "value",
        message: "Would you like to try this command?",
        initial: true,
      });

      if (response.value) {
        await executeCommand(correctedCommand, service, attempts + 1, options);
      } else {
        throw new Error("User cancelled retry");
      }
    } catch (err) {
      spinner.stop();
      throw err;
    }
  }
}

export async function copyToClipboard(text: string): Promise<void> {
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

export async function confirmCommand(
  command: string,
  type: string,
  dryRun: boolean,
): Promise<"execute" | "edit" | "copy" | "cancel"> {
  // Show command preview
  console.log(`\nGenerated ${type} command:`);
  console.log(pc.cyan(`  ${command}`));

  if (dryRun) {
    console.log(pc.yellow("\nDry run mode - command will not be executed"));
    return "cancel";
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

export async function editCommand(command: string): Promise<string> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: "Edit command",
    initial: command,
  });

  return response.value;
}
