# Venture — Full Handover Document

> **For:** Anyone taking over or onboarding to the Venture codebase  
> **Last updated:** June 2026  
> **Status:** Active development — local changes not yet committed

---

## 1. What Is Venture?

Venture is a **personalised travel itinerary planner** built as a Progressive Web App (PWA). It targets independent travellers who want to go beyond the tourist trail — the app's entire philosophy is built around surfacing *genuinely interesting* spots a city has to offer, not just the landmarks every guidebook covers.

The core loop is:

```
Research a city → Star the spots you like → AI generates a day-by-day plan → Manually adjust → Export to PDF
```

It is **not** a booking app. It doesn't integrate with hotels or flights. It's a planning and discovery tool — the equivalent of having a knowledgeable local friend build you an itinerary instead of copying one from TripAdvisor.

---

## 2. Who It's For

- Independent travellers planning city breaks of 2–7 days
- People who want a mix of well-known highlights and off-the-beaten-track spots
- Travellers who are staying in one accommodation base and may want to do day trips to nearby towns/areas
- Users who want a printable, shareable, day-structured plan they can actually walk off

---

## 3. The "Hiddenness" Score System

The single most important concept in the app. Every spot is rated 1–10 on a **hiddenness scale**:

| Score | Label | What It Means |
|-------|-------|---------------|
| 1–2 | **Tourist Trail** | Global icons — Big Ben, Eiffel Tower, Sagrada Família |
| 3–4 | **Well-Trodden** | Known locally, visited by informed travellers |
| 5–6 | **Worth a Detour** | On Reddit and niche travel blogs, not in guidebooks |
| 7–8 | **Local Secret** | Genuine local knowledge, rarely on tourist radar |
| 9–10 | **Off the Radar** | Requires insider knowledge to find |

This score is **assigned by the AI during research**, not by users. The AI scores each spot honestly based on how likely the average tourist is to know about it. Users can filter by score tier.

The score drives:
- The **colour** of every spot card (5 distinct tier colours)
- The **sort order** in the picker (higher scores surface first after starred spots)
- **Priority** during AI itinerary generation (higher scores preferred over tourist staples when filling non-starred slots)

---

## 4. How Research Works

### The Three-Pass System
When a user researches a city, the backend (`/api/research`) calls **GPT-4o-mini** three times in parallel, each focused on a different category cluster:

1. **Pass 1 — Popular/Iconic:** Famous landmarks, top museums, celebrated restaurants — the must-sees
2. **Pass 2 — Hidden/Local:** Bars, nightlife, food, music — the local circuit  
3. **Pass 3 — Nature/Outdoor:** Parks, viewpoints, outdoor spaces, architecture

This separation exists because a single prompt with all categories tends to produce unbalanced results — the model fills up on well-known spots before reaching the hidden ones.

### City-Scale Awareness
The prompt instructs the AI to be aware of city scale:
- Major world city (Bangkok, London, Paris…): 60–80 spots minimum per pass
- Large city (Amsterdam, Edinburgh, Prague…): 35–50 spots minimum
- Mid-size city (Porto, Tbilisi, Tallinn…): 20–35 spots minimum
- Small/niche destination: 10–20 spots minimum

The model is told *not* to pad — if it only genuinely knows 12 spots in a category for a small city, it returns 12.

### Quality Gate
After the AI returns spots, a `CONFIDENCE_THRESHOLD` of **0.4** filters out low-confidence entries. The AI itself scores each spot (`editorialConfidence: 0.0–1.0`) and spots below 0.4 are dropped before being sent to the client.

### Geocoding
After filtering, every spot is geocoded via **Mapbox** to get lat/lng coordinates. These are stored in Firestore and power the map view, travel time chips, and route optimisation.

### Recurring Events
A separate **Events pass** runs for all cities, looking for recurring weekly/monthly events (markets, open mics, jazz nights, etc.) using their own confidence scoring system.

### Caching
Spot data is cached in Firestore under `citySpots/{city}/spots/{id}`. A city is only re-researched if the user explicitly triggers it. This prevents redundant AI calls and means the second person planning a Bangkok trip gets instant results.

---

## 5. The Day Planner — How It Works

### Data Model
```
trips/{tripId}
  └─ destinations/{destId}         — one per city
       └─ dayPlans/{planId}        — one per calendar day
            └─ dayPlanSpots/{id}   — each placed spot (spotId, slot, sortOrder)
```

Each `dayPlanSpot` stores:
- `dayPlanId` — which day it belongs to
- `spotId` — reference to the city spot
- `timeOfDay` — `morning | afternoon | evening`
- `sortOrder` — integer for ordering within the slot

### The Three Slots
Every day is divided into three slots:
- **Morning** (08:00–12:00)
- **Afternoon** (12:00–18:00)
- **Evening** (18:00–late)

Each slot holds 1–3 spots. The UI shows them as stacked zones within each day card.

### Drag and Drop
Spots can be dragged between slots and between days. Built with **dnd-kit**. On desktop it's drag-and-drop; on mobile/touch it uses a tap-to-place flow (tap a spot to "pick it up", then tap a slot to drop it).

### Travel Time Chips
Between consecutive spots in the same day, the UI shows **travel time chips** (`~12 min walk` / `~8 min by transit`). These use the **haversine formula** (straight-line distance) with assumed speeds:
- Walking: 5 km/h (anything under 2 km)
- Transit: 30 km/h (anything over 2 km)

These are estimates, not live routing — they give a sense of scale, not a Google Maps promise.

### Route Optimisation Banner
When a day's spots are in a suboptimal order, the DaySection header shows a **"Better route saves Xkm"** banner with an Accept button. This uses a **nearest-neighbour algorithm** (O(n²), fine for 3–15 spots) starting from the accommodation to suggest a reordering. Accepting it writes the new order to Firestore and updates the UI instantly.

---

## 6. AI Itinerary Generation — Full Logic

This is the most complex part of the app. When the user hits **Generate**, the backend (`/api/generate-itinerary`) builds a structured prompt and calls GPT-4o-mini to assign spots to days and slots.

### Step 1 — Pre-filter by Opening Hours
Before the AI sees any spots, each spot is checked against each day's `planDate`. If a spot's `openingHours` says it's closed on that weekday, it's excluded from that day's consideration. This prevents the AI from ever assigning a spot to a day it can't be visited.

### Step 2 — Cap and Sort the Spot List
A maximum of **40 spots** is sent to the AI (token limit management). The list is built as:
1. All **starred spots** first (the user's personal saves — these are mandatory)
2. Remaining spots sorted by **hiddennessScore descending** (highest-quality, most interesting spots fill the rest of the budget)

This means if a user has starred 15 spots, those 15 are guaranteed in the prompt. The remaining 25 slots go to the highest-scoring unstarred spots.

### Step 3 — Geographic Clustering (Server-Side, Pre-AI)
This is the key fix for a major quality issue: without this, the AI would scatter distant spots across every day (e.g. planning a Kotor day-trip on Days 1, 2, and 3 instead of dedicating a single day to it).

**How it works:**

1. Compute haversine distance from each spot to the accommodation
2. Spots within **15 km** → "home-base" (can be visited any day)
3. Spots beyond 15 km → "distant"
4. Distant spots are greedily clustered: the furthest unassigned spot becomes a cluster centre, then any other distant spots within **12 km** of it join that cluster
5. Each cluster = one dedicated day-trip
6. If there are more clusters than available days, excess cluster spots are merged back into home-base

The AI then receives a hard constraint block listing every cluster by name with explicit rules:
- Each cluster occupies exactly ONE day
- Never split a cluster across multiple days
- Never assign spots from two different clusters to the same day
- Home-base spots fill the remaining days

### Step 4 — Prompt Construction
The final prompt includes:
- Accommodation location
- The cluster constraint block (if applicable)
- The starred spots block (mandatory — "include ALL of these")
- Full spot list with hiddenness scores, categories, opening hours, lat/lng
- Day summaries (day ID, day-of-week, available spot count)
- Slot definitions (morning/afternoon/evening hour ranges)
- Category rules (bars → evening only, cafés → morning only, museums → morning or afternoon)
- Opening hours rules (check the specific weekday, respect open/close times)
- Geography hint (cluster nearby spots within the same day)

Temperature is set to **0.4** (relatively low) to reduce creative hallucination and keep the AI focused on following the rules.

### Step 5 — Post-Processing
After the AI returns assignments:
1. **Validate** — drop any assignment missing `dayId`, `slot`, or `spotId`, or with an invalid slot value
2. **Deduplicate** — if the AI assigned a spot twice (rare but happens), keep only the first
3. **Slot fallback** — if the AI assigned a slot but the server-side `preferredSlot()` function disagrees (e.g. assigned a bar to morning), the AI's choice wins (it had full context)
4. **Write to Firestore** — each assignment is written as a `dayPlanSpot` document

### What the AI Is Good At
- Opening hours compliance (it reads the data and places spots on appropriate days)
- Slot placement (it follows the category rules for bars/cafés/museums)
- Starring respect (it almost always includes all starred spots)
- Balancing across days (spreading spots rather than front-loading Day 1)

### What the AI Is Not Great At
- **Pure geography** — without the clustering pre-processing step, it scatters distant spots badly
- **Very long trips** — with 7+ days and 40 spots, the prompt gets unwieldy and quality drops
- **Novelty** — it tends to put the highest-scored spots together even if geographically spread. The clustering step partially mitigates this.

---

## 7. The Map View

The map (`ItineraryMapView`) renders via **Mapbox GL JS**:
- Each day has its own coloured route line (dashed, day-coloured)
- Each spot is a numbered circle marker (numbered in visit order)
- Clicking a marker opens a popup with spot name, category, day/stop number
- The legend (bottom-left) lets you toggle individual days on/off or solo a day
- **When a day is soloed**, the left picker sidebar also filters to show only that day's spots — so you can see exactly what's planned for that day at a glance
- Accommodation is shown as a gold pin

---

## 8. The Picker / Starred List

The left panel shows either:
- **Starred mode** — only the spots the user has personally starred (saved)
- **All mode** — all researched spots for the city

Each spot card shows:
- Hiddenness score (coloured circle, tier colour)
- Category label
- Spot name
- **"✓ Day X · Slot" badge** — if the spot is already placed in the plan, this shows where
- Add button (opens a slot-selection sheet)

Spots can be filtered by category (multi-select chips) and minimum hiddenness score.

---

## 9. Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Styling | Inline CSS-in-JS + CSS variables |
| Database | Firebase Firestore |
| Auth | Firebase Auth |
| Maps | Mapbox GL JS |
| Drag & Drop | dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`) |
| AI (research) | GPT-4o-mini via OpenAI API |
| AI (itinerary) | GPT-4o-mini via OpenAI API |
| Geocoding | Mapbox Geocoding API |
| PDF export | Custom (`pdfExport.js`) |
| Hosting | Vercel (Hobby tier, 60s function timeout) |

---

## 10. Bug Fixes Made in This Session

### Bug 1 — Spot Duplication on Drag
**Problem:** Dragging a spot within the same day (e.g. Morning → Afternoon) created duplicates. Every subsequent drag added another copy.

**Root cause:** A JavaScript object literal key collision in the `onDragOver` handler. When moving within the same day, two separate `[srcDayId]` keys were spread into one object — JS silently discards the first, so the source slot's spot was never removed. The result: one removal that didn't happen + one addition that did = growing duplicate count.

**Fix:** Unified same-day moves into a single `[srcDayId]` key that atomically removes from the source slot AND adds to the target slot in one operation.

---

### Bug 2 — "Accept" (Route Suggestion Banner) Does Nothing
**Problem:** Clicking the Accept button on the "Better route saves Xkm" banner would write to Firestore correctly but the UI would not update — the order appeared unchanged until a hard reload.

**Root cause:** The `applyOrder` function in `DaySection` updated Firestore but never pushed the reordered slot state back up to `DaysBuilder`. The React state (`allSlots_`) stayed stale.

**Fix:** Added an `onApplyOrder(dayId, newSlots)` callback. After Firestore is updated, `DaySection` calls this, which calls `setAllSlots(prev => ({ ...prev, [dayId]: newSlots }))` in DaysBuilder — the UI updates immediately.

---

### Bug 3a — Map Shows Only 2–3 of 7–9 Spots
**Problem:** The itinerary map view consistently only drew 2–3 markers even when 7–9 spots were planned.

**Root cause:** Multiple failure modes:
1. Source/layer cleanup wasn't wrapped in try-catch — one error during cleanup aborted all subsequent drawing for that render
2. `addSource()` was called on sources that survived cleanup, throwing "source already exists" and aborting the day's drawing
3. Spot coordinates stored as strings in some Firestore documents — Mapbox silently dropped these markers
4. One spot had `null` lat/lng — `Number(null) = 0` placed its marker silently in the Atlantic (coordinate 0,0)

**Fix:** 
- Wrapped all cleanup in per-entry try-catch
- Used `setData()` if a source already exists, otherwise `addSource()`/`addLayer()`
- Added `Number()` coercion + explicit null guard (`if (!lng || !lat) skip`) before marker creation
- Isolated each marker in its own try-catch so one bad spot doesn't abort the rest

---

### Bug 3b — Planner Ignores Accommodation Anchor
**Problem:** When generating an itinerary, the AI scattered geographically distant spots across all days. A "Kotor day-trip" (60km from base) would appear on Days 1, 2, 3, and 4 instead of being consolidated into one dedicated day.

**Root cause:** Accommodation was only a soft text hint to the AI ("The traveller is staying at X"). The AI balanced other constraints (opening hours, day spread, variety) and routinely ignored geographic clustering.

**Fix:** Server-side geographic clustering before the AI runs. The `buildSpotClusters()` function:
- Separates spots into home-base (within 15km of accommodation) and distant
- Greedily clusters distant spots: furthest spot becomes a centre, nearby spots within 12km join it
- Caps clusters to `(totalDays - 1)` so there's always at least one home-base day
- Injects a mandatory cluster constraint block into the AI prompt naming every cluster and enforcing hard rules (each cluster gets exactly one day, never split, never mix two clusters on the same day)

---

### Bug 4 — Dead "+" Button on Occupied Slots
**Problem:** The "+" button to add a spot to a slot that already had spots was effectively unusable — it was a 20×20px circle in the slot header with no secondary tap target. Users couldn't easily hit it, especially on mobile.

**Fix:**
1. Made the entire empty-slot dashed area clickable (tapping anywhere in an empty slot now opens the quick-add sheet)
2. Added a full-width "+ add a spot" button below the placed spots in every non-empty slot — an easy-to-tap secondary entry point
3. Updated the empty-state prompt text from "Tap + to add, or drag here" to "Tap to add a spot" (accurate now that the whole zone is tappable)

---

### Feature 1 — Starred List Placement Indicator
**Previously:** Starred spots that were already in the plan showed as dimmed with a `✓` prefix — but there was no indication of *where* in the plan they were placed.

**Added:** A small colour-coded badge below the spot name reading `✓ Day 2 · Afternoon`, using the spot's own tier colour. This tells users at a glance whether a saved spot has been scheduled, and exactly where, without having to switch to the planner and hunt.

---

### Bonus Fix — Map 12 Errors in Dev Overlay
**Problem:** Every time the map view was opened, 12 console errors fired: `The layer 'itin-route-line-{dayId}' does not exist`. These were counted by Next.js's dev overlay as issues.

**Root cause:** The `toggleDay` function called `map.setLayoutProperty()` on route line layers for ALL days, including days with 0–1 spots — those days never had a route line added (you need ≥2 points for a LineString), so the layer didn't exist.

**Fix:** Added a `map.getLayer(layerId)` existence check before calling `setLayoutProperty`. If the layer doesn't exist (day has 0–1 spots), skip the call entirely.

---

### New Feature — Map Day Filter Syncs the Sidebar
**Added:** When the user solos a day on the map (e.g. clicks "Day 1" in the legend), the left picker panel now automatically filters to show only the spots placed in that day. An amber banner appears: "🗺 Showing Day 1 only — Click day again to reset". Clicking the day again (or "Show all") restores the full list. Switching back to List view clears the filter.

---

## 11. Known Limitations & Future Work

| Issue | Notes |
|-------|-------|
| **AI temperature at 0.4** | Keeps outputs consistent but can feel repetitive across cities. Consider 0.5–0.6 for more variety. |
| **40-spot cap** | Works well for 3–5 day trips. For longer trips, the AI has less to work with. Consider raising to 60 with selective trimming. |
| **Haversine travel times** | Straight-line only — doesn't account for rivers, one-way streets, public transit routes. Good for planning, not navigation. |
| **No live data** | Opening hours are AI-generated at research time. They can become stale. No live closure/hours updates. |
| **Cluster radii are fixed** | 15km home / 12km cluster works well for most trips. May be too tight for very rural areas, too loose for dense city centres. Could be made configurable. |
| **Single accommodation** | The app assumes one base for the whole trip. Multi-base trips (e.g. 3 nights in Rome, 2 nights in Florence) aren't modelled yet. |
| **Geocoding failures** | Some spots from the AI research have null lat/lng if Mapbox couldn't geocode their address. These spots are excluded from the map and travel time calculations silently. |

---

## 12. Files Changed in This Session

| File | Changes |
|------|---------|
| `src/components/DaysBuilder.jsx` | Bug 1 (drag dedup), Bug 2 (Accept callback), Bug 4 (+ button), Feature 1 (placement badge), Map day filter sync |
| `src/components/ItineraryMapView.jsx` | Bug 3a (marker null guard, setData, try-catch), 12-error fix (getLayer guard), day filter callback |
| `src/app/api/generate-itinerary/route.js` | Bug 3b (haversine + buildSpotClusters + prompt injection) |
| `src/lib/db.js` | Bug 2 (updateDayPlanSpotSlot accepts optional dayPlanId) |

> **None of these changes have been committed.** The dev server is running at `http://localhost:3000`. Test, then commit.
