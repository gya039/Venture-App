// src/app/api/research/route.js
// Streams research results via Server-Sent Events.
// Flow: 3 × OpenAI passes (history/architecture · food/nightlife · nature/outdoor)
//       → merge + deduplicate by name → geocode via Mapbox → SSE each spot.

// Vercel Hobby tier caps at 60s; Pro tier supports up to 300s.
// Streaming means spots found before the cutoff are still returned.
export const maxDuration = 60;

import { normaliseCategory } from '@/lib/categories';

// ---------------------------------------------------------------------------
// Geocode sanity threshold
// ---------------------------------------------------------------------------

/**
 * Maximum distance (km) a geocoded result may be from the city centre and still
 * be accepted.  Generous enough to include genuine day-trip spots (lakes,
 * villages, viewpoints 20–30 km out) while rejecting clear misplacements.
 *
 * Exported so the audit script and unit tests can reference the same value.
 */
export const GEOCODE_SANITY_KM = 35;

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
      "hiddennessLabel": "Tourist Trail|Well-Trodden|Worth a Detour|Local Secret|Off the Radar",
      "editorialConfidence": <float 0.0–1.0>,
      "category": "Art|Architecture|Bar|Beach|Café|Food|History|Market|Museum|Music|Nature|Nightlife|Offbeat|Park|Shopping|Spa|Spiritual",
      "interests": ["hiking","food","museums","art","nightlife","beaches","markets","monuments","photography","relaxation","music","streets","offbeat","outdoor"],
      "entryPrice": <number in local currency of the city (GBP for UK cities, USD for US cities, JPY for Japan, etc.); the ACTUAL standalone admission price even if the spot is included in a city pass; 0 if genuinely free to everyone; null if unknown>,
      "passIncluded": <boolean: true ONLY if this spot is free solely because it is bundled in a city tourist pass and has no independently-free entry — false for all genuinely free spots and all spots with real entry prices>,
      "currency": "<ISO 4217 code for the city's local currency, e.g. GBP for UK cities, USD for US, EUR for Eurozone, JPY for Japan, THB for Thailand, KRW for South Korea>",
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

CRITICAL RULES — violation means the spot will be rejected:
1. NEVER return a whole neighbourhood, district, or area as a spot (e.g. "West End", "Southside", "Finnieston" by itself is not a spot). Every entry must be a specific named venue, building, market, restaurant, park, or attraction — something with a door or an entrance you can walk through.
2. NEVER use "Other" as a category. It does not exist. Pick the closest category from this exact list: Art | Architecture | Bar | Beach | Café | Food | History | Market | Museum | Music | Nature | Nightlife | Offbeat | Park | Shopping | Spa | Spiritual. If a spot doesn't fit a single category perfectly, pick the CLOSEST one. Examples: a rooftop observation deck → Architecture; a public bath → Spa; a street-art mural → Art; a food hall → Food; a bookshop → Shopping; a comedy club → Offbeat; a yoga studio → Spa.
3. Do NOT use the same name as a neighbourhood as the spot name unless it refers to a specific place (e.g. "Southside" as a venue name is invalid; "Southside Market" at a specific address is valid).
4. Use the city's LOCAL currency for entryPrice and the currency field — do NOT convert to EUR for non-Eurozone cities.
5. Every spot MUST have a unique, specific name — not a generic description like "Local Café" or "Hidden Gem Restaurant". If you cannot name it specifically, omit it.

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
      "entryPrice": <number in the city's LOCAL currency; 0 if free; null if unknown>,
      "currency": "<ISO 4217 code for the city's local currency, e.g. GBP for UK cities, EUR for Eurozone, JPY for Japan>",
      "visitDurationMinutes": <typical duration in minutes>
    }
  ]
}

Confidence scoring:
0.8–1.0: Well-established, almost certainly still running, specific details confirmed
0.5–0.7: Probably still running but less certain about current schedule
0.2–0.4: You know this existed but uncertain if it's still running

IMPORTANT: Return complete, valid JSON. Close the array cleanly if approaching output limit.`;

const buildPopularPrompt = (city) => `You are a travel researcher producing a list of the most iconic and essential tourist attractions in ${city}.

These are the MUST-SEE, well-known places — the famous landmarks, top museums, celebrated restaurants, and unmissable experiences that every visitor should know about. These are NOT hidden gems.

Include:
- World-famous or nationally-famous landmarks and monuments
- Top-rated museums, galleries, and cultural institutions
- Iconic viewpoints, parks, and public spaces that define the city
- The restaurants, cafes, and food spots that have become famous
- Shopping streets, markets, and areas tourists love
- Celebrated hotels, rooftop bars, or entertainment venues
- Anything that appears on "must-see in ${city}" lists

Rules:
- Score hiddennessScore HONESTLY: 1–3 for global icons, 4–5 for well-known local favourites
- Set editorialConfidence HIGH (0.85–1.0) only for places you're certain are still operating, excellent, and genuinely worth visiting
- Include practical info: opening hours, prices, address
- Return 15–30 spots — the essential highlights, not an exhaustive list
- Every spot MUST be real and currently operating (as of your knowledge cutoff)

${JSON_SCHEMA}`.trim();

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

const buildPromptPass4 = (city, interests) => `You are a specialist travel researcher focused on street-level local life and specific community spaces.

Research "${city}" — each entry must be a SPECIFIC named place, not a whole neighbourhood or area. Focus on:
- A named mural, mosaic, or piece of street art at a specific location
- A specific community garden, allotment, or hidden green space with a name
- A named local square, fountain, or courtyard that is a genuine local meeting point
- A specific independent shop, studio, or workshop with a distinct identity (record shop, printmaker, vintage store)
- A named community hall, social club, or local institution that reflects the city's character
- A specific market stall, food hall, or street vendor that is a local institution
- A specific pedestrian street, lane, or passageway worth exploring (named, with a precise address)

Every spot MUST have a specific name and address — "Finnieston" is not a spot; "Vintage Guru, Finnieston" at 231 Dumbarton Rd is.
Do NOT return whole neighbourhoods, districts, or areas as a spot name.
Do NOT include restaurants, bars, famous landmarks, or tourist-facing attractions.

${interests.length > 0 ? `Prioritise spots related to: ${interests.filter((i) => !['food', 'nightlife', 'beaches'].includes(i)).join(', ')}.` : ''}

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
// Streaming OpenAI — parse spot objects incrementally as tokens arrive
// ---------------------------------------------------------------------------

/**
 * Find the character index just after the opening `[` of the "spots" array
 * in the accumulated JSON text. Returns -1 if not yet present.
 */
function findSpotsArrayStart(text) {
  const keyIdx = text.indexOf('"spots"');
  if (keyIdx === -1) return -1;
  const bracketIdx = text.indexOf('[', keyIdx);
  return bracketIdx === -1 ? -1 : bracketIdx + 1;
}

/**
 * Extract all complete top-level `{…}` objects from `text`.
 * Returns the parsed objects and the unconsumed tail (an incomplete object
 * or whitespace between objects).
 */
function extractCompleteObjects(text) {
  const objects = [];
  let depth        = 0;
  let objStart     = -1;
  let lastEnd      = 0;
  let parseFailures = 0;
  let i            = 0;

  while (i < text.length) {
    const ch = text[i];

    // Skip over quoted strings so braces inside values don't count
    if (ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"')  { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { objects.push(JSON.parse(text.slice(objStart, i + 1))); }
        catch { parseFailures++; } // silently consumed — now counted
        lastEnd  = i + 1;
        objStart = -1;
      }
    }
    i++;
  }

  return { objects, remaining: text.slice(lastEnd), parseFailures };
}

/**
 * Async generator that streams a single OpenAI completion and yields each
 * spot object as soon as its closing `}` token arrives in the stream.
 * This lets callers start geocoding + forwarding spots to the client
 * immediately rather than waiting for the full JSON response.
 */
async function* streamOpenAISpots(prompt, stats = {}) {
  stats.parseFailures = 0;
  stats.finishReason  = null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env.local');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:           'gpt-4o-mini',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.4,
      response_format: { type: 'json_object' },
      stream:          true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf   = '';   // incomplete SSE line buffer
  let jsonAccum = '';  // accumulated JSON content text
  let inArray   = false; // true once we've found the opening '[' of the spots array

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuf += decoder.decode(value, { stream: true });
      const lines = sseBuf.split('\n');
      sseBuf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        // Capture finish_reason whenever OpenAI sets it (arrives on the last content chunk)
        const fr = chunk.choices?.[0]?.finish_reason;
        if (fr) stats.finishReason = fr;

        const token = chunk.choices?.[0]?.delta?.content;
        if (!token) continue;

        jsonAccum += token;

        // Wait until we've buffered past the opening of the spots array
        if (!inArray) {
          const arrayStart = findSpotsArrayStart(jsonAccum);
          if (arrayStart === -1) continue;
          jsonAccum = jsonAccum.slice(arrayStart);
          inArray   = true;
        }

        // Pull out every complete spot object that's now available
        const { objects, remaining, parseFailures } = extractCompleteObjects(jsonAccum);
        stats.parseFailures += parseFailures;
        jsonAccum = remaining;

        for (const obj of objects) yield obj;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Concurrency-bounded work queue.
 * Limits how many async jobs run simultaneously; extras queue and auto-drain.
 */
class BoundedQueue {
  constructor(concurrency) {
    this._limit   = concurrency;
    this._active  = 0;
    this._pending = [];
  }
  add(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        this._active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => {
          this._active--;
          if (this._pending.length > 0) this._pending.shift()();
        });
      };
      if (this._active < this._limit) run();
      else this._pending.push(run);
    });
  }
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

/**
 * Approximate distance in km between two lat/lng points (equirectangular).
 * Exported so the audit script and sanity-check unit tests can use it directly.
 */
export function distKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Returns true when geocoded coords are within GEOCODE_SANITY_KM of the city
 * centre; false means the result should be retried or nulled out.
 * Pure function — no I/O, safe to unit-test without mocking Mapbox.
 */
export function passesSanity(coords, cityCenter, thresholdKm = GEOCODE_SANITY_KM) {
  if (!coords?.lat || !coords?.lng) return false;
  if (!cityCenter?.lat || !cityCenter?.lng) return true; // no centre to check against
  return distKm(coords.lat, coords.lng, cityCenter.lat, cityCenter.lng) <= thresholdKm;
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
 * Categories that represent a geographic area rather than a specific venue.
 * Only these are allowed to resolve to neighborhood/locality Mapbox features.
 * All other categories (Art, Museum, Bar, Café, Park, …) must resolve to POI
 * or address results so that POI names containing a place name (e.g. "The
 * Whitworth Art Gallery") are never assigned the coords of the place itself.
 */
const AREA_CATEGORIES = new Set(['Neighbourhood']);

function isAreaCategory(category) {
  return AREA_CATEGORIES.has(category);
}

/**
 * Geocode a single spot.
 *
 * Strategy (most → least precise):
 *   1. Address (postcode stripped) — runs first when present; a real street
 *      address is more precise than any name-based guess and prevents place-name
 *      collisions (e.g. "Whitworth Art Gallery" on Oxford Road vs. the town of
 *      Whitworth near Rochdale).
 *   2. Name as POI only (country-pinned, bbox)
 *   3. Name + city as POI only (country-pinned, bbox)
 *   4. Name + neighbourhood + city (poi,address)
 *   5. Name + city — broad types, no country filter
 *   6. Name + city — country pinned, no bbox
 *   7. Name + city — no country, no bbox (widest POI net)
 *   8. Neighbourhood field as query anchor (neighborhood,locality,place)
 *   9. Area-gated locality fallback — only for spots whose category is an
 *      explicit geographic area (Neighbourhood).  Resolves district/docklands
 *      names like "Salford Quays" that are indexed by Mapbox as neighborhoods
 *      rather than POIs.
 */
export async function geocodeSpot(spot, city, cityCenter, token) {
  // Uses module-level GEOCODE_SANITY_KM — change that constant to tune for all modes.
  const country = cityCenter.countryCode ?? null; // e.g. "pt"
  let anyFeaturesFound = false; // true if Mapbox returned features on any strategy

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

    anyFeaturesFound = true; // Mapbox returned a candidate — failure (if any) is a sanity rejection
    const [lng, lat] = d.features[0].center;
    if (!passesSanity({ lat, lng }, cityCenter)) return null;
    return { lat, lng };
  };

  try {
    let coords = null;

    // 1. Address first — a concrete address beats any name-based guess and prevents
    //    locality collisions for POIs whose name contains a place name.
    if (spot.address) {
      const addrClean = stripPostcode(spot.address);
      const addrLower = addrClean.toLowerCase();
      const cityLower = city.toLowerCase();
      const addrHasCity =
        addrLower.includes(cityLower) ||
        addrLower.split(/[\s,]+/).some((w) => cityLower.startsWith(w) && w.length > 3);

      coords = await tryQuery(
        addrHasCity ? addrClean : `${addrClean}, ${city}`,
        'address,poi'
      );
      // If the city-suffixed form failed and we haven't yet tried the bare address, try it.
      if (!coords && !addrHasCity) {
        coords = await tryQuery(addrClean, 'address,poi');
      }
    }

    // 2. Name as POI only — never neighborhood/locality here; prevents place-name
    //    collisions such as "The Whitworth Art Gallery" → town of Whitworth.
    if (!coords) coords = await tryQuery(spot.name, 'poi');

    // 3. Name + city as POI only
    if (!coords) coords = await tryQuery(`${spot.name}, ${city}`, 'poi');

    // 4. Name + neighbourhood + city
    if (!coords && spot.neighbourhood) {
      coords = await tryQuery(`${spot.name}, ${spot.neighbourhood}, ${city}`, 'poi,address');
    }

    // 5. Name + city — broad types, no country filter
    if (!coords) coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', false);

    // 6. Name + city — country pinned, no bbox
    if (!coords) coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', true, false);

    // 7. Name + city — no country, no bbox (widest POI net; never use 'place' type —
    //    it returns the city itself and causes all failed spots to stack on one pin)
    if (!coords) coords = await tryQuery(`${spot.name}, ${city}`, 'poi,address', false, false);

    // 8. Neighbourhood field as query anchor — helps when the POI name isn't indexed
    if (!coords && spot.neighbourhood) {
      coords = await tryQuery(`${spot.neighbourhood}, ${city}`, 'neighborhood,locality,place', false, false);
    }

    // 9. Area-gated locality fallback — ONLY for spots whose category is an explicit
    //    geographic area (e.g. Neighbourhood).  Resolves docklands/district names
    //    (Salford Quays, Northern Quarter) that Mapbox indexes as neighborhoods, not POIs.
    //    Non-area categories (Art, Museum, Bar, Café, …) must never reach this step.
    if (!coords && isAreaCategory(spot.category)) {
      coords = await tryQuery(spot.name, 'neighborhood,locality');
      if (!coords) coords = await tryQuery(`${spot.name}, ${city}`, 'neighborhood,locality', false, false);
    }

    if (coords) {
      return { ...spot, lat: coords.lat, lng: coords.lng, coordsMissing: false, geocodeSource: 'mapbox' };
    }

    // All strategies exhausted.  Report why: either Mapbox found no features at all,
    // or it returned features that all fell outside the GEOCODE_SANITY_KM radius.
    const failReason = anyFeaturesFound ? 'sanity_rejected' : 'no_features';
    console.warn(
      `[geocodeSpot] "${spot.name}" in ${city}: ` +
      (anyFeaturesFound
        ? `all results outside ${GEOCODE_SANITY_KM} km sanity gate`
        : 'no Mapbox features on any strategy')
    );
    return { ...spot, coordsMissing: true, geocodeFailReason: failReason };
  } catch { /* fall through */ }

  return { ...spot, coordsMissing: true, geocodeFailReason: 'error' };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  const { city, interests = [], mode = 'curated', category = '' } = await request.json();
  // ── Popular mode: tourist must-sees, non-streaming ──────────────────────────
  if (mode === 'popular') {
    const encoder = new TextEncoder();
    const stream  = new ReadableStream({
      async start(controller) {
        const send = (event, data) => {
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
          catch (e) { if (e?.code !== 'ERR_INVALID_STATE') throw e; }
        };
        try {
          send('status', { message: `Finding top attractions in ${city}…` });
          const raw    = await callOpenAI(buildPopularPrompt(city));
          const clean  = raw.map(({ lat, lng, latitude, longitude, ...rest }) => ({
            ...rest, category: normaliseCategory(rest.category), isPopular: true,
          }));
          send('total', { count: clean.length });
          const token      = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
          const cityCenter = token ? await getCityCenter(city, token) : null;
          let sent = 0, skipped = 0;
          const queue   = clean.slice();
          const workers = Array.from({ length: Math.min(5, clean.length) }, async () => {
            while (queue.length > 0) {
              const spot = queue.shift();
              if (!spot) continue;
              const geocoded = (token && cityCenter)
                ? await geocodeSpot(spot, city, cityCenter, token)
                : { ...spot, coordsMissing: true };
              if (geocoded.coordsMissing) { skipped++; }
              else { send('spot', geocoded); sent++; }
            }
          });
          await Promise.all(workers);
          send('summary', { generated: raw.length, geocoded: sent, dropped: skipped, city, mode: 'popular' });
          send('done', { total: sent });
        } catch (err) {
          send('error', { message: err.message ?? 'Popular research failed' });
        } finally {
          try { controller.close(); } catch {}
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }
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

          // No quality gate in deep mode — everything is labelled, nothing hidden.
          // Normalise category to the canonical set.
          const cleanSpots = deepRaw.map(({ lat, lng, latitude, longitude, ...rest }) => ({
            ...rest,
            category: normaliseCategory(rest.category),
          }));
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

        // ══ Curated mode: 6-pass streaming research ══════════════════════════
        // All 6 passes stream concurrently via OpenAI's streaming API.
        // Each spot is quality-gated + deduped + geocoded as soon as its closing
        // `}` arrives — pins appear on the client map within ~10–15 s of starting.
        send('status', { message: 'Starting AI research across 6 specialist categories…' });

        // Geocode city centre first so workers can start immediately
        const token      = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const cityCenter = token ? await getCityCenter(city, token) : null;
        if (!cityCenter) {
          console.warn(`[/api/research] getCityCenter failed for "${city}"`);
        }

        // ── Shared cross-pass state ───────────────────────────────────────────
        const seenNames       = [];   // accumulated names for live dedup; first-version wins
        const geocodePromises = [];   // collected so we can await all at the end
        const unlocated       = [];   // spots that failed geocoding: [{ name, reason }]
        let sent                  = 0;
        let skipped               = 0;
        let geocodeNoResults      = 0; // Mapbox returned no features on any strategy
        let geocodeSanityRejected = 0; // features returned but all outside sanity radius
        let totalGenerated        = 0;
        let qualityDropped        = 0;
        let dedupDropped          = 0;
        let completedPasses       = 0;

        // Bounded geocoding pool (max 5 concurrent Mapbox requests)
        const geoPool = new BoundedQueue(5);

        /**
         * Called for every spot that arrives from any streaming pass.
         * Applies quality gate + cross-pass dedup synchronously (JS single-thread
         * guarantees no interleaving between processSpot calls at await points),
         * then submits geocoding to the bounded pool without blocking the caller.
         * passStats receives per-pass quality/dedup breakdowns for the funnel log.
         */
        const processIncomingSpot = (spot, passStats) => {
          totalGenerated++;
          // Quality gate
          if ((spot.editorialConfidence ?? 0.5) < CONFIDENCE_THRESHOLD) {
            qualityDropped++;
            passStats.qualityDropped = (passStats.qualityDropped ?? 0) + 1;
            return;
          }
          // Cross-pass dedup — first version wins (avoids downstream rewrite complexity)
          if (seenNames.some(n => isDuplicate(n, spot.name))) {
            dedupDropped++;
            passStats.dedupDropped = (passStats.dedupDropped ?? 0) + 1;
            return;
          }
          seenNames.push(spot.name);
          passStats.queuedForGeocode = (passStats.queuedForGeocode ?? 0) + 1;
          // Strip any AI-provided coordinates; Mapbox is the authoritative geocoder.
          // Normalise category to the canonical set at point of generation.
          const { lat, lng, latitude, longitude, ...rest } = spot;
          const clean = { ...rest, category: normaliseCategory(rest.category) };
          // Queue the geocoding work and collect the promise so we can await at the end
          geocodePromises.push(
            geoPool.add(async () => {
              const geocoded = (token && cityCenter)
                ? await geocodeSpot(clean, city, cityCenter, token)
                : { ...clean, coordsMissing: true, geocodeFailReason: 'no_token' };
              if (!geocoded.coordsMissing) { send('spot', geocoded); sent++; }
              else {
                const reason = geocoded.geocodeFailReason ?? 'unknown';
                unlocated.push({ name: clean.name, reason });
                if (reason === 'sanity_rejected') geocodeSanityRejected++;
                else geocodeNoResults++;
                skipped++;
              }
            })
          );
        };

        // ── Run all 6 passes in parallel, streaming spots as they arrive ──────
        const PASS_CONFIGS = [
          { label: 'History & Architecture', prompt: buildPromptPass1(city, interests) },
          { label: 'Food & Nightlife',       prompt: buildPromptPass2(city, interests) },
          { label: 'Parks & Nature',         prompt: buildPromptPass3(city, interests) },
          { label: 'Neighbourhoods',         prompt: buildPromptPass4(city, interests) },
          { label: 'Subculture & Arts',      prompt: buildPromptPass5(city, interests) },
          { label: 'City Edges & Hidden',    prompt: buildPromptPass6(city, interests) },
        ];

        await Promise.all(
          PASS_CONFIGS.map(async ({ label, prompt }) => {
            let passCount = 0;
            const passStats = { parseFailures: 0, finishReason: null, qualityDropped: 0, dedupDropped: 0, queuedForGeocode: 0 };
            try {
              for await (const spot of streamOpenAISpots(prompt, passStats)) {
                processIncomingSpot(spot, passStats);
                passCount++;
              }
            } catch (err) {
              // A single failing pass doesn't abort the whole run
              console.error(`[research] ${label} pass error:`, err.message);
            }
            completedPasses++;
            console.log(
              `[research/funnel] ${label} (${completedPasses}/6): ` +
              `yielded=${passCount} | parseErr=${passStats.parseFailures} | ` +
              `qualityDrop=${passStats.qualityDropped} | dedupDrop=${passStats.dedupDropped} | ` +
              `geocodeQueued=${passStats.queuedForGeocode} | finishReason=${passStats.finishReason ?? 'unknown'}`
            );
            send('status', {
              message: `${completedPasses}/6 passes complete — ${seenNames.length} unique gems found, geocoding in progress…`,
            });
          })
        );

        // ── All streaming done; wait for any in-flight geocoding to finish ────
        await Promise.all(geocodePromises);

        if (sent === 0) {
          const reason = !cityCenter
            ? `Mapbox could not locate "${city}" — check your Mapbox token or try a different city name.`
            : `Mapbox geocoding failed for all ${skipped} spot${skipped !== 1 ? 's' : ''} in ${city}.`;
          send('error', { message: reason });
        } else {
          console.log(
            `[research/funnel] ${city} TOTALS: ` +
            `generated=${totalGenerated} | qualityDropped=${qualityDropped} | dedupDropped=${dedupDropped} | ` +
            `geocodeQueued=${seenNames.length} | geocodeOK=${sent} | ` +
            `geocodeNoResults=${geocodeNoResults} | geocodeSanityRejected=${geocodeSanityRejected}`
          );
          send('summary', {
            generated:            totalGenerated,
            unique:               seenNames.length,
            geocoded:             sent,
            dropped:              skipped,
            geocodeNoResults,
            geocodeSanityRejected,
            unlocated,
            qualityDropped,
            dedupDropped,
            city,
          });
          send('done', { total: sent });
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
