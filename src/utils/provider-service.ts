import { Anthropic } from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import type { Provider } from "./credentials";
import type { Message } from "./types";

export class ProviderService {
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private geminiClient?: GoogleGenerativeAI;

  constructor(
    private provider: Provider,
    private apiKey: string,
    private model: string,
  ) {
    this.initializeClient();
  }

  private initializeClient() {
    switch (this.provider) {
      case "anthropic":
        this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
        break;
      case "openai":
        this.openaiClient = new OpenAI({ apiKey: this.apiKey });
        break;
      case "gemini":
        this.geminiClient = new GoogleGenerativeAI(this.apiKey);
        break;
    }
  }

  async *streamChat(messages: Message[]): AsyncGenerator<string> {
    try {
      switch (this.provider) {
        case "anthropic": {
          if (!this.anthropicClient)
            throw new Error("Anthropic client not initialized");
          const stream = await this.anthropicClient.messages.create({
            model: this.model,
            messages: messages.map((msg) => ({
              role: msg.role === "user" ? "user" : "assistant",
              content: msg.content,
            })),
            max_tokens: 4096,
            stream: true,
          });

          for await (const chunk of stream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta?.type === "text_delta"
            ) {
              yield chunk.delta.text;
            }
          }
          break;
        }

        case "openai": {
          if (!this.openaiClient)
            throw new Error("OpenAI client not initialized");
          const stream = await this.openaiClient.chat.completions.create({
            model: this.model,
            messages: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            stream: true,
          });

          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              yield chunk.choices[0].delta.content;
            }
          }
          break;
        }

        case "gemini": {
          if (!this.geminiClient)
            throw new Error("Gemini client not initialized");
          const model = this.geminiClient.getGenerativeModel({
            model: this.model,
          });

          // Convert messages to Gemini format
          const contents = messages.map((msg) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));

          // Stream the response
          const result = await model.generateContentStream({
            contents,
          });

          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              yield text;
            }
          }
          break;
        }
      }
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Unknown error occurred while streaming chat");
    }
  }
}
