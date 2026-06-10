// src/lib/spotWrites.js
// Pure helpers for planning Firestore spot writes — no side effects, fully testable.

/**
 * Normalise a spot name for merge-dedup comparison.
 * Strips diacritics and collapses whitespace so "Café Nord" matches "Cafe Nord".
 * Kept intentionally simple (no article-stripping) so merge stays exact after
 * normalisation — fuzzy dedup during research is handled by isDuplicate in route.js.
 */
export function normaliseName(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given the current Firestore spots for a city and the incoming batch from research,
 * decide which docs to update in-place (preserving their ID) and which to create fresh.
 *
 * @param {{ id: string, name: string }[]} existingSpots  — current Firestore docs
 * @param {object[]}                       incomingSpots  — spots returned by research
 * @returns {{ updates: { id: string, spot: object }[], creates: object[] }}
 */
export function planSpotWrites(existingSpots, incomingSpots) {
  const byName = new Map(existingSpots.map((s) => [normaliseName(s.name), s.id]));

  const updates = [];
  const creates = [];
  for (const spot of incomingSpots) {
    const id = byName.get(normaliseName(spot.name));
    if (id) updates.push({ id, spot });
    else    creates.push(spot);
  }
  return { updates, creates };
}
