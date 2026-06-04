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

/**
 * Total straight-line distance (km) along a sequence of spots.
 * Skips legs where either spot has no coordinates.
 */
export function totalDistKm(spots) {
  let total = 0;
  for (let i = 0; i < spots.length - 1; i++) {
    const a = spots[i], b = spots[i + 1];
    if (a?.lat && a?.lng && b?.lat && b?.lng && !a.coordsMissing && !b.coordsMissing) {
      total += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }
  return total;
}

/**
 * Nearest-neighbour route suggestion for a day's spots.
 *
 * startLat / startLng — accommodation coordinates (used as the route start).
 *   If omitted, starts from the first geocoded spot.
 *
 * Returns the spots array reordered to minimise total straight-line travel.
 * Spots without coordinates are appended at the end unchanged.
 *
 * Complexity: O(n²) — fine for the 3–15 spots typical in a day plan.
 */
export function suggestOrder(spots, startLat = null, startLng = null) {
  const withCoords = spots.filter((s) => s.lat && s.lng && !s.coordsMissing);
  const noCoords   = spots.filter((s) => !s.lat || !s.lng ||  s.coordsMissing);

  if (withCoords.length <= 1) return spots; // nothing to optimise

  const remaining = [...withCoords];
  const ordered   = [];

  let curLat, curLng;

  if (startLat != null && startLng != null) {
    // Start route from accommodation
    curLat = startLat;
    curLng = startLng;
  } else {
    // No accommodation — start from the first geocoded spot
    const first = remaining.shift();
    ordered.push(first);
    curLat = first.lat;
    curLng = first.lng;
  }

  while (remaining.length > 0) {
    let bestIdx  = 0;
    let bestDist = haversineKm(curLat, curLng, remaining[0].lat, remaining[0].lng);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineKm(curLat, curLng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }

  return [...ordered, ...noCoords];
}
