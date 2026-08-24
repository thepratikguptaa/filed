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
      });
      return response.choices[0]?.message?.content?.trim() ?? "";
    },
  };
}
