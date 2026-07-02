import { describe, expect, it } from 'vitest';
import { haversineKm, withinRegion, type GeoRegion } from './geocode';

const longBeachWA = { lat: 46.352, lng: -124.054 };
const longBeachCA = { lat: 33.77, lng: -118.194 };
const astoriaOR = { lat: 46.188, lng: -123.831 };

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(longBeachWA, longBeachWA)).toBe(0);
  });

  it('measures Long Beach WA -> Long Beach CA at ~1470 km', () => {
    const km = haversineKm(longBeachWA, longBeachCA);
    expect(km).toBeGreaterThan(1300);
    expect(km).toBeLessThan(1600);
  });

  it('measures Long Beach WA -> Astoria OR at under 30 km', () => {
    expect(haversineKm(longBeachWA, astoriaOR)).toBeLessThan(30);
  });
});

describe('withinRegion', () => {
  const region: GeoRegion = {
    center: longBeachWA,
    box: { minLat: 46.3, maxLat: 46.75, minLng: -124.1, maxLng: -123.95 },
  };

  it('accepts a point inside the bounding box', () => {
    expect(withinRegion({ lat: 46.5, lng: -124.05 }, region)).toBe(true);
  });

  it('accepts a nearby town outside the box but within the radius', () => {
    expect(withinRegion(astoriaOR, region)).toBe(true);
  });

  it('rejects a same-named place in another state', () => {
    expect(withinRegion(longBeachCA, region)).toBe(false);
  });

  it('works without a bounding box (radius only)', () => {
    expect(withinRegion(astoriaOR, { center: longBeachWA })).toBe(true);
    expect(withinRegion(longBeachCA, { center: longBeachWA })).toBe(false);
  });
});
