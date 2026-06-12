import type { Page } from 'playwright';
import { SourceError } from '../lib/env';
import { isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import { jitter, wiggleMouse, withContext } from './browser';
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

async function scrapeDom(page: Page, days: number): Promise<RentalCar[]> {
  const raw = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class*="resultWrapper"], [data-resultid]'));
    return cards.slice(0, 20).map((card, i) => {
      const text = card.textContent ?? '';
      const priceMatch = text.replace(/,/g, '').match(/\$\s?(\d+)/);
      const img = card.querySelector('img') as HTMLImageElement | null;
      const name = card.querySelector('[class*="carName"], [class*="vehicle"]')?.textContent ?? `Car ${i + 1}`;
      const supplier = card.querySelector('[class*="agency"], [class*="provider"]')?.textContent ?? 'Unknown';
      return {
        id: `kayak-car-${i}`,
        name: name.trim(),
        supplier: supplier.trim(),
        price: priceMatch ? Number(priceMatch[1]) : 0,
        image: img?.src ?? '',
      };
    });
  });

  return raw
    .filter((r) => r.price > 0)
    .map((r): RentalCar => ({
      id: r.id,
      supplier: r.supplier,
      carName: r.name,
      carCategory: 'any',
      thumbnailUrl: r.image,
      pricePerDay: Math.round(r.price / days),
      totalPrice: r.price,
      currency: 'USD',
      bookingUrl: '',
    }));
}

export async function searchRentalCars(params: CarSearchParams): Promise<RentalCar[]> {
  const days = daysBetween(params.pickupDate, params.dropoffDate);

  return withContext(async (page) => {
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
      await page.mouse.wheel(0, 1800);
      await jitter(3000, 5000);
    } catch (err: unknown) {
      throw new SourceError('cars', `Navigation failed: ${String(err)}`);
    }

    let cars = [...intercepted.values()];
    if (cars.length === 0) {
      cars = await scrapeDom(page, days).catch(() => []);
    }
    if (cars.length === 0) {
      throw new SourceError('cars', 'Returned 0 cars (Kayak bot block likely — try HEADLESS=false).');
    }

    if (params.carCategory && params.carCategory !== 'any') {
      const wanted = params.carCategory;
      const filtered = cars.filter((c) => c.carCategory.toLowerCase().includes(wanted));
      if (filtered.length) cars = filtered;
    }
    return cars.slice(0, 20);
  });
}
