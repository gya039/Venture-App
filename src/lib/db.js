// src/lib/db.js
// Firestore CRUD helpers for Venture.
//
// Data model (all collections are top-level for easy querying):
//
//   users/{uid}                    — profile + default interests
//   trips/{tripId}                 — one per trip, userId + firstStartDate for sorting
//   destinations/{destId}          — one per city in a trip, links to tripId
//   citySpots/{city}/spots/{id}    — AI-researched spots, cached forever per city
//   dayPlans/{planId}              — one per trip day, links to destinationId
//   dayPlanSpots/{id}              — spots in a day plan
//   cityPasses/{city}              — curated day-pass data (seeded manually)
//   cityEvents/{city}/events/{id} — recurring events (Glasgow-only for now)

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import { normaliseCategory } from './categories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Firestore Timestamp (or plain Date/string) to an ISO date string */
function toISO(val) {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return val; // already a string
}

/** Convert an ISO date string to a Firestore Timestamp */
function toTimestamp(iso) {
  return Timestamp.fromDate(new Date(iso));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Upsert a user document on first sign-in.
 * Safe to call on every sign-in (no-op if doc already exists).
 */
export async function upsertUser(uid, email, displayName = null) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email,
      displayName: displayName ?? null,
      currency: 'GBP',
      interests: [],
      createdAt: serverTimestamp(),
    });
  } else if (displayName && snap.data().displayName !== displayName) {
    // Keep displayName in sync when the user updates their Google/Auth profile
    await updateDoc(ref, { displayName });
  }
}

export async function getUser(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateUserPrefs(uid, prefs) {
  await updateDoc(doc(db, 'users', uid), prefs);
}

// ---------------------------------------------------------------------------
// Trips (with destinations, assembled into the UI shape)
// ---------------------------------------------------------------------------

/**
 * Assemble trips + destinations into the shape the UI expects.
 * Accepts a pre-fetched destinations map (tripId → dest[]) to avoid N+1 queries.
 */
function assembleTripsSync(tripDocs, destsByTripId) {
  return tripDocs.map((tripSnap) => {
    const trip = { id: tripSnap.id, ...tripSnap.data() };
    const destinations = (destsByTripId[trip.id] ?? [])
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return {
      id:               trip.id,
      userId:           trip.userId ?? null,          // owner uid (needed for collab queries)
      name:             trip.name ?? null,
      isMultiCity:      trip.isMultiCity ?? false,
      interests:        trip.interests ?? [],
      coverPhoto:       trip.coverPhoto ?? null,
      createdAt:        toISO(trip.createdAt),
      accommodation:    trip.accommodation ?? null,   // { address, lat, lng } | null
      isPublic:         trip.isPublic ?? false,
      shareToken:       trip.shareToken ?? null,
      collaboratorUids: trip.collaboratorUids ?? [],
      collaborators:    trip.collaborators ?? [],
      destinations,
    };
  });
}

/**
 * Fetch destinations for a known list of tripIds in ONE query.
 * userId MUST be provided — Firestore security rules require the query
 * to include a userId filter so it only returns documents the user can read.
 * Returns a map of { tripId: [dest, ...] }
 */
async function fetchDestsForTrips(tripIds, userId) {
  if (!tripIds.length) return {};
  // Firestore 'in' supports up to 30 values; chunk if needed
  const chunks = [];
  for (let i = 0; i < tripIds.length; i += 30) chunks.push(tripIds.slice(i, i + 30));

  const map = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(
        collection(db, 'destinations'),
        where('tripId', 'in', chunk),
        where('userId', '==', userId),   // required: aligns with security rule
      );
      const snaps = await getDocs(q);
      snaps.docs.forEach((d) => {
        const data = d.data();
        const dest = {
          id: d.id, ...data,
          startDate: toISO(data.startDate),
          endDate:   toISO(data.endDate),
        };
        if (!map[data.tripId]) map[data.tripId] = [];
        map[data.tripId].push(dest);
      });
    })
  );
  return map;
}

/**
 * Fetch a single trip by ID (with its destinations assembled).
 */
export async function getTrip(tripId) {
  const snap = await getDoc(doc(db, 'trips', tripId));
  if (!snap.exists()) return null;
  const userId = snap.data().userId;           // needed for security-rule-aligned query
  const destsMap = await fetchDestsForTrips([tripId], userId);
  return assembleTripsSync([snap], destsMap)[0];
}

/**
 * One-time fetch of all trips for a user (sorted soonest first).
 * Uses 2 Firestore queries total instead of N+1.
 */
export async function getTrips(userId) {
  const q = query(
    collection(db, 'trips'),
    where('userId', '==', userId),
    orderBy('firstStartDate', 'asc')
  );
  const snaps = await getDocs(q);
  const tripIds = snaps.docs.map((d) => d.id);
  const destsMap = await fetchDestsForTrips(tripIds, userId);
  return assembleTripsSync(snaps.docs, destsMap);
}

/**
 * Real-time listener — calls onUpdate(trips[]) whenever trips change.
 * Uses 2 Firestore queries total instead of N+1.
 * Returns the unsubscribe function.
 */
export function listenTrips(userId, onUpdate, onError) {
  const q = query(
    collection(db, 'trips'),
    where('userId', '==', userId),
    orderBy('firstStartDate', 'asc')
  );
  return onSnapshot(
    q,
    async (snap) => {
      try {
        const tripIds = snap.docs.map((d) => d.id);
        const destsMap = await fetchDestsForTrips(tripIds, userId);
        onUpdate(assembleTripsSync(snap.docs, destsMap));
      } catch (err) {
        onError?.(err);
      }
    },
    onError
  );
}

/**
 * Create a trip + its destinations in one batch.
 *
 * destinations: [{
 *   city, country, countryCode,
 *   startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'
 * }]
 */
async function fetchCityPhoto(cityName) {
  try {
    const key = process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY;
    if (!key) return null;
    const r = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(cityName + ' city')}&per_page=1&orientation=landscape&client_id=${key}`
    );
    const d = await r.json();
    return d.results?.[0]?.urls?.regular ?? null;
  } catch { return null; }
}

export async function createTrip({ userId, name, isMultiCity, interests, destinations }) {
  const batch = writeBatch(db);

  const coverPhoto = await fetchCityPhoto(destinations[0].city);

  // Trip doc
  const tripRef = doc(collection(db, 'trips'));
  const firstStartDate = toTimestamp(destinations[0].startDate);
  batch.set(tripRef, {
    userId,
    name:        name ?? null,
    isMultiCity: isMultiCity ?? false,
    interests:   interests ?? [],
    firstStartDate,
    coverPhoto:  coverPhoto ?? null,
    createdAt:   serverTimestamp(),
  });

  // Destination docs
  const destIds = [];
  destinations.forEach((dest, i) => {
    const destRef = doc(collection(db, 'destinations'));
    destIds.push(destRef.id);
    batch.set(destRef, {
      tripId:       tripRef.id,
      userId,
      city:         dest.city,
      country:      dest.country ?? null,
      countryCode:  dest.countryCode ?? null,
      startDate:    toTimestamp(dest.startDate),
      endDate:      toTimestamp(dest.endDate),
      sortOrder:    i,
      researchDone: false,
      researchAt:   null,
    });
  });

  await batch.commit();
  return { tripId: tripRef.id, destIds };
}

export async function deleteTrip(tripId) {
  // Delete destinations first
  const q = query(collection(db, 'destinations'), where('tripId', '==', tripId));
  const snaps = await getDocs(q);
  const batch = writeBatch(db);
  snaps.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'trips', tripId));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Spots (city-level cache)
// ---------------------------------------------------------------------------

/** Returns all cached spots for a city, sorted by hiddenness desc.
 *  Merges with static seed data when Firestore has fewer than 5 spots. */
export async function getCachedSpots(city) {
  city = city.toLowerCase();
  const { getStaticSpots } = await import('@/data/citySpots');

  const q = query(
    collection(db, 'citySpots', city, 'spots'),
    orderBy('hiddennessScore', 'desc')
  );
  // Bypass the local IndexedDB cache so we always read the current server state.
  const snaps = await getDocsFromServer(q);
  // Normalise category on read so existing Firestore data (slash-pairs, legacy
  // values) comes out canonical without requiring a data migration.
  const firestoreSpots = snaps.docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, category: normaliseCategory(data.category) };
  });

  const staticSpots = getStaticSpots(city);
  if (staticSpots.length === 0) return firestoreSpots;

  // If Firestore has a good set already, return it as-is
  if (firestoreSpots.length >= 5) {
    // Append any static spots whose name isn't already in Firestore
    const firestoreNames = new Set(firestoreSpots.map((s) => s.name?.toLowerCase()));
    const newStatic = staticSpots.filter((s) => !firestoreNames.has(s.name?.toLowerCase()));
    return [...firestoreSpots, ...newStatic].sort((a, b) => (b.hiddennessScore ?? 0) - (a.hiddennessScore ?? 0));
  }

  // Firestore thin/empty — return static data (plus whatever Firestore has)
  const staticNames = new Set(staticSpots.map((s) => s.name?.toLowerCase()));
  const extra = firestoreSpots.filter((s) => !staticNames.has(s.name?.toLowerCase()));
  return [...staticSpots, ...extra].sort((a, b) => (b.hiddennessScore ?? 0) - (a.hiddennessScore ?? 0));
}

/** Writes spot objects into the citySpots/{city}/spots collection.
 *
 *  force=false (default): additive — only writes spots whose names are not
 *    already present in Firestore, preserving existing cached research.
 *  force=true: destructive — deletes all existing spots first, then writes
 *    the full incoming array (used on explicit "Refresh" re-research). */
export async function cacheSpots(city, spots, force = false) {
  city = city.toLowerCase();
  const spotsRef = collection(db, 'citySpots', city, 'spots');

  let spotsToWrite = spots;
  if (!force) {
    // Additive: read existing names, skip spots already present
    const existingSnaps = await getDocsFromServer(spotsRef);
    const existingNames = new Set(
      existingSnaps.docs.map((d) => (d.data().name ?? '').toLowerCase().trim())
    );
    spotsToWrite = spots.filter(
      (s) => !existingNames.has((s.name ?? '').toLowerCase().trim())
    );
    if (spotsToWrite.length === 0) return 0;
  } else {
    // Destructive: remove all existing spots before writing the new set.
    // Use getDocsFromServer to bypass IndexedDB so stale server docs are visible.
    const oldSnaps = await getDocsFromServer(spotsRef);
    if (oldSnaps.docs.length > 0) {
      const delBatch = writeBatch(db);
      oldSnaps.docs.forEach((d) => delBatch.delete(d.ref));
      await delBatch.commit();
    }
  }

  // Write spots — supports both camelCase (new API) and legacy snake_case fields
  const batch = writeBatch(db);
  spotsToWrite.forEach((spot) => {
    const ref = doc(spotsRef);
    batch.set(ref, {
      city,
      name:                 spot.name,
      description:          spot.description ?? null,
      whyHidden:            spot.whyHidden            ?? spot.why_hidden          ?? null,
      hiddennessReason:     spot.hiddennessReason      ?? null,
      hiddennessScore:      spot.hiddennessScore       ?? spot.hiddenness_score   ?? 1,
      hiddennessLabel:      spot.hiddennessLabel       ?? spot.hiddenness_label   ?? null,
      category:             spot.category              ?? null,
      interests:            spot.interests             ?? [],
      entryPrice:           spot.entryPrice            ?? spot.entry_price        ?? null,
      passIncluded:         spot.passIncluded          ?? false,
      currency:             spot.currency              ?? 'EUR',
      closureStatus:        spot.closureStatus         ?? 'open',
      openingHours:         spot.openingHours          ?? null,
      bestTimeToVisit:      spot.bestTimeToVisit       ?? null,
      visitDurationMinutes: spot.visitDurationMinutes  ?? null,
      address:              spot.address               ?? null,
      neighbourhood:        spot.neighbourhood         ?? null,
      lat:                  spot.lat      ?? spot.latitude  ?? null,
      lng:                  spot.lng      ?? spot.longitude ?? null,
      coordsMissing:        spot.coordsMissing         ?? false,
      geocodeSource:        spot.geocodeSource         ?? null,
      tips:                 spot.tips                  ?? [],
      avoid:                spot.avoid                 ?? null,
      nearbySpots:          spot.nearbySpots           ?? [],
      createdAt:            serverTimestamp(),
    });
  });
  await batch.commit();

  return spotsToWrite.length;
}

/** Save (or clear) the accommodation address + geocoords for a trip */
export async function updateTripAccommodation(tripId, accommodation) {
  // accommodation: { address, lat, lng } or null to clear
  await updateDoc(doc(db, 'trips', tripId), { accommodation: accommodation ?? null });
}

/** Mark a destination as research-complete */
export async function markResearchDone(destinationId) {
  await updateDoc(doc(db, 'destinations', destinationId), {
    researchDone: true,
    researchAt:   serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Destination + spots (for Trip Detail screen)
// ---------------------------------------------------------------------------

export async function getDestinationWithSpots(destinationId) {
  const destSnap = await getDoc(doc(db, 'destinations', destinationId));
  if (!destSnap.exists()) return null;

  const dest = { id: destSnap.id, ...destSnap.data() };
  dest.startDate = toISO(dest.startDate);
  dest.endDate   = toISO(dest.endDate);

  const spots = await getCachedSpots(dest.city);
  return { destination: dest, spots };
}

/**
 * Fetch a single spot from the city cache.
 */
export async function getSpot(city, spotId) {
  city = city.toLowerCase();
  const snap = await getDoc(doc(db, 'citySpots', city, 'spots', spotId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------------------------------------------------------------------------
// Day Plans
// ---------------------------------------------------------------------------

export async function getDayPlans(destinationId, _userId) {
  // dayPlans have `allow read: if true` — no userId filter required.
  // _userId is kept in the signature for backwards compatibility but is not used.
  const q = query(
    collection(db, 'dayPlans'),
    where('destinationId', '==', destinationId),
    orderBy('dayNumber', 'asc')
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    planDate: toISO(d.data().planDate),
  }));
}

/** Auto-generate day plan docs for every day in a destination's date range */
export async function generateDayPlans(destinationId, userId, tripId, startDate, endDate) {
  const start  = new Date(startDate);
  const end    = new Date(endDate);
  const batch  = writeBatch(db);
  let dayNum   = 1;

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const ref = doc(collection(db, 'dayPlans'));
    batch.set(ref, {
      destinationId,
      tripId,
      userId,
      planDate:  Timestamp.fromDate(new Date(d)),
      dayNumber: dayNum++,
    });
  }
  await batch.commit();
}

export async function addSpotToDayPlan(dayPlanId, spotId, spotCity, timeOfDay = 'morning') {
  // Use server-side read to bypass IndexedDB cache — prevents race-condition duplicates
  // when the user clicks + rapidly or the same spot is dropped multiple times.
  const allSnap = await getDocsFromServer(
    query(collection(db, 'dayPlanSpots'), where('dayPlanId', '==', dayPlanId))
  );
  // Idempotency: skip if this spot is already anywhere in this day plan
  // (same spot in different slots = duplicates — never intentional)
  const alreadyExists = allSnap.docs.some(d => d.data().spotId === spotId);
  if (alreadyExists) return;

  await addDoc(collection(db, 'dayPlanSpots'), {
    dayPlanId,
    spotId,
    spotCity,
    timeOfDay,
    sortOrder: allSnap.size,
  });
}

export async function getDayPlanSpots(dayPlanId) {
  const q = query(
    collection(db, 'dayPlanSpots'),
    where('dayPlanId', '==', dayPlanId),
    orderBy('sortOrder', 'asc')
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Update the time-of-day slot and sort order for a day plan spot (used by dnd-kit drag) */
export async function updateDayPlanSpotSlot(id, timeOfDay, sortOrder) {
  await updateDoc(doc(db, 'dayPlanSpots', id), { timeOfDay, sortOrder });
}

/** Remove a spot from a day plan */
export async function removeDayPlanSpot(dayPlanSpotId) {
  await deleteDoc(doc(db, 'dayPlanSpots', dayPlanSpotId));
}

/** Returns unique cities the user has researched, sorted newest first */
export async function getResearchedCities(userId) {
  const q = query(
    collection(db, 'destinations'),
    where('userId', '==', userId),
    where('researchDone', '==', true),
  );
  const snaps = await getDocs(q);
  // Deduplicate by city name, keep latest researchAt
  const map = {};
  snaps.docs.forEach((d) => {
    const { city, researchAt } = d.data();
    if (!city) return;
    const ts = researchAt?.toMillis?.() ?? 0;
    if (!map[city] || ts > map[city].ts) {
      map[city] = { city, ts };
    }
  });
  return Object.values(map).sort((a, b) => b.ts - a.ts).map((r) => r.city);
}

/** Remove all cached spots for a city (triggers re-research next visit) */
export async function clearCityCache(city) {
  city = city.toLowerCase();
  const snaps = await getDocs(collection(db, 'citySpots', city, 'spots'));
  if (!snaps.docs.length) return 0;
  const batch = writeBatch(db);
  snaps.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snaps.docs.length;
}

// ---------------------------------------------------------------------------
// Deep spot cache — cityDeepSpots/{cacheId}/spots/{id}
// Stored separately from the curated cache so they never mix.
// ---------------------------------------------------------------------------

/** Stable Firestore doc ID for a city+category pair */
function deepCacheId(city, category) {
  const c = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return `${c(city)}__${c(category)}`;
}

export async function getCachedDeepSpots(city, category) {
  const cid  = deepCacheId(city, category);
  const snap = await getDocs(collection(db, 'cityDeepSpots', cid, 'spots'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function cacheDeepSpots(city, category, spots) {
  const cid   = deepCacheId(city, category);
  const colRef = collection(db, 'cityDeepSpots', cid, 'spots');
  // Write in batches of 500 (Firestore limit)
  const BATCH_SIZE = 500;
  for (let i = 0; i < spots.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    spots.slice(i, i + BATCH_SIZE).forEach((spot) => {
      batch.set(doc(colRef), { ...spot, city, deepCategory: category, cachedAt: new Date().toISOString() });
    });
    // Write the parent metadata doc on the first batch
    if (i === 0) {
      batch.set(doc(db, 'cityDeepSpots', cid), { city, category, cachedAt: new Date().toISOString() });
    }
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Popular Spots — cityPopularSpots/{city}/spots/{id}
// Stored separately from hidden gems so we never mix the two lists.
// ---------------------------------------------------------------------------

export async function getCachedPopularSpots(city) {
  const snap = await getDocs(collection(db, 'cityPopularSpots', city.toLowerCase(), 'spots'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function cachePopularSpots(city, spots) {
  const cid    = city.toLowerCase();
  const colRef = collection(db, 'cityPopularSpots', cid, 'spots');
  const BATCH  = 500;
  for (let i = 0; i < spots.length; i += BATCH) {
    const batch = writeBatch(db);
    spots.slice(i, i + BATCH).forEach((spot) => {
      batch.set(doc(colRef), { ...spot, city, cachedAt: new Date().toISOString() });
    });
    if (i === 0) {
      batch.set(doc(db, 'cityPopularSpots', cid), { city, count: spots.length, cachedAt: new Date().toISOString() });
    }
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// City Events (recurring events, Glasgow-gated) — cityEvents/{city}/events/{id}
// ---------------------------------------------------------------------------

/** Events research is now enabled for all cities */
export const isEventsCity = (_city) => true;

export async function getCityEvents(city) {
  const snap = await getDocs(collection(db, 'cityEvents', city.toLowerCase(), 'events'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function cacheCityEvents(city, events) {
  const cid    = city.toLowerCase();
  const colRef = collection(db, 'cityEvents', cid, 'events');
  const BATCH  = 500;
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = writeBatch(db);
    events.slice(i, i + BATCH).forEach((ev) => {
      batch.set(doc(colRef), { ...ev, city, cachedAt: new Date().toISOString() });
    });
    if (i === 0) {
      batch.set(doc(db, 'cityEvents', cid), { city, count: events.length, cachedAt: new Date().toISOString() });
    }
    await batch.commit();
  }
}

/**
 * Add a recurring event to a day plan slot.
 * Events store all data inline (no spotId reference) so the planner can
 * display them without a second lookup into citySpots.
 */
export async function addEventToDayPlan(dayPlanId, event, city, timeOfDay) {
  return addDoc(collection(db, 'dayPlanSpots'), {
    dayPlanId,
    spotId:               null,       // events have no citySpots entry
    isEvent:              true,
    name:                 event.name,
    venue:                event.venue ?? null,
    description:          event.description ?? null,
    category:             event.category ?? 'other',
    recurrence:           event.recurrence ?? 'weekly',
    day:                  event.day ?? null,
    time:                 event.time ?? null,
    confidence:           event.confidence ?? 0.5,
    sourceHint:           event.sourceHint ?? null,
    hiddennessScore:      event.hiddennessScore ?? 5,
    entryPrice:           event.entryPrice ?? 0,
    visitDurationMinutes: event.visitDurationMinutes ?? null,
    lat:                  event.lat ?? null,
    lng:                  event.lng ?? null,
    city,
    timeOfDay,
    sortOrder:            Date.now(),
    createdAt:            serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// City Passes — served from the local constants file (no Firestore round-trip)
// ---------------------------------------------------------------------------

import { getCityPass as _getCityPassFromConstants } from '@/constants/cityPasses';
export async function getCityPass(city) {
  return _getCityPassFromConstants(city) ?? null;
}

// ---------------------------------------------------------------------------
// Saved Spots (users/{uid}/savedSpots/{spotId})
// ---------------------------------------------------------------------------

/** Returns all saved spot stubs for a user */
export async function getSavedSpots(userId) {
  const q = query(collection(db, 'users', userId, 'savedSpots'));
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Save a spot to the user's collection */
export async function saveSpot(userId, spot) {
  if (!spot?.id) return;
  await setDoc(doc(db, 'users', userId, 'savedSpots', spot.id), {
    spotId:          spot.id,
    city:            spot.city ?? null,
    name:            spot.name ?? null,
    hiddennessScore: spot.hiddennessScore ?? 1,
    category:        spot.category ?? null,
    interests:       spot.interests ?? [],
    savedAt:         serverTimestamp(),
  });
}

/** Remove a spot from the user's saved collection */
export async function unsaveSpot(userId, spotId) {
  await deleteDoc(doc(db, 'users', userId, 'savedSpots', spotId));
}

// ---------------------------------------------------------------------------
// Spot Notes + Visited (users/{uid}/spotNotes/{spotId})
// ---------------------------------------------------------------------------

/** Upsert note/visited state for a spot */
export async function saveSpotNote(uid, spotId, data) {
  if (!uid || !spotId) return;
  const ref = doc(db, 'users', uid, 'spotNotes', spotId);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/** Get note/visited state for a single spot */
export async function getSpotNote(uid, spotId) {
  if (!uid || !spotId) return null;
  const snap = await getDoc(doc(db, 'users', uid, 'spotNotes', spotId));
  return snap.exists() ? snap.data() : null;
}

/** Bulk-load all spot notes for a user → map of { spotId: { note, visited } } */
export async function getSpotNotes(uid) {
  if (!uid) return {};
  const snaps = await getDocs(collection(db, 'users', uid, 'spotNotes'));
  const map = {};
  snaps.docs.forEach((d) => { map[d.id] = d.data(); });
  return map;
}

// ---------------------------------------------------------------------------
// Trip Templates (cityTemplates/{city}/templates/{id})
// ---------------------------------------------------------------------------

/**
 * Save the current trip's day plan as a reusable template for a city.
 * Stores a lightweight snapshot: day plans + spot names (no personal data).
 */
export async function saveTripAsTemplate(city, authorId, days) {
  if (!city || !authorId || !days.length) return null;

  // Build a lightweight days array: just slot + spotName (no IDs, no PII)
  const daySnapshots = days.map((d) => ({
    dayNumber: d.dayNumber,
    spots: (d.spots ?? []).map((s) => ({
      spotId:   s.spotId ?? null,
      spotName: s.spotName ?? s.name ?? null,
      timeOfDay: s.timeOfDay ?? 'morning',
    })),
  })).filter((d) => d.spots.length > 0);

  if (!daySnapshots.length) return null;

  const ref = doc(collection(db, 'cityTemplates', city.toLowerCase(), 'templates'));
  await setDoc(ref, {
    city,
    authorId,
    days:      daySnapshots,
    dayCount:  daySnapshots.length,
    spotCount: daySnapshots.reduce((s, d) => s + d.spots.length, 0),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Fetch up to 5 community templates for a city.
 */
export async function getCityTemplates(city, limitN = 5) {
  if (!city) return [];
  try {
    // Fetch up to 50 docs server-side to bound the read cost, then rank client-side
    // by spotCount (avoids requiring a composite index on a rarely-queried collection).
    const q = query(
      collection(db, 'cityTemplates', city.toLowerCase(), 'templates'),
      limit(50),
    );
    const snaps = await getDocs(q);
    return snaps.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.spotCount ?? 0) - (a.spotCount ?? 0))
      .slice(0, limitN);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Spot Reviews (spotReviews/{spotId}/reviews/{uid})
// ---------------------------------------------------------------------------

/**
 * Save or update a star review for a spot.
 * Also updates the aggregate (avgRating, count) on the parent doc via batch.
 */
export async function saveSpotReview(uid, spotId, rating, comment = '') {
  if (!uid || !spotId || !rating) return;
  const reviewRef = doc(db, 'spotReviews', spotId, 'reviews', uid);
  const aggregateRef = doc(db, 'spotReviews', spotId);

  // Write the individual review (batch: review + aggregate re-compute)
  await setDoc(reviewRef, {
    uid,
    spotId,
    rating: Math.round(rating),
    comment: comment ?? '',
    createdAt: serverTimestamp(),
  }, { merge: true });

  // Re-compute aggregate from all reviews
  const allSnaps = await getDocs(collection(db, 'spotReviews', spotId, 'reviews'));
  const ratings = allSnaps.docs.map((d) => d.data().rating ?? 0).filter(Boolean);
  const count = ratings.length;
  const avgRating = count > 0 ? ratings.reduce((s, r) => s + r, 0) / count : 0;

  await setDoc(aggregateRef, { avgRating: Math.round(avgRating * 10) / 10, count }, { merge: true });
}

/**
 * Get aggregate review stats for a spot: { avgRating, count }.
 * Returns null if no reviews exist.
 */
export async function getSpotReviewAggregate(spotId) {
  if (!spotId) return null;
  const snap = await getDoc(doc(db, 'spotReviews', spotId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Get the current user's review for a spot.
 */
export async function getUserSpotReview(uid, spotId) {
  if (!uid || !spotId) return null;
  const snap = await getDoc(doc(db, 'spotReviews', spotId, 'reviews', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Batch-load review aggregates for multiple spotIds.
 * Returns a map of { spotId: { avgRating, count } }
 */
export async function getSpotReviewAggregates(spotIds) {
  if (!spotIds.length) return {};
  const snaps = await Promise.all(
    spotIds.map((id) => getDoc(doc(db, 'spotReviews', id)))
  );
  const map = {};
  snaps.forEach((snap, i) => {
    if (snap.exists()) map[spotIds[i]] = snap.data();
  });
  return map;
}

// ---------------------------------------------------------------------------
// "Trips like yours" — public trips that visit the same cities
// ---------------------------------------------------------------------------

/**
 * Find public trips (by other users) that include at least one of the given cities.
 * Strategy:
 *  1. Query destinations where city is in the user's cities.
 *  2. Collect the unique tripIds.
 *  3. Fetch those trip docs and keep the ones that are isPublic: true
 *     and were not created by the current user.
 * Returns an array of { id, name, destinations: [{city, countryCode}], tripId }
 */
export async function getPublicTripsLike(userCities, currentUserId, limitN = 8) {
  if (!userCities.length) return [];
  const cities = userCities.slice(0, 10); // 'in' max 30; practical cap 10

  try {
    const destsSnap = await getDocs(
      query(collection(db, 'destinations'), where('city', 'in', cities))
    );
    // Unique tripIds, excluding trips with no city overlap (already filtered by query)
    const tripIds = [...new Set(destsSnap.docs.map((d) => d.data().tripId))].filter(Boolean).slice(0, 30);
    if (!tripIds.length) return [];

    const tripDocs = await Promise.all(tripIds.map((id) => getDoc(doc(db, 'trips', id))));
    const publicTrips = tripDocs.filter(
      (d) => d.exists() && d.data().isPublic === true && d.data().userId !== currentUserId
    );

    // For each public trip, we need its destinations (cities + country codes)
    // Destinations are publicly readable — group by tripId from the destsSnap
    const destsByTripId = {};
    destsSnap.docs.forEach((d) => {
      const { tripId, city, countryCode, sortOrder } = d.data();
      if (!destsByTripId[tripId]) destsByTripId[tripId] = [];
      destsByTripId[tripId].push({ city, countryCode, sortOrder: sortOrder ?? 0 });
    });

    return publicTrips.slice(0, limitN).map((d) => ({
      id:          d.id,
      name:        d.data().name ?? null,
      isMultiCity: d.data().isMultiCity ?? false,
      destinations: (destsByTripId[d.id] ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Discover — spot popularity (how many travellers added a city's spots to day plans)
// ---------------------------------------------------------------------------

/**
 * Returns a map of { spotId: count } for all spots saved to any day plan
 * for a given city.  dayPlanSpots are publicly readable; spotCity is stored
 * on write in addSpotToDayPlan.
 */
export async function getSpotSaveCounts(city) {
  if (!city) return {};
  const q = query(
    collection(db, 'dayPlanSpots'),
    where('spotCity', '==', city),
  );
  const snaps = await getDocs(q);
  const counts = {};
  snaps.docs.forEach((d) => {
    const { spotId } = d.data();
    if (spotId) counts[spotId] = (counts[spotId] ?? 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------------------
// Public sharing
// ---------------------------------------------------------------------------

/**
 * Mark a trip (and all its destinations + day plans) as publicly readable.
 * Must be called by the trip owner.
 * userId is required — Firestore security rules reject queries without it.
 */
export async function setTripPublic(tripId, userId) {
  const batch = writeBatch(db);

  // Mark the trip itself
  batch.update(doc(db, 'trips', tripId), { isPublic: true });

  // Mark all destinations — must include userId filter to satisfy security rules
  const destsSnap = await getDocs(
    query(
      collection(db, 'destinations'),
      where('tripId', '==', tripId),
      where('userId', '==', userId),
    )
  );
  destsSnap.docs.forEach((d) => batch.update(d.ref, { isPublic: true }));

  // Mark all day plans — must include userId filter to satisfy security rules
  const plansSnap = await getDocs(
    query(
      collection(db, 'dayPlans'),
      where('tripId', '==', tripId),
      where('userId', '==', userId),
    )
  );
  plansSnap.docs.forEach((d) => batch.update(d.ref, { isPublic: true }));

  await batch.commit();
}

/**
 * Revoke public access to a trip (and all its destinations + day plans).
 * The share URL will return 404 after this call.
 * Must be called by the trip owner.
 */
export async function setTripPrivate(tripId, userId) {
  const batch = writeBatch(db);

  batch.update(doc(db, 'trips', tripId), { isPublic: false });

  const destsSnap = await getDocs(
    query(
      collection(db, 'destinations'),
      where('tripId', '==', tripId),
      where('userId', '==', userId),
    )
  );
  destsSnap.docs.forEach((d) => batch.update(d.ref, { isPublic: false }));

  const plansSnap = await getDocs(
    query(
      collection(db, 'dayPlans'),
      where('tripId', '==', tripId),
      where('userId', '==', userId),
    )
  );
  plansSnap.docs.forEach((d) => batch.update(d.ref, { isPublic: false }));

  await batch.commit();
}

/**
 * Fetch a public trip by ID (no auth required — trip must have isPublic: true).
 * Returns null if the trip doesn't exist or isn't public.
 */
export async function getTripPublic(tripId) {
  const snap = await getDoc(doc(db, 'trips', tripId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data.isPublic) return null;

  // Destinations are now publicly readable — no userId/isPublic filter needed.
  // Sort client-side to avoid requiring a composite index.
  const destsSnap = await getDocs(
    query(collection(db, 'destinations'), where('tripId', '==', tripId))
  );
  const destinations = destsSnap.docs
    .map((d) => ({
      id: d.id,
      ...d.data(),
      startDate: toISO(d.data().startDate),
      endDate:   toISO(d.data().endDate),
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return {
    id:          snap.id,
    name:        data.name ?? null,
    isMultiCity: data.isMultiCity ?? false,
    isPublic:    true,
    destinations,
  };
}

/**
 * Fetch public day plans for a destination (no auth required).
 * Returns [] if none exist or destination is not public.
 */
export async function getDayPlansPublic(destinationId) {
  // dayPlans are now publicly readable — sort client-side to avoid composite index.
  const q = query(
    collection(db, 'dayPlans'),
    where('destinationId', '==', destinationId),
  );
  const snaps = await getDocs(q);
  return snaps.docs
    .map((d) => ({ id: d.id, ...d.data(), planDate: toISO(d.data().planDate) }))
    .sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));
}

/**
 * Fetch spots for a day plan (publicly accessible — no PII).
 */
export async function getDayPlanSpotsPublic(dayPlanId) {
  const q = query(
    collection(db, 'dayPlanSpots'),
    where('dayPlanId', '==', dayPlanId),
    orderBy('sortOrder', 'asc'),
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// Refresh credits
// ---------------------------------------------------------------------------
// Stored at:
//   users/{uid}/cityPreviews/{slug}   — dateless city preview (limit 1)
//   users/{uid}/destRefreshes/{destId} — trip destination (free tier limit 3)
//
// Only EXPLICIT user-triggered refreshes count; initial auto-research does not.

/** Free-tier refresh caps. Import these alongside the functions. */
export const PREVIEW_REFRESH_LIMIT = 1;
export const TRIP_REFRESH_LIMIT    = 3;

/** Slug helper — stable key from a city name ("New York" → "new-york"). */
function citySlug(city) {
  return city.trim().toLowerCase().replace(/\s+/g, '-');
}

/** How many times this user has manually refreshed the dateless preview for a city. */
export async function getPreviewRefreshCount(userId, city) {
  const ref  = doc(db, 'users', userId, 'cityPreviews', citySlug(city));
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().refreshCount ?? 0) : 0;
}

/** Atomically increment the preview-refresh counter for a city. */
export async function incrementPreviewRefresh(userId, city) {
  const ref = doc(db, 'users', userId, 'cityPreviews', citySlug(city));
  await setDoc(ref, {
    city,
    refreshCount:    increment(1),
    lastRefreshedAt: serverTimestamp(),
  }, { merge: true });
}

/** How many times this user has manually refreshed a specific trip destination. */
export async function getDestRefreshCount(userId, destId) {
  const ref  = doc(db, 'users', userId, 'destRefreshes', destId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().refreshCount ?? 0) : 0;
}

/** Atomically increment the destination-refresh counter. */
export async function incrementDestRefresh(userId, destId, city) {
  const ref = doc(db, 'users', userId, 'destRefreshes', destId);
  await setDoc(ref, {
    destId,
    city,
    refreshCount:    increment(1),
    lastRefreshedAt: serverTimestamp(),
  }, { merge: true });
}

// ---------------------------------------------------------------------------
// Collaboration — private links + collaborator invites
// ---------------------------------------------------------------------------

/**
 * Generate a secret share token for a trip (private view-only link, no account needed).
 * Returns the token string.
 */
export async function generateShareToken(tripId) {
  const token = crypto.randomUUID().replace(/-/g, '');
  await updateDoc(doc(db, 'trips', tripId), { shareToken: token });
  return token;
}

/**
 * Revoke the private share token. The token URL will stop working immediately.
 */
export async function revokeShareToken(tripId) {
  await updateDoc(doc(db, 'trips', tripId), { shareToken: null });
}

/**
 * Fetch a trip by its private share token (no auth required).
 * Returns null if the trip doesn't exist or the token doesn't match.
 */
export async function getTripByToken(tripId, token) {
  if (!tripId || !token) return null;
  const snap = await getDoc(doc(db, 'trips', tripId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data.shareToken || data.shareToken !== token) return null;

  const destsSnap = await getDocs(
    query(collection(db, 'destinations'), where('tripId', '==', tripId))
  );
  const destinations = destsSnap.docs
    .map((d) => ({ id: d.id, ...d.data(), startDate: toISO(d.data().startDate), endDate: toISO(d.data().endDate) }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return {
    id:           snap.id,
    name:         data.name ?? null,
    isMultiCity:  data.isMultiCity ?? false,
    isPublic:     data.isPublic ?? false,
    creatorName:  data.creatorName ?? null,
    creatorEmail: data.creatorEmail ?? null,
    destinations,
  };
}

/**
 * Look up a registered Venture user by email address.
 * Returns { uid, email, displayName } or null if not found.
 */
export async function getUserByEmail(email) {
  if (!email) return null;
  const q = query(
    collection(db, 'users'),
    where('email', '==', email.toLowerCase().trim()),
    limit(1)
  );
  const snaps = await getDocs(q);
  if (snaps.empty) return null;
  const d = snaps.docs[0];
  return { uid: d.id, ...d.data() };
}

/**
 * Add a user as an editor collaborator on a trip.
 * targetUser: { uid, email, displayName }
 */
export async function addCollaborator(tripId, targetUser) {
  const tripRef = doc(db, 'trips', tripId);
  const snap    = await getDoc(tripRef);
  if (!snap.exists()) throw new Error('Trip not found');
  const data = snap.data();

  const existingUids = data.collaboratorUids ?? [];
  if (existingUids.includes(targetUser.uid)) return; // already added

  await updateDoc(tripRef, {
    collaboratorUids: [...existingUids, targetUser.uid],
    collaborators:    [...(data.collaborators ?? []), {
      uid:         targetUser.uid,
      email:       targetUser.email ?? null,
      displayName: targetUser.displayName ?? null,
      role:        'editor',
      addedAt:     serverTimestamp(),
    }],
  });
}

/**
 * Remove a collaborator from a trip by their uid.
 */
export async function removeCollaborator(tripId, targetUid) {
  const tripRef = doc(db, 'trips', tripId);
  const snap    = await getDoc(tripRef);
  if (!snap.exists()) return;
  const data = snap.data();
  await updateDoc(tripRef, {
    collaboratorUids: (data.collaboratorUids ?? []).filter((u) => u !== targetUid),
    collaborators:    (data.collaborators    ?? []).filter((c) => c.uid !== targetUid),
  });
}

/**
 * Real-time listener for trips that other users have shared with `uid`.
 * Returns the unsubscribe function.
 */
export function listenSharedTrips(uid, onUpdate, onError) {
  const q = query(
    collection(db, 'trips'),
    where('collaboratorUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    async (snap) => {
      try {
        const assembled = await Promise.all(
          snap.docs.map(async (tripSnap) => {
            const data      = tripSnap.data();
            const ownerId   = data.userId;
            // destinations are publicly readable — query without userId filter
            const destsSnap = await getDocs(
              query(
                collection(db, 'destinations'),
                where('tripId',  '==', tripSnap.id),
                where('userId',  '==', ownerId),   // owner's uid, not the collaborator's
              )
            );
            const destinations = destsSnap.docs
              .map((d) => ({ id: d.id, ...d.data(), startDate: toISO(d.data().startDate), endDate: toISO(d.data().endDate) }))
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            return {
              id:             tripSnap.id,
              userId:         ownerId,
              name:           data.name ?? null,
              isMultiCity:    data.isMultiCity ?? false,
              interests:      data.interests ?? [],
              coverPhoto:     data.coverPhoto ?? null,
              createdAt:      toISO(data.createdAt),
              isPublic:       data.isPublic ?? false,
              isSharedWithMe: true,   // UI flag — not stored in Firestore
              ownerDisplayName: data.ownerDisplayName ?? null,
              destinations,
            };
          })
        );
        onUpdate(assembled);
      } catch (err) {
        onError?.(err);
      }
    },
    onError
  );
}
