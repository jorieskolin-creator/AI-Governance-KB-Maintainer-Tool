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

function unwrapJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return value;
  if (typeof value !== 'string') return value;
  const inner = value.trim();
  if (
    !(inner.startsWith('{') && inner.endsWith('}')) &&
    !(inner.startsWith('[') && inner.endsWith(']'))
  ) {
    return value;
  }
  try {
    return unwrapJsonValue(JSON.parse(inner), depth + 1);
  } catch {
    return value;
  }
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return unwrapJsonValue(JSON.parse(fenced ?? trimmed));
}

export function supportsCustomTemperature(target: ModelTarget): boolean {
  if (target.provider === 'KIMI' || target.provider === 'META') return false;
  if (target.provider === 'OPENAI') {
    const model = target.model.trim().toLowerCase();
    // GPT-5 / o-series only accept the model default (1). Sending 0 is a 400.
    if (/^o[1-9]/.test(model) || model.startsWith('gpt-5')) return false;
  }
  return true;
}

export function requestBody(request: ModelExecutionRequest): Record<string, unknown> {
  const common: Record<string, unknown> = {
    model: request.target.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt }
    ],
    response_format: { type: 'json_object' }
  };

  if (supportsCustomTemperature(request.target)) {
    common.temperature = 0;
  }

  return common;
}

function extractMessageContent(payload: Record<string, any>): string {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  if (typeof message?.refusal === 'string') return message.refusal;
  return '';
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
      body: JSON.stringify(requestBody(request)),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, any>;
    if (!response.ok) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`${request.target.provider}/${request.target.model}: ${message}`);
    }

    const rawText = extractMessageContent(payload);
    if (!rawText.trim()) {
      throw new Error(`${request.target.provider}/${request.target.model}: empty model response`);
    }

    return {
      provider: request.target.provider,
      model: request.target.model,
      rawText,
      parsedJson: parseModelJson(rawText),
      inputTokens: payload?.usage?.prompt_tokens,
      outputTokens: payload?.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      promptHash: promptHash(request.systemPrompt, request.userPrompt)
    };
  } finally {
    clearTimeout(timeout);
  }
}
