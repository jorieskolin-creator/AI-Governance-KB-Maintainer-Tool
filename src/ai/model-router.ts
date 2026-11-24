import type { ModelRole } from '../domain/task-contract.js';

export type ModelProvider = 'OPENAI' | 'ANTHROPIC' | 'GROK';

export type ReasoningEffortLevel = 'low' | 'medium' | 'high';

export interface ModelTarget {
  provider: ModelProvider;
  model: string;
  reasoningEffort?: ReasoningEffortLevel;
  thinkingBudgetTokens?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ModelRoute {
  primary: ModelTarget;
  fallback: ModelTarget;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredAny(names: string[]): string {
  for (const name of names) {
    const value = optional(name);
    if (value) return value;
  }
  throw new Error(`Missing required environment variable; expected one of: ${names.join(', ')}`);
}

export function normalizeProviderName(raw: string, varName = 'PROVIDER'): ModelProvider {
  const value = raw.trim().toUpperCase();
  if (value === 'OPENAI') return 'OPENAI';
  if (value === 'ANTHROPIC' || value === 'CLAUDE') return 'ANTHROPIC';
  if (value === 'GROK' || value === 'XAI') return 'GROK';
  throw new Error(
    `${varName} must be OPENAI, ANTHROPIC, or GROK/XAI; received ${value}`
  );
}

export function normalizeModelIdentifier(
  providerName: ModelProvider,
  rawModel: string
): string {
  const trimmed = rawModel.trim();
  const lower = trimmed.toLowerCase().replace(/\s+/g, '-');

  if (providerName === 'ANTHROPIC') {
    if (
      lower === 'sonnet-5.5' ||
      lower === 'claude-sonnet-5.5' ||
      lower === 'claude-sonnet-5-5'
    ) {
      return 'claude-sonnet-5-5';
    }
    return trimmed;
  }

  if (providerName === 'OPENAI') {
    if (lower === 'gpt-6.1-terra' || lower === 'gpt6.1-terra') {
      return 'gpt-6.1-terra';
    }
    return trimmed;
  }

  if (providerName === 'GROK') {
    if (lower === 'grok-4.7' || lower === 'grok4.7') {
      return 'grok-4.7';
    }
    return trimmed;
  }

  return trimmed;
}

export function parseReasoningEffort(
  raw: string | undefined,
  fallbackEffort: ReasoningEffortLevel
): ReasoningEffortLevel {
  if (!raw) return fallbackEffort;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  throw new Error(
    `Invalid reasoning effort "${raw}"; expected "low", "medium", or "high".`
  );
}

export const DEFAULT_MODEL_ROUTES: Readonly<Record<ModelRole, ModelRoute>> = {
  WORKHORSE: {
    primary: {
      provider: 'ANTHROPIC',
      model: 'claude-sonnet-5-5',
      reasoningEffort: 'high',
      thinkingBudgetTokens: 8192,
      maxOutputTokens: 24576,
      timeoutMs: 360000
    },
    fallback: {
      provider: 'OPENAI',
      model: 'gpt-6.1-terra',
      reasoningEffort: 'high',
      maxOutputTokens: 24576,
      timeoutMs: 360000
    }
  },
  QUALITY_CHECKER: {
    primary: {
      provider: 'GROK',
      model: 'grok-4.7',
      reasoningEffort: 'low',
      maxOutputTokens: 12288,
      timeoutMs: 240000
    },
    fallback: {
      provider: 'OPENAI',
      model: 'gpt-6.1-terra',
      reasoningEffort: 'medium',
      maxOutputTokens: 12288,
      timeoutMs: 240000
    }
  },
  REASONER: {
    primary: {
      provider: 'OPENAI',
      model: 'gpt-6.1-terra',
      reasoningEffort: 'high',
      maxOutputTokens: 16384,
      timeoutMs: 300000
    },
    fallback: {
      provider: 'ANTHROPIC',
      model: 'claude-sonnet-5-5',
      reasoningEffort: 'high',
      thinkingBudgetTokens: 8192,
      maxOutputTokens: 16384,
      timeoutMs: 300000
    }
  }
};

function defaultParametersForTarget(
  role: ModelRole,
  providerName: ModelProvider,
  modelName: string,
  isFallback: boolean
): Pick<
  ModelTarget,
  'reasoningEffort' | 'thinkingBudgetTokens' | 'maxOutputTokens' | 'timeoutMs'
> {
  const baseRoleDefault = isFallback
    ? DEFAULT_MODEL_ROUTES[role].fallback
    : DEFAULT_MODEL_ROUTES[role].primary;
  const envEffort = optional(
    isFallback ? `${role}_FALLBACK_REASONING_EFFORT` : `${role}_REASONING_EFFORT`
  );

  // If QUALITY_CHECKER uses Grok 4.7, default reasoning effort is 'low' to prevent false-positive over-reasoning;
  // if QUALITY_CHECKER uses GPT 6.1 Terra / Sonnet 5.5, default is 'medium' unless overridden.
  const defaultEffort: ReasoningEffortLevel =
    role === 'QUALITY_CHECKER'
      ? providerName === 'GROK'
        ? 'low'
        : 'medium'
      : 'high';

  const reasoningEffort = parseReasoningEffort(
    envEffort,
    baseRoleDefault.reasoningEffort ?? defaultEffort
  );

  const thinkingBudgetTokens =
    providerName === 'ANTHROPIC'
      ? reasoningEffort === 'high'
        ? 8192
        : reasoningEffort === 'medium'
          ? 4096
          : undefined
      : undefined;

  return {
    reasoningEffort,
    thinkingBudgetTokens,
    maxOutputTokens: baseRoleDefault.maxOutputTokens,
    timeoutMs: baseRoleDefault.timeoutMs
  };
}

export function getModelRoute(role: ModelRole): ModelRoute {
  const defaults = DEFAULT_MODEL_ROUTES[role];

  const rawPrimaryProvider = optional(`${role}_PROVIDER`);
  const primaryProvider = rawPrimaryProvider
    ? normalizeProviderName(rawPrimaryProvider, `${role}_PROVIDER`)
    : defaults.primary.provider;
  const primaryModel = normalizeModelIdentifier(
    primaryProvider,
    optional(`${role}_MODEL`) ?? defaults.primary.model
  );

  const rawFallbackProvider = optional(`${role}_FALLBACK_PROVIDER`);
  const fallbackProvider = rawFallbackProvider
    ? normalizeProviderName(rawFallbackProvider, `${role}_FALLBACK_PROVIDER`)
    : defaults.fallback.provider;
  const fallbackModel = normalizeModelIdentifier(
    fallbackProvider,
    optional(`${role}_FALLBACK_MODEL`) ?? defaults.fallback.model
  );

  return {
    primary: {
      provider: primaryProvider,
      model: primaryModel,
      ...defaultParametersForTarget(role, primaryProvider, primaryModel, false)
    },
    fallback: {
      provider: fallbackProvider,
      model: fallbackModel,
      ...defaultParametersForTarget(role, fallbackProvider, fallbackModel, true)
    }
  };
}

export function getProviderApiKey(providerName: ModelProvider): string {
  switch (providerName) {
    case 'OPENAI':
      return required('OPENAI_API_KEY');
    case 'ANTHROPIC':
      return required('ANTHROPIC_API_KEY');
    case 'GROK':
      return requiredAny(['XAI_API_KEY', 'GROK_API_KEY']);
  }
}

export function getProviderBaseUrl(providerName: ModelProvider): string {
  const defaults: Record<ModelProvider, string> = {
    OPENAI: 'https://api.openai.com/v1',
    ANTHROPIC: 'https://api.anthropic.com/v1',
    GROK: 'https://api.x.ai/v1'
  };
  const variable = `${providerName}_BASE_URL`;
  const configured = optional(variable);
  return (configured || defaults[providerName]).replace(/\/$/, '');
}
