'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import InterestPicker from './InterestPicker';
import { updateUserPrefs } from '@/lib/db';
import { useTripModal } from '@/components/TripModalProvider';
import { track } from '@/lib/analytics';

/* ── Travel style presets ──────────────────────────────────────────────────── */
const TRAVEL_STYLES = [
  {
    id: 'foodie',
    icon: '🍜',
    name: 'Food & Nightlife',
    desc: 'Street food, local restaurants, bars and hidden gems for eating and drinking',
    interests: ['food', 'nightlife', 'markets'],
  },
  {
    id: 'culture',
    icon: '🏛️',
    name: 'Culture & History',
    desc: 'Museums, monuments, art galleries and architectural marvels',
    interests: ['museums', 'art', 'monuments'],
  },
  {
    id: 'nature',
    icon: '🌿',
    name: 'Nature & Adventure',
    desc: 'Parks, hiking trails, beaches and outdoor escapes',
    interests: ['hiking', 'beaches', 'photography'],
  },
  {
    id: 'relax',
    icon: '💆',
    name: 'Relaxation & Vibes',
    desc: 'Spas, cosy cafés, scenic spots and slow travel experiences',
    interests: ['relaxation', 'photography', 'markets'],
  },
];

/* ── Mapbox city autocomplete ──────────────────────────────────────────────── */
async function fetchCitySuggestions(query) {
  if (!query || query.length < 2) return [];
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return [];
  try {
    const res  = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?types=place&language=en&limit=5&access_token=${token}`);
    const data = await res.json();
    return (data.features ?? []).map((f) => ({
      name:    f.text,
      country: f.context?.find((c) => c.id.startsWith('country'))?.text ?? '',
      id:      f.id,
    }));
  } catch { return []; }
}

/**
 * OnboardingModal — 3-step post-signup flow.
 *
 * Step 0: Travel style (4 preset cards)
 * Step 1: Home city (optional)
 * Step 2: "You're set!" + plan first trip CTA
 */
export default function OnboardingModal({ userId, onClose }) {
  const tripModal = useTripModal();

  const [step,      setStep]      = useState(0);
  const [style,     setStyle]     = useState(null);   // selected TRAVEL_STYLES id
  const [interests, setInterests] = useState([]);
  const [homeCity,  setHomeCity]  = useState('');
  const [saving,    setSaving]    = useState(false);

  // City autocomplete (step 1)
  const [suggestions,  setSuggestions]  = useState([]);
  const [showSug,      setShowSug]      = useState(false);
  const [sugLoading,   setSugLoading]   = useState(false);
  const debounceRef = useRef(null);
  const sugRef      = useRef(null);
  const inputRef    = useRef(null);

  const TOTAL_STEPS = 3;

  const handleStyleSelect = (s) => {
    setStyle(s.id);
    setInterests(s.interests);
  };

  /* ── City input autocomplete ─────────────────────────────────────────────── */
  const handleCityChange = useCallback((val) => {
    setHomeCity(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSug(false); return; }
    setSugLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await fetchCitySuggestions(val);
      setSuggestions(results);
      setShowSug(results.length > 0);
      setSugLoading(false);
    }, 300);
  }, []);

  useEffect(() => {
    function onDown(e) {
      if (sugRef.current && !sugRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSug(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /* ── Save & close ─────────────────────────────────────────────────────────── */
  async function saveAndContinue() {
    setSaving(true);
    try {
      await updateUserPrefs(userId, {
        interests,
        ...(homeCity.trim() && { homeCity: homeCity.trim() }),
        onboardingComplete: true,
      });
    } catch (err) {
      console.error('Onboarding save error:', err);
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    await saveAndContinue();
    track('onboarding_completed', { style, interestCount: interests.length, hasHomeCity: !!homeCity.trim() });
    onClose?.();
  }

  async function finishAndPlan() {
    await saveAndContinue();
    track('onboarding_completed', { style, interestCount: interests.length, hasHomeCity: !!homeCity.trim() });
    onClose?.();
    // Pass the user's selected interests so TripModal can suggest matching cities
    setTimeout(() => tripModal?.openModal('', interests), 100);
  }

  async function skip() {
    try { await updateUserPrefs(userId, { onboardingComplete: true }); } catch {}
    onClose?.();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(4,4,12,0.9)',
      backdropFilter: 'blur(16px)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{
        width: '100%', maxWidth: 460,
        background: '#0f0f1a',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 24,
        padding: '32px 28px 28px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        animation: 'toastIn 0.25s ease',
      }}>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={{
              height: 4, borderRadius: 2,
              width: i === step ? 28 : i < step ? 16 : 10,
              background: i <= step ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
              transition: 'width 0.25s, background 0.25s',
            }} />
          ))}
        </div>

        {/* ── Step 0: Travel Style ─────────────────────────────────────────── */}
        {step === 0 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>✦</div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
                Welcome to Venture
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                What kind of traveller are you? We'll tailor hidden gems to match your style.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {TRAVEL_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleStyleSelect(s)}
                  className={`style-card${style === s.id ? ' selected' : ''}`}
                >
                  <span className="style-card-icon">{s.icon}</span>
                  <div>
                    <p className="style-card-name">{s.name}</p>
                    <p className="style-card-desc">{s.desc}</p>
                  </div>
                  {style === s.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '1.1rem', flexShrink: 0 }}>✓</span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
              >
                {style ? 'Continue →' : 'Skip this step →'}
              </button>
              <button type="button" onClick={skip}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', padding: '6px' }}>
                Skip setup entirely
              </button>
            </div>
          </>
        )}

        {/* ── Step 1: Home City ────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>🏡</div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
                Where are you based?
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Optional — helps Venture suggest nearby getaways and exclude your home city from hidden gems.
              </p>
            </div>

            {/* City input with autocomplete */}
            <div style={{ position: 'relative', marginBottom: 24 }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="e.g. London, Amsterdam, New York…"
                value={homeCity}
                onChange={(e) => handleCityChange(e.target.value)}
                onFocus={() => { if (suggestions.length > 0) setShowSug(true); }}
                style={{
                  width: '100%', padding: '12px 14px',
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.9rem',
                  outline: 'none', boxSizing: 'border-box',
                }}
                onFocusCapture={(e) => (e.target.style.borderColor = 'var(--accent)')}
                onBlurCapture={(e)  => (e.target.style.borderColor = 'var(--border)')}
                onKeyDown={(e) => { if (e.key === 'Enter' && homeCity) { setShowSug(false); setStep(2); } }}
                autoFocus
              />
              {sugLoading && (
                <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite' }} />
              )}

              {showSug && suggestions.length > 0 && (
                <div ref={sugRef} style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#131320', border: '1px solid var(--border)',
                  borderRadius: 10, boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden',
                }}>
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setHomeCity(s.name); setShowSug(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border)',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--card-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ opacity: 0.4, flexShrink: 0 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <div>
                        <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.country}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
              >
                Continue →
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" onClick={() => setStep(0)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', padding: '6px' }}>
                  ← Back
                </button>
                <button type="button" onClick={() => setStep(2)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', padding: '6px' }}>
                  Skip
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Ready to explore ──────────────────────────────────────── */}
        {step === 2 && (
          <>
            <button type="button" onClick={() => setStep(1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0 16px', textAlign: 'left', display: 'block' }}>
              ← Back
            </button>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{
                width: 72, height: 72, margin: '0 auto 20px',
                borderRadius: 20, background: 'linear-gradient(135deg, #f59e0b, #f97316)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '2rem', boxShadow: '0 8px 32px rgba(245,158,11,0.3)',
              }}>🌍</div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
                You're all set!
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Venture is ready to find hidden gems anywhere in the world. Start by planning your first trip.
              </p>
            </div>

            {/* Summary of preferences */}
            {(style || homeCity) && (
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '14px 16px', marginBottom: 24,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {style && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1rem' }}>{TRAVEL_STYLES.find(s => s.id === style)?.icon}</span>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Travel style</p>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>{TRAVEL_STYLES.find(s => s.id === style)?.name}</p>
                    </div>
                  </div>
                )}
                {homeCity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1rem' }}>📍</span>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Home city</p>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>{homeCity}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={finishAndPlan}
                disabled={saving}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: '0.95rem', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Plan my first trip →'}
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={saving}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', padding: '6px' }}
              >
                Explore the dashboard first
              </button>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
