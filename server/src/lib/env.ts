import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The server runs from `server/`, but `.env` lives at the repo root. Load it explicitly.
const here = dirname(fileURLToPath(import.meta.url)); // server/src/lib
config({ path: resolve(here, '../../../.env') });

/** Typed access to environment configuration. Loaded once from the repo-root .env. */
export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  kiwiTequilaApiKey: process.env.KIWI_TEQUILA_API_KEY ?? '',

  rapidApiKey: process.env.RAPIDAPI_KEY ?? '',
  rapidApiBookingHost: process.env.RAPIDAPI_BOOKING_HOST || 'booking-com.p.rapidapi.com',
  rapidApiActivitiesHost:
    process.env.RAPIDAPI_ACTIVITIES_HOST || 'travel-advisor.p.rapidapi.com',

  viatorApiKey: process.env.VIATOR_API_KEY ?? '',

  headless: (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
  scraperIdleTimeoutMs: Number(process.env.SCRAPER_IDLE_TIMEOUT_MS ?? 120_000),

  port: Number(process.env.PORT ?? 3001),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

/** Thrown by a source when it can't run (missing key, etc). Carried into SearchResults.errors. */
export class SourceError extends Error {
  constructor(
    public readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
