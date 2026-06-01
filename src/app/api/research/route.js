// src/app/api/research/route.js
// Streams research results via Server-Sent Events.
// Flow: 3 × OpenAI passes (history/architecture · food/nightlife · nature/outdoor)
//       → merge + deduplicate by name → geocode via Mapbox → SSE each spot.

// Vercel Hobby tier caps at 60s; Pro tier supports up to 300s.
// Multi-pass research for large cities typically takes 60–180s.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Quality gate — drops spots the model itself rates as low-confidence
// Tune this constant if the gate is too aggressive or too permissive.
// ---------------------------------------------------------------------------
const CONFIDENCE_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Prompts — three category-focused passes
// ---------------------------------------------------------------------------

const CITY_SIZE_GUIDE = `Produce as many genuine spots as you know in this category. Use the floors below as a minimum starting point — if you know more real spots beyond these numbers, keep going. Only stop when you have exhausted what you genuinely know, not when you hit the floor.

Minimum floor by city scale (self-assess honestly):
- Major world city (London, Paris, Tokyo, New York, Istanbul, Berlin, Barcelona, Rome, Seoul, Bangkok, Mumbai, São Paulo, Buenos Aires, Mexico City, Cairo, Shanghai, Beijing, Hong Kong, Taipei — and cities of similar scale): 60–80 spots minimum
- Large city (Amsterdam, Lisbon, Prague, Vienna, Budapest, Kyoto, Osaka, Edinburgh, Dublin, Kraków, Seville, Naples, Hanoi, Ho Chi Minh City, Chiang Mai, Montreal, Chicago, New Orleans, Cape Town, Nairobi — and similar): 35–50 spots minimum
- Mid-size city (Porto, Copenhagen, Tbilisi, Tallinn, Riga, Ljubljana, Vilnius, Ghent, Sarajevo, Oaxaca, Cartagena, Reykjavik, Hiroshima, Nara, Fukuoka — and similar): 20–35 spots minimum
- Small city or niche destination: 10–20 spots minimum

Do NOT pad or invent spots to reach these numbers. Every spot must be a place you are genuinely confident exists and is accurate. If you only know 12 genuine spots for a large city in this category, return 12 — do not fabricate the rest.`;

const JSON_SCHEMA = `Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "spots": [
    {
      "name": "string",
      "description": "2–3 sentences describing the place",
      "whyHidden": "1 sentence explaining why most tourists miss it (null for tourist staples)",
      "whyWorthIt": "1 concrete, specific reason to go — a dish to order, the room to ask for, the best time to arrive, a specific experience that can't be found elsewhere. NOT generic praise like 'great atmosphere'. null if you don't know a specific detail.",
      "hiddennessReason": "short phrase e.g. 'locals-only bar' or 'off the tourist map'",
      "hiddennessScore": <integer 1–10>,
      "hiddennessLabel": "Tourist Staple|Worth Knowing|Hidden Gem|Local Secret|Off the Map",
      "editorialConfidence": <float 0.0–1.0>,
      "category": "food|museum|park|bar|cafe|market|landmark|art|nature|shopping|spa|music|other",
      "interests": ["hiking","food","museums","art","nightlife","beaches","markets","monuments","photography","relaxation","music","streets","offbeat","outdoor"],
      "entryPrice": <number in EUR, 0 if free, null if unknown>,
      "currency": "EUR",
      "closureStatus": "<research actual status: open | temporarily_closed | permanently_closed | seasonal>",
      "openingHours": {"mon":"09:00-18:00","tue":"09:00-18:00","wed":"09:00-18:00","thu":"09:00-18:00","fri":"09:00-20:00","sat":"10:00-18:00","sun":"closed"},
      "bestTimeToVisit": "e.g. early morning or Sunday afternoon",
      "visitDurationMinutes": <integer, typical visit length>,
      "address": "Full street address including postcode",
      "neighbourhood": "District or area name",
      "tips": ["insider tip 1", "insider tip 2"],
      "avoid": "what to watch out for or avoid (null if nothing)",
      "nearbySpots": ["name of nearby spot 1", "name of nearby spot 2"]
    }
  ]
}

Hiddenness scoring guide:
1–3: Globally famous, always crowded, on every itinerary
4–5: Known locally, visited by informed travellers
6–7: Known to Reddit, niche travel blogs, expats
8–9: Genuine local knowledge, rarely on tourist radar
10: Requires specific insider knowledge to find

editorialConfidence scoring guide (SEPARATE axis from hiddenness — a famous place can score high here):
0.9–1.0: You are highly confident this is a real, distinctive, genuinely worthwhile place — specific details, clear character, a traveller would be glad they went
0.6–0.8: Solid pick — real place, worth visiting, description is accurate but perhaps slightly generic
0.4–0.5: Moderate confidence — place likely exists but description is vague, generic, or you're uncertain it's genuinely distinctive
0.1–0.3: Low confidence — filler entry, very uncertain the place exists or is notable, generic category placeholder
Use 0.5 only as a genuine middle estimate, not as a lazy default. Be honest: if you're not sure this spot deserves a traveller's time, score it low.

For closureStatus: research the REAL current status. Use "temporarily_closed" for places known to be closed for renovation or seasonal pause. Use "permanently_closed" for places that have shut down. Default to "open" only when confident the place is currently operating.
For openingHours, use 24-hour "HH:MM-HH:MM" format per day, or "closed" for closed days.
Use real, accurate addresses including street name and postcode where known.

IMPORTANT: Your response must be complete, valid, parseable JSON. If you are approaching your output limit, immediately stop adding new spots and close the JSON array cleanly with \`]}\`. A truncated response wastes everything that came before it.`;

// ---------------------------------------------------------------------------
// Events mode — recurring events for Glasgow (Phase 3, city-gated)
// ---------------------------------------------------------------------------

// Events research is enabled for all cities

/** Reuses the main JSON_SCHEMA key ("spots") so the geocoding pipeline is identical */
const EVENTS_JSON_SCHEMA = `Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "spots": [
    {
      "name": "string — event name",
      "venue": "string — venue where it takes place",
      "description": "1–2 sentences about what the event is",
      "recurrence": "weekly | monthly",
      "day": "Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday",
      "time": "HH:MM–HH:MM in 24-hour format (approximate is fine)",
      "category": "market | music | nightlife | art | food | sport | community | other",
      "confidence": <float 0.0–1.0>,
      "sourceHint": "brief clue about how you know this (e.g. 'well-known Glasgow tradition', 'listed on venue website')",
      "address": "venue street address — used for geocoding, be specific",
      "neighbourhood": "district or area name",
      "isEvent": true,
      "hiddennessScore": <integer 1–10>,
      "interests": ["markets","music","food","art","nightlife","outdoor","offbeat","streets"],
      "entryPrice": <number in GBP; 0 if free; null if unknown>,
      "visitDurationMinutes": <typical duration in minutes>
    }
  ]
}

Confidence scoring:
0.8–1.0: Well-established, almost certainly still running, specific details confirmed
0.5–0.7: Probably still running but less certain about current schedule
0.2–0.4: You know this existed but uncertain if it's still running

IMPORTANT: Return complete, valid JSON. Close the array cleanly if approaching output limit.`;

const buildEventsPrompt = (city) => `You are a local events researcher for ${city}.

Research RECURRING events in ${city} — events that happen weekly or monthly on a fixed schedule.

Cover:
- Regular markets (farmer's markets, vintage fairs, car boot sales, antique markets)
- Weekly music nights, jazz sessions, open mics, folk sessions at specific pubs or venues
- Regular club nights, dance events, DJ nights
- Monthly art openings, gallery nights, creative events
- Regular sports meetups, parkruns, cycling groups
- Weekly food pop-ups, street food markets, supper clubs
- Community gatherings, quiz nights, film screenings with fixed schedules
- Any recurring local event that a visitor spending a week there could attend

Rules:
- Only genuinely RECURRING events (weekly or monthly) — no one-offs or seasonal festivals
- Be HONEST about confidence — if you're not sure the event still runs, score it lower
- sourceHint: a brief clue about the source (e.g. "Barras official site", "long-running Glasgow tradition", "listed on The Glad Cafe calendar")
- address: the venue address — be specific, this is used for geocoding
- hiddennessScore: how local the event is (1 = tourist-facing, 10 = purely locals know it)
- DO NOT invent events. Every entry must be a real recurring event you genuinely know about.
- Return every event you know — no artificial cap.

${EVENTS_JSON_SCHEMA}`.trim();

// ---------------------------------------------------------------------------
// Deep-mode prompt — comprehensive single-category directory
// ---------------------------------------------------------------------------

const buildDeepPrompt = (city, category) => `You are a comprehensive travel directory researcher.

Produce a COMPLETE list of every "${category}" spot you know in ${city}.

This is a directory, not a curated list:
- Include EVERYTHING: famous, popular, hidden, obscure — completeness is the goal
- Do NOT omit a spot because it's well-known or touristy. It belongs here alongside the hidden gems.
- Score hiddenness (1–10) honestly so the user knows what to expect:
  1–3: Globally famous, on every tour itinerary
  4–6: Known to informed travellers
  7–10: Genuine local knowledge, rarely tourist-facing
- Score editorialConfidence on whether the entry is a real, specific place you are confident exists.
- Do NOT invent. Every entry must be a real place.
- Return as many genuine spots as you know — there is no target number.

${JSON_SCHEMA}`.trim();

const buildPromptPass1 = (city, interests) => `You are a specialist travel researcher focused on history, architecture, and neighbourhood character.

Research "${city}" — include ONLY spots from these categories:
- Unusual buildings, hidden architectural gems, historic courtyards, covered passages, forgotten corners
- Historical and heritage sites beyond the headline attractions
- Neighbourhood character: local squares, fountains, independent bookshops, antique markets, street art
- Quirky, offbeat, or genuinely unusual places with a story to tell
- Landmarks that deserve more attention than they get

Do NOT include restaurants, cafes, bars, food markets, nightlife, parks, or natural spaces.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => !['food', 'nightlife'].includes(i)).join(', ')}.` : ''}

Tag quirky, offbeat, or genuinely unusual spots with \`offbeat\` in their interests array.

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

const buildPromptPass2 = (city, interests) => `You are a specialist travel researcher focused on food culture, drink, and subculture.

Research "${city}" — include ONLY spots from these categories:
- Local restaurants beloved by residents but overlooked by tourists
- Hidden cafes, specialty coffee shops, neighbourhood bakeries
- Food markets, street food stalls, local specialty food shops and delis
- Independent bars, wine bars, craft beer spots far from the tourist circuit
- Underground or independent music venues, record shops, subculture hangouts
- Food halls and covered markets with genuine local character

Do NOT include historical landmarks, museums, parks, nature areas, or mainstream tourist restaurants.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => ['food', 'nightlife', 'markets'].includes(i)).join(', ')}.` : ''}

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

const buildPromptPass3 = (city, interests) => `You are a specialist travel researcher focused on nature, outdoor spaces, and contemplative spots.

Research "${city}" — include ONLY spots from these categories:
- Parks, gardens, and green spaces that locals actually use (not the famous tourist ones)
- Viewpoints, rooftops, and observation spots with genuine local character
- Religious and spiritual sites beyond the famous ones — small chapels, neighbourhood temples, hidden shrines
- Beaches, rivers, lakes, and waterfront spots away from tourist crowds
- Hiking routes, nature walks, and outdoor escapes within or near the city
- The real insider spots: the bench with the best view, the hidden garden, the quiet canal walk

Do NOT include restaurants, bars, cafes, historical museums, shopping areas, or nightlife.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => ['hiking', 'beaches', 'relaxation', 'photography', 'outdoor'].includes(i)).join(', ')}.` : ''}

Tag parks, gardens, hiking routes, nature walks, and outdoor spots with \`outdoor\` in their interests array (alongside \`hiking\` or \`beaches\` where also relevant).

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

const buildPromptPass4 = (city, interests) => `You are a specialist travel researcher focused on neighbourhood character and local street life.

Research "${city}" — include ONLY spots from these categories:
- Distinct residential neighbourhoods and districts with strong local identity that tourists walk through without stopping
- Local streets, lanes, alleyways, and thoroughfares worth exploring on foot
- Areas undergoing interesting change — up-and-coming districts, regenerated quarters, creative clusters
- Neighbourhood squares, local markets, community hubs that give each area its character
- Streets or blocks where independent shops, studios, and local businesses concentrate
- The kinds of areas where locals actually live, shop, and spend time

Do NOT include individual restaurants, bars, famous landmarks, parks, or tourist-facing attractions. Focus on areas and streets as destinations, not specific businesses.

${interests.length > 0 ? `Prioritise areas related to: ${interests.filter((i) => !['food', 'nightlife', 'beaches'].includes(i)).join(', ')}.` : ''}

Tag every spot in this pass with \`streets\` as their primary interest. Add other relevant tags alongside it.

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

const buildPromptPass5 = (city, interests) => `You are a specialist travel researcher focused on underground culture, subculture, and independent creative spaces.

Research "${city}" — include ONLY spots from these categories:
- Independent music venues, jazz clubs, experimental music spaces, and DIY concert venues
- Independent cinemas, arthouse film venues, and film societies
- Record shops, used bookshops, independent comics shops, and zine stores
- Art studios, artist-run galleries, printmaking studios, and ceramics workshops open to visitors
- Skateparks, skate spots, and skateboarding landmarks
- Significant street art locations, mural districts, and legal graffiti walls
- Hackerspaces, maker studios, community workshops
- Queer bars and LGBTQ+ cultural spaces
- Underground nightlife: techno clubs, basement venues, warehouse party locations (active ones)

Do NOT include mainstream museums, tourist restaurants, parks, or well-known attractions.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => ['nightlife', 'art', 'music', 'offbeat'].includes(i)).join(', ')}.` : ''}

Tag music venues, record shops, and live-music spaces with \`music\`. Tag DIY spaces, hackerspaces, skate spots, zine shops, and unusual subculture spots with \`offbeat\`.

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

const buildPromptPass6 = (city, interests) => `You are a specialist travel researcher focused on city edges, outskirts, and spots that require genuine effort to reach.

Research "${city}" — include ONLY spots from these categories:
- Lesser-known outer districts and edge neighbourhoods that tourists almost never visit
- Viewpoints and vantage points that require a walk, climb, or journey to reach — the reward-for-effort ones
- Hidden waterways: canal paths, hidden rivers, underground rivers with accessible sections, overgrown towpaths
- Reservoirs, filter beds, water treatment works with public access or interesting industrial heritage
- Urban farms, community gardens, allotment areas open to visitors
- Rooftop spots, elevated walkways, bridges with unusual views
- Industrial heritage: disused factories, railway infrastructure, decommissioned utilities with exploring interest
- Forgotten corners: overgrown cemeteries, abandoned buildings with legal access, liminal spaces

Do NOT include anything in the city centre, popular tourist areas, restaurants, or nightlife.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => ['hiking', 'photography', 'relaxation', 'outdoor', 'offbeat'].includes(i)).join(', ')}.` : ''}

Tag outdoor exploration, waterway, and nature spots with \`outdoor\`. Tag industrial heritage, liminal spaces, reservoirs, urban farms, and unusually hidden spots with \`offbeat\`.

${CITY_SIZE_GUIDE}

${JSON_SCHEMA}`.trim();

// ---------------------------------------------------------------------------
// Partial-JSON recovery
// ---------------------------------------------------------------------------

/**
 * Parse the AI's JSON response, with a truncation-recovery fallback.
 *
 * When gpt-4o-mini hits its 16,384-token output limit mid-response the JSON
 * is cut off (finish_reason="length"). Rather than throwing, we scan the raw
 * string for all complete { … } objects with balanced braces and return those.
 */
function safeParseSpots(raw) {
  // Happy path — response is well-formed
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.spots ?? []);
  } catch (_) {}

  // Recovery path — extract all complete spot objects before the cut-off
  console.warn('[safeParseSpots] JSON truncated — attempting partial recovery');
  const recovered = [];

  const spotsKey   = raw.indexOf('"spots"');
  if (spotsKey === -1) return recovered;
  const arrayStart = raw.indexOf('[', spotsKey);
  if (arrayStart === -1) return recovered;

  let depth    = 0;
  let objStart = -1;

  for (let i = arrayStart + 1; i < raw.length; i++) {
    const ch = raw[i];
    // Skip over string contents so braces inside values don't skew depth
    if (ch === '"') {
      i++;
      while (i < raw.length && !(raw[i] === '"' && raw[i - 1] !== '\\')) i++;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { recovered.push(JSON.parse(raw.slice(objStart, i + 1))); } catch (_) { /* skip malformed */ }
        objStart = -1;
      }
    }
  }

  console.warn(`[safeParseSpots] recovered ${recovered.length} complete spots from truncated response`);
  return recovered;
}

// ---------------------------------------------------------------------------
// OpenAI call
// ---------------------------------------------------------------------------

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env.local');

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

  const data   = await res.json();
  const choice = data.choices[0];
  const raw    = choice.message.content;

  if (choice.finish_reason === 'length') {
    console.warn('[callOpenAI] response hit output token limit (finish_reason=length) — partial recovery will be attempted');
  }

  const spots = safeParseSpots(raw);
  if (!spots.length) throw new Error('AI returned no spots for this pass. Please try again.');
  return spots;
}

// ---------------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------------

/** Normalise a spot name for fuzzy comparison */
function normalizeName(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')   // strip diacritics: café → cafe
    .replace(/[^a-z0-9\s]/g, ' ')                       // punctuation → space
    .replace(/\b(the|a|an|de|del|la|le|les|el|los|das|die|der)\b/g, '') // strip articles
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice-coefficient bigram similarity — returns 0..1 */
function bigramSim(a, b) {
  if (!a || !b) return 0;
  if (a === b)  return 1;
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let shared = 0;
  for (const bg of ba) if (bb.has(bg)) shared++;
  return (2 * shared) / (ba.size + bb.size);
}

/** True if two spot names refer to the same place */
function isDuplicate(nameA, nameB) {
  const na = normalizeName(nameA);
  const nb = normalizeName(nameB);
  if (!na || !nb)                     return false;
  if (na === nb)                      return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return bigramSim(na, nb) >= 0.80;
}

/** Merge spots from multiple passes; keep the higher-scored version on name collision */
function mergeAndDeduplicate(spotArrays) {
  const merged = [];
  for (const spots of spotArrays) {
    for (const spot of spots) {
      const idx = merged.findIndex((m) => isDuplicate(m.name, spot.name));
      if (idx === -1) {
        merged.push(spot);
      } else if ((spot.hiddennessScore ?? 0) > (merged[idx].hiddennessScore ?? 0)) {
        merged[idx] = spot; // keep higher-scored version
      }
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Geocoding helpers
// ---------------------------------------------------------------------------

async function getCityCenter(city, token) {
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(city)}.json?types=place&limit=1&access_token=${token}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.features?.length) return null;
  const feat = data.features[0];
  const [lng, lat] = feat.center;
  // Extract ISO country code (e.g. "pt") from the feature context so we can
  // constrain all subsequent spot-geocoding calls to the same country.
  const countryCtx  = feat.context?.find((c) => c.id.startsWith('country.'));
  const countryCode = countryCtx?.short_code?.split('-')[0] ?? null; // "pt", "gb", "us" …
  return { lat, lng, countryCode };
}

/** Approximate distance in km between two lat/lng points */
function distKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Strip postcodes from an address string.
 * Postcode centroids are often placed on roads, water, or open land — not the building.
 * Removing them forces Mapbox to resolve at street level instead.
 *
 * Handles:  PT 1900-312  ·  UK SW1A 2AA  ·  US 90210 / 90210-1234
 *           DE/ES/FR/IT 5-digit  ·  NL 1234 AB  ·  BE/CH 4-digit
 */
function stripPostcode(addr) {
  return addr
    .replace(/\b\d{4}-\d{3}\b/g, '')                          // PT: 1900-312
    .replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/gi, '') // UK: SW1A 2AA
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')                     // US/DE/ES/FR/IT: 90210
    .replace(/\b\d{4}\s[A-Z]{2}\b/gi, '')                     // NL: 1234 AB
    .replace(/\b\d{4}\b(?=\s*,|\s*$)/g, '')                   // BE/CH: 1000
    .replace(/,\s*,+/g, ',')                                   // collapse double commas
    .replace(/,\s*$/, '')                                      // trailing comma
    .trim();
}

/**
 * Geocode a single spot.
 *
 * Strategy (most → least precise):
 *   1. Name alone as POI (country-pinned) — Mapbox scores this highest; no postcode confusion
 *   2. Name + city as POI (country-pinned)
 *   3. Address (postcode stripped) + city (country-pinned)
 *   4. Address (postcode stripped) alone
 *   5. Name + neighbourhood + city
 *   6. Name + city with broad types (final fallback, no country filter)
 *   7. No bbox, country pinned — proximity + distKm guard only
 *   8. No bbox, no country — widest possible net
 *   9. Neighbourhood as query anchor
 */
async function geocodeSpot(spot, city, cityCenter, token) {
  const MAX_DIST_KM = 35;
  const country     = cityCenter.countryCode ?? null; // e.g. "pt"

  const tryQuery = async (query, types = 'poi,address', useCountry = true, useBbox = true) => {
    const pad  = 0.35; // ~39 km — wide enough to cover large metro areas like Tokyo
    const bbox = [
      cityCenter.lng - pad, cityCenter.lat - pad,
      cityCenter.lng + pad, cityCenter.lat + pad,
    ].join(',');

    let url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?proximity=${cityCenter.lng},${cityCenter.lat}&types=${types}&limit=1&access_token=${token}`;

    if (useBbox)               url += `&bbox=${bbox}`;
    if (useCountry && country) url += `&country=${country}`;

    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`[geocodeSpot] Mapbox HTTP ${r.status} for query="${query}" types=${types}`);
      return null;
    }
    const d = await r.json();
    if (!d.features?.length) return null;

    const [lng, lat] = d.features[0].center;
    if (distKm(lat, lng, cityCenter.lat, cityCenter.lng) > MAX_DIST_KM) return null;
    return { lat, lng };
  };

  try {
    let coords = null;

    // 1. POI name alone — cleanest query, highest Mapbox relevance score
    coords = await tryQuery(spot.name, 'poi');

    // 2. POI name + city
    if (!coords) {
      coords = await tryQuery(`${spot.name}, ${city}`, 'poi');
    }

    if (spot.address) {
      const addrClean = stripPostcode(spot.address);
      const addrLower = addrClean.toLowerCase();
      const cityLower = city.toLowerCase();
      const addrHasCity =
        addrLower.includes(cityLower) ||
        addrLower.split(/[\s,]+/).some((w) => cityLower.startsWith(w) && w.length > 3);

      // 3. Address (no postcode) + city
      if (!coords && !addrHasCity) {
        coords = await tryQuery(`${addrClean}, ${city}`, 'address,poi');
      }

      // 4. Address (no postcode) alone
      if (!coords) {
        coords = await tryQuery(addrClean, 'address,poi');
      }
    }

    // 5. Name + neighbourhood + city
    if (!coords && spot.neighbourhood) {
      coords = await tryQuery(`${spot.name}, ${spot.neighbourhood}, ${city}`, 'poi,address');
    }

    // 6. Final fallback — no country filter, broad types
    if (!coords) {
      coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', false);
    }

    // 7. No bbox, country pinned — proximity + distKm guard only
    if (!coords) {
      coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', true, false);
    }

    // 8. No bbox, no country — widest possible net (never use 'place' type — it
    //    returns the city itself and causes all failed spots to stack on one pin)
    if (!coords) {
      coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', false, false);
    }

    // 9. Neighbourhood as the query anchor — helps when the POI name isn't indexed
    if (!coords && spot.neighbourhood) {
      coords = await tryQuery(`${spot.neighbourhood}, ${city}`, 'neighborhood,locality,place', false, false);
    }

    if (coords) {
      return { ...spot, lat: coords.lat, lng: coords.lng, coordsMissing: false, geocodeSource: 'mapbox' };
    }
  } catch { /* fall through */ }

  return { ...spot, coordsMissing: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  const { city, interests = [], mode = 'curated', category = '' } = await request.json();
  if (!city) return new Response('{"error":"city is required"}', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Resilient send — silently ignores writes to an already-closed controller
      // (can happen when client disconnects mid-stream or after early return + finally)
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          if (e?.code !== 'ERR_INVALID_STATE') throw e;
        }
      };

      try {
        // ══ Deep mode: single comprehensive pass for ONE category ═════════════
        if (mode === 'deep' && category) {
          send('status', { message: `Researching all ${category} in ${city}…` });

          const deepRaw   = await callOpenAI(buildDeepPrompt(city, category));
          console.log(`[research/deep] ${city}/${category}: AI returned ${deepRaw.length} spots`);

          // No quality gate in deep mode — everything is labelled, nothing hidden
          const cleanSpots = deepRaw.map(({ lat, lng, latitude, longitude, ...rest }) => rest);
          if (!cleanSpots.length) throw new Error('AI returned no spots for this category.');

          send('status', { message: `${cleanSpots.length} ${category} spots found — geocoding…` });
          send('total',  { count: cleanSpots.length });

          const token      = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
          const cityCenter = token ? await getCityCenter(city, token) : null;

          let sent = 0, skipped = 0;
          const queue = cleanSpots.slice();

          const workers = Array.from(
            { length: Math.min(5, cleanSpots.length) },
            async () => {
              while (queue.length > 0) {
                const spot = queue.shift();
                if (!spot) continue;
                const geocoded = (token && cityCenter)
                  ? await geocodeSpot(spot, city, cityCenter, token)
                  : { ...spot, coordsMissing: true };
                if (geocoded.coordsMissing) { skipped++; }
                else { send('spot', { ...geocoded, deepCategory: category }); sent++; }
              }
            }
          );
          await Promise.all(workers);

          if (sent === 0) {
            send('error', { message: `Geocoding failed for all spots in ${city} / ${category}.` });
          } else {
            console.log(`[research/deep] ${city}/${category}: sent=${sent} skipped=${skipped}`);
            send('summary', { generated: deepRaw.length, unique: cleanSpots.length, geocoded: sent, dropped: skipped, city, category, mode: 'deep' });
            send('done', { total: sent });
          }
          return; // don't fall through to curated mode
        }

        // ══ Events mode: recurring events for one city (Glasgow-gated) ══════
        if (mode === 'events') {
          send('status', { message: `Researching recurring events in ${city}…` });
          const rawEvents = await callOpenAI(buildEventsPrompt(city));
          console.log(`[research/events] ${city}: AI returned ${rawEvents.length} events`);

          const cleanEvents = rawEvents.map(({ lat, lng, latitude, longitude, ...rest }) => ({
            ...rest,
            isEvent: true, // always tag as event regardless of what AI returned
          }));
          if (!cleanEvents.length) throw new Error('AI returned no events. Please try again.');

          send('status', { message: `${cleanEvents.length} events found — geocoding venues…` });
          send('total',  { count: cleanEvents.length });

          const token      = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
          const cityCenter = token ? await getCityCenter(city, token) : null;
          let sent = 0, skipped = 0;
          const evQueue = cleanEvents.slice();

          const evWorkers = Array.from(
            { length: Math.min(5, cleanEvents.length) },
            async () => {
              while (evQueue.length > 0) {
                const ev = evQueue.shift();
                if (!ev) continue;
                const geocoded = (token && cityCenter)
                  ? await geocodeSpot(ev, city, cityCenter, token)
                  : { ...ev, coordsMissing: true };
                if (geocoded.coordsMissing) { skipped++; }
                else { send('spot', geocoded); sent++; }
              }
            }
          );
          await Promise.all(evWorkers);

          if (sent === 0) {
            send('error', { message: `Geocoding failed for all events in ${city}.` });
          } else {
            console.log(`[research/events] ${city}: sent=${sent} skipped=${skipped}`);
            send('summary', { generated: rawEvents.length, geocoded: sent, dropped: skipped, city, mode: 'events' });
            send('done', { total: sent });
          }
          return;
        }

        // ══ Curated mode: 6-pass research ════════════════════════════════════
        // ── Pass 1: History, architecture, neighbourhood character ────────────
        send('status', { message: 'Pass 1 of 6 — researching history, architecture and neighbourhood character…' });
        const pass1 = await callOpenAI(buildPromptPass1(city, interests));
        console.log(`[research] Pass 1: received ${pass1.length} spots`);
        send('status', { message: `Pass 1 complete (${pass1.length} spots) — researching food, markets and nightlife…` });

        // ── Pass 2: Food, markets, nightlife, subculture ──────────────────────
        const pass2 = await callOpenAI(buildPromptPass2(city, interests));
        console.log(`[research] Pass 2: received ${pass2.length} spots`);
        send('status', { message: `Pass 2 complete (${pass2.length} spots) — researching parks, nature and local secrets…` });

        // ── Pass 3: Parks, nature, spiritual, viewpoints ──────────────────────
        const pass3 = await callOpenAI(buildPromptPass3(city, interests));
        console.log(`[research] Pass 3: received ${pass3.length} spots`);
        send('status', { message: `Pass 3 complete (${pass3.length} spots) — researching neighbourhoods and local streets…` });

        // ── Pass 4: Neighbourhoods, districts, local streets ──────────────────
        const pass4 = await callOpenAI(buildPromptPass4(city, interests));
        console.log(`[research] Pass 4: received ${pass4.length} spots`);
        send('status', { message: `Pass 4 complete (${pass4.length} spots) — researching underground culture and subculture…` });

        // ── Pass 5: Underground culture, music, art, subculture ───────────────
        const pass5 = await callOpenAI(buildPromptPass5(city, interests));
        console.log(`[research] Pass 5: received ${pass5.length} spots`);
        send('status', { message: `Pass 5 complete (${pass5.length} spots) — researching city edges and hidden outskirts…` });

        // ── Pass 6: City edges, outskirts, hidden waterways, rooftops ─────────
        const pass6 = await callOpenAI(buildPromptPass6(city, interests));
        console.log(`[research] Pass 6: received ${pass6.length} spots`);
        send('status', { message: `Pass 6 complete (${pass6.length} spots) — merging and deduplicating…` });

        // ── Merge + deduplicate ───────────────────────────────────────────────
        const totalGenerated    = pass1.length + pass2.length + pass3.length + pass4.length + pass5.length + pass6.length;
        const rawMerged         = mergeAndDeduplicate([pass1, pass2, pass3, pass4, pass5, pass6]);
        const duplicatesRemoved = totalGenerated - rawMerged.length;

        // ── Quality gate ─────────────────────────────────────────────────────
        // Drop spots the model itself rated below the confidence threshold.
        // Spots missing the field (e.g. from old cached data) pass through at 0.5.
        const afterQuality      = rawMerged.filter(s => (s.editorialConfidence ?? 0.5) >= CONFIDENCE_THRESHOLD);
        const droppedByQuality  = rawMerged.length - afterQuality.length;
        if (droppedByQuality > 0) {
          console.log(
            `[research] Quality gate: dropped ${droppedByQuality}/${rawMerged.length} spots ` +
            `(editorialConfidence < ${CONFIDENCE_THRESHOLD}) for ${city}`
          );
        } else {
          console.log(`[research] Quality gate: all ${rawMerged.length} spots passed (threshold ${CONFIDENCE_THRESHOLD})`);
        }

        // Strip any lat/lng the AI may have returned — coordinates come from Mapbox only
        const spots             = afterQuality.map(({ lat, lng, latitude, longitude, ...rest }) => rest);

        if (!spots.length) throw new Error('AI returned no spots. Please try again.');

        send('status', { message: `${spots.length} spots after quality filter (${duplicatesRemoved} dupes + ${droppedByQuality} quality drops) — geocoding locations…` });
        send('total',  { count: spots.length });

        // ── Geocode ───────────────────────────────────────────────────────────
        // Prefer a server-only token to avoid unnecessarily using the public-bundle token.
        const token      = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const cityCenter = token ? await getCityCenter(city, token) : null;

        if (!cityCenter) {
          console.warn(`[/api/research] getCityCenter failed for "${city}" — geocoding unavailable`);
        }

        let sent    = 0;
        let skipped = 0;

        // Geocode with up to 5 concurrent workers — reduces research time ~4×
        // compared to sequential processing.
        const CONCURRENCY = 5;
        const queue = spots.slice();

        const processSpot = async (spot) => {
          const geocoded = (token && cityCenter)
            ? await geocodeSpot(spot, city, cityCenter, token)
            : { ...spot, coordsMissing: true };

          if (geocoded.coordsMissing) {
            skipped++;
          } else {
            send('spot', geocoded);
            sent++;
          }
        };

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, spots.length) },
          async () => {
            while (queue.length > 0) {
              const spot = queue.shift();
              if (spot) await processSpot(spot);
            }
          },
        );
        await Promise.all(workers);

        if (sent === 0) {
          const reason = !cityCenter
            ? `Mapbox could not locate "${city}" — check your Mapbox token or try a different city name.`
            : `Mapbox geocoding failed for all ${skipped} spot${skipped !== 1 ? 's' : ''} in ${city}. The city may be outside the supported region or the token may be rate-limited.`;
          send('error', { message: reason });
        } else {
          if (skipped > 0) {
            console.log(`[/api/research] ${city}: sent=${sent} skipped=${skipped} (geocoding failed)`);
          }
          send('summary', { generated: totalGenerated, unique: spots.length, geocoded: sent, dropped: skipped, qualityDropped: droppedByQuality, city });
          send('done',    { total: sent });
        }
      } catch (err) {
        console.error('[/api/research] error:', err);
        send('error', { message: err.message ?? 'Research failed' });
      } finally {
        // Always close — safe to call even if already closed (client disconnected etc.)
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream; charset=utf-8',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
