import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { jitter, wiggleMouse, withContext } from './browser';
import type { EventTicket } from '../types/travel';

export interface StubHubScrapeParams {
  query: string;
  city?: string;
  dateFrom?: string; // used only by caller-side filters, not sent to the site
  dateTo?: string;
  quantity?: number;
  maxPrice?: number;
}

interface RawCard {
  id: string;
  href: string;
  text: string;
}

// Longer tokens first: alternation is ordered, so `US` would otherwise match
// before `USA` and leak the trailing "A" into the venue.
const HOST_COUNTRY = /USA|US|Mexico|Canada/;

/** "7:00 PM" → "19:00"; "" if unparseable. */
export function to24h(t: string | undefined): string {
  const m = t?.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * Parse a rendered StubHub search-result card into an EventTicket. The search
 * results page carries no prices (those load on the per-event page), so
 * `lowestPrice` is left undefined — the card title, date, city, and venue come
 * from the card text + the URL slug (e.g. `world-cup-houston-tickets-6-23-2026`).
 */
export function parseCard(raw: RawCard): EventTicket | undefined {
  const lines = raw.text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Title: the match/act line (contains " vs " or "World Cup"), else the longest line.
  const title =
    lines.find((l) => / vs | world cup/i.test(l)) ??
    [...lines].sort((a, b) => b.length - a.length)[0] ??
    'StubHub event';

  // Location line carries a time + concatenated "City, ST, Country" + venue.
  const locLine = lines.find((l) => /\d{1,2}:\d{2}\s*[AP]M/i.test(l)) ?? '';
  const timeM = locLine.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  const afterTime = timeM ? locLine.slice((timeM.index ?? 0) + timeM[1].length) : locLine;
  const locM = afterTime.match(new RegExp(`^(.+?),\\s*.+?,\\s*(?:${HOST_COUNTRY.source})(.*)$`));
  const city = locM?.[1]?.trim();
  const venue = locM?.[2]?.trim() || afterTime.trim();

  // Date from the URL slug: ...-M-D-YYYY/event/<id>/
  const dM = raw.href.match(/-(\d{1,2})-(\d{1,2})-(\d{4})\/event\//);
  let datetime = '';
  if (dM) {
    const [, mo, d, y] = dM;
    const hm = to24h(timeM?.[1]);
    datetime = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}${hm ? `T${hm}:00` : ''}`;
  }

  return {
    id: `sh-${raw.id}`,
    source: 'stubhub',
    title,
    venue,
    city,
    datetime,
    url: raw.href,
    currency: 'USD',
    thumbnailUrl: '',
    category: 'tickets',
  };
}

/** Harvest currently-mounted result cards (the search page virtualizes its list). */
async function harvestMounted(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/event/"]')) as HTMLAnchorElement[];
    const out: RawCard[] = [];
    for (const a of anchors) {
      const m = a.href.match(/\/event\/(\d+)/);
      if (!m) continue;
      const card = (a.closest('li, [class*="card" i], [class*="row" i], [role="listitem"]') ??
        a.parentElement ??
        a) as HTMLElement;
      out.push({ id: m[1], href: a.href.split('?')[0], text: card.innerText ?? '' });
    }
    return out;
  });
}

/**
 * Scrape StubHub event search. No API key required. Best-effort: StubHub (viagogo)
 * uses a virtualized results list behind bot defense, so we confirm the results
 * header loaded, then step-scroll harvesting mounted cards before they unmount.
 * Most reliable on a residential IP with HEADLESS=false. Runs in an isolated stealth
 * context so a block here never affects the other ticket sources.
 */
export async function searchStubHubScrape(params: StubHubScrapeParams): Promise<EventTicket[]> {
  return withContext(async (page) => {
    const term = params.city ? `${params.query} ${params.city}` : params.query;
    const url = `https://www.stubhub.com/secure/Search?q=${encodeURIComponent(term).replace(/%20/g, '+')}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (err: unknown) {
      throw new SourceError('events', `StubHub navigation failed: ${String(err)}`);
    }

    // Confirm we landed on a real results page (the "N events" header) rather than
    // a fallback/trending view — guards against harvesting the "popular near you" rail.
    let landed = false;
    for (let i = 0; i < 8; i++) {
      await jitter(800, 1400);
      const hasResults = await page
        .evaluate(() => /\b\d+\s+events?\b/i.test(document.body?.innerText ?? ''))
        .catch(() => false);
      if (hasResults) {
        landed = true;
        break;
      }
    }
    if (!landed) {
      throw new SourceError('events', 'StubHub did not return a results page (possible bot block — try HEADLESS=false).');
    }
    await wiggleMouse(page);

    // Step-scroll, accumulating cards across the virtualized list before they unmount.
    const collected = new Map<string, RawCard>();
    for (let step = 0; step < 16; step++) {
      for (const card of await harvestMounted(page).catch(() => [])) {
        if (!collected.has(card.id)) collected.set(card.id, card);
      }
      if (collected.size >= 30) break;
      await page.mouse.wheel(0, 800);
      await jitter(600, 1100);
    }

    const events = [...collected.values()]
      .map(parseCard)
      .filter((e): e is EventTicket => e !== undefined);

    if (events.length === 0) {
      throw new SourceError('events', 'StubHub returned 0 events (render miss or bot block — try HEADLESS=false).');
    }
    return events;
  });
}
