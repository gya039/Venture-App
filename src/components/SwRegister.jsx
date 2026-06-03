'use client';
import { useEffect } from 'react';

// Registers the service worker in production.
// DevSwKiller handles unregistering it in development so hot-reload stays clean.
export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => console.error('[SW] registration failed:', err));
    }
  }, []);
  return null;
}
