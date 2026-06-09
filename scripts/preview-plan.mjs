/**
 * scripts/preview-plan.mjs
 * Dry-run of generatePlan against the Amsterdam seed dataset.
 * Run with:  node scripts/preview-plan.mjs
 *
 * No Firebase. Imports seed data and planner directly.
 */

import { amsterdamSpots } from '../src/data/spots/amsterdam.js';
import { generatePlan }   from '../src/lib/itineraryPlanner.js';
import { haversineKm }    from '../src/lib/travelTime.js';
import { getVisitMinutes } from '../src/lib/timeFit.js';

// ── Fixture ──────────────────────────────────────────────────────────────────

const accommodation = {
  lat: 52.3680,
  lng:  4.8953,
  address: 'Amsterdam Canal House (city centre)',
};

// 5-day trip: Mon–Fri, week of 2 June 2025
const days = [
  { id: 'd1', dayNumber: 1, planDate: '2025-06-02' }, // Monday
  { id: 'd2', dayNumber: 2, planDate: '2025-06-03' }, // Tuesday
  { id: 'd3', dayNumber: 3, planDate: '2025-06-04' }, // Wednesday
  { id: 'd4', dayNumber: 4, planDate: '2025-06-05' }, // Thursday
  { id: 'd5', dayNumber: 5, planDate: '2025-06-06' }, // Friday
];

// Star 8 spots spread across the list: indices 0, 9, 18, 27, 36, 45, 54, 63
const starredIndices = new Set([0, 9, 18, 27, 36, 45, 54, 63].filter(i => i < amsterdamSpots.length));
const spots = amsterdamSpots.map((s, i) => ({
  ...s,
  isStarred: starredIndices.has(i),
}));

// ── Run ──────────────────────────────────────────────────────────────────────

const t0 = performance.now();
const { assignments, unplaced, dayMeta } = generatePlan({
  spots,
  accommodation,
  days,
  // default options: homeKm=15, clusterKm=12, budgetMinutes=480
});
const elapsed = (performance.now() - t0).toFixed(1);

// ── Pretty-print ─────────────────────────────────────────────────────────────

const spotMap   = new Map(spots.map(s => [s.id, s]));
const SLOTS     = ['morning', 'afternoon', 'evening'];
const SLOT_TIME = { morning: '08:00–12:00', afternoon: '12:00–18:00', evening: '18:00–late' };
const GREEN     = '\x1b[32m';
const CYAN      = '\x1b[36m';
const YELLOW    = '\x1b[33m';
const DIM       = '\x1b[2m';
const RESET     = '\x1b[0m';
const STAR      = '\x1b[33m★\x1b[0m';
const BOLD      = '\x1b[1m';

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

console.log();
console.log(`${BOLD}════ Venture Plan Preview — Amsterdam (${spots.length} spots, ${days.length} days) ════${RESET}`);
console.log(`${DIM}Accommodation: ${accommodation.address} (${accommodation.lat}, ${accommodation.lng})${RESET}`);
console.log(`${DIM}Starred:       ${spots.filter(s=>s.isStarred).map(s=>s.name).join(', ')}${RESET}`);
console.log();

for (const day of days) {
  const meta = dayMeta.find(m => m.dayId === day.id);
  const dayA = assignments
    .filter(a => a.dayId === day.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const daySpots = dayA.map(a => spotMap.get(a.spotId)).filter(Boolean);

  // Compute total active minutes (visit + travel from accommodation chain)
  let totalMins = 0;
  let prevLat = accommodation.lat, prevLng = accommodation.lng;
  for (const sp of daySpots) {
    const visitMin = getVisitMinutes(sp);
    let travelMin = 0;
    if (sp.lat && sp.lng) {
      const km = haversineKm(prevLat, prevLng, sp.lat, sp.lng) * 1.3;
      const speed = km / 1.3 < 2 ? 5 : 30;
      travelMin = (km / speed) * 60;
      prevLat = sp.lat; prevLng = sp.lng;
    }
    totalMins += visitMin + travelMin;
  }

  const typeTag = meta?.type === 'cluster' ? `${YELLOW}[DAY-TRIP]${RESET}` : `${GREEN}[HOME]${RESET}`;
  console.log(`${BOLD}Day ${day.dayNumber} — ${day.planDate}${RESET}  ${typeTag}`);
  console.log(`  ${DIM}${meta?.reason ?? ''}${RESET}`);

  if (dayA.length === 0) {
    console.log(`  ${DIM}(no spots assigned)${RESET}`);
  }

  for (const slotName of SLOTS) {
    const slotA = dayA.filter(a => a.slot === slotName);
    if (slotA.length === 0) continue;

    console.log(`  ${CYAN}${slotName.toUpperCase()}  ${DIM}${SLOT_TIME[slotName]}${RESET}`);

    let curLat = accommodation.lat, curLng = accommodation.lng;
    for (const a of slotA) {
      const sp = spotMap.get(a.spotId);
      if (!sp) continue;
      const km = (sp.lat && sp.lng) ? haversineKm(curLat, curLng, sp.lat, sp.lng) : null;
      const leg = km != null ? `${DIM}+${fmtKm(km)}${RESET}` : '';
      const star = sp.isStarred ? ` ${STAR}` : '';
      const score = `${DIM}[${sp.hiddennessScore ?? '?'}]${RESET}`;
      console.log(`    ${leg.padEnd(12)} ${sp.name}${star}  ${score}  ${DIM}${sp.category}${RESET}`);
      if (sp.lat && sp.lng) { curLat = sp.lat; curLng = sp.lng; }
    }
  }

  console.log(`  ${DIM}Total active time: ~${Math.round(totalMins)} min${RESET}`);
  console.log();
}

if (unplaced.length > 0) {
  console.log(`${BOLD}════ Unplaced (${unplaced.length}) ════${RESET}`);
  for (const { spot, reason } of unplaced) {
    const star = spot.isStarred ? ` ${STAR}` : '';
    console.log(`  ${DIM}✗${RESET}  ${spot.name}${star}  ${DIM}— ${reason}${RESET}`);
  }
  console.log();
}

console.log(`${DIM}generatePlan wall-clock: ${elapsed} ms${RESET}`);
console.log(`${DIM}Assigned: ${assignments.length} spots  |  Unplaced: ${unplaced.length}  |  Total: ${spots.length}${RESET}`);
console.log();
