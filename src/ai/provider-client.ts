import { createHash } from 'node:crypto';
import {
  getProviderApiKey,
  getProviderBaseUrl,
  type ModelProvider,
  type ModelTarget
} from './model-router.js';

export interface StructuredOutputHint {
  schemaName: string;
  requiredFields: string[];
}

export interface ModelExecutionRequest {
  target: ModelTarget;
  systemPrompt: string;
  userPrompt: string;
  structuredOutput?: StructuredOutputHint;
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

function defaultTimeoutMs(): number {
  const value = Number(process.env.MODEL_REQUEST_TIMEOUT_MS ?? 360000);
  return Number.isFinite(value) && value > 0 ? value : 360000;
}

function promptHash(systemPrompt: string, userPrompt: string): string {
  return createHash('sha256')
    .update(systemPrompt)
    .update('\n---\n')
    .update(userPrompt)
    .digest('hex');
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

function isOpenAiReasoningSeries(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return (
    /^o[1-9]/.test(lower) ||
    lower.startsWith('gpt-5') ||
    lower.startsWith('gpt-6') ||
    lower.startsWith('gpt6')
  );
}

function isAnthropicThinkingEnabled(target: ModelTarget): boolean {
  if (target.provider !== 'ANTHROPIC') return false;
  if (typeof target.thinkingBudgetTokens === 'number' && target.thinkingBudgetTokens > 0) {
    return true;
  }
  return target.reasoningEffort === 'high' || target.reasoningEffort === 'medium';
}

export function supportsCustomTemperature(target: ModelTarget): boolean {
  if (target.provider === 'ANTHROPIC') {
    // Anthropic forbids setting temperature != 1 when extended thinking is enabled.
    return !isAnthropicThinkingEnabled(target);
  }
  if (target.provider === 'OPENAI') {
    if (isOpenAiReasoningSeries(target.model)) return false;
    return true;
  }
  if (target.provider === 'GROK') {
    // Grok 4.7 at low/default reasoning supports deterministic temperature: 0;
    // omit temperature if high reasoning effort is explicitly requested.
    return target.reasoningEffort !== 'high';
  }
  return true;
}

export function supportsProviderJsonSchema(target: ModelTarget): boolean {
  // OpenAI json_schema is documented for GPT-4o-class models.
  // GPT-5 / GPT-6.1 Terra / o-series, Anthropic, and Grok use json_object / prompt contract.
  return target.provider === 'OPENAI' && supportsCustomTemperature(target);
}

function topLevelSchemaFields(fields: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const field of fields) {
    const top = field.split('.')[0]?.trim();
    if (!top || seen.has(top)) continue;
    seen.add(top);
    result.push(top);
  }
  return result;
}

export function providerNativeResponseFormat(
  target: ModelTarget,
  structuredOutput?: StructuredOutputHint
): Record<string, unknown> {
  if (!supportsProviderJsonSchema(target) || !structuredOutput) {
    return { type: 'json_object' };
  }
  const name =
    structuredOutput.schemaName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'task_output';
  const required = topLevelSchemaFields(structuredOutput.requiredFields);
  const properties: Record<string, Record<string, unknown>> = {};
  for (const field of required) {
    properties[field] = {};
  }
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: false,
      schema: {
        type: 'object',
        properties,
        required,
        additionalProperties: true
      }
    }
  };
}

export function requestBody(request: ModelExecutionRequest): Record<string, unknown> {
  const { target } = request;

  if (target.provider === 'ANTHROPIC') {
    const thinkingEnabled = isAnthropicThinkingEnabled(target);
    const budgetTokens = thinkingEnabled
      ? target.thinkingBudgetTokens ?? (target.reasoningEffort === 'medium' ? 4096 : 8192)
      : 0;
    const requestedMaxTokens = target.maxOutputTokens ?? (thinkingEnabled ? 24576 : 16384);
    const maxTokens = thinkingEnabled
      ? Math.max(requestedMaxTokens, budgetTokens + 4096)
      : requestedMaxTokens;

    const anthropicBody: Record<string, unknown> = {
      model: target.model,
      max_tokens: maxTokens,
      system: `${request.systemPrompt}\n\nIMPORTANT: Return ONLY a single valid JSON object matching the requested schema, with no surrounding prose.`,
      messages: [{ role: 'user', content: request.userPrompt }]
    };

    if (thinkingEnabled) {
      anthropicBody.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens
      };
    } else {
      anthropicBody.temperature = 0;
    }

    return anthropicBody;
  }

  const common: Record<string, unknown> = {
    model: target.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt }
    ],
    response_format: providerNativeResponseFormat(target, request.structuredOutput)
  };

  if (target.reasoningEffort) {
    common.reasoning_effort = target.reasoningEffort;
  }

  if (typeof target.maxOutputTokens === 'number' && target.maxOutputTokens > 0) {
    if (target.provider === 'OPENAI' && isOpenAiReasoningSeries(target.model)) {
      common.max_completion_tokens = target.maxOutputTokens;
    } else {
      common.max_tokens = target.maxOutputTokens;
    }
  }

  if (supportsCustomTemperature(target)) {
    common.temperature = 0;
  }

  return common;
}

export function extractMessageContent(payload: Record<string, any>): string {
  // Anthropic /v1/messages response format (`content: [{ type: 'thinking', ... }, { type: 'text', text: '...' }]`)
  if (Array.isArray(payload?.content)) {
    return payload.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'thinking') return '';
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  }

  // OpenAI / Grok /v1/chat/completions response format
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

export async function executeModel(
  request: ModelExecutionRequest
): Promise<ModelExecutionResponse> {
  const started = Date.now();
  const baseUrl = getProviderBaseUrl(request.target.provider);
  const apiKey = getProviderApiKey(request.target.provider);
  const controller = new AbortController();
  const effectiveTimeout = request.target.timeoutMs ?? defaultTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  const isAnthropic = request.target.provider === 'ANTHROPIC';
  const endpointUrl = isAnthropic
    ? `${baseUrl}/messages`
    : `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = isAnthropic
    ? {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    : {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      };

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody(request)),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, any>;
    if (!response.ok) {
      const message =
        payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
      throw new Error(`${request.target.provider}/${request.target.model}: ${message}`);
    }

    const rawText = extractMessageContent(payload);
    if (!rawText.trim()) {
      throw new Error(
        `${request.target.provider}/${request.target.model}: empty model response`
      );
    }

    const inputTokens =
      payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens;
    const outputTokens =
      payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens;

    return {
      provider: request.target.provider,
      model: request.target.model,
      rawText,
      parsedJson: parseModelJson(rawText),
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      promptHash: promptHash(request.systemPrompt, request.userPrompt)
    };
  } finally {
    clearTimeout(timeout);
  }
}
