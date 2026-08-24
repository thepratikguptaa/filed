import { azureLlm } from "./azure";
import type { LlmProvider } from "./types";

export type { CompletionOptions, LlmProvider, Message } from "./types";

let cached: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (!cached) cached = azureLlm();
  return cached;
}
