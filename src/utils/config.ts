import { homedir } from "os";
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { Provider } from "./credentials";

interface AppConfig {
  isInitialSetup: boolean;
  defaultProvider?: Provider;
  providerConfigs: Record<
    Provider,
    {
      defaultModel?: string;
    }
  >;
}

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor() {
    this.configDir = join(homedir(), ".config", "shellai");
    this.configFile = join(this.configDir, "config.json");
  }

  private async ensureConfigDir() {
    await mkdir(this.configDir, { recursive: true });
  }

  private async readConfig(): Promise<AppConfig> {
    try {
      const data = await readFile(this.configFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return {
        isInitialSetup: true,
        providerConfigs: {} as Record<Provider, { defaultModel?: string }>,
      };
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await this.ensureConfigDir();
    await writeFile(this.configFile, JSON.stringify(config, null, 2));
  }

  async isFirstRun(): Promise<boolean> {
    const config = await this.readConfig();
    return config.isInitialSetup;
  }

  async completeInitialSetup(): Promise<void> {
    const config = await this.readConfig();
    config.isInitialSetup = false;
    await this.writeConfig(config);
  }

  async getDefaultProvider(): Promise<Provider | null> {
    const config = await this.readConfig();
    return config.defaultProvider || null;
  }

  async setDefaultProvider(provider: Provider): Promise<void> {
    const config = await this.readConfig();
    config.defaultProvider = provider;
    await this.writeConfig(config);
  }

  async getDefaultModel(provider: Provider): Promise<string | null> {
    const config = await this.readConfig();
    return config.providerConfigs[provider]?.defaultModel || null;
  }

  async setDefaultModel(provider: Provider, model: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.providerConfigs[provider]) {
      config.providerConfigs[provider] = {};
    }
    config.providerConfigs[provider].defaultModel = model;
    await this.writeConfig(config);
  }

  async showHelp(): Promise<void> {
    console.log("\nAvailable commands:");
    console.log(
      "  shellai [message...]     Send message to AI (uses default or specified provider)",
    );
    console.log("  shellai config           Configure providers and defaults");
    console.log("  shellai chat             Start interactive chat session");
    console.log("\nOptions:");
    console.log(
      "  -p, --provider <name>    Use specific provider (anthropic, openai, gemini)",
    );
    console.log("  -m, --model <name>       Use specific model");
    console.log("\nExamples:");
    console.log('  shellai "What is TypeScript?"');
    console.log('  shellai -p openai "Hello"');
    console.log('  shellai -p anthropic -m claude-3-opus "Complex question"');
    console.log("  shellai config");
  }
}
