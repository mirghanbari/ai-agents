import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { env, SourceError } from '../lib/env';

// Stealth is applied at the browser level, shared by every context.
// `as never` bridges the stealth plugin's loose typing to playwright-extra's `use`.
chromium.use(StealthPlugin() as never);

let browserPromise: Promise<Browser> | null = null;

// A small pool of current, real-world fingerprints. Each context picks one at
// random, so a retry after a block presents as a different visitor. Versions
// need occasional bumping — an outdated Chrome UA is itself a bot signal.
const FINGERPRINTS = [
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    timezoneId: 'America/Los_Angeles',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    timezoneId: 'America/New_York',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    timezoneId: 'America/Denver',
  },
] as const;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: env.headless,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      // Route through a proxy when configured. Scraper blocks are mostly
      // IP-reputation based (datacenter ranges), so a residential/mobile proxy
      // is the single highest-impact reliability lever.
      proxy: env.proxyServer
        ? {
            server: env.proxyServer,
            username: env.proxyUsername || undefined,
            password: env.proxyPassword || undefined,
          }
        : undefined,
    });
  }
  return browserPromise;
}

/**
 * Run `fn` inside an isolated browser context (separate cookies/session per
 * scraper). The context is force-closed when `fn` resolves, and again by an
 * idle watchdog so a hung scraper can't leak a context indefinitely.
 */
export async function withContext<T>(fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const fingerprint = pick(FINGERPRINTS);
  const context = await browser.newContext({
    userAgent: fingerprint.userAgent,
    viewport: { width: randInt(1360, 1512), height: randInt(820, 982) },
    locale: 'en-US',
    timezoneId: fingerprint.timezoneId,
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await context.close().catch(() => undefined);
  };
  const watchdog = setTimeout(() => void close(), env.scraperIdleTimeoutMs);

  try {
    const page = await context.newPage();
    return await fn(page, context);
  } finally {
    clearTimeout(watchdog);
    await close();
  }
}

/**
 * Run a whole scrape attempt up to `env.scraperAttempts` times. Blocks and
 * layout hiccups are usually per-session, so each retry should build a *fresh*
 * context (call `withContext` inside `fn`) — a new fingerprint and cookie jar
 * often succeeds where the first attempt was challenged.
 */
export async function withRetry<T>(source: string, fn: (attempt: number) => Promise<T>): Promise<T> {
  const attempts = Math.max(1, env.scraperAttempts);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < attempts) await jitter(2500 * attempt, 5000 * attempt);
    }
  }
  if (lastErr instanceof SourceError) throw lastErr;
  throw new SourceError(source, `Failed after ${attempts} attempts: ${String(lastErr)}`);
}

const BLOCK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /captcha|hcaptcha|recaptcha/i, label: 'CAPTCHA challenge' },
  { re: /are you a (human|robot)|verify (you('| a)re|that you)|prove you/i, label: 'human-verification interstitial' },
  { re: /press\s*&\s*hold|press and hold/i, label: 'press-and-hold challenge (PerimeterX)' },
  { re: /access denied|request blocked|has been blocked/i, label: 'access denied page' },
  { re: /unusual (traffic|activity)|automated (queries|requests)/i, label: 'rate-limit / unusual-traffic page' },
  { re: /datadome|perimeterx|px-captcha|cf-challenge|checking your browser/i, label: 'bot-defense vendor challenge' },
];

/**
 * Inspect the rendered page for a bot-defense challenge. Returns a description
 * of the block, or null if the page looks like real content. Lets scrapers
 * report "blocked by a CAPTCHA" instead of a misleading "0 results", and lets
 * retries know a fresh session is worth trying.
 */
export async function looksBlocked(page: Page): Promise<string | null> {
  const title = await page.title().catch(() => '');
  const body = await page
    .evaluate(() => document.body?.innerText.slice(0, 3000) ?? '')
    .catch(() => '');
  const haystack = `${title}\n${body}`;
  for (const { re, label } of BLOCK_PATTERNS) {
    if (re.test(haystack)) return label;
  }
  return null;
}

/** Human-ish random delay to reduce bot-detection signal. */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randInt(minMs, maxMs)));
}

/** Light mouse movement to look less robotic on aggressive sites (e.g. Kayak). */
export async function wiggleMouse(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(randInt(100, 1200), randInt(100, 800), { steps: randInt(5, 15) });
    await jitter(150, 450);
  }
}

/** Called on server shutdown. */
export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close().catch(() => undefined);
    browserPromise = null;
  }
}
