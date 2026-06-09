// src/app/api/generate-itinerary/route.js
// AI-powered itinerary generator.
// Takes a list of available spots + selected day slots and uses GPT-4o-mini
// to produce a realistic, opening-hours-aware day-by-day plan.

export const maxDuration = 60;

const DAY_ABBR = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };

// ── Geographic clustering helpers ────────────────────────────────────────────

/** Straight-line distance in km (haversine). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cluster spots by proximity to accommodation.
 *
 * homeKm    – spots within this radius of accommodation are "home-base" (any day)
 * clusterKm – distant spots within this radius of each other form a day-trip cluster
 * maxDays   – caps clusters at (maxDays - 1) so there's always ≥1 home-base day
 *
 * Returns null when there's no accommodation or no distant spots (no clustering needed).
 * Otherwise returns { homeSpots, clusters: [{ centerSpot, distKm, spots }] }
 */
function buildSpotClusters(allSpots, accommodation, homeKm = 15, clusterKm = 12, maxDays = Infinity) {
  if (!accommodation?.lat || !accommodation?.lng) return null;

  const hLat = Number(accommodation.lat);
  const hLng = Number(accommodation.lng);
  if (!hLat || !hLng) return null;

  const homeSpots   = [];
  const distantSpots = [];

  for (const s of allSpots) {
    if (!s.lat || !s.lng) { homeSpots.push(s); continue; } // no coords → treat as local
    const d = haversineKm(hLat, hLng, Number(s.lat), Number(s.lng));
    if (d <= homeKm) homeSpots.push({ ...s, _distKm: d });
    else              distantSpots.push({ ...s, _distKm: d });
  }

  if (distantSpots.length === 0) return null; // everything is local — skip clustering

  // Greedy clustering: start from the furthest unassigned spot and absorb nearby spots.
  const clusters = [];
  const remaining = [...distantSpots].sort((a, b) => b._distKm - a._distKm);

  while (remaining.length > 0) {
    const center = remaining.shift(); // furthest spot becomes cluster centre
    const clusterSpots = [center];
    const stillLeft = [];
    for (const s of remaining) {
      if (haversineKm(Number(center.lat), Number(center.lng), Number(s.lat), Number(s.lng)) <= clusterKm) {
        clusterSpots.push(s);
      } else {
        stillLeft.push(s);
      }
    }
    remaining.length = 0;
    remaining.push(...stillLeft);
    clusters.push({ centerSpot: center, distKm: center._distKm, spots: clusterSpots });
  }

  // If there are more clusters than days allow, merge excess into homeSpots
  const maxClusters = Math.max(0, maxDays - 1);
  if (clusters.length > maxClusters) {
    const excess = clusters.splice(maxClusters);
    for (const c of excess) homeSpots.push(...c.spots);
  }

  return { homeSpots, clusters };
}

/** Parse a 24h time string "HH:MM" → minutes since midnight */
function toMins(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** True if the spot is open at all on a given ISO date */
function isOpenOn(spot, isoDate) {
  if (!spot.openingHours || !isoDate) return true; // unknown = assume open
  const dow = new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const abbr = DAY_ABBR[dow];
  if (!abbr) return true;
  const hrs = spot.openingHours[abbr];
  if (!hrs || hrs === 'closed') return false;
  return true;
}

/** Suggest the best slot (morning/afternoon/evening) for a spot based on its opening hours & category */
function preferredSlot(spot, isoDate) {
  const cats = (spot.category ?? '').toLowerCase();
  const ints  = (spot.interests ?? []).join(' ').toLowerCase();

  // Hard evening bias
  if (['bar', 'nightlife', 'music'].some(k => cats.includes(k) || ints.includes(k))) return 'evening';

  // Check opening hours if available
  if (spot.openingHours && isoDate) {
    const dow  = new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const abbr = DAY_ABBR[dow];
    const hrs  = abbr && spot.openingHours[abbr];
    if (hrs && hrs !== 'closed') {
      const [openStr, closeStr] = hrs.split('-');
      const openMins  = toMins(openStr);
      const closeMins = toMins(closeStr);
      // Opens after 17:00 → evening
      if (openMins != null && openMins >= 17 * 60) return 'evening';
      // Closes before 15:00 → morning
      if (closeMins != null && closeMins <= 15 * 60) return 'morning';
    }
  }

  // Category hints
  if (['café', 'cafe', 'bakery', 'market', 'breakfast'].some(k => cats.includes(k) || ints.includes(k))) return 'morning';
  if (['museum', 'gallery', 'art', 'history', 'architecture'].some(k => cats.includes(k) || ints.includes(k))) return 'afternoon';

  return null; // no strong preference
}

// ---------------------------------------------------------------------------
// OpenAI call (non-streaming — we need a complete plan before applying)
// ---------------------------------------------------------------------------

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const data = await res.json();
  const raw  = data.choices[0].message.content;
  try {
    const parsed = JSON.parse(raw);
    return parsed.assignments ?? parsed.days ?? parsed;
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    const { city, days, spots, accommodation, savedSpotIds = [] } = await request.json();

    if (!city || !days?.length || !spots?.length) {
      return Response.json({ error: 'city, days, and spots are required' }, { status: 400 });
    }

    // Pre-filter: only include spots open on each relevant day
    // Also separate by day so the AI gets a smaller, day-appropriate list per day
    const dayData = days.map((day) => {
      const openSpots = spots.filter((s) => isOpenOn(s, day.planDate));
      return { ...day, openSpotIds: openSpots.map((s) => s.id) };
    });

    // Cap spots sent to AI: prefer saved spots, fill with highest-score remainder
    const MAX_SPOTS = 40;
    const savedSet  = new Set(savedSpotIds);
    const sorted    = [
      ...spots.filter((s) => savedSet.has(s.id)),
      ...spots.filter((s) => !savedSet.has(s.id)).sort((a, b) => (b.hiddennessScore ?? 0) - (a.hiddennessScore ?? 0)),
    ].slice(0, MAX_SPOTS);

    // Build a concise spot list for the prompt
    const spotSummaries = sorted.map((s) => ({
      id:               s.id,
      name:             s.name,
      category:         s.category,
      neighbourhood:    s.neighbourhood ?? null,
      hiddennessScore:  s.hiddennessScore ?? 5,
      visitDuration:    s.visitDurationMinutes ?? 60,
      isStarred:        savedSet.has(s.id),
      openingHours:     s.openingHours ?? null,
      lat:              s.lat ?? null,
      lng:              s.lng ?? null,
      description:      s.description ? s.description.slice(0, 100) : null,
    }));

    // Separate starred spots for explicit mention in prompt
    const starredSummaries = spotSummaries.filter((s) => s.isStarred);
    const unstarredSummaries = spotSummaries.filter((s) => !s.isStarred);

    // Build day summaries for the prompt
    const daySummaries = dayData.map((d) => ({
      dayId:      d.id,
      dayNumber:  d.dayNumber,
      date:       d.planDate ?? null,
      dayOfWeek:  d.planDate
        ? new Date(d.planDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
        : null,
      openSpotCount: d.openSpotIds.length,
    }));

    const accommodationHint = accommodation?.address
      ? `The traveller is staying at: ${accommodation.address}${accommodation.lat ? ` (lat ${Number(accommodation.lat).toFixed(4)}, lng ${Number(accommodation.lng).toFixed(4)})` : ''}.`
      : '';

    // ── Geographic clustering (server-side, pre-AI) ─────────────────────────
    // Groups outlying spots into area clusters so the AI can't scatter a single
    // distant town (e.g. Kotor) across every day of the trip.
    const HOME_KM    = 15; // spots within this radius of accommodation = home-base
    const CLUSTER_KM = 12; // distant spots within this radius of each other = one day-trip
    const clusterResult = buildSpotClusters(sorted, accommodation, HOME_KM, CLUSTER_KM, days.length);

    // Build the cluster block injected into the prompt (empty string when no clusters)
    let clusterBlock = '';
    if (clusterResult && clusterResult.clusters.length > 0) {
      const { homeSpots, clusters } = clusterResult;
      const clusterDayCount = clusters.length;
      const homeDayCount    = Math.max(1, days.length - clusterDayCount);

      clusterBlock = `
══ GEOGRAPHIC DAY-TRIP CLUSTERS — MANDATORY ══
The traveller's base is: ${accommodation.address}

Spots have been pre-grouped by distance. You MUST respect this grouping.

${clusters.map((c, i) => {
  const area = c.spots.map(s => s.name).join(', ');
  return `DAY-TRIP CLUSTER ${i + 1}  (≈${Math.round(c.distKm)}km from base — put ALL on the SAME single day):
${c.spots.map(s => `  • ${s.id}  "${s.name}"  (${s.category ?? 'n/a'})`).join('\n')}`;
}).join('\n\n')}

HOME-BASE SPOTS (within ${HOME_KM}km of accommodation — spread across the ${homeDayCount} non-cluster day${homeDayCount !== 1 ? 's' : ''}):
${homeSpots.map(s => `  • ${s.id}  "${s.name}"  (${s.category ?? 'n/a'})`).join('\n')}

CLUSTER RULES (ABSOLUTE — higher priority than all other rules):
A. Each DAY-TRIP CLUSTER occupies exactly ONE day. Never split it across days.
B. NEVER assign spots from two different clusters to the same day.
C. NEVER visit the same cluster area on more than one day (e.g., if Cluster 1 is Kotor, there is ONE Kotor day only — not a Kotor day on Day 1, Day 2, Day 3…).
D. Home-base spots fill the remaining ${homeDayCount} day${homeDayCount !== 1 ? 's' : ''} — do not mix home-base and cluster spots on the same day.
E. You have ${clusterDayCount} day-trip day${clusterDayCount !== 1 ? 's' : ''} and ${homeDayCount} home-base day${homeDayCount !== 1 ? 's' : ''} to fill (${days.length} total).

`;
    }

    const starredBlock = starredSummaries.length > 0
      ? `══ ★ STARRED SPOTS — MANDATORY ══
The traveller has personally saved these ${starredSummaries.length} spots. You MUST include ALL of them in the plan.
Do not skip any starred spot unless it is closed on EVERY available day (check openingHours carefully).
Starred spot IDs (include every single one):
${starredSummaries.map((s) => `  • ${s.id}  →  "${s.name}"  (${s.category ?? 'n/a'}, score ${s.hiddennessScore})`).join('\n')}

`
      : '';

    const prompt = `You are an expert travel planner building a day-by-day itinerary for ${city}.

${accommodationHint}

${clusterBlock}${starredBlock}You have ${spotSummaries.length} available spots and ${daySummaries.length} days to fill.

★ STARRED SPOTS (isStarred: true) — ${starredSummaries.length} spots the traveller saved:
${starredSummaries.length > 0 ? JSON.stringify(starredSummaries, null, 1) : '(none)'}

OTHER SPOTS (fill remaining slots with these after placing all starred):
${JSON.stringify(unstarredSummaries, null, 1)}

DAYS:
${JSON.stringify(daySummaries, null, 1)}

══ SLOT DEFINITIONS ══
morning   = 08:00 – 12:00
afternoon = 12:00 – 18:00
evening   = 18:00 – late night

══ ABSOLUTE RULES — NEVER BREAK THESE ══
1. Each spot may appear ONCE across the entire itinerary. No repeats whatsoever.
2. Assign 3–6 spots per day total (1–3 per slot). Do not overload any slot.
3. ★ STARRED SPOTS FIRST: ALL starred spots MUST appear in the plan. Assign every starred spot to the best available day + slot. Only after all starred spots are placed, fill remaining capacity with non-starred spots.
4. Balance the days — spread spots across all days, not just Day 1.
${clusterBlock ? '5. CLUSTER RULES above (A–E) take priority over everything except opening-hours closures.\n' : ''}
══ OPENING HOURS — CHECK STRICTLY ══
${clusterBlock ? '6' : '5'}. For each day you have a dayOfWeek. Look at the spot's openingHours for that weekday key (mon/tue/wed/thu/fri/sat/sun).
   - If it says "closed" or the key is missing → DO NOT assign that spot that day. Try a different day.
   - If the opening time is ≥ 18:00 → "evening" ONLY.
   - If the closing time is ≤ 14:00 → "morning" ONLY.
   - If a spot has no openingHours data → use category rules below.

══ CATEGORY / TYPE RULES ══
${clusterBlock ? '7' : '6'}. Bar, Nightlife, Music venue, Club, Pub (for drinks):
   → "evening" ONLY. NEVER morning or afternoon. A bar that opens at 11:00 is still "evening" for planning purposes.
${clusterBlock ? '8' : '7'}. Café, Bakery, Brunch spot, Market (food in morning):
   → "morning" ONLY.
${clusterBlock ? '9' : '8'}. Museum, Gallery, Art, History, Architecture, Monument:
   → "morning" or "afternoon" ONLY. Never evening unless explicitly open late.
${clusterBlock ? '10' : '9'}. Restaurant (sit-down dinner):
   → "evening" preferred, "afternoon" acceptable.
${clusterBlock ? '11' : '10'}. Park, Garden, Viewpoint, Outdoor:
    → Any slot, but prefer "morning" or "afternoon" for daylight.

══ GEOGRAPHY ══
${clusterBlock ? '12' : '11'}. Cluster nearby spots within the same day. Use lat/lng to group spots that are close together — this reduces unnecessary travel.
${clusterBlock ? '13' : '12'}. ${accommodationHint ? 'Start each day\'s route from the accommodation location when clustering.' : 'Try to plan each day as a logical walking/transit loop.'}

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "assignments": [
    { "dayId": "<dayId>", "slot": "morning|afternoon|evening", "spotId": "<spotId>", "spotName": "<name>" }
  ]
}

CRITICAL: Every starred spot ID listed above MUST appear in your assignments array. Only skip a starred spot if it is "closed" on every single day in the DAYS list.`;

    const result = await callOpenAI(prompt);

    // Normalise — handle both {assignments:[...]} and [...] returns
    const rawAssignments = Array.isArray(result) ? result : (result.assignments ?? []);

    // Validate: ensure spotId and dayId are present; drop malformed entries
    const valid = rawAssignments.filter(
      (a) => a.dayId && a.slot && a.spotId && ['morning', 'afternoon', 'evening'].includes(a.slot)
    );

    // Augment with preferredSlot hints where AI didn't assign one (fallback)
    // Also de-duplicate (each spotId only once)
    const usedSpotIds = new Set();
    const assignments = [];
    for (const a of valid) {
      if (usedSpotIds.has(a.spotId)) continue;
      usedSpotIds.add(a.spotId);
      const spot = spots.find((s) => s.id === a.spotId);
      const slot = a.slot ?? preferredSlot(spot, days.find((d) => d.id === a.dayId)?.planDate) ?? 'morning';
      assignments.push({ ...a, slot });
    }

    // ── Force-include any starred spots the AI missed ──────────────────────
    // This guarantees starred spots always appear regardless of AI behaviour.
    const missingStarred = spotSummaries.filter((s) => s.isStarred && !usedSpotIds.has(s.id));
    for (const spot of missingStarred) {
      // Distribute missing starred spots across days that have room and where the spot is open
      const spotFull = spots.find((s) => s.id === spot.id);
      // Sort days by current load (least loaded first) so we spread evenly
      const sortedDays = [...days].sort((a, b) => {
        const ca = assignments.filter((x) => x.dayId === a.id).length;
        const cb = assignments.filter((x) => x.dayId === b.id).length;
        return ca - cb;
      });
      for (const day of sortedDays) {
        if (!isOpenOn(spotFull, day.planDate)) continue;
        const dayCount = assignments.filter((x) => x.dayId === day.id).length;
        if (dayCount >= 7) continue; // hard cap — don't overload
        const slot = preferredSlot(spotFull, day.planDate) ?? 'morning';
        assignments.push({ dayId: day.id, spotId: spot.id, slot, spotName: spot.name });
        usedSpotIds.add(spot.id);
        break;
      }
    }

    return Response.json({ assignments });
  } catch (err) {
    console.error('[generate-itinerary] error:', err);
    return Response.json({ error: err.message ?? 'Generation failed' }, { status: 500 });
  }
}
