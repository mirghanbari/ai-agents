import axios from 'axios';
import { env, SourceError } from '../lib/env';
import {
  asArray,
  dig,
  isRecord,
  pickInt,
  pickNumber,
  pickString,
  pickStringArray,
} from '../lib/coerce';
import type { Hotel } from '../types/travel';

export interface HotelSearchParams {
  destination: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  adults: number;
  maxPricePerNight?: number;
  minStars?: number;
}

interface DestId {
  destId: string;
  destType: string;
}

/** Resolve a free-text destination to a Booking.com location id. */
async function resolveDestination(destination: string): Promise<DestId> {
  const { data } = await axios.get(`https://${env.rapidApiBookingHost}/v1/hotels/locations`, {
    params: { name: destination, locale: 'en-gb' },
    headers: {
      'X-RapidAPI-Key': env.rapidApiKey,
      'X-RapidAPI-Host': env.rapidApiBookingHost,
    },
    timeout: 15_000,
  });
  const first = asArray(data)[0];
  const destId = pickString(dig(first, 'dest_id'));
  const destType = pickString(dig(first, 'dest_type'));
  if (!destId || !destType) {
    throw new SourceError('hotels', `No Booking.com location matched "${destination}".`);
  }
  return { destId, destType };
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function mapHotel(raw: unknown, nights: number): Hotel | undefined {
  if (!isRecord(raw)) return undefined;
  const id = pickString(raw.hotel_id);
  const name = pickString(raw.hotel_name);
  if (!id || !name) return undefined;

  const total =
    pickNumber(dig(raw, 'composite_price_breakdown', 'gross_amount', 'value')) ??
    pickNumber(raw.min_total_price) ??
    pickNumber(raw.price_breakdown && dig(raw, 'price_breakdown', 'gross_price'));
  const perNight = total !== undefined ? Math.round(total / nights) : pickNumber(raw.price);

  const lat = pickNumber(raw.latitude);
  const lng = pickNumber(raw.longitude);

  return {
    id,
    name,
    url: pickString(raw.url) ?? '',
    thumbnailUrl: pickString(raw.max_photo_url) ?? pickString(raw.main_photo_url) ?? '',
    address: pickString(raw.address) ?? pickString(raw.district) ?? '',
    pricePerNight: perNight ?? 0,
    totalPrice: total,
    currency: pickString(raw.currencycode) ?? pickString(raw.currency_code) ?? 'USD',
    rating: pickNumber(raw.review_score),
    reviewCount: pickInt(raw.review_nr),
    stars: pickInt(raw.class),
    amenities: pickStringArray(raw.hotel_facilities),
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
  };
}

export async function searchHotels(params: HotelSearchParams): Promise<Hotel[]> {
  if (!env.rapidApiKey) {
    throw new SourceError('hotels', 'RAPIDAPI_KEY not set — hotel search disabled.');
  }

  try {
    const { destId, destType } = await resolveDestination(params.destination);
    const { data } = await axios.get(`https://${env.rapidApiBookingHost}/v1/hotels/search`, {
      params: {
        dest_id: destId,
        dest_type: destType,
        checkin_date: params.checkIn,
        checkout_date: params.checkOut,
        adults_number: params.adults,
        room_number: 1,
        order_by: 'price',
        units: 'metric',
        filter_by_currency: 'USD',
        locale: 'en-gb',
        page_number: 0,
      },
      headers: {
        'X-RapidAPI-Key': env.rapidApiKey,
        'X-RapidAPI-Host': env.rapidApiBookingHost,
      },
      timeout: 20_000,
    });

    const nights = nightsBetween(params.checkIn, params.checkOut);
    let hotels = asArray(dig(data, 'result'))
      .map((h) => mapHotel(h, nights))
      .filter((h): h is Hotel => h !== undefined);

    if (params.maxPricePerNight !== undefined) {
      hotels = hotels.filter((h) => h.pricePerNight <= params.maxPricePerNight!);
    }
    if (params.minStars !== undefined) {
      hotels = hotels.filter((h) => (h.stars ?? 0) >= params.minStars!);
    }
    return hotels.slice(0, 20);
  } catch (err: unknown) {
    if (err instanceof SourceError) throw err;
    const detail = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}` : String(err);
    throw new SourceError('hotels', `Booking.com request failed: ${detail}`);
  }
}
