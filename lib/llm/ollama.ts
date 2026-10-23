import OpenAI from "openai";
import type { CompletionOptions, LlmProvider, Message } from "./types";

export function ollamaLlm(): LlmProvider {
  const model = process.env.OLLAMA_MODEL ?? "llama3.1";
  const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";

  // Ollama exposes an OpenAI-compatible API at /v1
  const client = new OpenAI({
    apiKey: "ollama",
    baseURL,
  });

  return {
    id: `ollama:${model}`,
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
