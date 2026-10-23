import { azureLlm } from "./azure";
import { openAiLlm } from "./openai";
import { ollamaLlm } from "./ollama";
import type { LlmProvider } from "./types";

export type { CompletionOptions, LlmProvider, Message } from "./types";

let cached: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (cached) return cached;

  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();

  if (provider === "openai" || (!provider && process.env.OPENAI_API_KEY && !process.env.AZURE_OPENAI_API_KEY)) {
    cached = openAiLlm();
  } else if (provider === "ollama") {
    cached = ollamaLlm();
  } else {
    cached = azureLlm();
  }

  return cached;
}
