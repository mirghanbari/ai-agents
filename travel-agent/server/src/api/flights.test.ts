import { describe, it, expect } from 'vitest';
import { mapFlight, formatDuration, googleFlightsUrl } from './flights';

describe('formatDuration', () => {
  it('parses hours and minutes from an ISO 8601 duration', () => {
    expect(formatDuration('PT8H30M')).toBe('8h 30m');
    expect(formatDuration('PT02H26M')).toBe('2h 26m'); // zero-padded, like Duffel sends
  });

  it('handles hours-only and minutes-only durations', () => {
    expect(formatDuration('PT5H')).toBe('5h 0m');
    expect(formatDuration('PT45M')).toBe('0h 45m');
  });

  it('returns empty string for missing or unparseable input', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration('nonsense')).toBe('');
  });
});

describe('googleFlightsUrl', () => {
  it('builds a URL-encoded Google Flights search query', () => {
    expect(googleFlightsUrl('LHR', 'JFK', '2026-07-01')).toBe(
      'https://www.google.com/travel/flights?q=Flights%20from%20LHR%20to%20JFK%20on%202026-07-01',
    );
  });

  it('appends the return date for round trips', () => {
    expect(googleFlightsUrl('LHR', 'JFK', '2026-07-01', '2026-07-08')).toBe(
      'https://www.google.com/travel/flights?q=' +
        encodeURIComponent('Flights from LHR to JFK on 2026-07-01 returning 2026-07-08'),
    );
  });
});

describe('mapFlight', () => {
  const raw = {
    id: 'off_123',
    total_amount: '451.00', // Duffel sends amounts as strings
    total_currency: 'GBP',
    owner: { name: 'British Airways', iata_code: 'BA' },
    slices: [
      {
        origin: { iata_code: 'LHR' },
        destination: { iata_code: 'JFK' },
        duration: 'PT8H30M',
        segments: [
          {
            departing_at: '2026-07-01T09:45:00',
            arriving_at: '2026-07-01T12:30:00',
            marketing_carrier: { name: 'British Airways', iata_code: 'BA' },
            marketing_carrier_flight_number: '177',
          },
          {
            departing_at: '2026-07-01T14:00:00',
            arriving_at: '2026-07-01T18:15:00',
            marketing_carrier: { name: 'British Airways', iata_code: 'BA' },
            marketing_carrier_flight_number: '203',
          },
        ],
      },
    ],
  };

  it('maps a full Duffel offer into a Flight, coercing the string price', () => {
    expect(mapFlight(raw)).toEqual({
      id: 'off_123',
      airline: 'British Airways',
      flightNumber: 'BA177', // carrier code + first segment number
      origin: 'LHR',
      destination: 'JFK',
      departTime: '2026-07-01T09:45:00', // first segment departs
      arriveTime: '2026-07-01T18:15:00', // last segment arrives
      duration: '8h 30m',
      stops: 1, // two segments → one stop
      price: 451,
      currency: 'GBP',
      bookingUrl:
        'https://www.google.com/travel/flights?q=' +
        encodeURIComponent('Flights from LHR to JFK on 2026-07-01'),
    });
  });

  it('populates returnLeg and a round-trip booking URL when a second slice exists', () => {
    const returnSlice = {
      origin: { iata_code: 'JFK' },
      destination: { iata_code: 'LHR' },
      duration: 'PT7H10M',
      segments: [
        {
          departing_at: '2026-07-08T18:00:00',
          arriving_at: '2026-07-09T06:10:00',
          marketing_carrier: { name: 'British Airways', iata_code: 'BA' },
          marketing_carrier_flight_number: '178',
        },
      ],
    };
    const roundTrip = { ...raw, slices: [raw.slices[0], returnSlice] };
    const f = mapFlight(roundTrip)!;
    expect(f.returnLeg).toEqual({
      origin: 'JFK',
      destination: 'LHR',
      departTime: '2026-07-08T18:00:00',
      arriveTime: '2026-07-09T06:10:00',
      duration: '7h 10m',
      stops: 0,
      flightNumber: 'BA178',
    });
    // outbound fields stay on the top level; price is the whole-offer total
    expect(f.origin).toBe('LHR');
    expect(f.price).toBe(451);
    expect(f.bookingUrl).toContain('returning%202026-07-08');
  });

  it('omits returnLeg for a one-way offer', () => {
    expect(mapFlight(raw)?.returnLeg).toBeUndefined();
  });

  it('reports zero stops for a single-segment slice', () => {
    const direct = {
      ...raw,
      slices: [{ ...raw.slices[0], segments: [raw.slices[0].segments[0]] }],
    };
    expect(mapFlight(direct)?.stops).toBe(0);
  });

  it('falls back to the segment carrier name when owner is absent', () => {
    const noOwner = { ...raw, owner: undefined };
    expect(mapFlight(noOwner)?.airline).toBe('British Airways');
  });

  it('returns undefined when id, price, or the first slice is missing', () => {
    expect(mapFlight({ ...raw, id: undefined })).toBeUndefined();
    expect(mapFlight({ ...raw, total_amount: undefined })).toBeUndefined();
    expect(mapFlight({ ...raw, slices: [] })).toBeUndefined();
    expect(mapFlight(null)).toBeUndefined();
  });
});
