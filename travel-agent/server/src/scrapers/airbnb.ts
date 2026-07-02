import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { asArray, dig, isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import { geocode, haversineKm, withinRegion, type GeoRegion } from '../lib/geocode';
import { jitter, looksBlocked, withContext, withRetry } from './browser';
import type { Listing } from '../types/travel';

export interface AirbnbSearchParams {
  location: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  minBedrooms?: number;
  maxPricePerNight?: number;
  pets?: number; // number of pets — triggers Airbnb's "allows pets" availability filter
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

// ── Parsing the current StaysSearch GraphQL shape ────────────────────────────
// Listing ids arrive base64-encoded as "StayListing:12345" / "DemandStayListing:12345".

export function decodeRoomId(b64Id: string): string {
  try {
    const decoded = Buffer.from(b64Id, 'base64').toString('utf8');
    return decoded.includes(':') ? decoded.split(':')[1] || b64Id : b64Id;
  } catch {
    return b64Id;
  }
}

/** Pull the results array out of an intercepted StaysSearch response body. */
export function extractSearchResults(blob: unknown): unknown[] {
  return asArray(dig(blob, 'data', 'presentation', 'staysSearch', 'results', 'searchResults'));
}

/** "$1,234 for 8 nights" price line → { total, nights }. */
function parsePriceLine(line: unknown): { total?: number; nights?: number } {
  if (!isRecord(line)) return {};
  const priceStr = pickString(line.discountedPrice) ?? pickString(line.price);
  const digits = priceStr?.match(/([\d,]+)/)?.[1];
  const total = digits ? Number(digits.replace(/,/g, '')) : undefined;
  const label = pickString(line.accessibilityLabel) ?? '';
  const nights = Number(label.match(/for (\d+)\s*night/)?.[1]);
  return { total, nights: Number.isFinite(nights) ? nights : undefined };
}

/**
 * Map one entry of `staysSearch.results.searchResults` to a Listing.
 * `fallbackNights` (from the requested dates) converts the stay-total price to
 * per-night when the response doesn't state its own night count.
 */
export function parseStaySearchResult(result: unknown, fallbackNights: number): Listing | undefined {
  if (!isRecord(result)) return undefined;
  const stay = result.demandStayListing;
  if (!isRecord(stay)) return undefined;

  const id = decodeRoomId(pickString(stay.id) ?? '');
  const title =
    pickString(result.title) ??
    pickString(dig(stay, 'description', 'name', 'localizedStringWithTranslationPreference'));
  const { total, nights } = parsePriceLine(dig(result, 'structuredDisplayPrice', 'primaryLine'));
  if (!id || !title || total === undefined) return undefined;

  const perNight = Math.round(total / (nights ?? fallbackNights));
  const lat = pickNumber(dig(stay, 'location', 'coordinate', 'latitude'));
  const lng = pickNumber(dig(stay, 'location', 'coordinate', 'longitude'));
  const ratingLabel = pickString(result.avgRatingLocalized) ?? pickString(result.avgRatingA11yLabel) ?? '';
  const ratingMatch = ratingLabel.match(/([\d.]+)(?:\s*\((\d+)\))?/);

  return {
    id,
    source: 'airbnb',
    title,
    url: `https://www.airbnb.com/rooms/${id}`,
    thumbnailUrl: pickString(dig(result, 'contextualPictures', 0, 'picture')) ?? '',
    pricePerNight: perNight,
    totalPrice: total,
    currency: 'USD',
    rating: ratingMatch ? Number(ratingMatch[1]) || undefined : undefined,
    reviewCount: ratingMatch?.[2] ? Number(ratingMatch[2]) : undefined,
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
  };
}

// ── Generic structural harvest (fallback for shape drift) ────────────────────

/**
 * Walk an arbitrary intercepted JSON tree collecting anything that looks like a
 * stay listing. Kept as a fallback for when Airbnb's GraphQL shape shifts away
 * from what `parseStaySearchResult` expects.
 */
function harvestListings(node: unknown, out: Map<string, Listing>): void {
  if (Array.isArray(node)) {
    for (const child of node) harvestListings(child, out);
    return;
  }
  if (!isRecord(node)) return;

  const id = pickString(node.id) ?? pickString(node.listingId);
  const title = pickString(node.name) ?? pickString(node.title);
  const price =
    pickNumber(node.price) ??
    pickNumber(node.rate) ??
    pickNumber((node.pricingQuote as Record<string, unknown> | undefined)?.rate);

  if (id && title && price !== undefined && !out.has(id)) {
    out.set(id, {
      id,
      source: 'airbnb',
      title,
      url: `https://www.airbnb.com/rooms/${id}`,
      thumbnailUrl: pickString(node.pictureUrl) ?? '',
      pricePerNight: price,
      currency: pickString(node.currency) ?? 'USD',
      rating: pickNumber(node.avgRating) ?? pickNumber(node.starRating),
      reviewCount: pickInt(node.reviewsCount) ?? pickInt(node.reviewCount),
      bedrooms: pickInt(node.bedrooms),
      beds: pickInt(node.beds),
      bathrooms: pickNumber(node.bathrooms),
      maxGuests: pickInt(node.personCapacity),
    });
  }

  for (const value of Object.values(node)) harvestListings(value, out);
}

// ── DOM fallback ─────────────────────────────────────────────────────────────

async function scrapeDom(page: Page): Promise<Listing[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="card-container"]'));
    return cards.slice(0, 20).map((card, i): Listing => {
      const link = card.querySelector('a[href*="/rooms/"]') as HTMLAnchorElement | null;
      const href = link?.href ?? '';
      const idMatch = href.match(/\/rooms\/(\d+)/);
      const priceText =
        card.querySelector('[data-testid="price-availability-row"]')?.textContent ??
        card.textContent ??
        '';
      const priceMatch = priceText.replace(/,/g, '').match(/\$\s?(\d+)/);
      const img = card.querySelector('img') as HTMLImageElement | null;
      const title = card.querySelector('[data-testid="listing-card-title"]')?.textContent ?? `Airbnb stay ${i + 1}`;
      return {
        id: idMatch ? idMatch[1] : href || `airbnb-${i}`,
        source: 'airbnb' as const,
        title: title.trim(),
        url: href,
        thumbnailUrl: img?.src ?? '',
        pricePerNight: priceMatch ? Number(priceMatch[1]) : 0,
        currency: 'USD',
      };
    });
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

/** One full page-load + harvest for a given location string. */
async function scrapeOnce(
  location: string,
  params: AirbnbSearchParams,
  nights: number,
  attempt: number,
): Promise<Listing[]> {
  return withContext(async (page) => {
    const bodies: Promise<unknown>[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('StaysSearch') && !url.includes('ExploreSections')) return;
      bodies.push(response.json().catch(() => undefined));
    });

    const search = encodeURIComponent(location);
    const petsParam = params.pets ? `&pets=${params.pets}` : '';
    const url =
      `https://www.airbnb.com/s/${search}/homes` +
      `?checkin=${params.checkIn}&checkout=${params.checkOut}&adults=${params.guests}${petsParam}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await jitter(2000, 4000);
      await page.mouse.wheel(0, 2400);
      await jitter(2000, 4000);
    } catch (err: unknown) {
      throw new SourceError('airbnb', `Navigation failed: ${String(err)}`);
    }

    const blobs = (await Promise.all(bodies)).filter((b) => b !== undefined);

    // Primary: the known StaysSearch shape (carries coordinates + real totals).
    let listings = blobs
      .flatMap(extractSearchResults)
      .map((r) => parseStaySearchResult(r, nights))
      .filter((l): l is Listing => l !== undefined);

    // Secondary: structural harvest of whatever JSON we did intercept.
    if (listings.length === 0) {
      const harvested = new Map<string, Listing>();
      for (const blob of blobs) harvestListings(blob, harvested);
      listings = [...harvested.values()];
    }

    // Tertiary: scrape the rendered DOM.
    if (listings.length === 0) {
      listings = await scrapeDom(page).catch(() => []);
    }

    if (listings.length === 0) {
      const block = await looksBlocked(page);
      throw new SourceError(
        'airbnb',
        block
          ? `Blocked by a ${block} (attempt ${attempt}). A residential IP (PROXY_SERVER) or HEADLESS=false is most reliable.`
          : 'Returned 0 listings (possible bot block or layout change — try HEADLESS=false).',
      );
    }

    const seen = new Set<string>();
    return listings.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  });
}

/** Split listings into in-region and wrong-region (coordinate-verified). */
function splitByRegion(listings: Listing[], region: GeoRegion | null): { kept: Listing[]; wrong: Listing[] } {
  if (!region) return { kept: listings, wrong: [] };
  const wrong = listings.filter(
    (l) => l.coordinates && !withinRegion({ lat: l.coordinates.lat, lng: l.coordinates.lng }, region),
  );
  return { kept: listings.filter((l) => !wrong.includes(l)), wrong };
}

export async function searchAirbnb(params: AirbnbSearchParams): Promise<Listing[]> {
  const nights = nightsBetween(params.checkIn, params.checkOut);
  // Geocode the query ourselves, in parallel with the scrape. Airbnb's own
  // geocoder silently resolves ambiguous names to bigger namesakes ("Long
  // Beach, WA" -> Long Beach, CA), so listing coordinates are checked against
  // where the user actually asked for. Null (lookup failed) skips the check.
  const regionPromise = geocode(params.location);

  return withRetry('airbnb', async (attempt) => {
    const region = await regionPromise;
    let { kept, wrong } = splitByRegion(await scrapeOnce(params.location, params, nights, attempt), region);

    // Everything landed in the wrong region: Airbnb picked the wrong namesake.
    // Re-search with the geocoder's fully qualified name ("Long Beach, Pacific
    // County, Washington, United States"), which disambiguates reliably.
    if (kept.length === 0 && wrong.length > 0 && region?.displayName) {
      ({ kept, wrong } = splitByRegion(await scrapeOnce(region.displayName, params, nights, attempt), region));
    }

    if (kept.length === 0 && wrong.length > 0) {
      const sample = wrong[0].coordinates!;
      const km = Math.round(haversineKm({ lat: sample.lat, lng: sample.lng }, region!.center));
      throw new SourceError(
        'airbnb',
        `Airbnb resolved "${params.location}" to a different region (listings landed ~${km} km away). ` +
          'Retry with a disambiguated location such as "Town, State" or "Town, Country".',
      );
    }

    let listings = kept;
    if (params.minBedrooms !== undefined) {
      listings = listings.filter((l) => (l.bedrooms ?? 0) >= params.minBedrooms!);
    }
    if (params.maxPricePerNight !== undefined) {
      listings = listings.filter((l) => l.pricePerNight > 0 && l.pricePerNight <= params.maxPricePerNight!);
    }
    return listings.slice(0, 20);
  });
}
