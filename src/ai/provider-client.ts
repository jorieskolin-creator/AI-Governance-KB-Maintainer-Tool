import { createHash } from 'node:crypto';
import {
  getProviderApiKey,
  getProviderBaseUrl,
  type ModelProvider,
  type ModelTarget
} from './model-router.js';

export interface ModelExecutionRequest {
  target: ModelTarget;
  systemPrompt: string;
  userPrompt: string;
}

export interface ModelExecutionResponse {
  provider: ModelProvider;
  model: string;
  rawText: string;
  parsedJson: unknown;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  promptHash: string;
}

function timeoutMs(): number {
  const value = Number(process.env.MODEL_REQUEST_TIMEOUT_MS ?? 360000);
  return Number.isFinite(value) && value > 0 ? value : 360000;
}

function promptHash(systemPrompt: string, userPrompt: string): string {
  return createHash('sha256').update(systemPrompt).update('\n---\n').update(userPrompt).digest('hex');
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return JSON.parse(fenced ?? trimmed);
}

export async function executeModel(request: ModelExecutionRequest): Promise<ModelExecutionResponse> {
  const started = Date.now();
  const baseUrl = getProviderBaseUrl(request.target.provider);
  const apiKey = getProviderApiKey(request.target.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.target.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, any>;
    if (!response.ok) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`${request.target.provider}/${request.target.model}: ${message}`);
    }

    const rawText = payload?.choices?.[0]?.message?.content;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new Error(`${request.target.provider}/${request.target.model}: empty model response`);
    }

    return {
      provider: request.target.provider,
      model: request.target.model,
      rawText,
      parsedJson: parseJsonText(rawText),
      inputTokens: payload?.usage?.prompt_tokens,
      outputTokens: payload?.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      promptHash: promptHash(request.systemPrompt, request.userPrompt)
    };
  } finally {
    clearTimeout(timeout);
  }
}
