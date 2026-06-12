import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { env } from '../lib/env';

// Stealth is applied at the browser level, shared by every context.
// `as never` bridges the stealth plugin's loose typing to playwright-extra's `use`.
chromium.use(StealthPlugin() as never);

let browserPromise: Promise<Browser> | null = null;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: env.headless,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
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
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: randInt(1380, 1440), height: randInt(860, 960) },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
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
