/**
 * City spots — static seed data merged with Firestore in getCachedSpots().
 * Source of truth is src/data/spots/*.js — one file per city.
 */
import { citySpots as _citySpots } from './spots/index.js';

export const citySpots = _citySpots;

/**
 * Get static spots for a city — case-insensitive match.
 */
export function getStaticSpots(city) {
  const normalised = city.toLowerCase();
  return citySpots.filter((s) => s.city.toLowerCase() === normalised);
}
