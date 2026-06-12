import Anthropic from '@anthropic-ai/sdk';
import { env, type Effort } from './env';

export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export interface TurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
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
  /** Stream text deltas as they arrive (for the report-writing turns). */
  onText?: (delta: string) => void;
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
  const maxContinuations = opts.maxContinuations ?? 4;

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

    const message = await stream.finalMessage();
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
    }
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;

    if (message.stop_reason === 'pause_turn') {
      // Server tool loop hit its limit mid-task — re-send to resume.
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    break;
  }

  return { text, inputTokens, outputTokens };
}
