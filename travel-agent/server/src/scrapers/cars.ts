import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import { jitter, looksBlocked, wiggleMouse, withContext, withRetry } from './browser';
import type { RentalCar } from '../types/travel';

export interface CarSearchParams {
  pickupLocation: string;
  pickupDate: string; // YYYY-MM-DD
  dropoffDate: string; // YYYY-MM-DD
  carCategory?: 'economy' | 'compact' | 'midsize' | 'suv' | 'luxury' | 'any';
}

function daysBetween(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
}

function harvestCars(node: unknown, out: Map<string, RentalCar>, days: number): void {
  if (Array.isArray(node)) {
    for (const child of node) harvestCars(child, out, days);
    return;
  }
  if (!isRecord(node)) return;

  const carName = pickString(node.carName) ?? pickString(node.vehicleName) ?? pickString(node.name);
  const total =
    pickNumber(node.totalPrice) ??
    pickNumber((node.price as Record<string, unknown> | undefined)?.total) ??
    pickNumber(node.price);
  const id = pickString(node.id) ?? pickString(node.resultId) ?? carName;

  if (id && carName && total !== undefined && !out.has(id)) {
    out.set(id, {
      id,
      supplier: pickString(node.supplier) ?? pickString(node.agency) ?? pickString(node.provider) ?? 'Unknown',
      carName,
      carCategory: pickString(node.carClass) ?? pickString(node.category) ?? 'any',
      thumbnailUrl: pickString(node.imageUrl) ?? pickString(node.image) ?? '',
      pricePerDay: Math.round(total / days),
      totalPrice: total,
      currency: pickString(node.currency) ?? 'USD',
      seats: pickInt(node.seats) ?? pickInt(node.passengers),
      transmission: pickString(node.transmission)?.toLowerCase().includes('manual') ? 'manual' : 'automatic',
      bookingUrl: pickString(node.bookingUrl) ?? pickString(node.deepLink) ?? '',
    });
  }

  for (const value of Object.values(node)) harvestCars(value, out, days);
}

// `.js-result` is Kayak's current stable hook (the styled classes like
// "jo6g-car-result-item" are build-hashed and rotate); the rest are older
// layouts kept as fallbacks.
const RESULT_SELECTOR =
  '.js-result, [class*="car-result-item"], [class*="resultWrapper"], [data-resultid]';

async function scrapeDom(page: Page, days: number): Promise<RentalCar[]> {
  const raw = await page.evaluate((selector) => {
    const cards = Array.from(document.querySelectorAll(selector));
    return cards.slice(0, 20).map((card, i) => {
      const img = card.querySelector('img') as HTMLImageElement | null;
      // The vehicle image alt is structured: "Vehicle type: Minivan - Chrysler
      // Pacifica or similar" — the most reliable name/category source.
      const altMatch = (img?.alt ?? '').match(/Vehicle type:\s*(.+?)\s*-\s*(.+?)(?:\s+or similar.*)?$/);
      // Offers render as "...\n{supplier}\n${price}\nTotal\n..." — the first
      // such triple is the headline (best) offer.
      const lines = ((card as HTMLElement).innerText ?? '').split('\n').map((l) => l.trim());
      let price = 0;
      let supplier = 'Unknown';
      for (let j = 1; j < lines.length - 1; j++) {
        const m = lines[j].match(/^\$\s?([\d,]+)$/);
        if (m && /^total/i.test(lines[j + 1] ?? '')) {
          price = Number(m[1].replace(/,/g, ''));
          supplier = lines[j - 1] || 'Unknown';
          break;
        }
      }
      if (price === 0) {
        const m = (card.textContent ?? '').replace(/,/g, '').match(/\$\s?(\d+)/);
        price = m ? Number(m[1]) : 0;
      }
      return {
        id: `kayak-car-${i}`,
        name: altMatch?.[2]?.trim() ?? lines.find((l) => l.length > 3) ?? `Car ${i + 1}`,
        category: altMatch?.[1]?.trim() ?? 'any',
        supplier,
        price,
        image: img?.src ?? '',
      };
    });
  }, RESULT_SELECTOR);

  return raw
    .filter((r) => r.price > 0)
    .map((r): RentalCar => ({
      id: r.id,
      supplier: r.supplier,
      carName: r.name,
      carCategory: r.category,
      thumbnailUrl: r.image,
      pricePerDay: Math.round(r.price / days),
      totalPrice: r.price,
      currency: 'USD',
      bookingUrl: '',
    }));
}

export async function searchRentalCars(params: CarSearchParams): Promise<RentalCar[]> {
  const days = daysBetween(params.pickupDate, params.dropoffDate);

  return withRetry('cars', (attempt) =>
    withContext(async (page) => {
    const intercepted = new Map<string, RentalCar>();

    page.on('response', (response) => {
      if (!/cars|car\/.*results|FlightSearch|carsearch/i.test(response.url())) return;
      void response
        .json()
        .then((body) => harvestCars(body, intercepted, days))
        .catch(() => undefined);
    });

    const loc = encodeURIComponent(params.pickupLocation);
    const url = `https://www.kayak.com/cars/${loc}/${params.pickupDate}/${params.dropoffDate}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // Kayak is aggressive about bot detection — go slow and look human.
      await jitter(3000, 5000);
      await wiggleMouse(page);
      // Results stream in over ~10-25s; poll instead of hoping a fixed sleep
      // is long enough.
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 700);
        await jitter(2000, 3500);
        if (intercepted.size > 0) break;
        const rendered = await page.locator(RESULT_SELECTOR).count().catch(() => 0);
        if (rendered >= 5) break;
      }
    } catch (err: unknown) {
      throw new SourceError('cars', `Navigation failed: ${String(err)}`);
    }

    let cars = [...intercepted.values()];
    let domError = '';
    if (cars.length === 0) {
      cars = await scrapeDom(page, days).catch((e: unknown) => {
        domError = ` DOM scrape failed: ${String(e).slice(0, 150)}.`;
        return [];
      });
    }
    if (cars.length === 0) {
      const block = await looksBlocked(page);
      const rendered = await page.locator(RESULT_SELECTOR).count().catch(() => -1);
      throw new SourceError(
        'cars',
        block
          ? `Blocked by a ${block} (attempt ${attempt}). Kayak is aggressive — a residential IP (PROXY_SERVER) helps most.`
          : `Returned 0 cars (${rendered} result cards rendered).${domError} Kayak bot block or layout change — try HEADLESS=false.`,
      );
    }

    if (params.carCategory && params.carCategory !== 'any') {
      const wanted = params.carCategory;
      const filtered = cars.filter((c) => c.carCategory.toLowerCase().includes(wanted));
      if (filtered.length) cars = filtered;
    }
    return cars.slice(0, 20);
    }),
  );
}
