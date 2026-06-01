'use client';

import { useState, useEffect } from 'react';
import { getDestinationWithSpots } from '@/lib/db';

/**
 * Fetches a destination + its researched spots from Firestore.
 * Spots come from the citySpots cache — sorted by hiddennessScore desc.
 */
export function useDestination(destinationId) {
  const [destination, setDestination] = useState(null);
  const [spots,       setSpots]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const fetchData = async () => {
    if (!destinationId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getDestinationWithSpots(destinationId);
      setDestination(data?.destination ?? null);
      setSpots(data?.spots ?? []);
    } catch (err) {
      console.error('useDestination error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Clear stale data from previous destination immediately so the map
    // doesn't briefly show old city markers while the new city loads.
    setSpots([]);
    setDestination(null);
    setError(null);
    fetchData();
  }, [destinationId]); // eslint-disable-line

  return { destination, spots, loading, error, refetch: fetchData };
}
