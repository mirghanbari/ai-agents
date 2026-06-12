import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load this agent's own .env (research-agent/.env), regardless of cwd.
const here = dirname(fileURLToPath(import.meta.url)); // src/lib
config({ path: resolve(here, '../../.env') });

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function parseEffort(value: string | undefined, fallback: Effort): Effort {
  return value && (EFFORT_ORDER as string[]).includes(value) ? (value as Effort) : fallback;
}

/** Bump effort up by `steps`, clamped to `max`. Deep mode bumps by 1. */
export function bumpEffort(effort: Effort, steps = 1): Effort {
  const i = Math.min(EFFORT_ORDER.indexOf(effort) + steps, EFFORT_ORDER.length - 1);
  return EFFORT_ORDER[i];
}

export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  effort: parseEffort(process.env.RESEARCH_EFFORT, 'medium'),
} as const;
