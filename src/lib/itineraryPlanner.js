// src/lib/itineraryPlanner.js
// Deterministic, pure itinerary planner core (Phase 1).
// No Firebase, React, or Next.js imports.
// Same inputs → byte-identical output. No Math.random(), no Date.now().

import { haversineKm, suggestOrder } from './travelTime.js';
import { getTimeFit, isOpenOnWeekday, getVisitMinutes } from './timeFit.js';

const SLOTS = ['morning', 'afternoon', 'evening'];
const MAX_PER_SLOT = 3;

export const DEFAULT_OPTIONS = {
  homeKm:        15,   // spots within this radius of accommodation → home-base
  clusterKm:     12,   // distant spots within this radius of each other → one cluster
  mergeKm:       13,   // merge two clusters if they're this close AND combined budget fits one day
  budgetMinutes: 480,  // active-time budget per day (visits + travel)
  roadFactor:    1.3,  // multiply haversine distance to approximate road distance
  walkKmh:       5,    // walking speed (used when haversine < 2km)
  transitKmh:    30,   // transit speed (used when haversine >= 2km)
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function coerceCoord(val) {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function legTravelMins(fromLat, fromLng, toLat, toLng, opts) {
  const { roadFactor, walkKmh, transitKmh } = opts;
  const straightKm = haversineKm(fromLat, fromLng, toLat, toLng);
  const roadKm     = straightKm * roadFactor;
  const speed      = straightKm < 2 ? walkKmh : transitKmh;
  return (roadKm / speed) * 60;
}

function spotSortKey(s) {
  // [starred desc, hiddennessScore desc, id asc] — all-numeric tuple for compare
  return [
    (s.starred || s.isStarred) ? 0 : 1,
    -(s.hiddennessScore ?? 0),
    s.id,
  ];
}

function compareTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return  1;
  }
  return 0;
}

function recalcDayBudget(spots, accommodation, opts) {
  const { roadFactor, walkKmh, transitKmh } = opts;
  let total = 0;
  let pLat  = accommodation?.lat != null ? Number(accommodation.lat) : null;
  let pLng  = accommodation?.lng != null ? Number(accommodation.lng) : null;
  for (const s of spots) {
    total += getVisitMinutes(s);
    if (pLat != null && pLng != null && s.lat != null && s.lng != null) {
      total += legTravelMins(pLat, pLng, s.lat, s.lng, { roadFactor, walkKmh, transitKmh });
    }
    if (s.lat != null) pLat = s.lat;
    if (s.lng != null) pLng = s.lng;
  }
  return total;
}

// ── Step 1: Sanitise ─────────────────────────────────────────────────────────

/**
 * Coerce lat/lng to numbers; spots with missing, unparseable, or zero
 * coordinates go to unplaced with reason "no map location".
 * String coordinates (e.g. "42.29") are coerced and treated as valid.
 * Zero is rejected because geocoders that fail silently often produce (0, 0) —
 * matches the falsy guard (`!s.lat || !s.lng`) used in route.js.
 */
export function sanitiseSpots(spots) {
  const valid    = [];
  const unplaced = [];
  for (const spot of spots) {
    const lat = coerceCoord(spot.lat);
    const lng = coerceCoord(spot.lng);
    if (!lat || !lng) { // falsy: catches null, NaN (→null from coerce), and 0
      unplaced.push({ spot, reason: 'no map location' });
    } else {
      valid.push({ ...spot, lat, lng });
    }
  }
  return { valid, unplaced };
}

// ── Step 2: Cluster ──────────────────────────────────────────────────────────

function buildSpotClusters(allSpots, accommodation, homeKm, clusterKm) {
  if (!accommodation?.lat || !accommodation?.lng) return null;
  const hLat = Number(accommodation.lat);
  const hLng = Number(accommodation.lng);
  if (!hLat || !hLng) return null; // falsy: NaN, 0, null — matches route.js guard

  const homeSpots    = [];
  const distantSpots = [];

  for (const s of allSpots) {
    if (s.lat == null || s.lng == null) { homeSpots.push(s); continue; }
    const d = haversineKm(hLat, hLng, s.lat, s.lng);
    if (d <= homeKm) homeSpots.push({ ...s, _distKm: d });
    else             distantSpots.push({ ...s, _distKm: d });
  }

  if (distantSpots.length === 0) return null;

  // Greedy: furthest unassigned → new cluster centre; absorb spots within clusterKm
  const remaining = [...distantSpots].sort((a, b) => b._distKm - a._distKm);
  const clusters  = [];

  while (remaining.length > 0) {
    const center       = remaining.shift();
    const clusterSpots = [center];
    const stillLeft    = [];
    for (const s of remaining) {
      haversineKm(center.lat, center.lng, s.lat, s.lng) <= clusterKm
        ? clusterSpots.push(s)
        : stillLeft.push(s);
    }
    remaining.length = 0;
    remaining.push(...stillLeft);
    clusters.push({ centerSpot: center, distKm: center._distKm, spots: clusterSpots });
  }

  return { homeSpots, clusters };
}

/**
 * Cluster validSpots around accommodation.
 * Additionally merges adjacent clusters (≤ mergeKm apart) whose combined visit
 * budget fits within one day.
 */
export function clusterSpots(validSpots, accommodation, opts = {}) {
  const { homeKm, clusterKm, mergeKm, budgetMinutes } = { ...DEFAULT_OPTIONS, ...opts };

  const result = buildSpotClusters(validSpots, accommodation, homeKm, clusterKm);
  if (!result) return { homeSpots: validSpots, clusters: [] };

  const { homeSpots } = result;
  let { clusters }    = result;

  // Merge nearby clusters that together fit within one day budget
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const ci   = clusters[i];
        const cj   = clusters[j];
        const dist = haversineKm(ci.centerSpot.lat, ci.centerSpot.lng, cj.centerSpot.lat, cj.centerSpot.lng);
        if (dist <= mergeKm) {
          const combined  = [...ci.spots, ...cj.spots];
          const totalMins = combined.reduce((s, sp) => s + getVisitMinutes(sp), 0);
          if (totalMins <= budgetMinutes) {
            const newCenter = ci.distKm >= cj.distKm ? ci.centerSpot : cj.centerSpot;
            clusters[i] = { centerSpot: newCenter, distKm: Math.max(ci.distKm, cj.distKm), spots: combined };
            clusters.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
  }

  return { homeSpots, clusters };
}

// ── Step 3: Assign cluster days ──────────────────────────────────────────────

/**
 * Greedy matching: assign each cluster to a day that maximises how many cluster
 * spots are open on that day. Larger clusters get priority. Ties broken by
 * day number (ascending), then cluster index (ascending).
 *
 * Returns Map<clusterIndex → dayId>.
 */
export function assignClusterDays(clusters, days) {
  const clusterDayMap = new Map();
  const usedDayIds    = new Set();

  // Process largest clusters first; tie-break by cluster index
  const indices = clusters
    .map((_, i) => i)
    .sort((a, b) => clusters[b].spots.length - clusters[a].spots.length || a - b);

  const sortedDays = [...days].sort((a, b) => a.dayNumber - b.dayNumber);

  for (const ci of indices) {
    const cluster = clusters[ci];
    let bestDay   = null;
    let bestScore = -1;

    for (const day of sortedDays) {
      if (usedDayIds.has(day.id)) continue;
      const score = cluster.spots.filter(s => isOpenOnWeekday(s, day.planDate)).length;
      if (score > bestScore) { bestScore = score; bestDay = day; }
    }

    if (bestDay) {
      clusterDayMap.set(ci, bestDay.id);
      usedDayIds.add(bestDay.id);
    }
  }

  return clusterDayMap;
}

// ── Step 4: Budget-pack home-base days ───────────────────────────────────────

/**
 * Greedily assign home-base spots to home-base days.
 * Priority order: starred first, then hiddennessScore desc, then id asc.
 * Each spot goes to the least-loaded day on which it's open.
 * Travel time (haversine × roadFactor) is counted toward the 480-min budget.
 *
 * A rebalance pass then moves non-starred spots from over-budget days to
 * under-budget days (< 50% filled) until stable.
 */
export function packHomeDays(homeSpots, homeDays, accommodation, opts = {}) {
  const mergedOpts = { ...DEFAULT_OPTIONS, ...opts };
  const { budgetMinutes, roadFactor, walkKmh, transitKmh } = mergedOpts;
  const travelOpts = { roadFactor, walkKmh, transitKmh };

  if (homeDays.length === 0) {
    return {
      assignments: [],
      unplaced:    homeSpots.map(s => ({ spot: s, reason: 'no home-base days available' })),
    };
  }

  const sorted     = [...homeSpots].sort((a, b) => compareTuple(spotSortKey(a), spotSortKey(b)));
  const sortedDays = [...homeDays].sort((a, b) => a.dayNumber - b.dayNumber);

  // Per-day mutable state
  const state = {};
  for (const day of sortedDays) {
    state[day.id] = { day, spots: [], totalMinutes: 0 };
  }

  const unplaced = [];

  for (const spot of sorted) {
    // Prefer least-loaded open day; tie-break by dayNumber
    const candidates = sortedDays
      .filter(d => isOpenOnWeekday(spot, d.planDate) && state[d.id].spots.length < MAX_PER_SLOT * 3)
      .sort((a, b) => state[a.id].totalMinutes - state[b.id].totalMinutes || a.dayNumber - b.dayNumber);

    let placed = false;
    for (const day of candidates) {
      const ds         = state[day.id];
      const visitMin   = getVisitMinutes(spot);
      let   travelMin  = 0;

      if (ds.spots.length > 0) {
        const last = ds.spots[ds.spots.length - 1];
        if (last.lat != null && last.lng != null) {
          travelMin = legTravelMins(last.lat, last.lng, spot.lat, spot.lng, travelOpts);
        }
      } else {
        const aLat = accommodation?.lat != null ? Number(accommodation.lat) : null;
        const aLng = accommodation?.lng != null ? Number(accommodation.lng) : null;
        if (aLat != null && aLng != null) {
          travelMin = legTravelMins(aLat, aLng, spot.lat, spot.lng, travelOpts);
        }
      }

      if (ds.totalMinutes + visitMin + travelMin <= budgetMinutes) {
        ds.spots.push(spot);
        ds.totalMinutes += visitMin + travelMin;
        placed = true;
        break;
      }
    }

    if (!placed) {
      const anyOpen = sortedDays.some(d => isOpenOnWeekday(spot, d.planDate));
      unplaced.push({ spot, reason: anyOpen ? 'day budget full' : 'closed on all planned days' });
    }
  }

  // Rebalance: move lowest-value non-starred spots from over-budget to under-50%-budget days
  let rebalanced = true;
  while (rebalanced) {
    rebalanced = false;
    for (const overDay of sortedDays) {
      const over = state[overDay.id];
      if (over.totalMinutes <= budgetMinutes) continue;

      for (const underDay of sortedDays) {
        if (underDay.id === overDay.id) continue;
        const under = state[underDay.id];
        if (under.totalMinutes >= budgetMinutes * 0.5) continue;
        if (under.spots.length >= MAX_PER_SLOT * 3) continue;

        const movable = over.spots
          .filter(s => !(s.starred || s.isStarred) && isOpenOnWeekday(s, underDay.day.planDate))
          .sort((a, b) => (a.hiddennessScore ?? 0) - (b.hiddennessScore ?? 0) || (a.id > b.id ? -1 : 1));

        if (movable.length === 0) continue;

        const mv          = movable[0];
        over.spots        = over.spots.filter(s => s.id !== mv.id);
        over.totalMinutes = recalcDayBudget(over.spots, accommodation, travelOpts);
        under.spots.push(mv);
        under.totalMinutes = recalcDayBudget(under.spots, accommodation, travelOpts);

        rebalanced = true;
        break;
      }
      if (rebalanced) break;
    }
  }

  const assignments = [];
  for (const day of sortedDays) {
    for (const spot of state[day.id].spots) {
      assignments.push({ dayId: day.id, spotId: spot.id });
    }
  }

  return { assignments, unplaced };
}

// ── Step 5: Slot bucketing ───────────────────────────────────────────────────

/**
 * Assign each assignment a slot (morning / afternoon / evening).
 *
 * Hard rule: evening-only spots NEVER go to morning or afternoon.
 * evening-only spots are processed first so they claim evening slots before
 * 'any' spots overflow into evening.
 * Tie-break within same fit-priority: lexicographic spot id.
 */
export function bucketSlots(assignments, spots) {
  const spotMap = new Map(spots.map(s => [s.id, s]));
  const FIT_ORDER = { 'evening-only': 0, 'morning-pref': 1, 'daytime': 2, 'any': 3 };

  // Group by dayId
  const byDay = {};
  for (const a of assignments) {
    if (!byDay[a.dayId]) byDay[a.dayId] = [];
    byDay[a.dayId].push(a);
  }

  const result = [];

  for (const dayAssignments of Object.values(byDay)) {
    const slotCount = { morning: 0, afternoon: 0, evening: 0 };

    const sorted = [...dayAssignments].sort((a, b) => {
      const fa = getTimeFit(spotMap.get(a.spotId)).fit;
      const fb = getTimeFit(spotMap.get(b.spotId)).fit;
      if (FIT_ORDER[fa] !== FIT_ORDER[fb]) return FIT_ORDER[fa] - FIT_ORDER[fb];
      return a.spotId < b.spotId ? -1 : 1;
    });

    for (const a of sorted) {
      const { fit } = getTimeFit(spotMap.get(a.spotId));
      let slot;

      if (fit === 'evening-only') {
        slot = 'evening';
      } else if (fit === 'morning-pref' || fit === 'daytime') {
        slot = slotCount.morning   < MAX_PER_SLOT ? 'morning'
             : slotCount.afternoon < MAX_PER_SLOT ? 'afternoon'
             : 'evening'; // overflow — not evening-only so OK
      } else { // 'any'
        slot = slotCount.morning   < MAX_PER_SLOT ? 'morning'
             : slotCount.afternoon < MAX_PER_SLOT ? 'afternoon'
             : slotCount.evening   < MAX_PER_SLOT ? 'evening'
             : 'morning'; // hard overflow (>9 spots/day — shouldn't happen)
      }

      slotCount[slot]++;
      result.push({ ...a, slot });
    }
  }

  return result;
}

// ── Step 6: Route ordering ───────────────────────────────────────────────────

function routeDistFromPoint(spots, fromLat, fromLng) {
  let total = 0;
  let pLat  = fromLat;
  let pLng  = fromLng;
  for (const s of spots) {
    if (s.lat != null && s.lng != null && pLat != null && pLng != null) {
      total += haversineKm(pLat, pLng, s.lat, s.lng);
      pLat = s.lat;
      pLng = s.lng;
    }
  }
  return total;
}

function permute(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permute(rest)) result.push([arr[i], ...perm]);
  }
  return result;
}

// Tries all permutations (safe for ≤3 spots per slot = max 6 permutations).
// Deterministic tie-break: lexicographic by joined spot ids.
function bestSlotOrder(spots, fromLat, fromLng) {
  if (spots.length <= 1) return spots;
  let best     = spots;
  let bestDist = routeDistFromPoint(spots, fromLat, fromLng);
  let bestKey  = spots.map(s => s.id).join('\x00');

  for (const perm of permute(spots)) {
    const d   = routeDistFromPoint(perm, fromLat, fromLng);
    const key = perm.map(s => s.id).join('\x00');
    if (d < bestDist || (d === bestDist && key < bestKey)) {
      bestDist = d;
      best     = perm;
      bestKey  = key;
    }
  }
  return best;
}

/**
 * Reorder each day's assignments for a shorter route.
 * Processes slots in morning → afternoon → evening order, carrying the current
 * position forward between slots. Within each slot, tries all permutations
 * (max 3 spots = 6 permutations) for the optimal order.
 * Adds an `order` index to each assignment for stable rendering.
 */
export function orderRoutes(assignments, spots, accommodation) {
  const spotMap = new Map(spots.map(s => [s.id, s]));
  const accLat  = accommodation?.lat != null ? Number(accommodation.lat) : null;
  const accLng  = accommodation?.lng != null ? Number(accommodation.lng) : null;

  // Group by dayId → slot
  const byDay = {};
  for (const a of assignments) {
    if (!byDay[a.dayId]) byDay[a.dayId] = { morning: [], afternoon: [], evening: [] };
    byDay[a.dayId][a.slot].push(a);
  }

  const result  = [];
  const dayIds  = Object.keys(byDay).sort();

  for (const dayId of dayIds) {
    const daySlots = byDay[dayId];
    let curLat     = accLat;
    let curLng     = accLng;
    let order      = 0;

    for (const slotName of SLOTS) {
      const slotAssignments = daySlots[slotName];
      if (!slotAssignments || slotAssignments.length === 0) continue;

      const slotSpots = slotAssignments.map(a => spotMap.get(a.spotId));
      const ordered   = bestSlotOrder(slotSpots, curLat, curLng);

      for (const spot of ordered) {
        const a = slotAssignments.find(x => x.spotId === spot.id);
        result.push({ ...a, order: order++ });
        if (spot.lat != null) curLat = spot.lat;
        if (spot.lng != null) curLng = spot.lng;
      }
    }
  }

  return result;
}

// ── Step 7: Day meta ─────────────────────────────────────────────────────────

export function buildDayMeta(clusters, clusterDayMap, days, homeDays) {
  const dayLookup = new Map(days.map(d => [d.id, d]));
  const meta      = [];

  for (const [ci, dayId] of clusterDayMap.entries()) {
    const c   = clusters[ci];
    const day = dayLookup.get(dayId);
    meta.push({
      dayId,
      dayNumber: day?.dayNumber ?? null,
      type:   'cluster',
      reason: `${c.centerSpot.name} day-trip — ${c.spots.length} spot${c.spots.length !== 1 ? 's' : ''} are ${Math.round(c.distKm)}km from your base`,
    });
  }

  for (const day of homeDays) {
    meta.push({ dayId: day.id, dayNumber: day.dayNumber, type: 'home', reason: 'Home-base day' });
  }

  return meta.sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a deterministic day-by-day itinerary.
 *
 * @param {{ spots, accommodation, days, options }} params
 *   spots         — array of spot objects (lat/lng may be null or string)
 *   accommodation — { lat, lng, address }
 *   days          — array of { id, dayNumber, planDate }
 *   options       — optional overrides for DEFAULT_OPTIONS tunables
 *
 * @returns {{ assignments, unplaced, dayMeta }}
 *   assignments  — [{ dayId, spotId, slot, order }]
 *   unplaced     — [{ spot, reason }]
 *   dayMeta      — [{ dayId, dayNumber, type: 'cluster'|'home', reason }]
 */
export function generatePlan({ spots, accommodation, days, options = {} }) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 1. Sanitise
  const { valid, unplaced } = sanitiseSpots(spots);

  // 2. Cluster
  const { homeSpots, clusters } = clusterSpots(valid, accommodation, opts);

  // Cap to (days.length − 1) clusters so there's always ≥ 1 home-base day
  const maxClusters    = Math.max(0, days.length - 1);
  const activeClusters = clusters.slice(0, maxClusters);
  const allHomeSpots   = [
    ...homeSpots,
    ...clusters.slice(maxClusters).flatMap(c => c.spots),
  ];

  // 3. Assign cluster days
  const clusterDayMap = assignClusterDays(activeClusters, days);

  // 4. Determine home days
  const clusterDayIds = new Set(clusterDayMap.values());
  const homeDays      = [...days]
    .filter(d => !clusterDayIds.has(d.id))
    .sort((a, b) => a.dayNumber - b.dayNumber);

  // 5. Build cluster assignments (all spots on their cluster day, no budget cap)
  const clusterAssignments = [];
  for (const [ci, dayId] of clusterDayMap.entries()) {
    for (const spot of activeClusters[ci].spots) {
      clusterAssignments.push({ dayId, spotId: spot.id });
    }
  }

  // 6. Budget-pack home days
  const { assignments: homeAssignments, unplaced: homeUnplaced } =
    packHomeDays(allHomeSpots, homeDays, accommodation, opts);

  // 7. Bucket slots and order routes
  const rawAssignments = [...clusterAssignments, ...homeAssignments];
  const withSlots      = bucketSlots(rawAssignments, valid);
  const ordered        = orderRoutes(withSlots, valid, accommodation);

  // 8. Day meta
  const dayMeta = buildDayMeta(activeClusters, clusterDayMap, days, homeDays);

  return {
    assignments: ordered,
    unplaced:    [...unplaced, ...homeUnplaced],
    dayMeta,
  };
}
