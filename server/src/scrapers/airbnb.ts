import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import { jitter, withContext } from './browser';
import type { Listing } from '../types/travel';

export interface AirbnbSearchParams {
  location: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  minBedrooms?: number;
  maxPricePerNight?: number;
}

/**
 * Walk an arbitrary intercepted JSON tree collecting anything that looks like a
 * stay listing. Airbnb's GraphQL shape shifts often, so we match structurally
 * (an object carrying a stable `id`, a name/title, and a numeric price) rather
 * than hard-coding the response path.
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
    pickNumber((node.structuredDisplayPrice as Record<string, unknown> | undefined)?.primaryLine) ??
    pickNumber((node.pricingQuote as Record<string, unknown> | undefined)?.rate);

  if (id && title && price !== undefined && !out.has(id)) {
    out.set(id, {
      id,
      source: 'airbnb',
      title,
      url: `https://www.airbnb.com/rooms/${id}`,
      thumbnailUrl:
        pickString((node.contextualPictures as Record<string, unknown> | undefined)?.[0]) ??
        pickString(node.pictureUrl) ??
        '',
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

export async function searchAirbnb(params: AirbnbSearchParams): Promise<Listing[]> {
  return withContext(async (page) => {
    const intercepted = new Map<string, Listing>();

    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('StaysSearch') && !url.includes('ExploreSections')) return;
      void response
        .json()
        .then((body) => harvestListings(body, intercepted))
        .catch(() => undefined);
    });

    const search = encodeURIComponent(params.location);
    const url =
      `https://www.airbnb.com/s/${search}/homes` +
      `?checkin=${params.checkIn}&checkout=${params.checkOut}&adults=${params.guests}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await jitter(2000, 4000);
      await page.mouse.wheel(0, 2400);
      await jitter(2000, 4000);
    } catch (err: unknown) {
      throw new SourceError('airbnb', `Navigation failed: ${String(err)}`);
    }

    let listings = [...intercepted.values()];
    if (listings.length === 0) {
      listings = await scrapeDom(page).catch(() => []);
    }
    if (listings.length === 0) {
      throw new SourceError('airbnb', 'Returned 0 listings (possible bot block — try HEADLESS=false).');
    }

    if (params.minBedrooms !== undefined) {
      listings = listings.filter((l) => (l.bedrooms ?? 0) >= params.minBedrooms!);
    }
    if (params.maxPricePerNight !== undefined) {
      listings = listings.filter((l) => l.pricePerNight <= params.maxPricePerNight!);
    }
    return listings.slice(0, 20);
  });
}
