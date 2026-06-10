// src/app/api/generate-itinerary/route.js
// Deterministic itinerary generator — uses the local planner, no OpenAI calls.

import { generatePlan } from '../../../lib/itineraryPlanner.js';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    const { city, days, spots, accommodation, savedSpotIds = [], lockedAssignments = [] } = await request.json();

    if (!city || !days?.length || !spots?.length) {
      return Response.json({ error: 'city, days, and spots are required' }, { status: 400 });
    }

    // Mark each spot with isStarred so the planner knows which to prioritise
    const savedSet   = new Set(savedSpotIds);
    const markedSpots = spots.map(s => ({ ...s, isStarred: savedSet.has(s.id) }));

    // If accommodation coords are missing, fall back to centroid of starred (then all) spots
    let anchor = accommodation;
    if (!accommodation?.lat || !accommodation?.lng) {
      const anchors = markedSpots.filter(s => s.isStarred && s.lat && s.lng);
      const pool    = anchors.length ? anchors : markedSpots.filter(s => s.lat && s.lng);
      if (pool.length) {
        anchor = {
          lat: pool.reduce((sum, x) => sum + Number(x.lat), 0) / pool.length,
          lng: pool.reduce((sum, x) => sum + Number(x.lng), 0) / pool.length,
        };
      }
    }

    const { assignments, unplaced, dayMeta } = generatePlan({
      spots: markedSpots,
      accommodation: anchor,
      days,
      lockedAssignments,
    });

    // Resolve spot names for the unplaced list
    const spotNameMap = new Map(spots.map(s => [s.id, s.name]));
    const unplacedOut = unplaced.map(({ spot, reason }) => ({
      spotId: spot.id,
      name:   spotNameMap.get(spot.id) ?? spot.name,
      reason,
    }));

    // If no accommodation was provided, prefix day reasons so the UI can surface it
    const finalMeta = accommodation?.lat
      ? dayMeta
      : dayMeta.map(m => ({
          ...m,
          reason: `No accommodation set — planned around the centre of your spots. ${m.reason}`,
        }));

    return Response.json({
      assignments,
      assignedCount: assignments.length,
      unplaced:      unplacedOut,
      dayMeta:       finalMeta,
    });
  } catch (err) {
    console.error('[generate-itinerary] error:', err);
    return Response.json({ error: err.message ?? 'Generation failed' }, { status: 500 });
  }
}
