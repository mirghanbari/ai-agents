import { searchStubHubScrape } from '../src/scrapers/stubhub';
import { closeBrowser } from '../src/scrapers/browser';

async function main() {
  const query = process.argv[2] ?? 'World Cup';
  console.log(`\n🔎 Scraping StubHub for: "${query}"  (HEADLESS=${process.env.HEADLESS ?? 'true'})\n`);
  const t0 = Date.now();
  try {
    const events = await searchStubHubScrape({ query });
    console.log(`✅ ${events.length} events in ${Date.now() - t0}ms\n`);
    for (const e of events.slice(0, 8)) {
      console.log(
        `• ${e.title}\n    ${e.venue || '(no venue)'} ${e.city ? '· ' + e.city : ''} ${e.datetime || ''}` +
          `\n    from ${e.lowestPrice != null ? '$' + e.lowestPrice : '—'}  ·  ${e.listingCount ?? '?'} listings  ·  ${e.url}`,
      );
    }
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await closeBrowser();
  }
}

void main();
