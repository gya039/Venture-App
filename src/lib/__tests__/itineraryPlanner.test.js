// src/lib/__tests__/itineraryPlanner.test.js
// Vitest integration tests for the deterministic itinerary planner.
// Montenegro fixture: Budva base, Kotor day-trip cluster, Petrovac day-trip cluster.

import { describe, it, expect } from 'vitest';
import { generatePlan } from '../itineraryPlanner.js';
import { getTimeFit, isOpenOnWeekday } from '../timeFit.js';
import { haversineKm } from '../travelTime.js';

// ── Montenegro fixture ───────────────────────────────────────────────────────

const accommodation = { lat: 42.2864, lng: 18.8400, address: 'Budva Old Town Hotel' };

// Four days: Thu–Sun 2025
const days = [
  { id: 'day-1', dayNumber: 1, planDate: '2025-05-15' }, // Thursday
  { id: 'day-2', dayNumber: 2, planDate: '2025-05-16' }, // Friday
  { id: 'day-3', dayNumber: 3, planDate: '2025-05-17' }, // Saturday
  { id: 'day-4', dayNumber: 4, planDate: '2025-05-18' }, // Sunday
];

// Budva home-base spots (all within ~3km of accommodation)
const budvaSpots = [
  // Nightlife / Bar — evening-only categories
  { id: 'b1', name: 'Jazz Club Budva',     category: 'Nightlife', lat: 42.2840, lng: 18.8385, hiddennessScore: 8, isStarred: true  },
  { id: 'b2', name: 'Old Town Bar',        category: 'Bar',       lat: 42.2845, lng: 18.8390, hiddennessScore: 5, isStarred: false },
  // Market — morning preferred; closed Sunday
  { id: 'b3', name: 'Fish Market',         category: 'Market',    lat: 42.2870, lng: 18.8420, hiddennessScore: 6, isStarred: false,
    openingHours: { mon: '06:00-13:00', tue: '06:00-13:00', wed: '06:00-13:00', thu: '06:00-13:00', fri: '06:00-13:00', sat: '06:00-13:00', sun: 'closed' } },
  // Beach — starred
  { id: 'b4', name: 'Budva City Beach',    category: 'Beach',     lat: 42.2800, lng: 18.8450, hiddennessScore: 4, isStarred: true  },
  // History / daytime
  { id: 'b5', name: 'Budva Old Town Walls',category: 'History',   lat: 42.2848, lng: 18.8388, hiddennessScore: 5, isStarred: false },
  { id: 'b6', name: 'Mogren Beach',        category: 'Beach',     lat: 42.2760, lng: 18.8350, hiddennessScore: 7, isStarred: false },
  { id: 'b7', name: "Richard's Head Lookout", category: 'Nature', lat: 42.2820, lng: 18.8500, hiddennessScore: 6, isStarred: false },
  // Spa — closed Saturday (day-3); used to verify weekday exclusion
  { id: 'b8', name: 'Budva Wellness Spa',  category: 'Spa',       lat: 42.2855, lng: 18.8410, hiddennessScore: 4, isStarred: false,
    openingHours: { mon: '10:00-20:00', tue: '10:00-20:00', wed: '10:00-20:00', thu: '10:00-20:00', fri: '10:00-20:00', sat: 'closed', sun: '10:00-20:00' } },
];

// Kotor spots — ~22km north-west of Budva; form a single day-trip cluster
const kotorSpots = [
  { id: 'k1', name: 'Kotor Old Town',        category: 'History',      lat: 42.4247, lng: 18.7712, hiddennessScore: 7, isStarred: true  },
  { id: 'k2', name: 'Kotor City Walls',      category: 'Architecture', lat: 42.4260, lng: 18.7730, hiddennessScore: 6, isStarred: false },
  { id: 'k3', name: 'Cat Museum Kotor',      category: 'Museum',       lat: 42.4250, lng: 18.7715, hiddennessScore: 8, isStarred: false },
  { id: 'k4', name: "St Tryphon's Cathedral",category: 'Spiritual',    lat: 42.4248, lng: 18.7710, hiddennessScore: 5, isStarred: false },
  { id: 'k5', name: 'Kotor Bay Viewpoint',   category: 'Nature',       lat: 42.4200, lng: 18.7700, hiddennessScore: 7, isStarred: false },
];

// Petrovac spots — ~12.5km south-east; cluster together as a day-trip when homeKm=10
const petrovacSpots = [
  { id: 'p1', name: 'Petrovac Beach',   category: 'Beach',   lat: 42.2053, lng: 18.9458, hiddennessScore: 5, isStarred: false },
  { id: 'p2', name: 'Petrovac Fortress',category: 'History', lat: 42.2060, lng: 18.9465, hiddennessScore: 6, isStarred: false },
];

// Special-case spots for assertions 6
const nullCoordSpot   = { id: 'spl-null', name: 'Unnamed Place',     category: 'Other', lat: null,     lng: null,     hiddennessScore: 3, isStarred: false };
const stringCoordSpot = { id: 'spl-str',  name: 'String Coord Café', category: 'Café',  lat: '42.2900',lng: '18.8420',hiddennessScore: 4, isStarred: false };

const allSpots = [...budvaSpots, ...kotorSpots, ...petrovacSpots, nullCoordSpot, stringCoordSpot];

// homeKm: 10 — ensures Petrovac (~12.5km) clusters as a day-trip, not home-base
const testOptions = { homeKm: 10, clusterKm: 12, mergeKm: 13, budgetMinutes: 480 };

function runPlan() {
  return generatePlan({ spots: allSpots, accommodation, days, options: testOptions });
}

// ── Utility ──────────────────────────────────────────────────────────────────

function allPermutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of allPermutations(rest)) result.push([arr[i], ...perm]);
  }
  return result;
}

function totalRouteKm(spots, startLat, startLng) {
  let total = 0;
  let pLat  = startLat;
  let pLng  = startLng;
  for (const s of spots) {
    if (pLat != null && pLng != null) total += haversineKm(pLat, pLng, s.lat, s.lng);
    pLat = s.lat;
    pLng = s.lng;
  }
  return total;
}

// ── 8 required integration assertions ────────────────────────────────────────

describe('generatePlan — Montenegro fixture', () => {

  it('1. all Kotor spots are on exactly one day', () => {
    const { assignments } = runPlan();
    const kotorIds = new Set(kotorSpots.map(s => s.id));
    const kotorA   = assignments.filter(a => kotorIds.has(a.spotId));
    const days     = new Set(kotorA.map(a => a.dayId));
    expect(kotorA.length).toBe(kotorSpots.length);
    expect(days.size).toBe(1);
  });

  it('2. both Petrovac spots share exactly one day', () => {
    const { assignments } = runPlan();
    const petIds = new Set(petrovacSpots.map(s => s.id));
    const petA   = assignments.filter(a => petIds.has(a.spotId));
    const days   = new Set(petA.map(a => a.dayId));
    expect(petA.length).toBe(petrovacSpots.length);
    expect(days.size).toBe(1);
  });

  it('3. no evening-only spot is placed in morning or afternoon', () => {
    const { assignments } = runPlan();
    const spotMap = new Map(allSpots.map(s => [s.id, s]));
    for (const a of assignments) {
      const spot = spotMap.get(a.spotId);
      if (!spot) continue;
      if (getTimeFit(spot).fit === 'evening-only') {
        expect(a.slot, `${spot.name} (evening-only) was placed in ${a.slot}`).toBe('evening');
      }
    }
  });

  it('4. no home-base day exceeds budget while another is under 50%', () => {
    const { assignments, dayMeta } = runPlan();
    const homeDayIds = dayMeta.filter(m => m.type === 'home').map(m => m.dayId);
    if (homeDayIds.length < 2) return;

    const spotMap = new Map(allSpots.map(s => [s.id, s]));
    const dayMins = {};
    for (const dayId of homeDayIds) {
      const daySpots = assignments
        .filter(a => a.dayId === dayId)
        .map(a => spotMap.get(a.spotId))
        .filter(Boolean);
      // Use visit minutes only for this check (travel is a rough estimate)
      dayMins[dayId] = daySpots.reduce((sum, s) => sum + (s.visitDurationMinutes ?? 60), 0);
    }

    const vals   = Object.values(dayMins);
    const maxMins = Math.max(...vals);
    const minMins = Math.min(...vals);
    if (maxMins > testOptions.budgetMinutes) {
      expect(minMins).toBeGreaterThanOrEqual(testOptions.budgetMinutes * 0.5);
    }
  });

  it('5. every starred spot is either assigned or in unplaced with a reason', () => {
    const { assignments, unplaced } = runPlan();
    const assignedIds = new Set(assignments.map(a => a.spotId));
    const unplacedIds = new Set(unplaced.map(u => u.spot.id));
    for (const spot of allSpots.filter(s => s.isStarred)) {
      const present = assignedIds.has(spot.id) || unplacedIds.has(spot.id);
      expect(present, `Starred spot "${spot.name}" is neither assigned nor in unplaced`).toBe(true);
      if (unplacedIds.has(spot.id)) {
        const entry = unplaced.find(u => u.spot.id === spot.id);
        expect(typeof entry.reason).toBe('string');
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('6a. null-coord spot → unplaced with reason "no map location"', () => {
    const { unplaced } = runPlan();
    const entry = unplaced.find(u => u.spot.id === nullCoordSpot.id);
    expect(entry).toBeDefined();
    expect(entry.reason).toBe('no map location');
  });

  it('6b. string-coord spot → coerced to number and assigned', () => {
    const { assignments } = runPlan();
    const a = assignments.find(a => a.spotId === stringCoordSpot.id);
    expect(a).toBeDefined();
  });

  it('7. within each slot, route distance equals the minimum over all permutations', () => {
    // bestSlotOrder (in orderRoutes) tries all permutations for ≤3 spots per slot,
    // so the chosen order must be ≤ every other possible ordering of that slot.
    const { assignments } = runPlan();
    const spotMap = new Map(allSpots.map(s => [s.id, s]));
    const dayIds  = [...new Set(assignments.map(a => a.dayId))];

    for (const dayId of dayIds) {
      const dayA = assignments.filter(a => a.dayId === dayId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      let curLat = accommodation.lat;
      let curLng = accommodation.lng;

      for (const slotName of ['morning', 'afternoon', 'evening']) {
        const slotSpots = dayA
          .filter(a => a.slot === slotName)
          .map(a => spotMap.get(a.spotId))
          .filter(s => s?.lat && s?.lng);

        if (slotSpots.length >= 2) {
          const actualDist = totalRouteKm(slotSpots, curLat, curLng);
          for (const perm of allPermutations(slotSpots)) {
            const d = totalRouteKm(perm, curLat, curLng);
            expect(actualDist, `Slot ${slotName} on day ${dayId}: optimized (${actualDist.toFixed(3)}) > permutation (${d.toFixed(3)})`).toBeLessThanOrEqual(d + 0.001);
          }
        }

        if (slotSpots.length > 0) {
          const last = slotSpots[slotSpots.length - 1];
          curLat = last.lat;
          curLng = last.lng;
        }
      }
    }
  });

  it('8. deterministic — two calls produce identical JSON', () => {
    expect(JSON.stringify(runPlan())).toBe(JSON.stringify(runPlan()));
  });

  it('bonus: b8 (spa, closed Saturday) is not assigned to day-3 (Saturday)', () => {
    const { assignments } = runPlan();
    expect(assignments.find(a => a.spotId === 'b8' && a.dayId === 'day-3')).toBeUndefined();
  });
});

// ── Edge-case tests ───────────────────────────────────────────────────────────

describe('generatePlan — edge cases', () => {

  it('EC1: 1-day trip with 30 spots — packs one day, rest unplaced with reasons', () => {
    const manySpots = Array.from({ length: 30 }, (_, i) => ({
      id: `ec1-${i}`, name: `Spot ${i}`, category: 'Museum',
      lat: 48.8566 + i * 0.001, lng: 2.3522 + i * 0.001,
      hiddennessScore: 5, isStarred: false,
    }));
    const oneDay = [{ id: 'day-1', dayNumber: 1, planDate: '2025-06-02' }];
    const acc    = { lat: 48.8566, lng: 2.3522 };
    const { assignments, unplaced } = generatePlan({ spots: manySpots, accommodation: acc, days: oneDay });

    expect(assignments.length).toBeGreaterThan(0);
    expect(unplaced.length).toBeGreaterThan(0);
    expect(assignments.length + unplaced.length).toBe(30);
    // Every unplaced spot must have a non-empty reason string
    for (const { reason } of unplaced) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
    // No assignment on a day that doesn't exist
    expect(assignments.every(a => a.dayId === 'day-1')).toBe(true);
  });

  it('EC2: all spots are distant — no home-base spots, one cluster per available day', () => {
    // Two tight clusters far from accommodation; 3 days → 2 cluster days + 1 home (empty)
    const clusterA = [
      { id: 'a1', name: 'Far A1', category: 'Museum', lat: 52.5200, lng: 13.4050, hiddennessScore: 6, isStarred: false },
      { id: 'a2', name: 'Far A2', category: 'Art',    lat: 52.5205, lng: 13.4055, hiddennessScore: 5, isStarred: false },
    ];
    const clusterB = [
      { id: 'b1', name: 'Far B1', category: 'Park',   lat: 48.8566, lng: 2.3522,  hiddennessScore: 7, isStarred: false },
      { id: 'b2', name: 'Far B2', category: 'Nature', lat: 48.8570, lng: 2.3530,  hiddennessScore: 6, isStarred: false },
    ];
    const acc  = { lat: 50.0, lng: 8.0 }; // Frankfurt-ish, far from both clusters
    const d3   = [
      { id: 'd1', dayNumber: 1, planDate: '2025-06-02' },
      { id: 'd2', dayNumber: 2, planDate: '2025-06-03' },
      { id: 'd3', dayNumber: 3, planDate: '2025-06-04' },
    ];
    expect(() => generatePlan({ spots: [...clusterA, ...clusterB], accommodation: acc, days: d3 })).not.toThrow();
    const { assignments, unplaced } = generatePlan({ spots: [...clusterA, ...clusterB], accommodation: acc, days: d3 });
    // All spots should be assigned (they form clusters)
    expect(assignments.length + unplaced.length).toBe(4);
    // Cluster A on one day, cluster B on another
    const aIds = new Set(['a1','a2']);
    const bIds = new Set(['b1','b2']);
    const aDays = new Set(assignments.filter(a => aIds.has(a.spotId)).map(a => a.dayId));
    const bDays = new Set(assignments.filter(a => bIds.has(a.spotId)).map(a => a.dayId));
    expect(aDays.size).toBe(1);
    expect(bDays.size).toBe(1);
    expect([...aDays][0]).not.toBe([...bDays][0]); // different days
  });

  it('EC3: zero starred spots — runs without crash, assigns spots', () => {
    const noStars = budvaSpots.map(s => ({ ...s, isStarred: false }));
    expect(() => generatePlan({ spots: noStars, accommodation, days: days.slice(0, 2), options: testOptions })).not.toThrow();
    const { assignments } = generatePlan({ spots: noStars, accommodation, days: days.slice(0, 2), options: testOptions });
    expect(assignments.length).toBeGreaterThan(0);
  });

  it('EC4: accommodation lat/lng as strings — coerced and used correctly', () => {
    const strAcc = { lat: '42.2864', lng: '18.8400', address: 'Budva (strings)' };
    expect(() => generatePlan({ spots: budvaSpots, accommodation: strAcc, days: days.slice(0, 2), options: testOptions })).not.toThrow();
    const { assignments } = generatePlan({ spots: budvaSpots, accommodation: strAcc, days: days.slice(0, 2), options: testOptions });
    // Should produce the same assignments as with numeric coords
    const numAcc = { lat: 42.2864, lng: 18.8400 };
    const { assignments: numA } = generatePlan({ spots: budvaSpots, accommodation: numAcc, days: days.slice(0, 2), options: testOptions });
    expect(JSON.stringify(assignments)).toBe(JSON.stringify(numA));
  });

  it('EC5: more days than spots can fill — no crash, remaining days empty but dayMeta present', () => {
    const fewSpots = budvaSpots.slice(0, 3); // only 3 spots
    const manyDays = [
      { id: 'dx1', dayNumber: 1, planDate: '2025-06-02' },
      { id: 'dx2', dayNumber: 2, planDate: '2025-06-03' },
      { id: 'dx3', dayNumber: 3, planDate: '2025-06-04' },
      { id: 'dx4', dayNumber: 4, planDate: '2025-06-05' },
      { id: 'dx5', dayNumber: 5, planDate: '2025-06-06' },
    ];
    expect(() => generatePlan({ spots: fewSpots, accommodation, days: manyDays, options: testOptions })).not.toThrow();
    const { assignments, unplaced, dayMeta } = generatePlan({ spots: fewSpots, accommodation, days: manyDays, options: testOptions });
    // All 3 spots assigned, none unplaced
    expect(assignments.length).toBe(3);
    expect(unplaced.length).toBe(0);
    // dayMeta still covers all 5 days
    expect(dayMeta.length).toBe(5);
    // No day has more than 1 spot (3 spots across 5 days = 1 per day max, spread)
    const dayLoads = Object.fromEntries(manyDays.map(d => [d.id, 0]));
    for (const a of assignments) dayLoads[a.dayId]++;
    expect(Math.max(...Object.values(dayLoads))).toBeLessThanOrEqual(2); // sensible spread
  });
});

// ── getTimeFit unit tests ─────────────────────────────────────────────────────

describe('getTimeFit — category defaults', () => {
  it('Bar → evening-only', ()        => expect(getTimeFit({ category: 'Bar' }).fit).toBe('evening-only'));
  it('Nightlife → evening-only', ()  => expect(getTimeFit({ category: 'Nightlife' }).fit).toBe('evening-only'));
  it('Music → evening-only', ()      => expect(getTimeFit({ category: 'Music' }).fit).toBe('evening-only'));
  it('Café → morning-pref', ()       => expect(getTimeFit({ category: 'Café' }).fit).toBe('morning-pref'));
  it('Market → morning-pref', ()     => expect(getTimeFit({ category: 'Market' }).fit).toBe('morning-pref'));
  it('Museum → daytime', ()          => expect(getTimeFit({ category: 'Museum' }).fit).toBe('daytime'));
  it('Beach → daytime', ()           => expect(getTimeFit({ category: 'Beach' }).fit).toBe('daytime'));
  it('Nature → daytime', ()          => expect(getTimeFit({ category: 'Nature' }).fit).toBe('daytime'));
  it('Food → any', ()                => expect(getTimeFit({ category: 'Food' }).fit).toBe('any'));
  it('Spa → any', ()                 => expect(getTimeFit({ category: 'Spa' }).fit).toBe('any'));
  it('null spot → any, no throw', () => {
    expect(() => getTimeFit(null)).not.toThrow();
    expect(getTimeFit(null).fit).toBe('any');
  });
  it('null category → any, no throw', () => {
    expect(() => getTimeFit({ category: null })).not.toThrow();
    expect(getTimeFit({ category: null }).fit).toBe('any');
  });
});

describe('getTimeFit — opening hours override', () => {
  it('all opens ≥ 17:00 → evening-only (overrides Food→any)', () => {
    const spot = {
      category: 'Food',
      openingHours: { mon: '20:00-02:00', tue: '20:00-02:00', fri: '17:00-23:00' },
    };
    expect(getTimeFit(spot).fit).toBe('evening-only');
  });

  it('max close ≤ 14:00 → morning-pref (overrides Museum→daytime)', () => {
    const spot = {
      category: 'Museum',
      openingHours: { mon: '08:00-13:00', tue: '08:00-13:00', sat: '08:00-12:00' },
    };
    expect(getTimeFit(spot).fit).toBe('morning-pref');
  });

  it('mixed hours (no clear pattern) → category default', () => {
    const spot = {
      category: 'Art',
      openingHours: { mon: '09:00-18:00', tue: '09:00-21:00' },
    };
    // max close = 21:00 > 14:00; min open = 09:00 < 17:00 → no override → Art = daytime
    expect(getTimeFit(spot).fit).toBe('daytime');
  });

  it('garbage hour strings → falls back to category (Nightlife → evening-only)', () => {
    const spot = {
      category: 'Nightlife',
      openingHours: { mon: 'not-a-time', tue: 'open all day' },
    };
    expect(getTimeFit(spot).fit).toBe('evening-only');
  });
});

// ── isOpenOnWeekday unit tests ────────────────────────────────────────────────

describe('isOpenOnWeekday', () => {
  it('no openingHours → true',                  () => expect(isOpenOnWeekday({ name: 'x' }, '2025-05-15')).toBe(true));
  it('empty openingHours → true',               () => expect(isOpenOnWeekday({ openingHours: {} }, '2025-05-15')).toBe(true));
  it('null date → true',                        () => expect(isOpenOnWeekday({ openingHours: { thu: 'closed' } }, null)).toBe(true));
  it('null spot → true',                        () => expect(isOpenOnWeekday(null, '2025-05-15')).toBe(true));

  it('closed on matching day → false', () => {
    // 2025-05-15 = Thursday
    expect(isOpenOnWeekday({ openingHours: { thu: 'closed' } }, '2025-05-15')).toBe(false);
  });

  it('open string on matching day → true', () => {
    // 2025-05-16 = Friday
    expect(isOpenOnWeekday({ openingHours: { fri: '09:00-18:00' } }, '2025-05-16')).toBe(true);
  });

  it('missing weekday key → true (assume open)', () => {
    // Only Monday defined; Thursday not in map
    expect(isOpenOnWeekday({ openingHours: { mon: '09:00-18:00' } }, '2025-05-15')).toBe(true);
  });

  it('closed Saturday, open Sunday → correctly returns false/true', () => {
    const spot = { openingHours: { sat: 'closed', sun: '10:00-20:00' } };
    expect(isOpenOnWeekday(spot, '2025-05-17')).toBe(false); // Saturday
    expect(isOpenOnWeekday(spot, '2025-05-18')).toBe(true);  // Sunday
  });
});
