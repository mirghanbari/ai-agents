import axios from 'axios';
import { env, SourceError } from '../lib/env';
import { asArray, dig, isRecord, pickInt, pickNumber, pickString, pickStringArray } from '../lib/coerce';
import { searchStubHubScrape } from '../scrapers/stubhub';
import type { EventTicket } from '../types/travel';

export interface EventSearchParams {
  query: string; // team / match / artist, e.g. "USA World Cup"
  city?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  quantity?: number; // tickets needed — soft filter on listing availability
  maxPrice?: number; // per ticket
}

// ── SeatGeek (client_id only, free tier) ─────────────────────────────────────

export function mapSeatGeekEvent(raw: unknown): EventTicket | undefined {
  if (!isRecord(raw)) return undefined;
  const id = pickString(raw.id);
  const title = pickString(raw.title) ?? pickString(raw.short_title);
  if (!id || !title) return undefined;

  const performers = asArray(raw.performers)
    .map((p) => pickString(dig(p, 'name')))
    .filter((n): n is string => n !== undefined);

  return {
    id: `sg-${id}`,
    source: 'seatgeek',
    title,
    venue: pickString(dig(raw, 'venue', 'name')) ?? '',
    city: pickString(dig(raw, 'venue', 'city')),
    datetime: pickString(raw.datetime_local) ?? pickString(raw.datetime_utc) ?? '',
    url: pickString(raw.url) ?? '',
    lowestPrice: pickNumber(dig(raw, 'stats', 'lowest_price')),
    highestPrice: pickNumber(dig(raw, 'stats', 'highest_price')),
    averagePrice: pickNumber(dig(raw, 'stats', 'average_price')),
    currency: 'USD',
    listingCount:
      pickInt(dig(raw, 'stats', 'visible_listing_count')) ?? pickInt(dig(raw, 'stats', 'listing_count')),
    performers: performers.length ? performers : undefined,
    category: pickString(raw.type),
    thumbnailUrl:
      pickString(dig(raw, 'performers', 0, 'image')) ??
      pickString(dig(raw, 'performers', 0, 'images', 'huge')) ??
      '',
  };
}

async function searchSeatGeek(params: EventSearchParams): Promise<EventTicket[]> {
  const query: Record<string, string | number> = {
    client_id: env.seatGeekClientId,
    q: params.query,
    per_page: 25,
    sort: 'datetime_local.asc',
  };
  if (env.seatGeekClientSecret) query.client_secret = env.seatGeekClientSecret;
  if (params.city) query['venue.city'] = params.city;
  if (params.dateFrom) query['datetime_local.gte'] = params.dateFrom;
  if (params.dateTo) query['datetime_local.lte'] = params.dateTo;
  if (params.maxPrice !== undefined) query['lowest_price.lte'] = params.maxPrice;

  const { data } = await axios.get('https://api.seatgeek.com/2/events', {
    params: query,
    timeout: 15_000,
  });

  return asArray(dig(data, 'events'))
    .map(mapSeatGeekEvent)
    .filter((e): e is EventTicket => e !== undefined);
}

// ── StubHub (OAuth client-credentials → catalog search) ──────────────────────

let stubHubToken: { value: string; expiresAt: number } | null = null;

async function getStubHubToken(): Promise<string> {
  if (stubHubToken && stubHubToken.expiresAt > Date.now() + 30_000) {
    return stubHubToken.value;
  }
  const basic = Buffer.from(`${env.stubHubClientId}:${env.stubHubClientSecret}`).toString('base64');
  const { data } = await axios.post(
    'https://account.stubhub.com/oauth2/token',
    new URLSearchParams({ grant_type: 'client_credentials', scope: 'read:events' }),
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15_000,
    },
  );
  const token = pickString(dig(data, 'access_token'));
  if (!token) throw new SourceError('events', 'StubHub auth returned no access token.');
  const ttl = pickNumber(dig(data, 'expires_in')) ?? 3600;
  stubHubToken = { value: token, expiresAt: Date.now() + ttl * 1000 };
  return token;
}

export function mapStubHubEvent(raw: unknown): EventTicket | undefined {
  if (!isRecord(raw)) return undefined;
  const id = pickString(raw.id);
  const title = pickString(raw.name) ?? pickString(raw.title);
  if (!id || !title) return undefined;

  return {
    id: `sh-${id}`,
    source: 'stubhub',
    title,
    venue: pickString(dig(raw, 'venue', 'name')) ?? '',
    city: pickString(dig(raw, 'venue', 'city')),
    datetime: pickString(raw.eventDateLocal) ?? pickString(raw.eventDateUTC) ?? '',
    url: pickString(raw.webURI) ?? pickString(raw.url) ?? '',
    lowestPrice: pickNumber(dig(raw, 'ticketInfo', 'minPrice')),
    highestPrice: pickNumber(dig(raw, 'ticketInfo', 'maxPrice')),
    averagePrice: undefined,
    currency: pickString(dig(raw, 'ticketInfo', 'currencyCode')) ?? 'USD',
    listingCount:
      pickInt(dig(raw, 'ticketInfo', 'totalListings')) ?? pickInt(dig(raw, 'ticketInfo', 'totalTickets')),
    performers: pickStringArray(asArray(raw.performers).map((p) => pickString(dig(p, 'name')))),
    category: pickString(dig(raw, 'categories', 0, 'name')) ?? pickString(raw.categoryName),
    thumbnailUrl: pickString(raw.imageUrl) ?? '',
  };
}

async function searchStubHub(params: EventSearchParams): Promise<EventTicket[]> {
  const token = await getStubHubToken();
  const query: Record<string, string | number> = {
    title: params.query,
    rows: 25,
    sort: 'eventDateLocal asc',
  };
  if (params.city) query.city = params.city;
  if (params.dateFrom) query.dateLocal = `${params.dateFrom}TO${params.dateTo ?? params.dateFrom}`;

  const { data } = await axios.get('https://api.stubhub.com/search/catalog/events/v3', {
    params: query,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 20_000,
  });

  return asArray(dig(data, 'events'))
    .map(mapStubHubEvent)
    .filter((e): e is EventTicket => e !== undefined);
}

// ── Fan-out across both providers ────────────────────────────────────────────

/**
 * Search event tickets across SeatGeek and StubHub in parallel. Each provider is
 * independent: a missing key disables only that provider, and one failing
 * provider never blocks the other. Throws SourceError only if no provider is
 * configured at all, or if every configured provider failed.
 */
export async function searchEventTickets(params: EventSearchParams): Promise<EventTicket[]> {
  const providers: { name: string; run: () => Promise<EventTicket[]> }[] = [];
  if (env.seatGeekClientId) providers.push({ name: 'SeatGeek', run: () => searchSeatGeek(params) });
  // StubHub: use the partner API when creds are present, otherwise scrape the
  // site (no key needed, so this source is always available — best-effort).
  if (env.stubHubClientId && env.stubHubClientSecret) {
    providers.push({ name: 'StubHub', run: () => searchStubHub(params) });
  } else {
    providers.push({ name: 'StubHub', run: () => searchStubHubScrape(params) });
  }

  const settled = await Promise.allSettled(providers.map((p) => p.run()));

  const events: EventTicket[] = [];
  const failures: string[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      events.push(...outcome.value);
    } else {
      const err = outcome.reason;
      const detail = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}` : String(err);
      failures.push(`${providers[i].name}: ${detail.trim()}`);
    }
  });

  // Every configured provider failed — surface it as a source error.
  if (events.length === 0 && failures.length === providers.length) {
    throw new SourceError('events', `Ticket search failed — ${failures.join('; ')}`);
  }

  return applyFilters(events, params);
}

/** Soft client-side filters: per-ticket price ceiling and enough listings for the party. */
export function applyFilters(events: EventTicket[], params: EventSearchParams): EventTicket[] {
  let out = events;
  if (params.maxPrice !== undefined) {
    out = out.filter((e) => e.lowestPrice === undefined || e.lowestPrice <= params.maxPrice!);
  }
  if (params.quantity !== undefined && params.quantity > 1) {
    out = out.filter((e) => e.listingCount === undefined || e.listingCount >= params.quantity!);
  }
  // Cheapest get-in price first; events with no price float to the end.
  // Cap at 20 to match every other source and bound the agent's context cost.
  return out.sort((a, b) => (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity)).slice(0, 20);
}
