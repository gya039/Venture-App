'use client';

import { useState, useEffect } from 'react';
import { track } from '@/lib/analytics';

/**
 * InstallBanner — shows an "Add to Home Screen" prompt on supported browsers.
 *
 * Uses the `beforeinstallprompt` event (Chrome/Edge/Android).
 * Hides itself:
 *  - if already installed (display-mode: standalone)
 *  - after the user dismisses it (localStorage flag)
 *  - on iOS (handled separately via native Safari banner)
 */
export default function InstallBanner() {
  const [prompt,      setPrompt]      = useState(null);
  const [visible,     setVisible]     = useState(false);
  const [installing,  setInstalling]  = useState(false);
  const [isIOS,       setIsIOS]       = useState(false);
  const [iosDismissed,setIosDismissed]= useState(true); // default hidden

  // Capture the deferred install prompt as soon as the browser fires it
  // (fires before or after the user creates a trip — we hold it and show later)
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Show the banner only after the user has created their first trip
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem('pwa-banner-dismissed')) return;

    function check() {
      if (!localStorage.getItem('hasCreatedTrip')) return;

      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
      if (ios) {
        setIsIOS(true);
        setIosDismissed(false);
      } else if (prompt) {
        setVisible(true);
      }
    }

    check();

    // Re-check when trip creation fires a storage event (same-tab workaround)
    const onTripCreated = () => check();
    window.addEventListener('venture:tripCreated', onTripCreated);
    return () => window.removeEventListener('venture:tripCreated', onTripCreated);
  }, [prompt]); // re-run when deferred prompt is captured

  const dismiss = () => {
    localStorage.setItem('pwa-banner-dismissed', '1');
    setVisible(false);
    setIosDismissed(true);
  };

  const install = async () => {
    if (!prompt) return;
    setInstalling(true);
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('pwa-banner-dismissed', '1');
      track('install_prompt_accepted');
    }
    setVisible(false);
    setInstalling(false);
  };

  // ── iOS banner ─────────────────────────────────────────────────────────
  if (isIOS && !iosDismissed) {
    return (
      <div style={{
        position:      'fixed',
        bottom:        'calc(var(--nav-height, 64px) + env(safe-area-inset-bottom) + 8px)',
        left:          12, right: 12,
        zIndex:        150,
        background:    'var(--card)',
        border:        '1px solid rgba(245,158,11,0.3)',
        borderRadius:  14,
        padding:       '14px 16px',
        boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
        animation:     'fadeInUp 0.3s ease both',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <img src="/icons/apple-touch-icon.png" alt="" width={40} height={40} style={{ borderRadius: 9, flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 3 }}>Add Venture to Home Screen</p>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Tap <strong style={{ color: 'var(--text-secondary)' }}>Share</strong> then <strong style={{ color: 'var(--text-secondary)' }}>Add to Home Screen</strong> for the full app experience.
              </p>
            </div>
          </div>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
        </div>
        {/* Arrow pointing down to Safari toolbar */}
        <div style={{
          position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
          width: 16, height: 8, overflow: 'hidden',
        }}>
          <div style={{ width: 12, height: 12, background: 'var(--card)', border: '1px solid rgba(245,158,11,0.3)', transform: 'rotate(45deg)', marginTop: -6, marginLeft: 2 }} />
        </div>
      </div>
    );
  }

  // ── Chrome/Android banner ──────────────────────────────────────────────
  if (!visible) return null;

  return (
    <div style={{
      position:      'fixed',
      bottom:        'calc(var(--nav-height, 64px) + env(safe-area-inset-bottom) + 8px)',
      left:          12, right: 12,
      zIndex:        150,
      background:    'var(--card)',
      border:        '1px solid rgba(245,158,11,0.3)',
      borderRadius:  14,
      padding:       '14px 16px',
      boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
      animation:     'fadeInUp 0.3s ease both',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 9, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 2 }}>Install Venture</p>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Add to your home screen for the best experience</p>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', padding: '4px', flexShrink: 0 }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={dismiss}
          style={{ flex: 1, padding: '9px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.82rem', cursor: 'pointer' }}
        >
          Not now
        </button>
        <button
          onClick={install}
          disabled={installing}
          style={{ flex: 2, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
        >
          {installing ? 'Installing…' : '📲 Install App'}
        </button>
      </div>
    </div>
  );
}
