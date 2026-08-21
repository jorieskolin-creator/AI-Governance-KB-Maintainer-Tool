import type { ModelRole } from '../domain/task-contract.js';

export type ModelProvider = 'OPENAI' | 'GROK' | 'KIMI';

export interface ModelTarget {
  provider: ModelProvider;
  model: string;
}

export interface ModelRoute {
  primary: ModelTarget;
  fallback: ModelTarget;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function provider(name: string): ModelProvider {
  const value = required(name).toUpperCase();
  if (value !== 'OPENAI' && value !== 'GROK' && value !== 'KIMI') {
    throw new Error(`${name} must be OPENAI, GROK or KIMI; received ${value}`);
  }
  return value;
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
      return required('GROK_API_KEY');
    case 'KIMI':
      return required('KIMI_API_KEY');
  }
}

export function getProviderBaseUrl(providerName: ModelProvider): string {
  const defaults: Record<ModelProvider, string> = {
    OPENAI: 'https://api.openai.com/v1',
    GROK: 'https://api.x.ai/v1',
    KIMI: 'https://api.moonshot.ai/v1'
  };
  const variable = `${providerName}_BASE_URL`;
  const configured = process.env[variable]?.trim();
  return (configured || defaults[providerName]).replace(/\/$/, '');
}
