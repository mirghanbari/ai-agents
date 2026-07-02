import axios from 'axios';
import { asArray, dig, pickString } from './coerce';

// Free OSM Nominatim geocoding, used to sanity-check scraper results: some
// travel sites silently resolve small-town queries to bigger namesakes
// ("Long Beach, WA" -> Long Beach, CA; "Ocean Shores, WA" -> the Bahamas).
// We geocode the user's query ourselves and drop listings whose coordinates
// land in the wrong region.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoRegion {
  center: GeoPoint;
  /** Bounding box of the geocoded place, when the geocoder provides one. */
  box?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /**
   * Fully qualified place name ("Long Beach, Pacific County, Washington,
   * United States") — an unambiguous query to retry with when a site's own
   * geocoder picked the wrong namesake.
   */
  displayName?: string;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Is `p` plausibly part of the searched region? True when inside the place's
 * bounding box or within `radiusKm` of its center. The radius is deliberately
 * generous — search results legitimately include nearby towns; the failure
 * mode we're catching is a same-named place hundreds of km away.
 */
export function withinRegion(p: GeoPoint, region: GeoRegion, radiusKm = 100): boolean {
  const { box } = region;
  if (box && p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng) {
    return true;
  }
  return haversineKm(p, region.center) <= radiusKm;
}

const cache = new Map<string, GeoRegion | null>();

// Nominatim's usage policy: identify the app and stay at <= 1 request/second.
// Requests are serialized through `queue` with a minimum gap; the cache means
// each distinct location is looked up once per process.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const MIN_GAP_MS = 1100;

function num(value: unknown): number | undefined {
  const n = Number(pickString(value) ?? value);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchRegion(query: string): Promise<GeoRegion | null> {
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: query, format: 'jsonv2', limit: 1 },
    headers: { 'User-Agent': 'wayfarer-travel-agent/1.0 (personal travel search)' },
    timeout: 10_000,
  });

  const first = asArray(data)[0];
  const lat = num(dig(first, 'lat'));
  const lng = num(dig(first, 'lon'));
  if (lat === undefined || lng === undefined) return null;

  const bb = asArray(dig(first, 'boundingbox')).map(num);
  const box =
    bb.length === 4 && bb.every((v) => v !== undefined)
      ? { minLat: bb[0]!, maxLat: bb[1]!, minLng: bb[2]!, maxLng: bb[3]! }
      : undefined;

  return { center: { lat, lng }, box, displayName: pickString(dig(first, 'display_name')) };
}

/**
 * Geocode a free-text place. Returns null (never throws) when the lookup
 * fails or finds nothing — callers should treat that as "can't verify" and
 * skip coordinate filtering rather than dropping results.
 */
export async function geocode(query: string): Promise<GeoRegion | null> {
  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const result = (queue = queue
    .catch(() => undefined)
    .then(() => fetchRegion(query).catch(() => null)));
  const region = (await result) as GeoRegion | null;
  cache.set(key, region);
  return region;
}
