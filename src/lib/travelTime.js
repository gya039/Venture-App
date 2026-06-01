// src/lib/travelTime.js
// Haversine-based travel time estimates — no external API needed.
// Walk assumed at 5 km/h; transit at 30 km/h.

const R_KM = 6371;

/**
 * Straight-line distance in km between two lat/lng points (haversine formula).
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns a travel chip descriptor between two spots, or null if either has no coords.
 *
 * Returns: { label: string, mode: 'walk'|'transit', km: number } | null
 */
export function travelChip(spotA, spotB) {
  if (
    !spotA?.lat || !spotA?.lng || spotA.coordsMissing ||
    !spotB?.lat || !spotB?.lng || spotB.coordsMissing
  ) return null;

  const km = haversineKm(spotA.lat, spotA.lng, spotB.lat, spotB.lng);
  if (km < 0.05) return null; // same spot essentially

  if (km < 2) {
    const mins = Math.max(1, Math.round((km / 5) * 60));
    return { label: `~${mins} min walk`, mode: 'walk', km };
  }
  const mins = Math.max(1, Math.round((km / 30) * 60));
  return { label: `~${mins} min by transit`, mode: 'transit', km };
}

/** Human-readable distance label */
export function fmtKm(km) {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}
