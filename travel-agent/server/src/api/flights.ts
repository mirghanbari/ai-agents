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

const CABIN_CODE: Record<NonNullable<Flight['cabin']>, string> = {
  economy: 'M',
  premium_economy: 'W',
  business: 'C',
  first: 'F',
};

/** Kiwi expects DD/MM/YYYY. */
function toKiwiDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** Seconds → "Xh Ym". */
function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function mapFlight(raw: unknown, currency: string): Flight | undefined {
  if (!isRecord(raw)) return undefined;
  const price = pickNumber(raw.price);
  const id = pickString(raw.id);
  if (price === undefined || id === undefined) return undefined;

  const airlines = asArray(raw.airlines).map(pickString).filter((s): s is string => !!s);
  const route = asArray(raw.route);
  const firstLeg = route[0];
  const flightNo = isRecord(firstLeg)
    ? `${pickString(firstLeg.airline) ?? ''}${pickString(firstLeg.flight_no) ?? ''}`
    : '';

  return {
    id,
    airline: airlines[0] ?? pickString(dig(raw, 'airlines', 0)) ?? 'Unknown',
    flightNumber: flightNo,
    origin: pickString(raw.flyFrom) ?? pickString(raw.cityFrom) ?? '',
    destination: pickString(raw.flyTo) ?? pickString(raw.cityTo) ?? '',
    departTime: pickString(raw.local_departure) ?? '',
    arriveTime: pickString(raw.local_arrival) ?? '',
    duration: formatDuration(pickNumber(dig(raw, 'duration', 'total'))),
    stops: Math.max(0, route.length - 1),
    price,
    currency,
    bookingUrl: pickString(raw.deep_link) ?? pickString(raw.booking_token) ?? '',
  };
}

export async function searchFlights(params: FlightSearchParams): Promise<Flight[]> {
  if (!env.kiwiTequilaApiKey) {
    throw new SourceError('flights', 'KIWI_TEQUILA_API_KEY not set — flight search disabled.');
  }

  const query: Record<string, string | number> = {
    fly_from: params.origin,
    fly_to: params.destination,
    date_from: toKiwiDate(params.departDate),
    date_to: toKiwiDate(params.departDate),
    adults: params.adults,
    curr: 'USD',
    limit: 20,
    sort: 'price',
  };
  if (params.returnDate) {
    query.return_from = toKiwiDate(params.returnDate);
    query.return_to = toKiwiDate(params.returnDate);
  }
  if (params.cabin) query.selected_cabins = CABIN_CODE[params.cabin];

  try {
    const { data } = await axios.get('https://api.tequila.kiwi.com/v2/search', {
      params: query,
      headers: { apikey: env.kiwiTequilaApiKey },
      timeout: 20_000,
    });
    const currency = pickString(dig(data, 'currency')) ?? 'USD';
    const items = asArray(dig(data, 'data'));
    const flights = items
      .map((item) => mapFlight(item, currency))
      .filter((f): f is Flight => f !== undefined);
    if (params.cabin) return flights.map((f) => ({ ...f, cabin: params.cabin }));
    return flights;
  } catch (err: unknown) {
    const detail = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}` : String(err);
    throw new SourceError('flights', `Kiwi Tequila request failed: ${detail}`);
  }
}
