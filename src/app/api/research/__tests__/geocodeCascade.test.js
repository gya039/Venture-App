// src/app/api/research/__tests__/geocodeCascade.test.js
//
// Unit tests for the geocodeSpot strategy cascade.
// All Mapbox calls are intercepted via a vi.stubGlobal fetch mock — no real HTTP.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeSpot } from '../route.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MANCHESTER = { lat: 53.4808, lng: -2.2426, countryCode: 'gb' };
const TOKEN      = 'test-token';

// Oxford Road, Manchester — where The Whitworth actually is (~2 km from centre)
const OXFORD_RD  = { lat: 53.4627, lng: -2.2315 };
// Town of Whitworth near Rochdale — the wrong result (~25 km north)
const WHITWORTH_TOWN = { lat: 53.6580, lng: -2.1720 };
// Salford Quays docklands district (~3.5 km west)
const SALFORD_QUAYS  = { lat: 53.4733, lng: -2.2998 };

/** Build a mock fetch response for a single Mapbox result */
function mapboxHit(coords) {
  return { ok: true, json: () => Promise.resolve({ features: [{ center: [coords.lng, coords.lat] }] }) };
}

/** Build a mock fetch response for zero results */
const mapboxMiss = { ok: true, json: () => Promise.resolve({ features: [] }) };

// ---------------------------------------------------------------------------
// (a) Address-first: address present → address result wins before name strategies
// ---------------------------------------------------------------------------

describe('(a) address present → address strategy wins', () => {
  beforeEach(() => {
    // First call (address strategy) returns Oxford Rd — subsequent calls should not be reached
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mapboxHit(OXFORD_RD)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns coords from the address strategy when address is present', async () => {
    const spot = {
      name:     'The Whitworth Art Gallery',
      category: 'Art',
      address:  'Oxford Rd, Manchester M15 6ER',
    };

    const result = await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    expect(result.coordsMissing).toBe(false);
    expect(result.lat).toBeCloseTo(OXFORD_RD.lat, 3);
    expect(result.lng).toBeCloseTo(OXFORD_RD.lng, 3);
  });

  it('resolves in a single fetch call when the address strategy succeeds', async () => {
    const spot = {
      name:     'The Whitworth Art Gallery',
      category: 'Art',
      address:  'Oxford Rd, Manchester M15 6ER',
    };

    await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('address strategy URL uses types=address and NOT locality', async () => {
    const spot = {
      name:     'The Whitworth Art Gallery',
      category: 'Art',
      address:  'Oxford Rd, Manchester M15 6ER',
    };

    await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    const url = vi.mocked(fetch).mock.calls[0][0];
    expect(url).toContain('types=address');
    expect(url).not.toContain('locality');
    expect(url).not.toContain('neighborhood');
  });
});

// ---------------------------------------------------------------------------
// (b) Non-area category: locality types never used, even if all POI strategies fail
// ---------------------------------------------------------------------------

describe('(b) non-area category never falls back to locality types', () => {
  beforeEach(() => {
    // All strategies return no features — forcing the cascade to exhaust
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mapboxMiss));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns coordsMissing when all strategies fail for a non-area category', async () => {
    const spot = {
      name:     'The Whitworth Art Gallery',
      category: 'Art',
      // no address, no neighbourhood field
    };

    const result = await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    expect(result.coordsMissing).toBe(true);
  });

  it('never calls Mapbox with neighborhood or locality types for Art category', async () => {
    const spot = { name: 'The Whitworth Art Gallery', category: 'Art' };

    await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0]);
    for (const url of urls) {
      expect(url).not.toMatch(/types=[^&]*(?:neighborhood|locality)/);
    }
  });

  it.each(['Museum', 'Bar', 'Café', 'Park', 'Music', 'History', 'Architecture'])(
    'never uses locality types for category "%s"',
    async (category) => {
      const spot = { name: 'Some Venue', category };

      await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

      const urls = vi.mocked(fetch).mock.calls.map((c) => c[0]);
      for (const url of urls) {
        expect(url).not.toMatch(/types=[^&]*(?:neighborhood|locality)/);
      }

      vi.mocked(fetch).mockClear();
    }
  );
});

// ---------------------------------------------------------------------------
// (c) Area category: Salford Quays shape resolves via the gated locality fallback
// ---------------------------------------------------------------------------

describe('(c) Neighbourhood category resolves via locality fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves when all POI strategies fail but locality fallback succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      // The gated area fallback (strategy 9) uses neighborhood,locality types
      if (/types=[^&]*(?:neighborhood|locality)/.test(url)) {
        return mapboxHit(SALFORD_QUAYS);
      }
      return mapboxMiss;
    }));

    const spot = {
      name:     'Salford Quays',
      category: 'Neighbourhood',
      // no address — it's an area, not a building
    };

    const result = await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    expect(result.coordsMissing).toBe(false);
    expect(result.lat).toBeCloseTo(SALFORD_QUAYS.lat, 3);
    expect(result.lng).toBeCloseTo(SALFORD_QUAYS.lng, 3);
  });

  it('used a locality-type URL to resolve the area spot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      if (/types=[^&]*(?:neighborhood|locality)/.test(url)) return mapboxHit(SALFORD_QUAYS);
      return mapboxMiss;
    }));

    const spot = { name: 'Salford Quays', category: 'Neighbourhood' };
    await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    const localityCall = vi.mocked(fetch).mock.calls.find(
      ([url]) => /types=[^&]*(?:neighborhood|locality)/.test(url)
    );
    expect(localityCall).toBeDefined();
  });

  it('returns coordsMissing if even the locality fallback finds nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mapboxMiss));

    const spot = { name: 'Nowhere District', category: 'Neighbourhood' };
    const result = await geocodeSpot(spot, 'Manchester', MANCHESTER, TOKEN);

    expect(result.coordsMissing).toBe(true);
  });
});
