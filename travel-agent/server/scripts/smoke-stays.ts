import { withContext, jitter, closeBrowser } from '../src/scrapers/browser';

// Ad-hoc pet-friendly stay search across the WA/OR coast corridor.
//   cd server && npx tsx scripts/smoke-stays.ts
//
// Why this doesn't use src/scrapers/airbnb.ts: that scraper feeds free text to
// Airbnb's geocoder, which silently resolves small coastal towns to far-bigger
// namesakes ("Long Beach, WA" -> Long Beach, CA; "Ocean Shores, WA" -> Bahamas).
// Here we (a) use disambiguated labels and (b) hard-filter every listing by its
// real coordinate against a WA/OR-coast bounding box.
const checkIn = '2026-08-21';
const checkOut = '2026-08-29';
const guests = 2;
const maxPricePerNight = 200;
const NIGHTS = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000);

// Bounding box for the corridor (Ocean Shores ~47.0 down to Rockaway Beach ~45.6,
// coast at ~-124.2, inland Columbia towns to ~-123.2).
const BOX = { minLat: 45.4, maxLat: 47.2, minLng: -124.4, maxLng: -122.8 };

const towns = [
  'Ocean Shores, Grays Harbor County, WA',
  'Westport, Grays Harbor County, WA',
  'Long Beach Peninsula, WA',
  'Astoria, Oregon',
  'Seaside, Oregon',
  'Cannon Beach, Oregon',
];

interface Row {
  id: string;
  title: string;
  town: string;
  total: number;
  nights: number;
  perNight: number;
  lat: number;
  lng: number;
  rating?: number;
  url: string;
  full: boolean;
}

function roomId(b64Id: string): string {
  try {
    return Buffer.from(b64Id, 'base64').toString('utf8').split(':')[1] ?? b64Id;
  } catch {
    return b64Id;
  }
}

function parsePrice(line: unknown): { total?: number; nights?: number } {
  if (!line || typeof line !== 'object') return {};
  const l = line as Record<string, unknown>;
  const priceStr = (l.discountedPrice ?? l.price) as string | undefined;
  const total = priceStr ? Number(priceStr.replace(/[^\d]/g, '')) : undefined;
  const label = (l.accessibilityLabel as string | undefined) ?? '';
  const nights = Number(label.match(/for (\d+)\s*night/)?.[1]);
  return { total, nights: Number.isFinite(nights) ? nights : undefined };
}

async function searchTown(label: string): Promise<Row[]> {
  return withContext(async (page) => {
    let blob: unknown = null;
    page.on('response', (r) => {
      if (r.url().includes('StaysSearch')) {
        void r.json().then((b) => { blob = b; }).catch(() => undefined);
      }
    });
    const url =
      `https://www.airbnb.com/s/${encodeURIComponent(label)}/homes` +
      `?checkin=${checkIn}&checkout=${checkOut}&adults=${guests}&pets=1`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await jitter(3000, 5000);
    await page.mouse.wheel(0, 2200);
    await jitter(2500, 4000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = (blob as any)?.data?.presentation?.staysSearch?.results?.searchResults ?? [];

    const rows: Row[] = [];
    for (const r of results) {
      const coord = r.demandStayListing?.location?.coordinate;
      if (!coord) continue;
      const { total, nights } = parsePrice(r.structuredDisplayPrice?.primaryLine);
      if (total === undefined) continue;
      const n = nights ?? NIGHTS;
      const id = roomId(r.demandStayListing?.id ?? '');
      rows.push({
        id,
        title: (r.title as string) ?? r.demandStayListing?.description?.name?.localizedStringWithTranslationPreference ?? 'Stay',
        town: label.split(',')[0],
        total,
        nights: n,
        perNight: Math.round(total / n),
        lat: coord.latitude,
        lng: coord.longitude,
        rating: Number(String(r.avgRatingLocalized ?? '').match(/[\d.]+/)?.[0]) || undefined,
        url: `https://www.airbnb.com/rooms/${id}`,
        full: n === NIGHTS,
      });
    }
    return rows;
  });
}

const run = async () => {
  console.log(`${checkIn} -> ${checkOut} (${NIGHTS} nights) | ${guests} adults + pet | <= $${maxPricePerNight}/night\n`);
  const all: Row[] = [];
  for (const town of towns) {
    let rows: Row[] = [];
    try {
      rows = await searchTown(town);
    } catch (e) {
      console.log(`  ${town}: ERR ${String(e).slice(0, 60)}`);
    }
    const inBox = rows.filter(
      (r) => r.lat > BOX.minLat && r.lat < BOX.maxLat && r.lng > BOX.minLng && r.lng < BOX.maxLng,
    );
    const dropped = rows.length - inBox.length;
    const keep = inBox.filter((r) => r.perNight > 0 && r.perNight <= maxPricePerNight);
    all.push(...keep);
    console.log(
      `${town.split(',')[0].padEnd(14)} ${keep.length} <= $${maxPricePerNight}/n` +
      ` (of ${inBox.length} in-region; ${dropped} off-box dropped)`,
    );
  }

  const seen = new Set<string>();
  const out = all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  out.sort((a, b) => Number(b.full) - Number(a.full) || a.perNight - b.perNight);
  const fullCount = out.filter((r) => r.full).length;
  console.log(`\nTOTAL ${out.length} pet-friendly under $${maxPricePerNight}/night | ${fullCount} for the full ${NIGHTS}-night window\n`);
  for (const r of out) {
    const pn = `$${r.perNight}/n`.padEnd(8);
    const win = r.full ? `FULL ${NIGHTS}n` : `${r.nights}n only`;
    const rating = r.rating ? `★${r.rating}` : '';
    console.log(`${pn} ${win.padEnd(9)} ${r.town.padEnd(13)} (${r.lat.toFixed(2)},${r.lng.toFixed(2)}) ${r.title.slice(0, 30).padEnd(32)} ${rating}`);
    console.log(`        ${r.url}`);
  }
  await closeBrowser();
};
run().catch((e) => { console.error('ERR', e); process.exit(1); });
