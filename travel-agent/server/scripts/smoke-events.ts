import { searchEventTickets } from '../src/api/events';

// Manual smoke test for the event-ticket fan-out (SeatGeek API + StubHub scraper).
//   cd server && npx tsx scripts/smoke-events.ts "Belgium Egypt" 2 500
const query = process.argv[2] ?? 'World Cup';
const quantity = process.argv[3] ? Number(process.argv[3]) : undefined;
const maxPrice = process.argv[4] ? Number(process.argv[4]) : undefined;

const run = async () => {
  console.log(`query=${JSON.stringify(query)} quantity=${quantity ?? '—'} maxPrice=${maxPrice ?? '—'}\n`);
  const events = await searchEventTickets({ query, quantity, maxPrice });
  const sg = events.filter((e) => e.source === 'seatgeek').length;
  const sh = events.filter((e) => e.source === 'stubhub').length;
  console.log(`TOTAL ${events.length} | seatgeek ${sg} | stubhub ${sh}\n`);
  for (const e of events) {
    const src = e.source.toUpperCase().padEnd(8);
    const price = e.lowestPrice !== undefined ? `$${e.lowestPrice}` : '—';
    const listings = e.listingCount !== undefined ? `${e.listingCount} listings` : 'listings n/a';
    console.log(`[${src}] ${e.title.slice(0, 44).padEnd(46)} ${price.padEnd(6)} ${listings.padEnd(14)} ${e.city ?? '—'} ${e.datetime.slice(0, 10)}`);
    console.log(`         ${e.url}`);
  }
};
run().catch((e) => { console.error('ERR', e); process.exit(1); });
