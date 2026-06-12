import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import { jitter, withContext } from './browser';
import type { Listing } from '../types/travel';

export interface VrboSearchParams {
  location: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  maxPricePerNight?: number;
}

function harvestListings(node: unknown, out: Map<string, Listing>): void {
  if (Array.isArray(node)) {
    for (const child of node) harvestListings(child, out);
    return;
  }
  if (!isRecord(node)) return;

  const id = pickString(node.id) ?? pickString(node.propertyId) ?? pickString(node.listingId);
  const title = pickString(node.headline) ?? pickString(node.name) ?? pickString(node.title);
  const price =
    pickNumber((node.price as Record<string, unknown> | undefined)?.lead) ??
    pickNumber((node.priceSummary as Record<string, unknown> | undefined)?.amount) ??
    pickNumber(node.averageNightlyPrice) ??
    pickNumber(node.price);

  if (id && title && price !== undefined && !out.has(id)) {
    out.set(id, {
      id,
      source: 'vrbo',
      title,
      url: pickString(node.detailPageUrl) ?? `https://www.vrbo.com/${id}`,
      thumbnailUrl:
        pickString((node.images as Record<string, unknown>[] | undefined)?.[0]?.uri) ??
        pickString(node.thumbnailUrl) ??
        '',
      pricePerNight: price,
      currency: pickString(node.currency) ?? 'USD',
      rating: pickNumber((node.reviews as Record<string, unknown> | undefined)?.score) ?? pickNumber(node.rating),
      reviewCount: pickInt((node.reviews as Record<string, unknown> | undefined)?.total),
      bedrooms: pickInt(node.bedrooms),
      bathrooms: pickNumber(node.bathrooms),
      maxGuests: pickInt(node.sleeps) ?? pickInt(node.maxOccupancy),
    });
  }

  for (const value of Object.values(node)) harvestListings(value, out);
}

async function scrapeDom(page: Page): Promise<Listing[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-stid="property-listing"]'));
    return cards.slice(0, 20).map((card, i): Listing => {
      const link = card.querySelector('a[href]') as HTMLAnchorElement | null;
      const href = link?.href ?? '';
      const priceText = card.textContent ?? '';
      const priceMatch = priceText.replace(/,/g, '').match(/\$\s?(\d+)/);
      const img = card.querySelector('img') as HTMLImageElement | null;
      const title = card.querySelector('h3, [data-stid="content-hotel-title"]')?.textContent ?? `VRBO stay ${i + 1}`;
      return {
        id: href || `vrbo-${i}`,
        source: 'vrbo' as const,
        title: title.trim(),
        url: href,
        thumbnailUrl: img?.src ?? '',
        pricePerNight: priceMatch ? Number(priceMatch[1]) : 0,
        currency: 'USD',
      };
    });
  });
}

export async function searchVrbo(params: VrboSearchParams): Promise<Listing[]> {
  return withContext(async (page) => {
    const intercepted = new Map<string, Listing>();

    page.on('response', (response) => {
      if (!response.url().includes('propertyAvailabilitySearchResults') && !response.url().includes('/graphql')) {
        return;
      }
      void response
        .json()
        .then((body) => {
          const text = JSON.stringify(body);
          if (text.includes('propertyAvailabilitySearchResults') || text.includes('detailPageUrl')) {
            harvestListings(body, intercepted);
          }
        })
        .catch(() => undefined);
    });

    const q = encodeURIComponent(params.location);
    const url =
      `https://www.vrbo.com/search?destination=${q}` +
      `&startDate=${params.checkIn}&endDate=${params.checkOut}&adults=${params.guests}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await jitter(2000, 5000);
      await page.mouse.wheel(0, 2600);
      await jitter(2000, 5000);
    } catch (err: unknown) {
      throw new SourceError('vrbo', `Navigation failed: ${String(err)}`);
    }

    let listings = [...intercepted.values()];
    if (listings.length === 0) {
      listings = await scrapeDom(page).catch(() => []);
    }
    if (listings.length === 0) {
      throw new SourceError('vrbo', 'Returned 0 listings (possible bot block — try HEADLESS=false).');
    }

    if (params.maxPricePerNight !== undefined) {
      listings = listings.filter((l) => l.pricePerNight <= params.maxPricePerNight!);
    }
    return listings.slice(0, 20);
  });
}
