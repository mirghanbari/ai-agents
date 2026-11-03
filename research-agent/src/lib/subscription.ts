import {
  query,
  type HookCallback,
  type HookJSONOutput,
  type OutputFormat,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { env } from './env';
import type { TurnOptions, TurnResult } from './anthropic';
import type { DomainLimits } from '../agent/tools';

// Subscription billing: the same research turn, run through the Claude Agent SDK.
// The SDK drives a Claude Code subprocess that signs in with your Claude Pro/Max
// subscription (the existing `claude login`, or CLAUDE_CODE_OAUTH_TOKEN), so runs
// count against plan usage instead of spending API credits.
//
// Web access uses Claude Code's built-in WebSearch / WebFetch tools. WebFetch
// returns a model-written digest of the page rather than raw page text, so the
// credits path's `fetchContentTokens` cap has no direct equivalent here. The
// search/fetch counts and the domain list are enforced by a PreToolUse hook, and
// `maxTurns` bounds the loop length.

/**
 * Subprocess env that forces subscription auth. Keeps PATH/HOME (so the CLI can
 * find its login in the keychain) but DROPS ANTHROPIC_API_KEY: if the key were
 * present, Claude Code would prefer it and quietly bill API credits. The SDK's
 * `env` option replaces the subprocess env entirely, so we copy process.env.
 */
function subscriptionEnv(): Record<string, string> {
  // ANTHROPIC_AUTH_TOKEN is API billing too. The OAuth token is re-added below
  // only if non-empty: a blank one (from an unfilled .env line) breaks sign-in.
  const strip = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!strip.has(k) && v !== undefined) out[k] = v;
  }
  if (env.claudeCodeOAuthToken) out.CLAUDE_CODE_OAUTH_TOKEN = env.claudeCodeOAuthToken;
  return out;
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  };
}

function allow(updatedInput?: Record<string, unknown>): HookJSONOutput {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', ...(updatedInput ? { updatedInput } : {}) },
  };
}

/** PreToolUse hook: enforce the budget's search/fetch counts and the domain list. */
function webGuard(searchUses: number, fetchUses: number, domains: DomainLimits | undefined): HookCallback {
  let searches = 0;
  let fetches = 0;
  const allowList = domains?.allow?.length ? domains.allow : undefined;
  const blockList = !allowList && domains?.block?.length ? domains.block : undefined;

  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolInput = (typeof input.tool_input === 'object' && input.tool_input !== null
      ? input.tool_input
      : {}) as Record<string, unknown>;

    if (input.tool_name === 'WebSearch') {
      if (searches >= searchUses) return deny('Search budget used up. Write the report from what you have.');
      searches++;
      if (allowList) return allow({ ...toolInput, allowed_domains: allowList });
      if (blockList) return allow({ ...toolInput, blocked_domains: blockList });
      return allow();
    }
    if (input.tool_name === 'WebFetch') {
      if (fetches >= fetchUses) return deny('Fetch budget used up. Write the report from what you have.');
      let host = '';
      try {
        host = new URL(String(toolInput.url ?? '')).hostname;
      } catch {
        return deny('Invalid URL.');
      }
      if (allowList && !hostMatches(host, allowList)) return deny(`Only these domains may be fetched: ${allowList.join(', ')}`);
      if (blockList && hostMatches(host, blockList)) return deny(`${host} is blocked for this run.`);
      fetches++;
      return allow();
    }
    return deny('Only web search and web fetch are available.');
  };
}

function usageTotals(result: SDKResultMessage): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const u of Object.values(result.modelUsage)) {
    inputTokens += u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
    outputTokens += u.outputTokens;
  }
  return { inputTokens, outputTokens };
}

const AUTH_HINT =
  'Subscription sign-in failed. Run `claude login` (or set CLAUDE_CODE_OAUTH_TOKEN in .env), or use credits instead.';

interface SdkRunOptions {
  system: string;
  prompt: string;
  effort: TurnOptions['effort'];
  web?: TurnOptions['web'];
  outputFormat?: OutputFormat;
  onText?: (delta: string) => void;
  onPhase?: (phase: string) => void;
  signal?: AbortSignal;
}

async function runSdk(o: SdkRunOptions): Promise<TurnResult & { structured?: unknown }> {
  const abortController = new AbortController();
  const onAbort = (): void => abortController.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });

  const web = o.web;
  // Each tool call + its result is one turn; leave room for the final write-up.
  const maxTurns = web ? web.budget.searchUses + web.budget.fetchUses + 3 : 3;

  let text = '';
  let refused = false;
  let assistantError: string | undefined;
  let result: SDKResultMessage | undefined;

  try {
    const run = query({
      prompt: o.prompt,
      options: {
        model: env.anthropicModel,
        effort: o.effort,
        env: subscriptionEnv(),
        abortController,
        // Our own analyst persona only: no Claude Code coding preset, and no
        // on-disk settings, CLAUDE.md, or plugins from wherever this runs.
        systemPrompt: o.system,
        settingSources: [],
        tools: web ? ['WebSearch', 'WebFetch'] : [],
        hooks: web
          ? { PreToolUse: [{ hooks: [webGuard(web.budget.searchUses, web.budget.fetchUses, web.domains)] }] }
          : undefined,
        // Headless: never block on a permission prompt. The hook above still
        // denies anything over budget or outside the domain list.
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        maxTurns,
        ...(o.outputFormat ? { outputFormat: o.outputFormat } : {}),
      },
    });

    for await (const m of run) {
      if (m.type === 'stream_event') {
        if (m.parent_tool_use_id !== null) continue;
        const ev = m.event;
        if (ev.type === 'content_block_start') {
          const b = ev.content_block;
          if (b.type === 'thinking') o.onPhase?.('thinking');
          else if (b.type === 'text') o.onPhase?.('writing the report');
          else if (b.type === 'tool_use' && b.name === 'WebSearch') o.onPhase?.('searching the web');
          else if (b.type === 'tool_use' && b.name === 'WebFetch') o.onPhase?.('reading a source');
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          text += ev.delta.text;
          o.onText?.(ev.delta.text);
        }
      } else if (m.type === 'assistant' && m.error) {
        assistantError = m.error;
      } else if (m.type === 'system' && m.subtype === 'model_refusal_fallback') {
        o.onPhase?.(`retrying on ${m.fallback_model}`);
      } else if (m.type === 'system' && m.subtype === 'model_refusal_no_fallback') {
        refused = true;
        const category = m.api_refusal_category;
        const note = `\n\n> ⚠️ The model declined to continue this request${category ? ` (category: ${category})` : ''}. Any text above is incomplete.\n`;
        text += note;
        o.onText?.(note);
      } else if (m.type === 'result') {
        result = m;
      }
    }
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
  }

  if (assistantError && ['authentication_failed', 'oauth_org_not_allowed', 'billing_error'].includes(assistantError)) {
    throw new Error(`${AUTH_HINT} (${assistantError})`);
  }
  if (!result) throw new Error(assistantError ? `Agent SDK error: ${assistantError}` : 'Agent SDK run ended without a result.');
  if (result.subtype === 'error_during_execution') {
    throw new Error(`Agent SDK error: ${result.errors.join('; ') || assistantError || 'unknown'}`);
  }

  const { inputTokens, outputTokens } = usageTotals(result);
  return {
    text,
    inputTokens,
    outputTokens,
    truncated: result.subtype === 'error_max_turns' || assistantError === 'max_output_tokens',
    refused,
    structured: result.subtype === 'success' ? result.structured_output : undefined,
  };
}

/** One research turn billed to the Claude subscription. Same contract as runTurnCredits. */
export async function runTurnSubscription(opts: TurnOptions): Promise<TurnResult> {
  const r = await runSdk({
    system: opts.system,
    prompt: opts.input,
    effort: opts.effort,
    web: opts.web,
    onText: opts.onText,
    onPhase: opts.onPhase,
    signal: opts.signal,
  });
  return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, truncated: r.truncated, refused: r.refused };
}

/** Structured-output call (no tools) billed to the subscription. Returns the parsed object, or undefined. */
export async function structuredSubscription(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const r = await runSdk({
    system,
    prompt,
    effort: 'medium',
    outputFormat: { type: 'json_schema', schema },
    signal,
  });
  return r.structured;
}
