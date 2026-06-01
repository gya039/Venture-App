'use client';

import { useState, useEffect } from 'react';

/**
 * OfflineBanner — shows a sticky banner when the user loses connectivity.
 * Listens to the browser's online/offline events.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Set initial state
    setOffline(!navigator.onLine);

    const handleOffline = () => setOffline(true);
    const handleOnline  = () => setOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online',  handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online',  handleOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={{
      position:   'fixed',
      top:        0,
      left:       0,
      right:      0,
      zIndex:     999,
      background: 'rgba(220,38,38,0.95)',
      backdropFilter: 'blur(8px)',
      padding:    '9px 16px',
      display:    'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap:        8,
      fontSize:   '0.8rem',
      fontWeight: 600,
      color:      '#fff',
      fontFamily: 'system-ui, sans-serif',
      animation:  'slideDown 0.25s ease',
    }}>
      <style>{`@keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
      <span>📶</span>
      <span>You're offline — some features may be unavailable</span>
    </div>
  );
}
