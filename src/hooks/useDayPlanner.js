'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { getDayPlans, getDayPlanSpots, getCachedSpots } from '@/lib/db';

/**
 * Loads day plans for a destination, with their spots fully assembled.
 *
 * Returns:
 *   days: [{
 *     id, dayNumber, planDate,
 *     spots: [{ ...spotData, dayPlanSpotId, timeOfDay, sortOrder }],
 *     totalCost: number,
 *   }]
 *   loading, error, refetch
 */
export function useDayPlanner(destId, city) {
  const { user, authReady } = useAuth();

  const [days,    setDays]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchData = async () => {
    if (!destId || !city || !authReady || !user) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    try {
      // 1. Day plans for this destination (userId required by Firestore security rule)
      const plans = await getDayPlans(destId, user.uid);

      // 2. All researched spots for the city (one batch read)
      const allSpots = await getCachedSpots(city);
      const spotMap  = Object.fromEntries(allSpots.map(s => [s.id, s]));

      // 3. Day plan spots for each plan
      const assembled = await Promise.all(plans.map(async (plan) => {
        const dpSpots = await getDayPlanSpots(plan.id);
        const spots = dpSpots
          .map(dps => {
            // Events store all their data inline (spotId is null)
            if (dps.isEvent) {
              return { ...dps, dayPlanSpotId: dps.id };
            }
            const spot = spotMap[dps.spotId];
            if (!spot) return null;
            return { ...spot, dayPlanSpotId: dps.id, timeOfDay: dps.timeOfDay, sortOrder: dps.sortOrder };
          })
          .filter(Boolean)
          // Safety net: deduplicate by dayPlanSpotId in case Firestore has stale duplicates
          .filter((sp, idx, arr) => arr.findIndex(x => x.dayPlanSpotId === sp.dayPlanSpotId) === idx)
          .sort((a, b) => {
            const order = { morning: 0, afternoon: 1, evening: 2 };
            return (order[a.timeOfDay] ?? 3) - (order[b.timeOfDay] ?? 3) || a.sortOrder - b.sortOrder;
          });

        const totalCost = spots.reduce((sum, s) => sum + (s.entryPrice ?? 0), 0);
        return { ...plan, spots, totalCost };
      }));

      setDays(assembled);
    } catch (err) {
      console.error('useDayPlanner error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [destId, city, authReady, user?.uid]); // eslint-disable-line

  return { days, loading, error, refetch: fetchData };
}
