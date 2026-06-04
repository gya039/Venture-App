// src/app/api/generate-itinerary/route.js
// AI-powered itinerary generator.
// Takes a list of available spots + selected day slots and uses GPT-4o-mini
// to produce a realistic, opening-hours-aware day-by-day plan.

export const maxDuration = 60;

const DAY_ABBR = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };

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
      ? `The traveller is staying at: ${accommodation.address}${accommodation.lat ? ` (lat ${accommodation.lat.toFixed(4)}, lng ${accommodation.lng.toFixed(4)})` : ''}.`
      : '';

    const prompt = `You are an expert travel planner building a day-by-day itinerary for ${city}.

${accommodationHint}

You have ${spotSummaries.length} available spots and ${daySummaries.length} days to fill.

SPOTS:
${JSON.stringify(spotSummaries, null, 1)}

DAYS:
${JSON.stringify(daySummaries, null, 1)}

══ SLOT DEFINITIONS ══
morning   = 08:00 – 12:00
afternoon = 12:00 – 18:00
evening   = 18:00 – late night

══ ABSOLUTE RULES — NEVER BREAK THESE ══
1. Each spot may appear ONCE across the entire itinerary. No repeats.
2. Assign 3–6 spots per day total (1–2 per slot). Do not overload any slot.
3. Starred spots (isStarred: true) MUST be prioritised — include as many as possible before non-starred ones.
4. Balance the days — spread good spots across all days, not just Day 1.

══ OPENING HOURS — CHECK STRICTLY ══
5. For each day you have a dayOfWeek. Look at the spot's openingHours for that weekday key (mon/tue/wed/thu/fri/sat/sun).
   - If it says "closed" or the key is missing → DO NOT assign that spot that day. Skip it entirely.
   - If the opening time is ≥ 18:00 → "evening" ONLY.
   - If the closing time is ≤ 14:00 → "morning" ONLY.
   - If a spot has no openingHours data → use category rules below.

══ CATEGORY / TYPE RULES ══
6. Bar, Nightlife, Music venue, Club, Pub (for drinks):
   → "evening" ONLY. NEVER morning or afternoon. A bar that opens at 11:00 is still "evening" for planning purposes.
7. Café, Bakery, Brunch spot, Market (food in morning):
   → "morning" ONLY.
8. Museum, Gallery, Art, History, Architecture, Monument:
   → "morning" or "afternoon" ONLY. Never evening unless explicitly open late.
9. Restaurant (sit-down dinner):
   → "evening" preferred, "afternoon" acceptable.
10. Park, Garden, Viewpoint, Outdoor:
    → Any slot, but prefer "morning" or "afternoon" for daylight.

══ GEOGRAPHY ══
11. Cluster nearby spots within the same day. Use lat/lng to group spots that are close together — this reduces unnecessary travel.
12. ${accommodationHint ? 'Start each day\'s route from the accommodation location when clustering.' : 'Try to plan each day as a logical walking/transit loop.'}

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "assignments": [
    { "dayId": "<dayId>", "slot": "morning|afternoon|evening", "spotId": "<spotId>", "spotName": "<name>" }
  ]
}

Only include assignments where the spot genuinely fits the day AND the slot. When in doubt, skip the spot.`;

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

    return Response.json({ assignments });
  } catch (err) {
    console.error('[generate-itinerary] error:', err);
    return Response.json({ error: err.message ?? 'Generation failed' }, { status: 500 });
  }
}
