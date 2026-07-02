import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { env } from '../lib/env';
import { agentSystemPrompt } from '../agent';
import { createWayfarerServer, wayfarerToolNames } from '../agent/sdkTools';
import { emptyResults, mergeResults } from '../lib/results';
import type { SearchResults } from '../types/travel';

// Subscription-auth chat: runs the same Wayfarer agent + seven searches through
// the Claude Agent SDK, which authenticates with a Claude Pro/Max subscription
// (CLAUDE_CODE_OAUTH_TOKEN) instead of billing pay-as-you-go API credits. Emits
// the identical SSE event shape as routes/chat.ts so the client is unchanged.

const router = express.Router();

const ChatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  newMessage: z.string().min(1).max(2000),
});

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Flatten prior turns into a single primer message. The Agent SDK's default
 * (string prompt) mode is one-shot, so we fold conversation history into the
 * prompt rather than replaying it as separate turns — enough for the agent to
 * keep context without the streaming-input machinery.
 */
function buildPrompt(messages: { role: string; content: string }[], newMessage: string): string {
  if (messages.length === 0) return newMessage;
  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Wayfarer'}: ${m.content}`)
    .join('\n\n');
  return `Conversation so far:\n${history}\n\nUser: ${newMessage}`;
}

/** Pull streamable assistant text out of an SDK message, across shape variants. */
function extractText(message: SDKMessage): string {
  if (message.type === 'assistant') {
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: 'text'; text: string } => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
    }
  }
  return '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Pull search tool calls out of an assistant message so we can emit the same
 * `searching` event the API-key route does (drives the client's progress
 * indicator). SDK MCP tools are namespaced `mcp__<server>__<tool>`; the client
 * expects the bare tool name (e.g. `search_flights`), so strip the prefix.
 */
function extractToolUses(message: SDKMessage): { name: string; input: unknown }[] {
  if (message.type !== 'assistant') return [];
  const content = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is { type: 'tool_use'; name: string; input: unknown } =>
      isRecord(b) && b.type === 'tool_use' && typeof b.name === 'string',
    )
    .map((b) => ({ name: b.name.replace(/^mcp__wayfarer-search__/, ''), input: b.input }));
}

router.post('/', async (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const { messages, newMessage } = parsed.data;
  sseHeaders(res);

  // Force subscription auth: hand the subprocess a clean env that keeps PATH/HOME
  // (so it can find the CLI and read the Claude Code keychain login) but DROPS
  // ANTHROPIC_API_KEY — otherwise the CLI would prefer API-key billing and
  // silently charge credits, defeating the point of subscription mode. Auth then
  // comes from CLAUDE_CODE_OAUTH_TOKEN if set, else the existing `claude login`.
  const subprocessEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'ANTHROPIC_API_KEY' && v !== undefined) subprocessEnv[k] = v;
  }
  if (env.claudeCodeOAuthToken) subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN = env.claudeCodeOAuthToken;

  // Stop the agent loop (and the scrapers it drives) if the client goes away —
  // otherwise a navigated-away request keeps spending a subscription call and
  // browser time on output nobody will receive.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  const accumulated = emptyResults();
  const startTime = Date.now();

  // Tools push each partial result here; we merge into the accumulator and
  // stream it, matching the API-key route's `partial_results` events.
  const mcpServer = createWayfarerServer((partial: Partial<SearchResults>) => {
    mergeResults(accumulated, partial);
    sendEvent(res, 'partial_results', { data: accumulated });
  });

  let lastFinalText = '';

  try {
    const run = query({
      prompt: buildPrompt(messages, newMessage),
      options: {
        model: env.anthropicModel,
        env: subprocessEnv,
        abortController,
        // Our own persona only — don't inherit the Claude Code coding preset or
        // any on-disk project settings.
        systemPrompt: agentSystemPrompt,
        settingSources: [],
        mcpServers: { 'wayfarer-search': mcpServer },
        allowedTools: wayfarerToolNames,
        // Headless server: never block on an interactive permission prompt.
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        maxTurns: 6,
      },
    });

    for await (const message of run) {
      if (message.type === 'stream_event') {
        const ev = (message as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          sendEvent(res, 'token', { content: ev.delta.text });
        }
      } else if (message.type === 'assistant') {
        // Surface tool calls as a `searching` event so the client shows its
        // progress indicator during the (slow) scrape phase.
        const toolUses = extractToolUses(message);
        if (toolUses.length > 0) sendEvent(res, 'searching', { tools: toolUses });
        // With partial messages on, deltas already streamed the text; keep the
        // latest assistant text as the authoritative final for the message.
        const text = extractText(message);
        if (text) lastFinalText = text;
      } else if (message.type === 'result') {
        const r = message as { subtype?: string; result?: string };
        if (r.subtype === 'success' && typeof r.result === 'string' && r.result) {
          lastFinalText = r.result;
        }
      }
    }

    accumulated.durationMs = Date.now() - startTime;
    sendEvent(res, 'results', { data: accumulated });
    sendEvent(res, 'done', { durationMs: accumulated.durationMs, finalText: lastFinalText });
  } catch (err: unknown) {
    // An abort means the client already disconnected — nothing to report to.
    if (!abortController.signal.aborted) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      sendEvent(res, 'error', { message });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
