import { z } from 'zod';
import { anthropic, runTurnCredits, type TurnOptions, type TurnResult } from '../lib/anthropic';
import { runTurnSubscription, structuredSubscription } from '../lib/subscription';
import { env, type Billing, type Effort } from '../lib/env';
import { lighter, type Budget } from '../lib/budget';
import type { DomainLimits } from './tools';
import {
  ANALYST_SYSTEM,
  PLANNER_SYSTEM,
  RESEARCHER_SYSTEM,
  SYNTHESIZER_SYSTEM,
} from './prompts';

export interface ResearchOptions {
  mode: 'quick' | 'deep';
  /** Who pays: the Claude subscription (Agent SDK) or API credits (Messages API). */
  billing: Billing;
  effort: Effort;
  budget: Budget;
  domains?: DomainLimits;
  /** Streams the final report text as it's written. */
  onText?: (delta: string) => void;
  /** Status lines (planning, per-subtopic progress) — for stderr / UI log. */
  onProgress?: (line: string) => void;
  /** Abort the whole run (e.g. the browser disconnected). */
  signal?: AbortSignal;
}

export interface ResearchResult {
  report: string;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
  refused: boolean;
  subtopics?: string[];
}

function runTurn(billing: Billing, opts: TurnOptions): Promise<TurnResult> {
  return billing === 'subscription' ? runTurnSubscription(opts) : runTurnCredits(opts);
}

// ── Planner (deep mode): decompose into independent subtopics ─────────────────

const PlanSchema = z.object({ subtopics: z.array(z.string().min(1)).min(1).max(6) });

const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: { subtopics: { type: 'array', items: { type: 'string' } } },
  required: ['subtopics'],
  additionalProperties: false,
};

async function planSubtopics(question: string, billing: Billing, signal?: AbortSignal): Promise<string[]> {
  let raw: unknown;
  if (billing === 'subscription') {
    raw = await structuredSubscription(PLANNER_SYSTEM, question, PLAN_JSON_SCHEMA, signal);
  } else {
    const message = await anthropic.messages.create(
      {
        model: env.anthropicModel,
        max_tokens: 4000,
        system: PLANNER_SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_JSON_SCHEMA } },
        messages: [{ role: 'user', content: question }],
      },
      { signal },
    );
    const textBlock = message.content.find((b) => b.type === 'text');
    if (textBlock?.type === 'text') {
      try {
        raw = JSON.parse(textBlock.text);
      } catch {
        raw = undefined;
      }
    }
  }
  const parsed = PlanSchema.safeParse(raw);
  return parsed.success ? parsed.data.subtopics : [question]; // degrade gracefully to a single thread
}

// ── Quick mode: one agent, multi-search single pass ──────────────────────────

async function runQuick(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  const b = opts.budget;
  const r = await runTurn(opts.billing, {
    system: ANALYST_SYSTEM,
    input: question,
    effort: opts.effort,
    web: { budget: b, domains: opts.domains },
    signal: opts.signal,
    maxTokens: b.maxTokens,
    maxContinuations: b.maxContinuations,
    tokenCeiling: b.tokenCeiling,
    onText: opts.onText,
    onPhase: opts.onProgress,
  });
  return {
    report: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    truncated: r.truncated,
    refused: r.refused,
  };
}

// ── Deep mode: plan → parallel (lighter) sub-agents → lead synthesis ─────────

async function runDeep(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  const b = opts.budget;
  const subB = lighter(b);

  opts.onProgress?.('Planning subtopics…');
  const planned = await planSubtopics(question, opts.billing, opts.signal);
  const subtopics = planned.slice(0, b.maxSubtopics);
  opts.onProgress?.(`Researching ${subtopics.length} subtopics in parallel:`);

  const memos = await Promise.all(
    subtopics.map(async (subtopic): Promise<{ subtopic: string } & TurnResult> => {
      opts.onProgress?.(`  → ${subtopic}`);
      const r = await runTurn(opts.billing, {
        system: RESEARCHER_SYSTEM,
        input: `Subtopic to research: ${subtopic}\n\nThis is part of the larger question: "${question}"`,
        effort: opts.effort,
        web: { budget: subB, domains: opts.domains },
        signal: opts.signal,
        maxTokens: subB.maxTokens,
        maxContinuations: subB.maxContinuations,
        tokenCeiling: subB.tokenCeiling,
      });
      opts.onProgress?.(`  ✓ ${subtopic}${r.truncated ? ' (hit cap)' : ''}`);
      return { subtopic, ...r };
    }),
  );

  opts.onProgress?.('Synthesizing final report…');
  const memoBlock = memos
    .map((m, i) => `### Memo ${i + 1}: ${m.subtopic}\n\n${m.text}`)
    .join('\n\n---\n\n');
  const synthesis = await runTurn(opts.billing, {
    system: SYNTHESIZER_SYSTEM,
    input: `Original question: ${question}\n\nSub-agent findings memos:\n\n${memoBlock}`,
    effort: opts.effort,
    maxTokens: Math.min(b.maxTokens * 2, 24_000),
    maxContinuations: 1,
    tokenCeiling: b.tokenCeiling,
    onText: opts.onText,
    onPhase: opts.onProgress,
    signal: opts.signal,
  });

  return {
    report: synthesis.text,
    inputTokens: synthesis.inputTokens + memos.reduce((s, m) => s + m.inputTokens, 0),
    outputTokens: synthesis.outputTokens + memos.reduce((s, m) => s + m.outputTokens, 0),
    truncated: synthesis.truncated || memos.some((m) => m.truncated),
    refused: synthesis.refused,
    subtopics,
  };
}

export function research(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  return opts.mode === 'deep' ? runDeep(question, opts) : runQuick(question, opts);
}
