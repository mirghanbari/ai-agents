import { searchAirbnb } from '../src/scrapers/airbnb';
import { closeBrowser } from '../src/scrapers/browser';

// Live smoke for the Airbnb scraper:  cd server && npx tsx scripts/smoke-airbnb.ts
// Uses an ambiguous small-town query on purpose — "Long Beach, WA" is exactly
// the name Airbnb's geocoder used to silently resolve to Long Beach, CA, so a
// passing run also proves the geocode-verification filter.
const daysOut = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const params = {
  location: process.argv[2] ?? 'Long Beach, WA',
  checkIn: daysOut(30),
  checkOut: daysOut(33),
  guests: 2,
  pets: process.argv.includes('--pets') ? 1 : undefined,
};

const run = async (): Promise<void> => {
  console.log(`Searching Airbnb: ${JSON.stringify(params)}\n`);
  const listings = await searchAirbnb(params);
  console.log(`${listings.length} listings\n`);
  for (const l of listings) {
    const coord = l.coordinates ? `(${l.coordinates.lat.toFixed(2)},${l.coordinates.lng.toFixed(2)})` : '(no coords)';
    const rating = l.rating ? `★${l.rating}` : '';
    console.log(
      `$${String(l.pricePerNight).padEnd(5)}/n ${coord.padEnd(17)} ${l.title.slice(0, 40).padEnd(42)} ${rating}`,
    );
    console.log(`         ${l.url}`);
  }
  await closeBrowser();
};

run().catch(async (e) => {
  console.error('ERR', e);
  await closeBrowser();
  process.exit(1);
});
