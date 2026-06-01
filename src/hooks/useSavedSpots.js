'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSavedSpots, saveSpot, unsaveSpot } from '@/lib/db';

/**
 * useSavedSpots — manages the user's bookmarked spots.
 *
 * Returns:
 *   savedIds   {Set<string>}  set of saved spotIds
 *   toggle     {fn}           toggle(spot, wantSaved) — optimistic + persisted
 *   loading    {boolean}
 */
export function useSavedSpots(userId) {
  const [savedIds, setSavedIds] = useState(new Set());
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    getSavedSpots(userId)
      .then((spots) => setSavedIds(new Set(spots.map((s) => s.spotId).filter(Boolean))))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  const toggle = useCallback(async (spot, wantSaved) => {
    if (!userId || !spot?.id) return;

    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (wantSaved) next.add(spot.id);
      else next.delete(spot.id);
      return next;
    });

    try {
      if (wantSaved) await saveSpot(userId, spot);
      else await unsaveSpot(userId, spot.id);
    } catch (err) {
      console.error('Save spot error:', err);
      // Rollback on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wantSaved) next.delete(spot.id);
        else next.add(spot.id);
        return next;
      });
    }
  }, [userId]);

  return { savedIds, toggle, loading };
}
