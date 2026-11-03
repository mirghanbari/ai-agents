import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load this agent's own .env (research-agent/.env), regardless of cwd.
const here = dirname(fileURLToPath(import.meta.url)); // src/lib
config({ path: resolve(here, '../../.env') });

/** Who pays for a run: the Claude Pro/Max subscription, or pay-as-you-go API credits. */
export type Billing = 'subscription' | 'credits';

export function parseBilling(value: string | undefined, fallback: Billing): Billing {
  return value === 'subscription' || value === 'credits' ? value : fallback;
}

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
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  /** Model to re-run on if a safety classifier declines. Set to "none" to disable. */
  fallbackModel:
    process.env.ANTHROPIC_FALLBACK_MODEL === 'none'
      ? null
      : process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-opus-4-8',
  effort: parseEffort(process.env.RESEARCH_EFFORT, 'medium'),
  /** Default billing. Subscription unless RESEARCH_BILLING=credits. */
  billing: parseBilling(process.env.RESEARCH_BILLING, 'subscription'),
  /** Optional: for headless use (`claude setup-token`). Otherwise the existing `claude login` is used. */
  claudeCodeOAuthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
} as const;
