import prompts from "prompts";
import type { PromptObject } from "prompts";
import pc from "picocolors";
import type { Provider } from "../utils/credentials";
import { CredentialsManager } from "../utils/credentials";
import { ConfigManager } from "../utils/config";
import { getProviderModels } from "../utils/provider-models";

const credentials = new CredentialsManager();
const config = new ConfigManager();

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n\nExiting...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nExiting...");
  process.exit(0);
});

async function getHiddenInput(message: string): Promise<string> {
  const response = await prompts({
    type: "password",
    name: "value",
    message,
    validate: (value) => (value.trim() ? true : "Value cannot be empty"),
  });

  // Handle cancellation
  if (!response.value) {
    console.log("\nOperation cancelled");
    process.exit(0);
  }

  return response.value;
}

async function selectModel(
  provider: Provider,
  apiKey: string,
  currentModel?: string | null,
): Promise<string | undefined> {
  console.log("\nFetching available models...");
  const models = await getProviderModels(provider, apiKey);

  if (currentModel) {
    console.log(pc.green(`Current model: ${currentModel}`));
  }

  const response = await prompts({
    type: "select",
    name: "value",
    message: "Select model",
    choices: models.map((m) => ({ title: m, value: m })),
    initial: models.findIndex((m) => m === currentModel) || 0,
  });

  // Handle cancellation
  if (response.value === undefined) {
    console.log("\nOperation cancelled");
    process.exit(0);
  }

  return response.value;
}

async function showStatus(): Promise<void> {
  const { configured, unconfigured } = await credentials.listProviders();
  const defaultProvider = await config.getDefaultProvider();

  console.log("\nCurrent configuration:");
  if (configured.length > 0) {
    console.log(pc.green("\nConfigured providers:"));
    for (const p of configured) {
      const defaultModel = await config.getDefaultModel(p);
      console.log(
        `  - ${p}${p === defaultProvider ? pc.dim(" (default)") : ""}` +
          (defaultModel ? pc.dim(` [${defaultModel}]`) : ""),
      );
    }
  }
  if (unconfigured.length > 0) {
    console.log(pc.yellow("\nUnconfigured providers:"));
    unconfigured.forEach((p) => console.log(`  - ${p}`));
  }
}

async function handleSwitchProvider(): Promise<void> {
  const { configured } = await credentials.listProviders();
  if (configured.length === 0) {
    console.log(
      pc.yellow(
        "\nNo providers configured yet. Please configure a provider first.",
      ),
    );
    return;
  }

  const defaultProvider = await config.getDefaultProvider();
  const response = await prompts({
    type: "select",
    name: "value",
    message: "Select provider to switch to",
    choices: configured.map((p) => ({
      title: `${p}${p === defaultProvider ? pc.dim(" (current)") : ""}`,
      value: p,
    })),
  });

  if (!response.value) {
    console.log("\nOperation cancelled");
    return;
  }

  const provider = response.value as Provider;
  if (provider === defaultProvider) {
    console.log(pc.yellow("\nAlready using this provider"));
    return;
  }

  // Ask if user wants to switch model as well
  const switchModelResponse = await prompts({
    type: "confirm",
    name: "value",
    message: "Would you like to switch the model as well?",
    initial: true,
  });

  await config.setDefaultProvider(provider);
  console.log(pc.green(`\n✓ Switched to ${provider}`));

  if (switchModelResponse.value) {
    const apiKey = await credentials.getCredentials(provider);
    if (!apiKey) {
      console.error(pc.red("\nError getting provider credentials"));
      return;
    }

    const currentModel = await config.getDefaultModel(provider);
    const newModel = await selectModel(provider, apiKey, currentModel);
    if (newModel) {
      await config.setDefaultModel(provider, newModel);
      console.log(pc.green(`✓ Switched to model ${newModel}`));
    }
  }
}

async function handleSwitchModel(): Promise<void> {
  const defaultProvider = await config.getDefaultProvider();
  if (!defaultProvider) {
    console.log(
      pc.yellow(
        "\nNo default provider set. Please configure a provider first.",
      ),
    );
    return;
  }

  const apiKey = await credentials.getCredentials(defaultProvider);
  if (!apiKey) {
    console.error(pc.red("\nError getting provider credentials"));
    return;
  }

  const currentModel = await config.getDefaultModel(defaultProvider);
  const newModel = await selectModel(defaultProvider, apiKey, currentModel);
  if (newModel) {
    await config.setDefaultModel(defaultProvider, newModel);
    console.log(pc.green(`\n✓ Switched to model ${newModel}`));
  }
}

async function handleManageAPIKeys(): Promise<void> {
  const { configured, unconfigured } = await credentials.listProviders();
  const choices = [
    ...configured.map((p) => ({
      title: `Update API key for ${p}`,
      value: { action: "update", provider: p },
    })),
    ...unconfigured.map((p) => ({
      title: `Set API key for ${p}`,
      value: { action: "set", provider: p },
    })),
  ];

  const response = await prompts({
    type: "select",
    name: "value",
    message: "Choose an action",
    choices,
  });

  if (!response.value) {
    console.log("\nOperation cancelled");
    return;
  }

  const { action, provider } = response.value;
  const apiKey = await getHiddenInput(`Enter API key for ${provider}`);
  await credentials.saveCredentials(provider, apiKey);

  if (action === "update") {
    console.log(pc.green(`\n✓ Updated API key for ${provider}`));
  } else {
    console.log(pc.green(`\n✓ Set API key for ${provider}`));

    // If this is the first provider, set it as default
    const defaultProvider = await config.getDefaultProvider();
    if (!defaultProvider) {
      await config.setDefaultProvider(provider);
      console.log(pc.green(`✓ Set ${provider} as the default provider`));
    }

    // Ask if user wants to set a specific model
    const setModelResponse = await prompts({
      type: "confirm",
      name: "value",
      message: "Would you like to set a specific model?",
      initial: true,
    });

    if (setModelResponse.value) {
      const model = await selectModel(provider, apiKey);
      if (model) {
        await config.setDefaultModel(provider, model);
        console.log(pc.green(`✓ Set model to ${model}`));
      }
    }
  }
}

export async function configureProvider(initialProvider?: Provider) {
  try {
    // Show current status
    await showStatus();

    // If provider specified, go straight to API key management
    if (initialProvider) {
      const { configured } = await credentials.listProviders();
      const action = configured.includes(initialProvider) ? "update" : "set";
      const apiKey = await getHiddenInput(
        `Enter API key for ${initialProvider}`,
      );
      await credentials.saveCredentials(initialProvider, apiKey);

      console.log(
        pc.green(
          `\n✓ ${action === "update" ? "Updated" : "Set"} API key for ${initialProvider}`,
        ),
      );

      if (action === "set") {
        const setModelResponse = await prompts({
          type: "confirm",
          name: "value",
          message: "Would you like to set a specific model?",
          initial: true,
        });

        if (setModelResponse.value) {
          const model = await selectModel(initialProvider, apiKey);
          if (model) {
            await config.setDefaultModel(initialProvider, model);
            console.log(pc.green(`✓ Set model to ${model}`));
          }
        }

        // If this is the first provider, set it as default
        const defaultProvider = await config.getDefaultProvider();
        if (!defaultProvider) {
          await config.setDefaultProvider(initialProvider);
          console.log(
            pc.green(`✓ Set ${initialProvider} as the default provider`),
          );
        }
      }
      return;
    }

    // Show main menu
    const mainChoices = [
      { title: "Switch Provider", value: "switch-provider" },
      { title: "Switch Model", value: "switch-model" },
      { title: "Manage API Keys", value: "api-keys" },
      { title: "Exit", value: null },
    ];

    const response = await prompts({
      type: "select",
      name: "value",
      message: "Choose an action",
      choices: mainChoices,
    });

    if (!response.value) {
      console.log("\nOperation cancelled");
      return;
    }

    switch (response.value) {
      case "switch-provider":
        await handleSwitchProvider();
        break;
      case "switch-model":
        await handleSwitchModel();
        break;
      case "api-keys":
        await handleManageAPIKeys();
        break;
    }
  } catch (error) {
    console.error(
      pc.red("\nError:"),
      error instanceof Error ? error.message : "Unknown error occurred",
    );
    process.exit(1);
  }
}
