import Anthropic from '@anthropic-ai/sdk';
import { env, type Effort } from './env';

export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export interface TurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** True if the run was stopped by the token ceiling before finishing. */
  truncated: boolean;
}

export interface TurnOptions {
  system: string;
  /** User question / instructions for this turn. */
  input: string;
  effort: Effort;
  tools?: Anthropic.ToolUnion[];
  maxTokens?: number;
  /** Server-side tools loop server-side; if it pauses, we re-send up to this many times. */
  maxContinuations?: number;
  /** Hard stop: abort further continuations once cumulative in+out tokens exceed this. */
  tokenCeiling?: number;
  /** Stream text deltas as they arrive (for the report-writing turns). */
  onText?: (delta: string) => void;
  /** Live phase updates: 'searching the web', 'reading a source', 'thinking', 'writing'. */
  onPhase?: (phase: string) => void;
}

/** Map a starting content block to a human phase label. */
function phaseOf(block: Anthropic.ContentBlock): string | null {
  switch (block.type) {
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
 * Run one analytical turn on Opus with adaptive thinking + effort. Handles the
 * `pause_turn` continuation that server-side web tools can trigger when they hit
 * the per-request tool-iteration limit. Returns the full concatenated text.
 */
export async function runTurn(opts: TurnOptions): Promise<TurnResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.input }];
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let truncated = false;
  const maxContinuations = opts.maxContinuations ?? 4;
  const ceiling = opts.tokenCeiling ?? Infinity;

  for (let i = 0; i <= maxContinuations; i++) {
    const stream = anthropic.messages.stream({
      model: env.anthropicModel,
      max_tokens: opts.maxTokens ?? 16_000,
      system: opts.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort },
      tools: opts.tools,
      messages,
    });

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

    if (message.stop_reason === 'pause_turn') {
      // Server tool loop hit its limit mid-task. Stop here if we've blown the
      // token ceiling, otherwise re-send to resume.
      if (inputTokens + outputTokens >= ceiling) {
        truncated = true;
        break;
      }
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    break;
  }

  return { text, inputTokens, outputTokens, truncated };
}
