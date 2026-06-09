// src/lib/timeFit.js
// Pure helpers for classifying when a spot fits best in the day.
// No Firebase, React, or Next.js imports.

import { normaliseCategory } from './categories.js';

const DAY_ABBR = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
};

const EVENING_ONLY_CATS = new Set(['Bar', 'Nightlife', 'Music']);
const MORNING_PREF_CATS = new Set(['Café', 'Market']);
const DAYTIME_CATS      = new Set(['Beach', 'Nature', 'Park', 'Museum', 'Art', 'Architecture', 'History']);

function toMins(t) {
  if (!t || typeof t !== 'string') return null;
  const parts = t.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * True if the spot is open at all on a given ISO date (YYYY-MM-DD).
 * Unknown or missing hours → true.
 */
export function isOpenOnWeekday(spot, date) {
  if (!spot?.openingHours || !date) return true;
  try {
    const dow  = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const abbr = DAY_ABBR[dow];
    if (!abbr) return true;
    const hrs = spot.openingHours[abbr];
    if (hrs === 'closed') return false;
    return true; // missing key or any other value → assume open
  } catch {
    return true;
  }
}

/**
 * Classify the best time-of-day fit for a spot.
 *
 * Opening hours take priority over category if they're parseable as "HH:MM-HH:MM".
 * Any parse failure falls silently back to the category-based default.
 * Never throws.
 *
 * Returns { fit: 'evening-only'|'morning-pref'|'daytime'|'any', reason: string }
 */
export function getTimeFit(spot) {
  const cat = normaliseCategory(spot?.category);

  // Try to derive from opening hours first
  if (spot?.openingHours) {
    try {
      const hourStrings = Object.values(spot.openingHours)
        .filter(h => h && h !== 'closed' && typeof h === 'string');

      if (hourStrings.length > 0) {
        const openMins = hourStrings
          .map(h => toMins(h.split('-')[0]))
          .filter(m => m !== null);
        const closeMins = hourStrings
          .map(h => toMins(h.split('-')[1]))
          .filter(m => m !== null);

        if (openMins.length > 0) {
          const minOpen = Math.min(...openMins);
          if (minOpen >= 17 * 60) {
            const hh = String(Math.floor(minOpen / 60)).padStart(2, '0');
            const mm = String(minOpen % 60).padStart(2, '0');
            return { fit: 'evening-only', reason: `Opens at ${hh}:${mm} — evening only` };
          }
        }
        if (closeMins.length > 0) {
          const maxClose = Math.max(...closeMins);
          if (maxClose <= 14 * 60) {
            const hh = String(Math.floor(maxClose / 60)).padStart(2, '0');
            const mm = String(maxClose % 60).padStart(2, '0');
            return { fit: 'morning-pref', reason: `Closes by ${hh}:${mm} — morning preferred` };
          }
        }
      }
    } catch {
      // fall through to category default
    }
  }

  if (EVENING_ONLY_CATS.has(cat)) return { fit: 'evening-only', reason: `${cat} — evening only by category` };
  if (MORNING_PREF_CATS.has(cat)) return { fit: 'morning-pref', reason: `${cat} — morning preferred by category` };
  if (DAYTIME_CATS.has(cat))      return { fit: 'daytime',      reason: `${cat} — daytime (morning or afternoon)` };
  return { fit: 'any', reason: `${cat} — no slot preference` };
}

const VISIT_MINS_BY_CAT = {
  Museum:    90,
  Art:       90,
  Market:    60,
  Food:      75,
  Café:      45,
  Nature:    60,
  Park:      60,
  Bar:       90,
  Nightlife: 90,
};

/**
 * Estimated visit duration in minutes.
 * Uses spot.visitDurationMinutes if a positive number, otherwise falls back to
 * category defaults (museum/gallery 90, café 45, food 75, bar/nightlife 90, rest 60).
 */
export function getVisitMinutes(spot) {
  const explicit = spot?.visitDurationMinutes;
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  const cat = normaliseCategory(spot?.category);
  return VISIT_MINS_BY_CAT[cat] ?? 60;
}
