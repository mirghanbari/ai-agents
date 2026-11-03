import Anthropic from '@anthropic-ai/sdk';
import { env, type Effort } from './env';
import type { Budget } from './budget';
import { webTools, type DomainLimits } from '../agent/tools';

export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

/** Beta that gates the server-side refusal fallback (array form). */
const FALLBACK_BETA = 'server-side-fallback-2026-06-01';

export interface TurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** True if the run stopped early: token ceiling, or the reply hit max_tokens. */
  truncated: boolean;
  /** True if the model (and any fallback) declined the request. */
  refused: boolean;
}

export interface TurnOptions {
  system: string;
  /** User question / instructions for this turn. */
  input: string;
  effort: Effort;
  /** Give the turn web search + fetch, bounded by this budget. Omit for no tools. */
  web?: { budget: Budget; domains?: DomainLimits };
  maxTokens?: number;
  /** Server-side tools loop server-side; if it pauses, we re-send up to this many times. */
  maxContinuations?: number;
  /** Hard stop: abort further continuations once cumulative in+out tokens exceed this. */
  tokenCeiling?: number;
  /** Stream text deltas as they arrive (for the report-writing turns). */
  onText?: (delta: string) => void;
  /** Live phase updates: 'searching the web', 'reading a source', 'thinking', 'writing'. */
  onPhase?: (phase: string) => void;
  /** Abort the turn (e.g. the browser disconnected). */
  signal?: AbortSignal;
}

/** Map a starting content block to a human phase label. */
function phaseOf(block: Anthropic.Beta.BetaContentBlock): string | null {
  switch (block.type) {
    case 'fallback':
      return `retrying on ${block.to.model}`;
    case 'thinking':
      return 'thinking';
    case 'text':
      return 'writing the report';
    case 'server_tool_use':
      if (block.name === 'web_search') return 'searching the web';
      if (block.name === 'web_fetch') return 'reading a source';
      return 'using a tool';
    default:
      return null;
  }
}

/**
 * Content to echo back when resuming after `pause_turn`. After a mid-output
 * fallback, blocks before the last `fallback` boundary that the fallback model
 * can't continue from must be dropped: thinking, tool_use, and server-tool calls
 * without their result. Text and paired server-tool blocks echo normally.
 */
function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  const resultIds = new Set(
    content.flatMap((b) => ('tool_use_id' in b && typeof b.tool_use_id === 'string' ? [b.tool_use_id] : [])),
  );
  return content.filter((b, i) => {
    if (i >= boundary) return true;
    if (b.type === 'text') return true;
    if (b.type === 'server_tool_use') return resultIds.has(b.id);
    if ('tool_use_id' in b) return true; // server-tool result paired with a kept call
    return false;
  });
}

/**
 * Run one analytical turn on Opus with adaptive thinking + effort. Handles the
 * `pause_turn` continuation that server-side web tools can trigger when they hit
 * the per-request tool-iteration limit. Returns the full concatenated text.
 */
export async function runTurnCredits(opts: TurnOptions): Promise<TurnResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.input }];
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let truncated = false;
  let refused = false;
  const maxContinuations = opts.maxContinuations ?? 4;
  const ceiling = opts.tokenCeiling ?? Infinity;

  for (let i = 0; i <= maxContinuations; i++) {
    const stream = anthropic.beta.messages.stream({
      model: env.anthropicModel,
      max_tokens: opts.maxTokens ?? 16_000,
      system: opts.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort },
      tools: opts.web ? webTools(opts.web.budget, opts.web.domains) : undefined,
      messages,
      // If a safety classifier declines (e.g. a false positive on a biology or
      // security question), the API re-runs the request on the fallback model.
      ...(env.fallbackModel
        ? { betas: [FALLBACK_BETA], fallbacks: [{ model: env.fallbackModel }] }
        : {}),
    }, { signal: opts.signal });

    if (opts.onText) stream.on('text', (delta) => opts.onText?.(delta));
    if (opts.onPhase) {
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const phase = phaseOf(event.content_block);
          if (phase) opts.onPhase?.(phase);
        }
      });
    }

    const message = await stream.finalMessage();
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
    }
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;

    if (message.stop_reason === 'refusal') {
      // The whole chain declined. Any partial text is incomplete; say so plainly.
      refused = true;
      const category = message.stop_details?.category;
      const note = `\n\n> ⚠️ The model declined to continue this request${category ? ` (category: ${category})` : ''}. Any text above is incomplete.\n`;
      text += note;
      opts.onText?.(note);
      break;
    }
    if (message.stop_reason === 'max_tokens') {
      truncated = true;
      break;
    }
    if (message.stop_reason === 'pause_turn') {
      // Server tool loop hit its limit mid-task. Stop here if we've blown the
      // token ceiling, otherwise re-send to resume.
      if (inputTokens + outputTokens >= ceiling) {
        truncated = true;
        break;
      }
      messages.push({ role: 'assistant', content: echoable(message.content) });
      continue;
    }
    break;
  }

  return { text, inputTokens, outputTokens, truncated, refused };
}
