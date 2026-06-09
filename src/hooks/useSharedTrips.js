'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { listenSharedTrips } from '@/lib/db';

/**
 * Real-time listener for trips that other users have shared with the current user.
 * Returns { trips, loading } where each trip has isSharedWithMe: true.
 */
export function useSharedTrips() {
  const { user, loading: authLoading, authReady } = useAuth();
  const [trips,   setTrips]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !authReady) return;
    if (!user) { setTrips([]); setLoading(false); return; }

    setLoading(true);
    const unsub = listenSharedTrips(
      user.uid,
      (data) => { setTrips(data); setLoading(false); },
      (err)  => { console.error('[useSharedTrips]', err); setLoading(false); }
    );
    return unsub;
  }, [user?.uid, authLoading, authReady]); // eslint-disable-line

  return { trips, loading: loading || authLoading };
}
