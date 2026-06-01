 CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run start        # Serve production build

# Tests — dev server must be running first
npx playwright test                          # All tests
npx playwright test tests/map.spec.js        # Single file
npx playwright test tests/map.spec.js --grep "pin accuracy"  # Single test

# One-time Firestore cache clear (after geocoding fixes)
cd functions && GOOGLE_CLOUD_PROJECT=<id> node ../scripts/clearCitySpots.mjs
```

Tests are fully sequential (`fullyParallel: false`, 1 worker). `qa.spec.js` must run before `map.spec.js` because it creates the Lisbon trip that map tests depend on. Test credentials come from `.env.local` as `TEST_EMAIL` / `TEST_PASSWORD`.

## Architecture

### Data flow — spot research

```
User clicks "Research" →
  runResearch() [lib/functions.js]
    → Check Firestore cache (citySpots/{city}/spots)
    → if cache hit: return immediately
    → POST /api/research [SSE route]
        → OpenAI (gpt-4o-mini, json_object mode) → 20 spots as JSON
        → Strip any AI-generated lat/lng
        → getCityCenter() → Mapbox → city [lng, lat] + ISO country code
        → geocodeSpot() × 20 (sequential, 9 fallback strategies)
        → SSE stream: status | spot | error | done events
    → cacheSpots() → Firestore writeBatch
    → markResearchDone() → destinations/{id}.researchDone = true
```

All spot coordinates come exclusively from Mapbox — never from OpenAI. Spots that fail all 9 geocoding strategies are skipped (not saved). Never add `place` to Mapbox `types` parameter: it returns the city itself and stacks all failed spots on one pin.

### Firestore collections

```
users/{uid}                         profile, currency, interests
trips/{tripId}                      userId, name, isMultiCity, firstStartDate
destinations/{destId}               tripId, userId, city, startDate, endDate, researchDone
citySpots/{city}/spots/{spotId}     geocoded spot cache — city-scoped, never expires
dayPlans/{planId}                   destinationId, userId, tripId, planDate, dayNumber
dayPlanSpots/{id}                   dayPlanId, spotId, spotCity, timeOfDay, sortOrder
users/{uid}/savedSpots/{spotId}     lightweight spot stubs
users/{uid}/spotNotes/{spotId}      { note, visited }
cityPasses/{city}                   manually-seeded day-pass data
cityTemplates/{city}/templates/{id} community trip templates
spotReviews/{spotId}/reviews/{uid}  individual reviews
spotReviews/{spotId}                aggregate { avgRating, count }
```

**Firestore security rules require `userId` in every query** on protected collections (trips, destinations, dayPlans). Always include `where('userId', '==', userId)` or the query will be rejected.

Always use `getDocsFromServer()` instead of `getDocs()` when reading `citySpots` — the IndexedDB offline cache can return stale geocoded coordinates from a previous broken research run.

### Key modules

- **`src/lib/db.js`** — All Firestore CRUD. Primary interface for data. Never write Firestore calls outside this file.
- **`src/lib/functions.js`** — `runResearch()` — the only entry point for triggering AI research. Handles cache check, SSE parsing, and Firestore write.
- **`src/app/api/research/route.js`** — SSE route (`maxDuration = 60`). Calls OpenAI then geocodes sequentially. `geocodeSpot()` has 9 fallback strategies with bbox `pad = 0.35°`, `MAX_DIST_KM = 35`.
- **`src/lib/firebase.js`** — Firebase singleton with offline persistence. Guards against SSR (no env vars during prerender).
- **`src/components/MapView.jsx`** — Mapbox GL JS map. Markers are DOM-based (`mapboxgl.Marker`), not GL layers/sources. `window.ventureMap` and `window.ventureMapMarkers` are exposed for Playwright assertions.

### Auth pattern

`useAuth()` returns `{ user, loading, authReady }`.
- `user` starts as `undefined` (SSR-safe), then `null` (not logged in) or a Firebase user object.
- `authReady` is `true` only after Firebase has confirmed the session. Gate Firestore writes on `authReady`, not just `user`.
- A localStorage UID seed (`venture_uid`) makes repeat visits feel instant — `user` may be `{ uid, _cached: true }` briefly before Firebase resolves.

### Hiddenness system

Scores 1–10 map to five tiers. Always derive colours and labels from `getHiddennessLevel(score)` in `src/constants/hiddenness.js`:

| Score | Label | Color |
|---|---|---|
| 1–3 | Tourist Staple | `#6b7280` grey |
| 4–5 | Worth Knowing | `#3b82f6` blue |
| 6–7 | Hidden Gem | `#22c55e` green |
| 8–9 | Local Secret | `#f59e0b` amber |
| 10 | Off the Map | `#eab308` yellow |

### Map implementation notes

- Mapbox GL JS is dynamically imported (`import('mapbox-gl')`) to avoid SSR issues.
- React 18/19 strict-mode double-invokes effects in dev. A `cancelled` flag in the init effect prevents two Mapbox instances mounting in the same container.
- `map.resize()` must be called inside `requestAnimationFrame()` — calling it in the async import microtask races with flex layout settling.
- `hasFitRef.current` guards `fitBounds` so it fires only once per filter/style change, not on every streaming spot addition.
- `centerLat`/`centerLng` props must be passed explicitly from the trip page (derived from `selectedDest` or first geocoded spot) — no hardcoded city fallback.

### PWA / service worker

Service worker (`@ducanh2912/next-pwa`) is intentionally disabled — it conflicts with Next.js 16 Turbopack. The manifest.json and meta tags are in place. Re-enable via Serwist when needed. In dev, `DevSwKiller` component force-unregisters any lingering SW on each page load.

## Environment variables

```
OPENAI_API_KEY                          Server-only
NEXT_PUBLIC_MAPBOX_TOKEN                Client + server (geocoding in API route)
NEXT_PUBLIC_FIREBASE_API_KEY            Client
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
NEXT_PUBLIC_APP_URL
TEST_EMAIL / TEST_PASSWORD              Playwright tests only
```

## Path aliases

`@/` maps to `src/` (configured in `jsconfig.json`).
