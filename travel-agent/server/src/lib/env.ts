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

  // Claude Agent SDK subscription auth. When set, /api/chat/subscription runs
  // the agent against a Claude Pro/Max plan instead of billing API credits.
  // Generate with `claude setup-token` (Claude Code CLI).
  claudeCodeOAuthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',

  // Flights — Duffel (open self-serve signup, free test tokens). Replaced Kiwi
  // Tequila (partner-gated) and Amadeus Self-Service (decommissioned 2026-07-17).
  duffelToken: process.env.DUFFEL_ACCESS_TOKEN ?? '',

  rapidApiKey: process.env.RAPIDAPI_KEY ?? '',
  rapidApiBookingHost: process.env.RAPIDAPI_BOOKING_HOST || 'booking-com.p.rapidapi.com',
  rapidApiActivitiesHost:
    process.env.RAPIDAPI_ACTIVITIES_HOST || 'travel-advisor.p.rapidapi.com',

  viatorApiKey: process.env.VIATOR_API_KEY ?? '',

  // Event tickets — SeatGeek needs only a client id (free); StubHub needs a
  // partner client id + secret (OAuth client-credentials).
  seatGeekClientId: process.env.SEATGEEK_CLIENT_ID ?? '',
  seatGeekClientSecret: process.env.SEATGEEK_CLIENT_SECRET ?? '',
  stubHubClientId: process.env.STUBHUB_CLIENT_ID ?? '',
  stubHubClientSecret: process.env.STUBHUB_CLIENT_SECRET ?? '',

  headless: (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
  scraperIdleTimeoutMs: Number(process.env.SCRAPER_IDLE_TIMEOUT_MS ?? 120_000),
  // Full scrape attempts per source (fresh browser context each time).
  scraperAttempts: Number(process.env.SCRAPER_ATTEMPTS ?? 2),
  // Optional proxy for the scraping browser, e.g. "http://host:port". Scraper
  // blocks are mostly IP-reputation based, so a residential proxy is the
  // biggest reliability upgrade available.
  proxyServer: process.env.PROXY_SERVER ?? '',
  proxyUsername: process.env.PROXY_USERNAME ?? '',
  proxyPassword: process.env.PROXY_PASSWORD ?? '',

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
