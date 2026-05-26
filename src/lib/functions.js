// src/lib/functions.js
// Research helper — calls the Next.js /api/research route (server-side OpenAI call),
// then writes spots into Firestore and marks the destination as researched.
// No Firebase Cloud Functions / Blaze plan required.

import { cacheSpots, markResearchDone, getCachedSpots } from './db';

/**
 * Run AI research for a city.
 *
 * @param {string}   city        City name
 * @param {string[]} interests   Interest IDs to bias the prompt
 * @param {string}   [destId]    Destination doc ID — marked researchDone after run
 * @param {boolean}  [force]     Skip cache check and re-run even if spots exist
 * @returns {{ spots: object[], cached: boolean }}
 */
export async function runResearch(city, interests = [], destId, force = false) {
  // 1. Check Firestore cache (unless force)
  if (!force) {
    const cached = await getCachedSpots(city);
    if (cached.length > 0) {
      if (destId) await markResearchDone(destId).catch(() => {});
      return { spots: cached, cached: true };
    }
  }

  // 2. Call Next.js API route → OpenAI on the server (90s timeout)
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 90_000);

  let res;
  try {
    res = await fetch('/api/research', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ city, interests }),
      signal:  controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Research timed out after 90 seconds. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Research request failed (${res.status})`);
  }

  const { spots } = await res.json();

  // 3. Write spots to Firestore city cache
  await cacheSpots(city, spots);

  // 4. Mark destination as researched
  if (destId) await markResearchDone(destId).catch(() => {});

  return { spots, cached: false };
}
