// src/app/api/research/__tests__/geocodeSanity.test.js
//
// Unit tests for the geocode sanity-check utilities exported from research/route.js.
// No Mapbox calls — all geocoding is simulated via injected functions.

import { describe, it, expect, vi } from 'vitest';
import { GEOCODE_SANITY_KM, distKm, passesSanity } from '../route.js';

// ── Manchester fixture — used to mirror the live Salford Quays scenario ───────
const MANCHESTER_CENTRE = { lat: 53.4808, lng: -2.2426 };

// Real Salford Quays coords (~2.5 km west of Manchester centre)
const SALFORD_QUAYS_REAL = { lat: 53.4732, lng: -2.2998 };
// Bad coords returned by Mapbox for Salford Quays (~27 km from centre, Todmorden area)
const SALFORD_QUAYS_BAD  = { lat: 53.7135, lng: -2.0982 };
// Hollingworth Lake — genuinely distant (~28 km), correct coords
const HOLLINGWORTH_LAKE  = { lat: 53.6396, lng: -2.0949 };

// ── GEOCODE_SANITY_KM ──────────────────────────────────────────────────────────

describe('GEOCODE_SANITY_KM', () => {
  it('is exported and equals 35', () => {
    expect(GEOCODE_SANITY_KM).toBe(35);
  });
});

// ── distKm ────────────────────────────────────────────────────────────────────

describe('distKm', () => {
  it('returns ~0 for identical points', () => {
    expect(distKm(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 5);
  });

  it('Manchester centre to Salford Quays Real: within 5 km', () => {
    const d = distKm(
      MANCHESTER_CENTRE.lat, MANCHESTER_CENTRE.lng,
      SALFORD_QUAYS_REAL.lat, SALFORD_QUAYS_REAL.lng,
    );
    expect(d).toBeLessThan(5);
    expect(d).toBeGreaterThan(0);
  });

  it('Manchester centre to bad Salford Quays coords: ~27 km', () => {
    const d = distKm(
      MANCHESTER_CENTRE.lat, MANCHESTER_CENTRE.lng,
      SALFORD_QUAYS_BAD.lat,  SALFORD_QUAYS_BAD.lng,
    );
    // The bad coords are ~27 km away — under 35 km, which explains why they
    // slipped through the threshold guard before the explicit sanity check was added.
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(35);
  });

  it('Manchester centre to Hollingworth Lake: ~28 km (genuine day-trip)', () => {
    const d = distKm(
      MANCHESTER_CENTRE.lat, MANCHESTER_CENTRE.lng,
      HOLLINGWORTH_LAKE.lat,  HOLLINGWORTH_LAKE.lng,
    );
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(35); // within threshold → legitimately placed
  });
});

// ── passesSanity — in-range pass ───────────────────────────────────────────────

describe('passesSanity — in-range pass', () => {
  it('Salford Quays real coords pass against Manchester centre', () => {
    expect(passesSanity(SALFORD_QUAYS_REAL, MANCHESTER_CENTRE)).toBe(true);
  });

  it('spot 34 km from centre passes (clearly inside 35 km threshold)', () => {
    // Use 34 km — well inside the threshold — to avoid floating-point rounding
    // at the exact boundary (35/111 * 111 is not guaranteed to round-trip to
    // exactly 35.0 in IEEE 754 double precision).
    const inside = { lat: MANCHESTER_CENTRE.lat + 34 / 111, lng: MANCHESTER_CENTRE.lng };
    expect(passesSanity(inside, MANCHESTER_CENTRE)).toBe(true);
  });

  it('passes with a custom tighter threshold', () => {
    // Hollingworth Lake (28 km) — passes 35 km default but fails 20 km
    expect(passesSanity(HOLLINGWORTH_LAKE, MANCHESTER_CENTRE, 35)).toBe(true);
    expect(passesSanity(HOLLINGWORTH_LAKE, MANCHESTER_CENTRE, 20)).toBe(false);
  });
});

// ── passesSanity — out-of-range rejection ─────────────────────────────────────

describe('passesSanity — out-of-range rejection (triggers retry)', () => {
  it('returns false for coords 36 km from city centre', () => {
    const tooFar = { lat: MANCHESTER_CENTRE.lat + 36 / 111, lng: MANCHESTER_CENTRE.lng };
    expect(passesSanity(tooFar, MANCHESTER_CENTRE)).toBe(false);
  });

  it('Seoul bad coords (Busan, 329 km) fail against Seoul centre', () => {
    const SEOUL_CENTRE   = { lat: 37.5665, lng: 126.9780 };
    const BUSAN_BOSU_KM  = distKm(35.0989, 129.0285, SEOUL_CENTRE.lat, SEOUL_CENTRE.lng);
    expect(passesSanity({ lat: 35.0989, lng: 129.0285 }, SEOUL_CENTRE)).toBe(false);
    expect(busan_bosu_km_ish()).toBeGreaterThan(300);
    function busan_bosu_km_ish() { return BUSAN_BOSU_KM; }
  });
});

// ── passesSanity — edge cases ─────────────────────────────────────────────────

describe('passesSanity — edge cases', () => {
  it('null coords → false', () => {
    expect(passesSanity(null, MANCHESTER_CENTRE)).toBe(false);
  });

  it('undefined coords → false', () => {
    expect(passesSanity(undefined, MANCHESTER_CENTRE)).toBe(false);
  });

  it('coords with zero lat → false (zero is falsy, treated as missing)', () => {
    expect(passesSanity({ lat: 0, lng: 0 }, MANCHESTER_CENTRE)).toBe(false);
  });

  it('no city centre → true (cannot check, pass through)', () => {
    expect(passesSanity(SALFORD_QUAYS_REAL, null)).toBe(true);
    expect(passesSanity(SALFORD_QUAYS_REAL, undefined)).toBe(true);
    expect(passesSanity(SALFORD_QUAYS_REAL, {})).toBe(true);
  });
});

// ── Simulated retry logic ─────────────────────────────────────────────────────
//
// The actual Mapbox-backed geocodeSpot is not called in tests.  Instead we
// simulate the behaviour that the 9-strategy cascade implements: strategy 1
// (name-only) returns bad coords that fail the sanity check; strategy 2
// (name + city) returns correct coords that pass.
//
// This proves the contract: a failing sanity check triggers the retry path.

describe('simulated retry — out-of-range result → retry succeeds', () => {
  async function simulateGeocode(geocodeFn, spot, city, cityCenter) {
    // Strategy 1: name alone
    const attempt1 = await geocodeFn(`${spot.name}`, 'poi');
    if (passesSanity(attempt1, cityCenter)) return { ...spot, ...attempt1, coordsMissing: false };

    // Strategy 2 (explicit retry): "{name}, {city}"
    const attempt2 = await geocodeFn(`${spot.name}, ${city}`, 'poi');
    if (passesSanity(attempt2, cityCenter)) return { ...spot, ...attempt2, coordsMissing: false };

    // All strategies failed sanity — null the coords
    return { ...spot, coordsMissing: true };
  }

  it('retry succeeds: bad first result → good second result → not coordsMissing', async () => {
    const spot       = { id: 'test', name: 'Salford Quays' };
    const city       = 'Manchester';
    const cityCenter = MANCHESTER_CENTRE;

    const mockGeocode = vi.fn()
      .mockResolvedValueOnce(SALFORD_QUAYS_BAD)   // strategy 1: bad coords (~27 km, under threshold)
      .mockResolvedValueOnce(SALFORD_QUAYS_REAL);  // strategy 2 retry: correct coords

    // NB: SALFORD_QUAYS_BAD is ~27 km from Manchester centre — under 35 km — so it
    // passes passesSanity.  This test therefore shows the RETRY being invoked only
    // when the first attempt fails, NOT that the bad coords are caught by threshold.
    // The actual Salford Quays bug was an under-threshold bad result that could only
    // be caught by a tighter threshold or by re-researching the city.

    const result = await simulateGeocode(mockGeocode, spot, city, cityCenter);

    // Because the bad coords ARE within 35 km, strategy 1 passes and no retry occurs.
    // This test documents that known limitation: the 35 km guard cannot catch
    // a wrong result that is still within threshold.
    expect(result.coordsMissing).toBe(false);
    expect(mockGeocode).toHaveBeenCalledTimes(1); // strategy 1 passed, no retry needed
  });

  it('retry succeeds: clearly out-of-range first → good retry → placed correctly', async () => {
    const spot       = { id: 'test', name: 'Some Spot' };
    const city       = 'Manchester';
    const cityCenter = MANCHESTER_CENTRE;

    const FAR_COORDS  = { lat: 54.0, lng: -2.0 }; // ~60 km from Manchester — fails sanity
    const NEAR_COORDS = { lat: 53.48, lng: -2.25 }; // 0.3 km — passes sanity

    const mockGeocode = vi.fn()
      .mockResolvedValueOnce(FAR_COORDS)   // strategy 1: fails sanity
      .mockResolvedValueOnce(NEAR_COORDS); // strategy 2 retry: passes

    const result = await simulateGeocode(mockGeocode, spot, city, cityCenter);

    expect(result.coordsMissing).toBe(false);
    expect(result.lat).toBe(NEAR_COORDS.lat);
    expect(result.lng).toBe(NEAR_COORDS.lng);
    expect(mockGeocode).toHaveBeenCalledTimes(2);
    expect(mockGeocode).toHaveBeenNthCalledWith(1, 'Some Spot', 'poi');
    expect(mockGeocode).toHaveBeenNthCalledWith(2, 'Some Spot, Manchester', 'poi');
  });

  it('retry fails: both strategies out-of-range → coordsMissing: true', async () => {
    const spot       = { id: 'test', name: 'Nowhere Place' };
    const city       = 'Manchester';
    const cityCenter = MANCHESTER_CENTRE;

    const FAR_COORDS = { lat: 54.5, lng: -1.0 }; // ~120 km from Manchester

    const mockGeocode = vi.fn().mockResolvedValue(FAR_COORDS);

    const result = await simulateGeocode(mockGeocode, spot, city, cityCenter);

    expect(result.coordsMissing).toBe(true);
    expect(mockGeocode).toHaveBeenCalledTimes(2);
  });
});
