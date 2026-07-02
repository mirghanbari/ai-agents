import { searchRentalCars } from '../src/scrapers/cars';
import { closeBrowser } from '../src/scrapers/browser';

// Live smoke for the Kayak cars scraper:  cd server && npx tsx scripts/smoke-cars.ts [airport]
const daysOut = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const params = {
  pickupLocation: process.argv[2] ?? 'PDX',
  pickupDate: daysOut(30),
  dropoffDate: daysOut(33),
};

const run = async (): Promise<void> => {
  console.log(`Searching rental cars: ${JSON.stringify(params)}\n`);
  const cars = await searchRentalCars(params);
  console.log(`${cars.length} cars\n`);
  for (const c of cars) {
    console.log(
      `$${String(c.pricePerDay).padEnd(4)}/day  $${String(c.totalPrice).padEnd(5)} total  ` +
        `${c.carCategory.padEnd(18)} ${c.carName.slice(0, 40).padEnd(42)} (${c.supplier})`,
    );
  }
  await closeBrowser();
};

run().catch(async (e) => {
  console.error('ERR', e);
  await closeBrowser();
  process.exit(1);
});
