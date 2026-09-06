import type { ModelRole } from '../domain/task-contract.js';

export type ModelProvider = 'OPENAI' | 'GROK' | 'KIMI' | 'META';

export interface ModelTarget {
  provider: ModelProvider;
  model: string;
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

function provider(name: string): ModelProvider {
  const value = required(name).toUpperCase();
  if (value === 'OPENAI') return 'OPENAI';
  if (value === 'GROK' || value === 'XAI') return 'GROK';
  if (value === 'KIMI' || value === 'MOONSHOT') return 'KIMI';
  if (value === 'META' || value === 'MUSE' || value === 'META_AI') return 'META';
  throw new Error(
    `${name} must be OPENAI, GROK/XAI, KIMI/MOONSHOT or META/MUSE; received ${value}`
  );
}

export function getModelRoute(role: ModelRole): ModelRoute {
  return {
    primary: {
      provider: provider(`${role}_PROVIDER`),
      model: required(`${role}_MODEL`)
    },
    fallback: {
      provider: provider(`${role}_FALLBACK_PROVIDER`),
      model: required(`${role}_FALLBACK_MODEL`)
    }
  };
}

export function getProviderApiKey(providerName: ModelProvider): string {
  switch (providerName) {
    case 'OPENAI':
      return required('OPENAI_API_KEY');
    case 'GROK':
      return requiredAny(['GROK_API_KEY', 'XAI_API_KEY']);
    case 'KIMI':
      return requiredAny(['KIMI_API_KEY', 'MOONSHOT_API_KEY']);
    case 'META':
      return requiredAny(['META_API_KEY', 'MODEL_API_KEY', 'MUSE_API_KEY']);
  }
}

export function getProviderBaseUrl(providerName: ModelProvider): string {
  const defaults: Record<ModelProvider, string> = {
    OPENAI: 'https://api.openai.com/v1',
    GROK: 'https://api.x.ai/v1',
    KIMI: 'https://api.moonshot.ai/v1',
    META: 'https://api.meta.ai/v1'
  };
  const variable = `${providerName}_BASE_URL`;
  const configured = optional(variable);
  return (configured || defaults[providerName]).replace(/\/$/, '');
}
