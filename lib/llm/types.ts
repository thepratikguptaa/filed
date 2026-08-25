export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface LlmProvider {
  readonly id: string;
  complete(messages: Message[], options?: CompletionOptions): Promise<string>;
}
