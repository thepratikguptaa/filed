import { AzureOpenAI } from "openai";
import { env } from "../config";
import type { CompletionOptions, LlmProvider, Message } from "./types";

export function azureLlm(): LlmProvider {
  const deployment = env.azureChatDeployment;
  const client = new AzureOpenAI({
    endpoint: env.azureEndpoint,
    apiKey: env.azureApiKey,
    apiVersion: env.azureApiVersion,
    deployment,
  });

  return {
    id: `azure:${deployment}`,
    async complete(messages: Message[], options: CompletionOptions = {}): Promise<string> {
      const response = await client.chat.completions.create({
        model: deployment,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 900,
        ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      return response.choices[0]?.message?.content?.trim() ?? "";
    },
    async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<string> {
      const response = await client.chat.completions.create({
        model: deployment,
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
