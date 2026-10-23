import OpenAI from "openai";
import type { CompletionOptions, LlmProvider, Message } from "./types";

export function openAiLlm(): LlmProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI provider.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o";
  const baseURL = process.env.OPENAI_BASE_URL;

  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });

  return {
    id: `openai:${model}`,
    async complete(messages: Message[], options: CompletionOptions = {}): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 900,
        ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      return response.choices[0]?.message?.content?.trim() ?? "";
    },
    async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<string> {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 900,
        stream: true,
        ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}
