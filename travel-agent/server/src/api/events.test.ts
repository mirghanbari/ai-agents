import { describe, it, expect } from 'vitest';
import { mapSeatGeekEvent, mapStubHubEvent, applyFilters } from './events';
import type { EventTicket } from '../types/travel';

describe('mapSeatGeekEvent', () => {
  const raw = {
    id: 5821,
    title: 'USA vs. Wales',
    type: 'sports',
    datetime_local: '2026-06-23T19:00:00',
    url: 'https://seatgeek.com/usa-vs-wales-tickets/5821',
    venue: { name: 'NRG Stadium', city: 'Houston' },
    stats: { lowest_price: 120, highest_price: 900, average_price: 350, visible_listing_count: 42 },
    performers: [{ name: 'USA', image: 'https://img/usa.png' }, { name: 'Wales' }],
  };

  it('maps a full SeatGeek event into an EventTicket', () => {
    expect(mapSeatGeekEvent(raw)).toEqual({
      id: 'sg-5821',
      source: 'seatgeek',
      title: 'USA vs. Wales',
      venue: 'NRG Stadium',
      city: 'Houston',
      datetime: '2026-06-23T19:00:00',
      url: 'https://seatgeek.com/usa-vs-wales-tickets/5821',
      lowestPrice: 120,
      highestPrice: 900,
      averagePrice: 350,
      currency: 'USD',
      listingCount: 42,
      performers: ['USA', 'Wales'],
      category: 'sports',
      thumbnailUrl: 'https://img/usa.png',
    });
  });

  it('falls back to short_title when title is absent', () => {
    expect(mapSeatGeekEvent({ id: 1, short_title: 'Short' })?.title).toBe('Short');
  });

  it('falls back to the performer huge image for the thumbnail', () => {
    const e = mapSeatGeekEvent({ id: 1, title: 'X', performers: [{ images: { huge: 'https://img/h.png' } }] });
    expect(e?.thumbnailUrl).toBe('https://img/h.png');
  });

  it('omits the visible count by falling back to listing_count', () => {
    const e = mapSeatGeekEvent({ id: 1, title: 'X', stats: { listing_count: 7 } });
    expect(e?.listingCount).toBe(7);
  });

  it('returns undefined when id or title is missing, or input is not a record', () => {
    expect(mapSeatGeekEvent({ title: 'no id' })).toBeUndefined();
    expect(mapSeatGeekEvent({ id: 1 })).toBeUndefined();
    expect(mapSeatGeekEvent(null)).toBeUndefined();
    expect(mapSeatGeekEvent([])).toBeUndefined();
  });
});

describe('mapStubHubEvent', () => {
  const raw = {
    id: 'EV99',
    name: 'Lakers vs. Celtics',
    eventDateLocal: '2026-12-25T17:30:00',
    webURI: 'https://stubhub.com/lakers-celtics/event/99',
    venue: { name: 'Crypto.com Arena', city: 'Los Angeles' },
    ticketInfo: { minPrice: 85, maxPrice: 1200, currencyCode: 'USD', totalListings: 310 },
    performers: [{ name: 'Lakers' }, { name: 'Celtics' }],
    categories: [{ name: 'NBA' }],
    imageUrl: 'https://img/lakers.png',
  };

  it('maps a full StubHub event into an EventTicket', () => {
    expect(mapStubHubEvent(raw)).toEqual({
      id: 'sh-EV99',
      source: 'stubhub',
      title: 'Lakers vs. Celtics',
      venue: 'Crypto.com Arena',
      city: 'Los Angeles',
      datetime: '2026-12-25T17:30:00',
      url: 'https://stubhub.com/lakers-celtics/event/99',
      lowestPrice: 85,
      highestPrice: 1200,
      averagePrice: undefined,
      currency: 'USD',
      listingCount: 310,
      performers: ['Lakers', 'Celtics'],
      category: 'NBA',
      thumbnailUrl: 'https://img/lakers.png',
    });
  });

  it('falls back from name to title, and defaults currency to USD', () => {
    const e = mapStubHubEvent({ id: 'A', title: 'Fallback', ticketInfo: {} });
    expect(e?.title).toBe('Fallback');
    expect(e?.currency).toBe('USD');
  });

  it('returns undefined when id or title is missing', () => {
    expect(mapStubHubEvent({ name: 'no id' })).toBeUndefined();
    expect(mapStubHubEvent({ id: 'A' })).toBeUndefined();
    expect(mapStubHubEvent(undefined)).toBeUndefined();
  });
});

describe('applyFilters', () => {
  const ev = (over: Partial<EventTicket>): EventTicket => ({
    id: 'sh-x',
    source: 'stubhub',
    title: 'E',
    venue: 'V',
    datetime: '',
    url: '',
    currency: 'USD',
    thumbnailUrl: '',
    ...over,
  });

  it('drops events above maxPrice but keeps those with no price', () => {
    const out = applyFilters(
      [ev({ id: 'a', lowestPrice: 50 }), ev({ id: 'b', lowestPrice: 500 }), ev({ id: 'c' })],
      { query: 'x', maxPrice: 100 },
    );
    expect(out.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('drops events with too few listings for the party, keeping unknown counts', () => {
    const out = applyFilters(
      [ev({ id: 'a', listingCount: 1 }), ev({ id: 'b', listingCount: 6 }), ev({ id: 'c' })],
      { query: 'x', quantity: 4 },
    );
    expect(out.map((e) => e.id).sort()).toEqual(['b', 'c']);
  });

  it('does not filter on listings when quantity is 1', () => {
    const out = applyFilters([ev({ id: 'a', listingCount: 0 })], { query: 'x', quantity: 1 });
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('caps the result set at 20 (keeping the cheapest), like every other source', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev({ id: `e${i}`, lowestPrice: 30 - i }));
    const out = applyFilters(many, { query: 'x' });
    expect(out).toHaveLength(20);
    expect(out[0].lowestPrice).toBe(1); // cheapest first survives the cap
    expect(out.some((e) => e.lowestPrice! > 20)).toBe(false); // priciest 10 dropped
  });

  it('sorts cheapest get-in first and floats priceless events to the end', () => {
    const out = applyFilters(
      [ev({ id: 'mid', lowestPrice: 200 }), ev({ id: 'none' }), ev({ id: 'low', lowestPrice: 50 })],
      { query: 'x' },
    );
    expect(out.map((e) => e.id)).toEqual(['low', 'mid', 'none']);
  });
});
