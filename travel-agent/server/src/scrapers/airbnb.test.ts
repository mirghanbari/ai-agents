import { describe, expect, it } from 'vitest';
import { decodeRoomId, extractSearchResults, parseStaySearchResult } from './airbnb';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Mirror of the live StaysSearch GraphQL result shape (August 2026). */
function makeResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Cozy beach cottage',
    avgRatingLocalized: '4.92 (188)',
    demandStayListing: {
      id: b64('DemandStayListing:12345678'),
      description: {
        name: { localizedStringWithTranslationPreference: 'Cottage by the sea' },
      },
      location: { coordinate: { latitude: 46.35, longitude: -124.05 } },
    },
    structuredDisplayPrice: {
      primaryLine: {
        price: '$1,600',
        discountedPrice: '$1,440',
        accessibilityLabel: '$1,440 for 8 nights, originally $1,600',
      },
    },
    ...overrides,
  };
}

describe('decodeRoomId', () => {
  it('decodes a base64 "Type:id" listing id', () => {
    expect(decodeRoomId(b64('StayListing:987654'))).toBe('987654');
  });

  it('returns the input unchanged when it is not base64-encoded "Type:id"', () => {
    expect(decodeRoomId('987654')).toBe('987654');
  });
});

describe('extractSearchResults', () => {
  it('digs out staysSearch.results.searchResults', () => {
    const blob = {
      data: { presentation: { staysSearch: { results: { searchResults: [1, 2] } } } },
    };
    expect(extractSearchResults(blob)).toEqual([1, 2]);
  });

  it('returns [] for unrelated payloads', () => {
    expect(extractSearchResults({ data: {} })).toEqual([]);
    expect(extractSearchResults(null)).toEqual([]);
  });
});

describe('parseStaySearchResult', () => {
  it('maps the current GraphQL shape to a Listing', () => {
    const listing = parseStaySearchResult(makeResult(), 8);
    expect(listing).toMatchObject({
      id: '12345678',
      source: 'airbnb',
      title: 'Cozy beach cottage',
      url: 'https://www.airbnb.com/rooms/12345678',
      totalPrice: 1440, // prefers the discounted price
      pricePerNight: 180, // 1440 / 8 nights (from the accessibility label)
      rating: 4.92,
      reviewCount: 188,
      coordinates: { lat: 46.35, lng: -124.05 },
    });
  });

  it('falls back to the description name and requested nights', () => {
    const result = makeResult({ title: undefined });
    delete (result.structuredDisplayPrice as Record<string, Record<string, unknown>>).primaryLine
      .accessibilityLabel;
    const listing = parseStaySearchResult(result, 4);
    expect(listing?.title).toBe('Cottage by the sea');
    expect(listing?.pricePerNight).toBe(360); // 1440 / 4 requested nights
  });

  it('rejects entries without a price', () => {
    expect(parseStaySearchResult(makeResult({ structuredDisplayPrice: {} }), 8)).toBeUndefined();
  });

  it('rejects non-listing nodes', () => {
    expect(parseStaySearchResult({ foo: 'bar' }, 8)).toBeUndefined();
    expect(parseStaySearchResult(null, 8)).toBeUndefined();
  });
});
