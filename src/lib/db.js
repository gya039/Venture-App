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

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

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
export async function upsertUser(uid, email) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email,
      currency: 'GBP',
      interests: [],
      createdAt: serverTimestamp(),
    });
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
      id:          trip.id,
      name:        trip.name ?? null,
      isMultiCity: trip.isMultiCity ?? false,
      interests:   trip.interests ?? [],
      createdAt:   toISO(trip.createdAt),
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
export async function createTrip({ userId, name, isMultiCity, interests, destinations }) {
  const batch = writeBatch(db);

  // Trip doc
  const tripRef = doc(collection(db, 'trips'));
  const firstStartDate = toTimestamp(destinations[0].startDate);
  batch.set(tripRef, {
    userId,
    name:        name ?? null,
    isMultiCity: isMultiCity ?? false,
    interests:   interests ?? [],
    firstStartDate,
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

/** Returns all cached spots for a city, sorted by hiddenness desc */
export async function getCachedSpots(city) {
  const q = query(
    collection(db, 'citySpots', city, 'spots'),
    orderBy('hiddennessScore', 'desc')
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Writes an array of spot objects into the citySpots cache */
export async function cacheSpots(city, spots) {
  const batch = writeBatch(db);
  spots.forEach((spot) => {
    const ref = doc(collection(db, 'citySpots', city, 'spots'));
    batch.set(ref, {
      city,
      name:             spot.name,
      description:      spot.description ?? null,
      whyHidden:        spot.why_hidden ?? null,
      hiddennessScore:  spot.hiddenness_score,
      hiddennessLabel:  spot.hiddenness_label,
      lat:              spot.lat ?? null,
      lng:              spot.lng ?? null,
      address:          spot.address ?? null,
      entryPrice:       spot.entry_price ?? null,
      currency:         spot.currency ?? 'EUR',
      interests:        spot.interests ?? [],
      sources:          spot.sources ?? [],
      coordsMissing:    spot.coordsMissing ?? false,
      createdAt:        serverTimestamp(),
    });
  });
  await batch.commit();

  // Mark destination as researched
  return spots.length;
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
  const snap = await getDoc(doc(db, 'citySpots', city, 'spots', spotId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------------------------------------------------------------------------
// Day Plans
// ---------------------------------------------------------------------------

export async function getDayPlans(destinationId, userId) {
  // userId is required — security rule checks resource.data.userId == request.auth.uid
  // so the query must include a userId filter or Firestore will reject it wholesale.
  const q = query(
    collection(db, 'dayPlans'),
    where('destinationId', '==', destinationId),
    where('userId', '==', userId),
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
  const q = query(collection(db, 'dayPlanSpots'), where('dayPlanId', '==', dayPlanId));
  const existing = await getDocs(q);
  await addDoc(collection(db, 'dayPlanSpots'), {
    dayPlanId,
    spotId,
    spotCity,
    timeOfDay,
    sortOrder: existing.size,
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

// ---------------------------------------------------------------------------
// City Passes (curated — manually seeded via console or seed script)
// ---------------------------------------------------------------------------

export async function getCityPass(city) {
  const snap = await getDoc(doc(db, 'cityPasses', city.toLowerCase()));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
