import axios from 'axios';
import { env, SourceError } from '../lib/env';
import { asArray, dig, isRecord, pickInt, pickNumber, pickString } from '../lib/coerce';
import type { Activity } from '../types/travel';

export interface ActivitySearchParams {
  destination: string;
  date?: string; // YYYY-MM-DD
  category?: string;
  adults?: number;
  maxPricePerPerson?: number;
}

function mapAttraction(raw: unknown): Activity | undefined {
  if (!isRecord(raw)) return undefined;
  const id = pickString(raw.location_id);
  const title = pickString(raw.name);
  if (!id || !title) return undefined;

  const price =
    pickNumber(dig(raw, 'offer_group', 'lowest_price')) ??
    pickNumber(dig(raw, 'booking', 'provider')) ??
    0;

  return {
    id,
    title,
    url: pickString(raw.web_url) ?? '',
    thumbnailUrl:
      pickString(dig(raw, 'photo', 'images', 'medium', 'url')) ??
      pickString(dig(raw, 'photo', 'images', 'small', 'url')) ??
      '',
    duration: pickString(dig(raw, 'duration')),
    price,
    currency: 'USD',
    rating: pickNumber(raw.rating),
    reviewCount: pickInt(raw.num_reviews),
    category: pickString(dig(raw, 'subcategory', 0, 'name')) ?? pickString(raw.category),
    bookingUrl: pickString(dig(raw, 'offer_group', 'offer_list', 0, 'url')) ?? pickString(raw.web_url) ?? '',
  };
}

/** RapidAPI "Travel Advisor": resolve a location, then list attractions. */
async function searchViaRapidApi(params: ActivitySearchParams): Promise<Activity[]> {
  const headers = {
    'X-RapidAPI-Key': env.rapidApiKey,
    'X-RapidAPI-Host': env.rapidApiActivitiesHost,
  };
  const loc = await axios.get(`https://${env.rapidApiActivitiesHost}/locations/search`, {
    params: { query: params.destination, limit: 1, lang: 'en_US' },
    headers,
    timeout: 15_000,
  });
  const locationId = pickString(dig(loc.data, 'data', 0, 'result_object', 'location_id'));
  if (!locationId) {
    throw new SourceError('activities', `No location matched "${params.destination}".`);
  }

  const list = await axios.get(`https://${env.rapidApiActivitiesHost}/attractions/list`, {
    params: { location_id: locationId, limit: 20, currency: 'USD', lang: 'en_US' },
    headers,
    timeout: 20_000,
  });

  let activities = asArray(dig(list.data, 'data'))
    .map(mapAttraction)
    .filter((a): a is Activity => a !== undefined);

  if (params.maxPricePerPerson !== undefined) {
    activities = activities.filter((a) => a.price <= params.maxPricePerPerson! || a.price === 0);
  }
  return activities;
}

/** Viator Partner API freetext product search (used when VIATOR_API_KEY is set). */
async function searchViaViator(params: ActivitySearchParams): Promise<Activity[]> {
  const { data } = await axios.post(
    'https://api.viator.com/partner/products/search',
    {
      filtering: { freetext: `${params.category ?? ''} ${params.destination}`.trim() },
      currency: 'USD',
      pagination: { start: 1, count: 20 },
    },
    {
      headers: {
        'exp-api-key': env.viatorApiKey,
        Accept: 'application/json;version=2.0',
        'Content-Type': 'application/json',
      },
      timeout: 20_000,
    },
  );

  return asArray(dig(data, 'products'))
    .map((raw): Activity | undefined => {
      if (!isRecord(raw)) return undefined;
      const id = pickString(raw.productCode);
      const title = pickString(raw.title);
      if (!id || !title) return undefined;
      return {
        id,
        title,
        url: pickString(dig(raw, 'productUrl')) ?? '',
        thumbnailUrl: pickString(dig(raw, 'images', 0, 'variants', 0, 'url')) ?? '',
        duration: pickString(dig(raw, 'duration', 'description')),
        price: pickNumber(dig(raw, 'pricing', 'summary', 'fromPrice')) ?? 0,
        currency: pickString(dig(raw, 'pricing', 'currency')) ?? 'USD',
        rating: pickNumber(dig(raw, 'reviews', 'combinedAverageRating')),
        reviewCount: pickInt(dig(raw, 'reviews', 'totalReviews')),
        category: params.category,
        bookingUrl: pickString(dig(raw, 'productUrl')) ?? '',
      };
    })
    .filter((a): a is Activity => a !== undefined);
}

export async function searchActivities(params: ActivitySearchParams): Promise<Activity[]> {
  try {
    if (env.viatorApiKey) return await searchViaViator(params);
    if (env.rapidApiKey) return await searchViaRapidApi(params);
    throw new SourceError(
      'activities',
      'No VIATOR_API_KEY or RAPIDAPI_KEY set — activity search disabled.',
    );
  } catch (err: unknown) {
    if (err instanceof SourceError) throw err;
    const detail = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}` : String(err);
    throw new SourceError('activities', `Activity search failed: ${detail}`);
  }
}
