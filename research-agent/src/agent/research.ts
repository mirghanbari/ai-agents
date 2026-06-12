import { z } from 'zod';
import { anthropic, runTurn, type TurnResult } from '../lib/anthropic';
import { env, type Effort } from '../lib/env';
import { lighter, type Budget } from '../lib/budget';
import { webTools, type DomainLimits } from './tools';
import {
  ANALYST_SYSTEM,
  PLANNER_SYSTEM,
  RESEARCHER_SYSTEM,
  SYNTHESIZER_SYSTEM,
} from './prompts';

export interface ResearchOptions {
  mode: 'quick' | 'deep';
  effort: Effort;
  budget: Budget;
  domains?: DomainLimits;
  /** Streams the final report text as it's written. */
  onText?: (delta: string) => void;
  /** Status lines (planning, per-subtopic progress) — for stderr / UI log. */
  onProgress?: (line: string) => void;
}

export interface ResearchResult {
  report: string;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
  subtopics?: string[];
}

// ── Planner (deep mode): decompose into independent subtopics ─────────────────

const PlanSchema = z.object({ subtopics: z.array(z.string().min(1)).min(1).max(6) });

async function planSubtopics(question: string): Promise<string[]> {
  const message = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 4000,
    system: PLANNER_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { subtopics: { type: 'array', items: { type: 'string' } } },
          required: ['subtopics'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: question }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (textBlock?.type !== 'text') return [question];
  try {
    return PlanSchema.parse(JSON.parse(textBlock.text)).subtopics;
  } catch {
    return [question]; // degrade gracefully to a single thread
  }
}

// ── Quick mode: one agent, multi-search single pass ──────────────────────────

async function runQuick(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  const b = opts.budget;
  const r = await runTurn({
    system: ANALYST_SYSTEM,
    input: question,
    effort: opts.effort,
    tools: webTools(b, opts.domains),
    maxTokens: b.maxTokens,
    maxContinuations: b.maxContinuations,
    tokenCeiling: b.tokenCeiling,
    onText: opts.onText,
  });
  return {
    report: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    truncated: r.truncated,
  };
}

// ── Deep mode: plan → parallel (lighter) sub-agents → lead synthesis ─────────

async function runDeep(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  const b = opts.budget;
  const subB = lighter(b);

  opts.onProgress?.('Planning subtopics…');
  const planned = await planSubtopics(question);
  const subtopics = planned.slice(0, b.maxSubtopics);
  opts.onProgress?.(`Researching ${subtopics.length} subtopics in parallel:`);

  const memos = await Promise.all(
    subtopics.map(async (subtopic): Promise<{ subtopic: string } & TurnResult> => {
      opts.onProgress?.(`  → ${subtopic}`);
      const r = await runTurn({
        system: RESEARCHER_SYSTEM,
        input: `Subtopic to research: ${subtopic}\n\nThis is part of the larger question: "${question}"`,
        effort: opts.effort,
        tools: webTools(subB, opts.domains),
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
  const synthesis = await runTurn({
    system: SYNTHESIZER_SYSTEM,
    input: `Original question: ${question}\n\nSub-agent findings memos:\n\n${memoBlock}`,
    effort: opts.effort,
    maxTokens: Math.min(b.maxTokens * 2, 24_000),
    maxContinuations: 1,
    tokenCeiling: b.tokenCeiling,
    onText: opts.onText,
  });

  return {
    report: synthesis.text,
    inputTokens: synthesis.inputTokens + memos.reduce((s, m) => s + m.inputTokens, 0),
    outputTokens: synthesis.outputTokens + memos.reduce((s, m) => s + m.outputTokens, 0),
    truncated: synthesis.truncated || memos.some((m) => m.truncated),
    subtopics,
  };
}

export function research(question: string, opts: ResearchOptions): Promise<ResearchResult> {
  return opts.mode === 'deep' ? runDeep(question, opts) : runQuick(question, opts);
}
