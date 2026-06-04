// src/lib/functions.js
// Research helper — calls the Next.js /api/research SSE route,
// streams spots one-by-one via onSpot callback, caches to Firestore on completion.

import { cacheSpots, markResearchDone, getCachedSpots, getCachedDeepSpots, cacheDeepSpots, getCityEvents, cacheCityEvents, getCachedPopularSpots, cachePopularSpots } from './db';

/**
 * Run AI research for a city with streaming callbacks.
 *
 * @param {string}   city        City name
 * @param {string[]} interests   Interest IDs to bias the prompt
 * @param {string}   [destId]    Destination doc ID — marked researchDone after run
 * @param {boolean}  [force]     Skip cache check and re-run even if spots exist
 * @param {object}   [callbacks]
 * @param {Function} [callbacks.onSpot]   Called with each spot object as it arrives
 * @param {Function} [callbacks.onStatus] Called with status message strings
 * @returns {{ spots: object[], cached: boolean }}
 */
export async function runResearch(
  city,
  interests = [],
  destId,
  force = false,
  { onSpot, onStatus, onSummary } = {},
) {
  // 1. Check Firestore cache (unless force-refreshing)
  if (!force) {
    const cached = await getCachedSpots(city);
    if (cached.length > 0) {
      if (destId) await markResearchDone(destId).catch(() => {});
      return { spots: cached, cached: true };
    }
  }

  onStatus?.('Consulting AI travel researcher…');

  // 2. Open SSE connection to the Next.js route
  const res = await fetch('/api/research', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ city, interests }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Research request failed (${res.status})`);
  }

  // 3. Read the SSE stream chunk-by-chunk
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  const allSpots = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by double newlines
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? ''; // keep incomplete trailing chunk

    for (const part of parts) {
      if (!part.trim()) continue;

      let event = 'message';
      let data  = '';

      for (const line of part.split('\n')) {
        if (line.startsWith('event: '))      event = line.slice(7).trim();
        else if (line.startsWith('data: '))  data  = line.slice(6).trim();
      }

      if (!data) continue;

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        console.warn('[runResearch] malformed SSE data:', data);
        continue;
      }

      if (event === 'status') {
        onStatus?.(payload.message);
      } else if (event === 'spot') {
        allSpots.push(payload);
        onSpot?.(payload);
      } else if (event === 'summary') {
        onSummary?.(payload);
      } else if (event === 'error') {
        throw new Error(payload.message ?? 'Research failed');
      }
      // 'total' and 'done' are informational — no action needed here
    }
  }

  if (!allSpots.length) throw new Error('AI returned no spots. Please try again.');

  // 4. Write all spots to the Firestore city cache
  await cacheSpots(city, allSpots, force);

  // 5. Mark destination as research-complete
  if (destId) await markResearchDone(destId).catch(() => {});

  return { spots: allSpots, cached: false };
}

/**
 * Deep research — comprehensive list for a single category.
 * Checks the deep cache first; hits the API only on a miss.
 *
 * @param {string}   city       City name
 * @param {string}   category   Category label (e.g. "Food & Drink")
 * @param {boolean}  [force]    Skip cache and re-fetch
 * @param {object}   [callbacks]
 */
export async function runDeepResearch(
  city,
  category,
  force = false,
  { onSpot, onStatus, onSummary } = {},
) {
  // 1. Check deep cache
  if (!force) {
    const cached = await getCachedDeepSpots(city, category);
    if (cached.length > 0) {
      cached.forEach((s) => onSpot?.(s));
      onSummary?.({ geocoded: cached.length, city, category, mode: 'deep', fromCache: true });
      return { spots: cached, cached: true };
    }
  }

  onStatus?.(`Researching all ${category} in ${city}…`);

  // 2. POST to /api/research with mode:'deep'
  const res = await fetch('/api/research', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ city, category, mode: 'deep' }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Deep research failed (${res.status})`);
  }

  // 3. Stream SSE — same pattern as runResearch
  const reader   = res.body.getReader();
  const decoder  = new TextDecoder();
  const allSpots = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message', data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: '))     event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data  = line.slice(6).trim();
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }

      if      (event === 'status')  onStatus?.(payload.message);
      else if (event === 'spot')    { allSpots.push(payload); onSpot?.(payload); }
      else if (event === 'summary') onSummary?.(payload);
      else if (event === 'error')   throw new Error(payload.message ?? 'Deep research failed');
    }
  }

  if (!allSpots.length) throw new Error('AI returned no spots for this category. Please try again.');

  // 4. Cache deep spots separately
  await cacheDeepSpots(city, category, allSpots).catch((err) =>
    console.error('[runDeepResearch] cache error:', err)
  );

  return { spots: allSpots, cached: false };
}

/**
 * Popular spots research — tourist must-sees, clearly separate from hidden gems.
 * Checks the Firestore popular cache first; hits AI only on a miss.
 */
export async function runPopularResearch(
  city,
  force = false,
  { onSpot, onStatus, onSummary } = {},
) {
  if (!force) {
    const cached = await getCachedPopularSpots(city);
    if (cached.length > 0) {
      cached.forEach((s) => onSpot?.(s));
      onSummary?.({ geocoded: cached.length, city, mode: 'popular', fromCache: true });
      return { spots: cached, cached: true };
    }
  }

  onStatus?.(`Finding top attractions in ${city}…`);

  const res = await fetch('/api/research', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ city, mode: 'popular' }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Popular research failed (${res.status})`);
  }

  const reader   = res.body.getReader();
  const decoder  = new TextDecoder();
  const allSpots = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message', data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: '))     event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data  = line.slice(6).trim();
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      if      (event === 'status')  onStatus?.(payload.message);
      else if (event === 'spot')    { allSpots.push(payload); onSpot?.(payload); }
      else if (event === 'summary') onSummary?.(payload);
      else if (event === 'error')   throw new Error(payload.message ?? 'Popular research failed');
    }
  }

  if (!allSpots.length) throw new Error('No popular spots found. Please try again.');

  await cachePopularSpots(city, allSpots).catch((err) =>
    console.error('[runPopularResearch] cache error:', err)
  );

  return { spots: allSpots, cached: false };
}

/**
 * Recurring-events research for a single city (Glasgow-gated).
 * Checks the events cache first; hits the AI only on a miss.
 */
export async function runEventsResearch(
  city,
  force = false,
  { onEvent, onStatus, onSummary } = {},
) {
  // 1. Check events cache
  if (!force) {
    const cached = await getCityEvents(city);
    if (cached.length > 0) {
      cached.forEach((e) => onEvent?.(e));
      onSummary?.({ geocoded: cached.length, city, mode: 'events', fromCache: true });
      return { events: cached, cached: true };
    }
  }

  onStatus?.(`Researching recurring events in ${city}…`);

  const res = await fetch('/api/research', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ city, mode: 'events' }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Events research failed (${res.status})`);
  }

  const reader    = res.body.getReader();
  const decoder   = new TextDecoder();
  const allEvents = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.trim()) continue;
      let ev = 'message', data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: '))     ev   = line.slice(7).trim();
        else if (line.startsWith('data: ')) data = line.slice(6).trim();
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      if      (ev === 'status')  onStatus?.(payload.message);
      else if (ev === 'spot')    { allEvents.push(payload); onEvent?.(payload); }
      else if (ev === 'summary') onSummary?.(payload);
      else if (ev === 'error')   throw new Error(payload.message ?? 'Events research failed');
    }
  }

  if (!allEvents.length) throw new Error('AI returned no events. Please try again.');

  await cacheCityEvents(city, allEvents).catch((err) =>
    console.error('[runEventsResearch] cache error:', err)
  );

  return { events: allEvents, cached: false };
}
