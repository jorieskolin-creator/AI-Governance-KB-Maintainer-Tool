import type { ModelRole } from '../domain/task-contract.js';

export interface ModelRoute {
  primary: string;
  fallback: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getModelRoute(role: ModelRole): ModelRoute {
  const prefix = role;
  return {
    primary: required(`${prefix}_MODEL`),
    fallback: required(`${prefix}_FALLBACK_MODEL`)
  };
}

// Provider-specific clients belong behind adapters. Cognitive services request
// REASONER / WORKHORSE / QUALITY_CHECKER and never call a provider directly.
