import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../lib/env';
import { agentSystemPrompt, executeToolCall, toolDefinitions } from '../agent';
import { emptyResults, mergeResults } from '../lib/results';
import type { SearchResults } from '../types/travel';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const MAX_TOOL_ITERATIONS = 3;

// ── Request validation ──────────────────────────────────────────────────────

const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ),
  newMessage: z.string().min(1).max(2000),
});

// ── SSE helpers ─────────────────────────────────────────────────────────────

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering if proxied
  res.flushHeaders();
}

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Tool execution loop ──────────────────────────────────────────────────────

async function runAgentLoop(
  res: Response,
  conversationHistory: Anthropic.MessageParam[],
  accumulatedResults: SearchResults,
): Promise<void> {
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = anthropic.messages.stream({
      model: env.anthropicModel,
      max_tokens: 4096,
      system: agentSystemPrompt,
      messages: conversationHistory,
      tools: toolDefinitions,
    });

    stream.on('text', (text) => sendEvent(res, 'token', { content: text }));

    const message = await stream.finalMessage();
    conversationHistory.push({ role: 'assistant', content: message.content });

    if (message.stop_reason !== 'tool_use') break; // end_turn / max_tokens / refusal — done

    const toolUseBlocks = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    sendEvent(res, 'searching', {
      tools: toolUseBlocks.map((t) => ({ name: t.name, input: t.input })),
    });

    // Execute every tool call in parallel — one failure never blocks the rest.
    const settled = await Promise.allSettled(
      toolUseBlocks.map(async (toolUse) => ({
        toolUseId: toolUse.id,
        result: await executeToolCall(toolUse.name, toolUse.input),
      })),
    );

    const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

    settled.forEach((outcome, i) => {
      const toolUse = toolUseBlocks[i];
      if (outcome.status === 'fulfilled') {
        mergeResults(accumulatedResults, outcome.value.result);
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: outcome.value.toolUseId,
          content: JSON.stringify(outcome.value.result),
        });
        sendEvent(res, 'partial_results', { data: accumulatedResults });
      } else {
        const reason = outcome.reason instanceof Error ? outcome.reason.message : 'Tool execution failed';
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: reason }),
          is_error: true,
        });
      }
    });

    conversationHistory.push({ role: 'user', content: toolResultContent });
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const { messages, newMessage } = parsed.data;
  sseHeaders(res);

  const conversationHistory: Anthropic.MessageParam[] = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: newMessage },
  ];

  const accumulatedResults = emptyResults();
  const startTime = Date.now();

  try {
    await runAgentLoop(res, conversationHistory, accumulatedResults);
    accumulatedResults.durationMs = Date.now() - startTime;
    sendEvent(res, 'results', { data: accumulatedResults });
    sendEvent(res, 'done', { durationMs: accumulatedResults.durationMs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendEvent(res, 'error', { message });
  } finally {
    res.end();
  }
});

export default router;
