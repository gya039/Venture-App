'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { upsertUser } from '@/lib/db';

const CACHE_KEY = 'venture_uid';

export function useAuth() {
  // Always start undefined — same on server and client first render (no hydration mismatch)
  const [user,      setUser]      = useState(undefined);
  const [loading,   setLoading]   = useState(true);
  // authReady = true only once Firebase has confirmed the session (safe for Firestore writes)
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Seed from localStorage after mount (client-only, never runs on server)
    try {
      const uid = localStorage.getItem(CACHE_KEY);
      if (uid) {
        setUser({ uid, _cached: true });
        setLoading(false); // show content instantly on repeat visits
      }
    } catch {}

    if (!auth) {
      setUser(null);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      setUser(null);
      setLoading(false);
    }, 5000);

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      clearTimeout(timeout);
      if (firebaseUser) {
        try { localStorage.setItem(CACHE_KEY, firebaseUser.uid); } catch {}
        upsertUser(firebaseUser.uid, firebaseUser.email, firebaseUser.displayName).catch(() => {});
        setUser(firebaseUser);
      } else {
        try { localStorage.removeItem(CACHE_KEY); } catch {}
        setUser(null);
      }
      setAuthReady(true);
      setLoading(false);
    });

    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  return { user, loading, authReady };
}
