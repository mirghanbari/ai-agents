import express from 'express';
import cors from 'cors';
import { env } from './lib/env';
import chatRouter from './routes/chat';
import searchRouter from './routes/search';
import { closeBrowser } from './scrapers/browser';

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: env.anthropicModel,
    sources: {
      anthropic: Boolean(env.anthropicApiKey),
      flights: Boolean(env.kiwiTequilaApiKey),
      hotels: Boolean(env.rapidApiKey),
      activities: Boolean(env.rapidApiKey || env.viatorApiKey),
      // Always available: falls back to the keyless StubHub scraper when no
      // ticket API keys are set. SeatGeek/StubHub keys only add API-backed results.
      events: true,
      scrapers: true,
    },
  });
});

app.use('/api/chat', chatRouter);
app.use('/api/search', searchRouter);

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🧭 Wayfarer server listening on http://localhost:${env.port}`);
  if (!env.anthropicApiKey) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  ANTHROPIC_API_KEY is not set — /api/chat will fail until you add it to .env');
  }
});

async function shutdown(): Promise<void> {
  await closeBrowser();
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
