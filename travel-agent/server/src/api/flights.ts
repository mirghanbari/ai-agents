import axios from 'axios';
import { env, SourceError } from '../lib/env';
import { asArray, dig, isRecord, pickNumber, pickString } from '../lib/coerce';
import type { Flight } from '../types/travel';

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  cabin?: Flight['cabin'];
}

const DUFFEL_API = 'https://api.duffel.com/air/offer_requests';

// Duffel cabin_class values map 1:1 to our Flight['cabin'] union, so no
// translation table is needed (unlike Kiwi's single-letter codes).

/**
 * Build a Google Flights search URL. Duffel offers have no public deep link
 * (they're booked via API), so we point users at a pre-filled search instead.
 */
export function googleFlightsUrl(origin: string, destination: string, departDate: string): string {
  const q = `Flights from ${origin} to ${destination} on ${departDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

/** Parse an ISO 8601 duration ("PT8H30M") into "Xh Ym". */
export function formatDuration(iso: string | undefined): string {
  if (!iso) return '';
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!match) return '';
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  return `${h}h ${m}m`;
}

/**
 * Map a Duffel offer to our Flight shape. Routing/times come from the first
 * slice (the outbound); for round trips the price still reflects the whole
 * offer, matching how the UI card shows a single total.
 */
export function mapFlight(raw: unknown): Flight | undefined {
  if (!isRecord(raw)) return undefined;
  const id = pickString(raw.id);
  const price = pickNumber(raw.total_amount); // Duffel sends amounts as strings; pickNumber coerces
  if (id === undefined || price === undefined) return undefined;

  const slice = asArray(raw.slices)[0];
  if (!isRecord(slice)) return undefined;
  const segments = asArray(slice.segments);
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];

  const carrierCode = pickString(dig(firstSeg, 'marketing_carrier', 'iata_code')) ?? '';
  const flightNo = pickString(dig(firstSeg, 'marketing_carrier_flight_number')) ?? '';

  const origin = pickString(dig(slice, 'origin', 'iata_code')) ?? '';
  const destination = pickString(dig(slice, 'destination', 'iata_code')) ?? '';
  const departTime = pickString(dig(firstSeg, 'departing_at')) ?? '';

  return {
    id,
    airline:
      pickString(dig(raw, 'owner', 'name')) ??
      pickString(dig(firstSeg, 'marketing_carrier', 'name')) ??
      'Unknown',
    flightNumber: carrierCode && flightNo ? `${carrierCode}${flightNo}` : '',
    origin,
    destination,
    departTime,
    arriveTime: pickString(dig(lastSeg, 'arriving_at')) ?? '',
    duration: formatDuration(pickString(slice.duration)),
    stops: Math.max(0, segments.length - 1),
    price,
    currency: pickString(raw.total_currency) ?? 'USD',
    // Duffel offers have no public deep link; send users to a pre-filled search.
    bookingUrl: origin && destination ? googleFlightsUrl(origin, destination, departTime.slice(0, 10)) : '',
  };
}

export async function searchFlights(params: FlightSearchParams): Promise<Flight[]> {
  if (!env.duffelToken) {
    throw new SourceError('flights', 'DUFFEL_ACCESS_TOKEN not set — flight search disabled.');
  }

  const slices: Record<string, string>[] = [
    { origin: params.origin, destination: params.destination, departure_date: params.departDate },
  ];
  if (params.returnDate) {
    slices.push({
      origin: params.destination,
      destination: params.origin,
      departure_date: params.returnDate,
    });
  }

  const body = {
    data: {
      slices,
      passengers: Array.from({ length: Math.max(1, params.adults) }, () => ({ type: 'adult' })),
      ...(params.cabin ? { cabin_class: params.cabin } : {}),
    },
  };

  try {
    // return_offers=true (default) returns the priced offers inline, so a single
    // request is enough; we sort by price and cap at 20 ourselves.
    const { data } = await axios.post(DUFFEL_API, body, {
      params: { return_offers: true },
      headers: {
        Authorization: `Bearer ${env.duffelToken}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30_000,
    });

    const offers = asArray(dig(data, 'data', 'offers'));
    const flights = offers
      .map(mapFlight)
      .filter((f): f is Flight => f !== undefined)
      .sort((a, b) => a.price - b.price)
      .slice(0, 20);

    if (params.cabin) return flights.map((f) => ({ ...f, cabin: params.cabin }));
    return flights;
  } catch (err: unknown) {
    const detail = axios.isAxiosError(err)
      ? `${err.response?.status ?? ''} ${err.message}`
      : String(err);
    throw new SourceError('flights', `Duffel request failed: ${detail}`);
  }
}
