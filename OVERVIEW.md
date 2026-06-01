 Venture — App Overview & Developer Guide

## What is Venture?

Venture is a **PWA (Progressive Web App) travel planner** built around a single idea: most travel apps show you the same 10 famous landmarks every tourist already knows. Venture does the opposite.

It uses AI to research a city and surface **hidden gems** — the places locals go, the bars not on TripAdvisor, the viewpoints you only find if someone tells you. Every spot is scored on a **hiddenness scale of 1–10**:

| Score | Label | What it means |
|---|---|---|
| 1–3 | Tourist Staple | Famous, crowded, on every itinerary |
| 4–5 | Worth Knowing | Known to informed travellers |
| 6–7 | Hidden Gem | On niche blogs and expat forums |
| 8–9 | Local Secret | Rarely on the tourist radar |
| 10 | Off the Map | Requires insider knowledge to find |

### What a user does

1. **Create a trip** — pick a city (or multiple cities), travel dates, and interests (food, art, nightlife, hiking, etc.)
2. **Research** — Venture calls OpenAI to generate 20 curated spots, then geocodes every one via Mapbox so pins land at street level on the map
3. **Explore** — browse spots in a list or on an interactive map, filter by interest/hiddenness, open a detail drawer with opening hours, entry price, insider tips, and a "why tourists miss it" explanation
4. **Plan days** — drag spots into a day-by-day itinerary (morning / afternoon / evening slots), with automatic cost tallying
5. **City Pass** — see whether a city pass saves money based on the spots you've chosen
6. **Share** — make a trip public and share the link; others can view the full itinerary without logging in

---

## CLAUDE.md — Developer Reference

This is the guidance file for Claude Code when working in this repository.

---

### Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build
npm run start        # Serve the production build

# Tests — requires dev server already running
npx playwright test                                              # All tests
npx playwright test tests/map.spec.js                           # Single file
npx playwright test tests/map.spec.js --grep "pin accuracy"     # Single test by name

# One-time Firestore spot cache clear (run after geocoding fixes)
cd functions && GOOGLE_CLOUD_PROJECT=<your-project-id> node ../scripts/clearCitySpots.mjs
```

> Tests are fully sequential (1 worker, no parallelism). `qa.spec.js` must run before `map.spec.js` — the QA suite creates the Lisbon trip that map tests depend on. Credentials come from `.env.local` as `TEST_EMAIL` / `TEST_PASSWORD`.

---

### How the Research Pipeline Works

This is the most important flow in the codebase — understanding it explains almost everything else.

```
User clicks "Research"
  └─ runResearch()              [src/lib/functions.js]
       ├─ Check citySpots/{city}/spots in Firestore
       │    └─ Cache hit? Return immediately (no API call)
       └─ Cache miss → POST /api/research
            ├─ OpenAI gpt-4o-mini → JSON of 20 spots
            ├─ Strip any AI-generated lat/lng (coordinates come from Mapbox only)
            ├─ getCityCenter() → Mapbox → city center + ISO country code
            ├─ geocodeSpot() × 20  (sequential, 9 fallback strategies each)
            │    └─ Spots that fail all 9 strategies are skipped entirely
            ├─ SSE stream → client receives: status | spot | error | done
            ├─ cacheSpots() → Firestore writeBatch
            └─ markResearchDone() → destinations/{id}.researchDone = true
```

**Critical rule:** Never use `place` as a Mapbox geocoding type. It returns the city itself when a POI lookup fails, causing all unresolved spots to stack on a single pin.

---

### Firestore Data Model

```
users/{uid}                          Profile, currency preference, interests
trips/{tripId}                       userId, name, isMultiCity, firstStartDate
destinations/{destId}                tripId, userId, city, dates, researchDone
citySpots/{city}/spots/{spotId}      Geocoded spot cache — never expires, city-scoped
dayPlans/{planId}                    destinationId, userId, dayNumber, planDate
dayPlanSpots/{id}                    dayPlanId, spotId, timeOfDay, sortOrder
users/{uid}/savedSpots/{spotId}      Lightweight spot stubs
users/{uid}/spotNotes/{spotId}       { note, visited }
cityPasses/{city}                    Manually-seeded day-pass data
cityTemplates/{city}/templates/{id}  Community itinerary templates
spotReviews/{spotId}/reviews/{uid}   Individual star reviews
spotReviews/{spotId}                 Aggregate { avgRating, count }
```

> **Firestore security rules require `userId` in every query** on protected collections (trips, destinations, dayPlans). Always include `where('userId', '==', userId)` or the query will be rejected server-side.

> Always use `getDocsFromServer()` (not `getDocs()`) when reading `citySpots` — IndexedDB offline cache can return stale/broken coordinates from previous research runs.

---

### Key Files

| File | Responsibility |
|---|---|
| `src/lib/db.js` | **All Firestore CRUD.** Never write Firestore calls anywhere else. |
| `src/lib/functions.js` | `runResearch()` — sole entry point for AI research. Handles cache, SSE, Firestore write. |
| `src/app/api/research/route.js` | SSE API route. Calls OpenAI → Mapbox. `geocodeSpot()` has 9 fallback strategies. |
| `src/lib/firebase.js` | Firebase singleton with offline persistence. Guards against SSR. |
| `src/components/MapView.jsx` | Mapbox GL JS map with DOM-based markers (not GL layers). |
| `src/constants/hiddenness.js` | Score→colour/label mapping. Use `getHiddennessLevel(score)` everywhere. |
| `src/constants/interests.js` | 10 interest categories used in AI prompt and UI filters. |

---

### Auth Pattern

`useAuth()` returns `{ user, loading, authReady }`.

- `user` is always `undefined` on first render (SSR-safe), then `null` or a Firebase user object
- `authReady` becomes `true` only after Firebase has confirmed the session — **gate Firestore writes on `authReady`**, not just `user`
- A `localStorage` UID seed makes repeat visits feel instant; `user` may briefly be `{ uid, _cached: true }` before Firebase resolves

---

### Map Implementation Notes

- Mapbox GL JS is **dynamically imported** (`import('mapbox-gl')`) to avoid SSR crashes
- React 19 strict-mode double-invokes effects in dev — a `cancelled` flag prevents two Mapbox instances mounting in the same container
- `map.resize()` must always be called inside `requestAnimationFrame()` — calling it in the async import microtask races with flex layout
- `hasFitRef.current` prevents `fitBounds` from firing on every streaming spot addition; it resets only on filter or style changes
- `centerLat` / `centerLng` must be passed explicitly from the trip page (derived from the destination or first geocoded spot)
- `window.ventureMap` and `window.ventureMapMarkers` are exposed for Playwright test assertions

---

### PWA / Service Worker

The service worker package (`@ducanh2912/next-pwa`) is **intentionally disabled** — it conflicts with Next.js 16's Turbopack bundler. `manifest.json` and all PWA meta tags are in place. Re-enable via Serwist when the bundler conflict is resolved. In dev, `DevSwKiller` force-unregisters any lingering SW on every page load.

---

### Environment Variables

```
OPENAI_API_KEY                           Server-only (API route)
NEXT_PUBLIC_MAPBOX_TOKEN                 Client + server (geocoding in API route)
NEXT_PUBLIC_FIREBASE_API_KEY             Client
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
NEXT_PUBLIC_APP_URL
TEST_EMAIL / TEST_PASSWORD               Playwright tests only (.env.local)
```

### Path Aliases

`@/` resolves to `src/` — configured in `jsconfig.json`.

---

*Stack: Next.js 16 · React 19 · Firebase Auth + Firestore · Mapbox GL JS · OpenAI gpt-4o-mini · Playwright · Vercel Analytics*
