import { logger } from '../shared/logger.js';
import { LlmError } from '../shared/errors.js';
import type { Config } from '../shared/config.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  token_count: number;
  cost_estimate: number;
}

// OpenAI-compatible chat completions API response shape (partial)
interface OpenAIResponse {
  choices: Array<{ message: { content: string | null } }>;
  model: string;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

export class LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private activeRequests = 0;

  constructor(config: Config['llm']) {
    this.baseUrl = config.base_url || 'https://api.openai.com/v1';
    this.apiKey = config.api_key;
    this.model = config.model;
    this.maxTokens = config.max_tokens;
    this.temperature = config.temperature;
    this.timeoutMs = config.timeout_ms;
    this.maxConcurrent = config.max_concurrent;
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    // Enforce concurrency limit
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.activeRequests++;
    try {
      return await this.doRequest(messages);
    } finally {
      this.activeRequests--;
    }
  }

  private async doRequest(messages: LlmMessage[]): Promise<LlmResponse> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const body = JSON.stringify({
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LlmError(`LLM request timed out after ${this.timeoutMs}ms`)), this.timeoutMs),
    );

    let response: Response;
    try {
      response = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(`LLM request failed: ${err instanceof Error ? err.message : String(err)}`, {
        url,
        model: this.model,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LlmError(`LLM API error: ${response.status} ${response.statusText}`, {
        status: response.status,
        body: text.slice(0, 500),
        url,
      });
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (err) {
      throw new LlmError('LLM response is not valid JSON', { url });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LlmError('LLM returned empty content', { response: JSON.stringify(data).slice(0, 200) });
    }

    const tokenCount = data.usage?.total_tokens ?? 0;
    // Rough cost estimate: $0.40/1M input + $1.60/1M output (gpt-4.1-mini rates)
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const costEstimate = (promptTokens * 0.0000004) + (completionTokens * 0.0000016);

    logger.debug(
      { model: data.model, tokens: tokenCount, cost: costEstimate.toFixed(6) },
      'LLM call completed',
    );

    return {
      content,
      model: data.model,
      token_count: tokenCount,
      cost_estimate: costEstimate,
    };
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }
}

let clientInstance: LlmClient | null = null;

export function initLlmClient(config: Config['llm']): LlmClient {
  clientInstance = new LlmClient(config);
  return clientInstance;
}

export function getLlmClient(): LlmClient {
  if (!clientInstance) {
    throw new LlmError('LLM client not initialized. Call initLlmClient() first.');
  }
  return clientInstance;
}

export function resetLlmClient(): void {
  clientInstance = null;
}
