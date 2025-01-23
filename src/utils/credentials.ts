import { homedir } from "os";
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

// Provider types and models
export type Provider = "anthropic" | "openai" | "gemini";

export const FALLBACK_MODELS = {
  anthropic: ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
  openai: ["gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
  gemini: ["gemini-pro", "gemini-pro-vision"],
} as Record<Provider, string[]>;

interface ProviderConfig {
  apiKey: { iv: string; encrypted: string };
}

interface CredentialsData {
  credentials: Record<Provider, ProviderConfig>;
}

// Credentials manager
export class CredentialsManager {
  private configDir: string;
  private credentialsFile: string;
  private masterKey: Buffer;

  constructor() {
    this.configDir = join(homedir(), ".config", "shellai");
    this.credentialsFile = join(this.configDir, "credentials");
    // Use a fixed key for development. In production, this should be more secure
    this.masterKey = scryptSync("shellai-secret-key", "salt", 32);
  }

  private async ensureConfigDir() {
    await mkdir(this.configDir, { recursive: true });
  }

  private encrypt(text: string): { iv: string; encrypted: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", this.masterKey, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return {
      iv: iv.toString("hex"),
      encrypted,
    };
  }

  private decrypt(encrypted: string, iv: string): string {
    const decipher = createDecipheriv(
      "aes-256-cbc",
      this.masterKey,
      Buffer.from(iv, "hex"),
    );
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  private async readCredentialsData(): Promise<CredentialsData> {
    try {
      const data = await readFile(this.credentialsFile, "utf8");
      const parsed = JSON.parse(data);
      // Ensure credentials object exists with correct type
      if (!parsed.credentials) {
        parsed.credentials = {} as Record<Provider, ProviderConfig>;
      }
      return parsed;
    } catch (error) {
      // Return fresh credentials object with correct type
      return { credentials: {} as Record<Provider, ProviderConfig> };
    }
  }

  private async writeCredentialsData(data: CredentialsData): Promise<void> {
    await this.ensureConfigDir();
    await writeFile(this.credentialsFile, JSON.stringify(data, null, 2));
  }

  async saveCredentials(provider: Provider, apiKey: string): Promise<void> {
    await this.ensureConfigDir();
    const data = await this.readCredentialsData();

    // Initialize provider config if it doesn't exist
    if (!data.credentials[provider]) {
      data.credentials[provider] = {
        apiKey: this.encrypt(apiKey),
      };
    } else {
      data.credentials[provider].apiKey = this.encrypt(apiKey);
    }

    await this.writeCredentialsData(data);
  }

  async getCredentials(provider: Provider): Promise<string | undefined> {
    const data = await this.readCredentialsData();
    const providerConfig = data.credentials[provider];
    if (!providerConfig?.apiKey) return undefined;
    return this.decrypt(
      providerConfig.apiKey.encrypted,
      providerConfig.apiKey.iv,
    );
  }

  async listProviders(): Promise<{
    configured: Provider[];
    unconfigured: Provider[];
  }> {
    const allProviders: Provider[] = ["anthropic", "openai", "gemini"];
    const data = await this.readCredentialsData();
    const configured: Provider[] = [];

    for (const provider of allProviders) {
      if (data.credentials[provider]?.apiKey) {
        configured.push(provider);
      }
    }

    const unconfigured = allProviders.filter(
      (provider) => !configured.includes(provider),
    );

    return { configured, unconfigured };
  }
}
