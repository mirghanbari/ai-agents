import express, { type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bumpEffort, env, type Effort } from './lib/env';
import { resolveBudget } from './lib/budget';
import { research } from './agent/research';

const here = dirname(fileURLToPath(import.meta.url)); // src
const PORT = Number(process.env.PORT ?? 3002);
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const app = express();
app.use(express.static(join(here, '..', 'public')));

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// SSE: stream a research run. GET so the browser can use EventSource.
app.get('/api/research', async (req, res) => {
  const question = String(req.query.q ?? '').trim();
  if (!question) {
    res.status(400).json({ error: 'missing q' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!env.anthropicApiKey) {
    send(res, 'error', { message: 'ANTHROPIC_API_KEY is not set on the server.' });
    res.end();
    return;
  }

  const mode = req.query.mode === 'deep' ? 'deep' : 'quick';
  const effortQ = String(req.query.effort ?? '');
  const effort: Effort = (EFFORTS as string[]).includes(effortQ)
    ? (effortQ as Effort)
    : mode === 'deep'
      ? bumpEffort(env.effort)
      : env.effort;
  const budget = resolveBudget(String(req.query.budget ?? ''));
  const allow = String(req.query.domains ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);

  const started = Date.now();
  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  try {
    const result = await research(question, {
      mode,
      effort,
      budget,
      domains: allow.length ? { allow } : undefined,
      onText: (delta) => !cancelled && send(res, 'token', { t: delta }),
      onProgress: (line) => !cancelled && send(res, 'progress', { line }),
    });
    if (!cancelled) {
      send(res, 'done', {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        truncated: result.truncated,
        subtopics: result.subtopics ?? [],
        seconds: (Date.now() - started) / 1000,
        model: env.anthropicModel,
        mode,
        budget: String(req.query.budget ?? 'standard'),
        effort,
      });
    }
  } catch (e: unknown) {
    if (!cancelled) send(res, 'error', { message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🔬 Research agent UI → http://localhost:${PORT}`);
  if (!env.anthropicApiKey) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  ANTHROPIC_API_KEY not set — add it to research-agent/.env');
  }
});
