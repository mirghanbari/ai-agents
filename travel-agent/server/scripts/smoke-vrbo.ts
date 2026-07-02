import { searchVrbo } from '../src/scrapers/vrbo';
import { closeBrowser } from '../src/scrapers/browser';

// Live smoke for the VRBO scraper:  cd server && npx tsx scripts/smoke-vrbo.ts [location]
const daysOut = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const params = {
  location: process.argv[2] ?? 'Cannon Beach, Oregon',
  checkIn: daysOut(30),
  checkOut: daysOut(33),
  guests: 2,
};

const run = async (): Promise<void> => {
  console.log(`Searching VRBO: ${JSON.stringify(params)}\n`);
  const listings = await searchVrbo(params);
  console.log(`${listings.length} listings\n`);
  for (const l of listings) {
    const rating = l.rating ? `★${l.rating}` : '';
    console.log(`$${String(l.pricePerNight).padEnd(5)}/n ${l.title.slice(0, 50).padEnd(52)} ${rating}`);
    console.log(`         ${l.url.slice(0, 80)}`);
  }
  await closeBrowser();
};

run().catch(async (e) => {
  console.error('ERR', e);
  await closeBrowser();
  process.exit(1);
});
