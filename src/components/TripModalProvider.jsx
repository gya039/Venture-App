'use client';

// TripModalProvider — 4-step bottom-sheet modal for creating a new trip.
// Steps: Destination → Dates → Interests → Review
// Provides openModal(prefillCity?) via useTripModal() hook.

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { createTrip, generateDayPlans, getCityTemplates } from '@/lib/db';
import InterestPicker from '@/components/InterestPicker';
import { useToast } from '@/components/ToastProvider';
import { track } from '@/lib/analytics';

const Ctx = createContext(null);
export const useTripModal = () => useContext(Ctx);

const STEPS = ['Destination', 'Dates', 'Interests', 'Review'];

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('');
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const INPUT = {
  width: '100%', padding: '11px 14px',
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.95rem',
  outline: 'none', boxSizing: 'border-box', colorScheme: 'dark',
  transition: 'border-color 0.15s',
};

const LABEL = {
  display: 'block', fontSize: '0.68rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 8,
};

/* ── Curated cities with interest tags (for suggestions) ─────────────────── */
const CURATED_CITIES = [
  { city: 'Amsterdam',   cc: 'NL', tags: ['museums', 'art', 'nightlife', 'markets'] },
  { city: 'Lisbon',      cc: 'PT', tags: ['food', 'markets', 'photography', 'relaxation'] },
  { city: 'Tokyo',       cc: 'JP', tags: ['food', 'markets', 'nightlife', 'photography'] },
  { city: 'Barcelona',   cc: 'ES', tags: ['art', 'beaches', 'food', 'nightlife'] },
  { city: 'Prague',      cc: 'CZ', tags: ['monuments', 'nightlife', 'markets'] },
  { city: 'Vienna',      cc: 'AT', tags: ['museums', 'art', 'relaxation'] },
  { city: 'Budapest',    cc: 'HU', tags: ['nightlife', 'relaxation', 'monuments'] },
  { city: 'Berlin',      cc: 'DE', tags: ['art', 'nightlife', 'museums'] },
  { city: 'Kyoto',       cc: 'JP', tags: ['relaxation', 'photography', 'monuments', 'hiking'] },
  { city: 'Bangkok',     cc: 'TH', tags: ['food', 'markets', 'monuments'] },
  { city: 'Porto',       cc: 'PT', tags: ['food', 'photography', 'relaxation'] },
  { city: 'Seoul',       cc: 'KR', tags: ['food', 'nightlife', 'markets', 'art'] },
  { city: 'Copenhagen',  cc: 'DK', tags: ['food', 'relaxation', 'design'] },
  { city: 'Mexico City', cc: 'MX', tags: ['art', 'food', 'markets', 'monuments'] },
  { city: 'New York',    cc: 'US', tags: ['museums', 'art', 'nightlife', 'food'] },
  { city: 'Rome',        cc: 'IT', tags: ['monuments', 'food', 'museums', 'art'] },
];

/* ── Provider ─────────────────────────────────────────────────────────────── */
export default function TripModalProvider({ children }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [open,    setOpen]    = useState(false);
  const [step,    setStep]    = useState(0);
  const [city,    setCity]    = useState('');
  const [cc,      setCC]      = useState('');   // country code
  const [start,   setStart]   = useState('');
  const [end,     setEnd]     = useState('');
  const [interests, setInterests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [seedInterests,  setSeedInterests]  = useState([]); // from onboarding
  const [startedAtDates, setStartedAtDates] = useState(false); // entered from city preview

  // Mapbox autocomplete
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg,    setShowSugg]    = useState(false);
  const debRef = useRef(null);
  const inputRef = useRef(null);
  const [inputRect, setInputRect] = useState(null);

  // Community templates for the selected city
  const [templates,     setTemplates]     = useState([]);
  const [templateCity,  setTemplateCity]  = useState('');

  // Load templates when a city is chosen (with 400ms debounce after CC is set)
  useEffect(() => {
    if (!city || city === templateCity) return;
    const t = setTimeout(() => {
      setTemplateCity(city);
      getCityTemplates(city).then(setTemplates).catch(() => setTemplates([]));
    }, 400);
    return () => clearTimeout(t);
  }, [city, templateCity]);

  /* ── Public API ─────────────────────────────────────────────────────────── */
  /**
   * openModal(city, interests, opts)
   *   opts.startAtDates  – skip the Destination step; open straight on Dates
   *   opts.countryCode   – pre-set country code (e.g. from city preview URL param)
   */
  const openModal = useCallback((prefill = '', prefillInterests = [], {
    startAtDates = false,
    countryCode  = '',
  } = {}) => {
    setCity(prefill);
    setCC(countryCode);
    setStart(''); setEnd('');
    setInterests(prefillInterests);
    setStep(startAtDates ? 1 : 0);
    setStartedAtDates(startAtDates);
    setError('');
    setSeedInterests(prefillInterests);
    setSuggestions([]); setShowSugg(false);
    setTemplates([]); setTemplateCity('');
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (!loading) setOpen(false);
  }, [loading]);

  /* ── City search ────────────────────────────────────────────────────────── */
  const onCityInput = (val) => {
    setCity(val); setError('');
    clearTimeout(debRef.current);
    if (val.length < 2) { setSuggestions([]); setShowSugg(false); return; }
    debRef.current = setTimeout(async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) return;
        const r = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json` +
          `?types=place&limit=5&access_token=${token}`
        );
        const d = await r.json();
        setSuggestions(
          (d.features ?? []).map((f) => ({
            name:        f.text,
            fullName:    f.place_name,
            countryCode: (
              f.context?.find((c) => c.id.startsWith('country'))?.short_code ?? ''
            ).toUpperCase(),
          }))
        );
        setInputRect(inputRef.current?.getBoundingClientRect() ?? null);
        setShowSugg(true);
      } catch { /* ignore */ }
    }, 280);
  };

  const pickSuggestion = (s) => {
    setCity(s.name);
    setCC(s.countryCode.slice(0, 2));
    setSuggestions([]); setShowSugg(false);
  };

  /* ── Navigation ─────────────────────────────────────────────────────────── */
  const validate = () => {
    if (step === 0 && !city.trim()) {
      setError('Please enter a destination city.'); return false;
    }
    if (step === 1) {
      if (!start || !end) { setError('Please choose start and end dates.'); return false; }
      if (end <= start)   { setError('End date must be after start date.'); return false; }
    }
    return true;
  };

  const next = () => {
    if (!validate()) return;
    setError(''); setStep((s) => s + 1);
  };
  const back = () => { setError(''); setStep((s) => Math.max(0, s - 1)); };

  /* ── Create ─────────────────────────────────────────────────────────────── */
  const handleCreate = async () => {
    if (!user) { setError('You must be signed in to create a trip.'); return; }
    setLoading(true); setError('');
    try {
      const { tripId, destIds } = await createTrip({
        userId: user.uid,
        name: null,
        isMultiCity: false,
        interests,
        destinations: [{
          city:        city.trim(),
          countryCode: cc || null,
          startDate:   start,
          endDate:     end,
        }],
      });
      await generateDayPlans(destIds[0], user.uid, tripId, start, end);
      // Signal that the user has created their first trip (for PWA install prompt)
      localStorage.setItem('hasCreatedTrip', '1');
      window.dispatchEvent(new Event('venture:tripCreated'));
      track('trip_created', { city: city.trim(), interests });
      setOpen(false);
      router.push(`/trips/${tripId}`);
    } catch (err) {
      const msg = err.message ?? 'Something went wrong. Please try again.';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const nights = start && end
    ? Math.round((new Date(end) - new Date(start)) / 86_400_000)
    : 0;

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <Ctx.Provider value={{ openModal, closeModal }}>
      {children}

      {/* ── Backdrop ── */}
      {open && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 300,
            animation: 'toastIn 0.2s ease',
          }}
        />
      )}

      {/* ── Bottom sheet ── */}
      {open && (
        <div
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: 'var(--surface)',
            borderRadius: '20px 20px 0 0',
            border: '1px solid var(--border)',
            borderBottom: 'none',
            zIndex: 301,
            maxHeight: '90dvh',
            display: 'flex', flexDirection: 'column',
            animation: 'slideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
          }}
        >
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px' }}>
            <div style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          </div>

          {/* Header */}
          <div style={{ padding: '8px 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.025em' }}>
                {step === 3 ? `Review — ${city}` : startedAtDates ? city : 'New Trip'}
              </h2>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {startedAtDates
                  ? `${STEPS[step]} · Step ${step} of ${STEPS.length - 1}`
                  : `${STEPS[step]} · Step ${step + 1} of ${STEPS.length}`}
              </p>
            </div>
            <button
              onClick={closeModal}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer',
                width: 32, height: 32, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '1.1rem', lineHeight: 1, flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Step progress bar — 3 segments when started from city preview */}
          {(() => {
            const bars     = startedAtDates ? STEPS.slice(1) : STEPS;
            const barIndex = startedAtDates ? step - 1 : step;
            return (
              <div style={{ display: 'flex', gap: 4, padding: '0 24px 18px' }}>
                {bars.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: 3, borderRadius: 3,
                      background: i <= barIndex ? 'var(--accent)' : 'var(--border)',
                      transition: 'background 0.25s',
                    }}
                  />
                ))}
              </div>
            );
          })()}

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>

            {/* ════ Step 0: Destination ════ */}
            {step === 0 && (
              <div>
                <label style={LABEL}>Where are you headed?</label>
                <input
                  ref={inputRef}
                  autoFocus
                  type="text"
                  placeholder="e.g. Amsterdam"
                  value={city}
                  onChange={(e) => onCityInput(e.target.value)}
                  style={INPUT}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--accent)';
                    if (suggestions.length > 0) setShowSugg(true);
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border)';
                  }}
                />

                {/* Autocomplete — inline list, no clipping issues */}
                {showSugg && suggestions.length > 0 && (
                  <div style={{
                    marginTop: 8,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 14, overflow: 'hidden',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  }}>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={() => pickSuggestion(s)}
                        style={{
                          width: '100%', padding: '16px 18px', background: 'none',
                          border: 'none',
                          borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                          textAlign: 'left', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 14,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>
                          {flagEmoji(s.countryCode) || '📍'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                            {s.name}
                          </p>
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.fullName}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Detected country */}
                {cc && (
                  <p style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {flagEmoji(cc)} Detected: {cc}
                  </p>
                )}

                {/* Suggested cities based on interests (shown when no text entered) */}
                {!city && (() => {
                  const suggested = seedInterests.length > 0
                    ? CURATED_CITIES
                        .map((c) => ({ ...c, score: c.tags.filter((t) => seedInterests.includes(t)).length }))
                        .filter((c) => c.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 6)
                    : CURATED_CITIES.slice(0, 6);

                  return (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                        {seedInterests.length > 0 ? '✨ Matched to your interests' : '🌍 Popular destinations'}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {suggested.map((c) => (
                          <button
                            key={c.city}
                            type="button"
                            onClick={() => { setCity(c.city); setCC(c.cc); }}
                            style={{
                              padding: '6px 12px', borderRadius: 20,
                              background: 'var(--card)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.8rem', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              transition: 'border-color 0.12s, color 0.12s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                          >
                            <span>{flagEmoji(c.cc)}</span>
                            <span>{c.city}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Community templates for the entered city */}
                {city && templates.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <p style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      📋 Community itineraries for {city}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {templates.map((tmpl) => (
                        <div
                          key={tmpl.id}
                          style={{
                            padding: '10px 14px', borderRadius: 10,
                            background: 'var(--card)', border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          }}
                        >
                          <div>
                            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {tmpl.dayCount} day{tmpl.dayCount !== 1 ? 's' : ''} · {tmpl.spotCount} spot{tmpl.spotCount !== 1 ? 's' : ''}
                            </p>
                            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              Community itinerary
                            </p>
                          </div>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                            color: 'var(--accent)', flexShrink: 0,
                          }}>
                            ✦ Template
                          </span>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                      Create your trip — these templates will be in your Day Planner.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ════ Step 1: Dates ════ */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={LABEL}>Start date</label>
                  <input
                    autoFocus
                    type="date"
                    value={start}
                    onChange={(e) => { setStart(e.target.value); setError(''); }}
                    style={INPUT}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={(e)  => e.target.style.borderColor = 'var(--border)'}
                  />
                </div>
                <div>
                  <label style={LABEL}>End date</label>
                  <input
                    type="date"
                    value={end}
                    min={start || undefined}
                    onChange={(e) => { setEnd(e.target.value); setError(''); }}
                    style={INPUT}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={(e)  => e.target.style.borderColor = 'var(--border)'}
                  />
                </div>
                {nights > 0 && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(245,158,11,0.07)',
                    border: '1px solid rgba(245,158,11,0.15)',
                    borderRadius: 10, textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>
                      {nights} night{nights !== 1 ? 's' : ''} · {nights + 1} day{nights + 1 !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ════ Step 2: Interests ════ */}
            {step === 2 && (
              <div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.55 }}>
                  Optional — biases research toward spots you'll love. You can always change these later.
                </p>
                <InterestPicker selected={interests} onChange={setInterests} />
              </div>
            )}

            {/* ════ Step 3: Review ════ */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 14, padding: 18,
                  display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  {/* City + flag */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '2rem', lineHeight: 1 }}>{flagEmoji(cc) || '🌍'}</span>
                    <div>
                      <p style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>{city}</p>
                      {cc && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{cc}</p>}
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  {/* Dates */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 3 }}>DATES</p>
                      <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                        {fmtDate(start)} → {fmtDate(end)}
                      </p>
                    </div>
                    <div style={{
                      background: 'var(--accent-dim)',
                      border: '1px solid rgba(245,158,11,0.2)',
                      borderRadius: 8, padding: '5px 12px',
                    }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent)' }}>
                        {nights}n · {nights + 1}d
                      </span>
                    </div>
                  </div>

                  {/* Interests */}
                  {interests.length > 0 && (
                    <>
                      <div style={{ height: 1, background: 'var(--border)' }} />
                      <div>
                        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>INTERESTS</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {interests.map((id) => (
                            <span key={id} style={{
                              padding: '3px 10px',
                              background: 'var(--accent-dim)',
                              border: '1px solid rgba(245,158,11,0.2)',
                              borderRadius: 20,
                              fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)',
                            }}>
                              {id}
                            </span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  ✨ We'll run AI research immediately and surface hidden gems specific to {city}. Research runs 6 specialist passes in parallel — typically ready in 45–90 seconds.
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                marginTop: 14, padding: '9px 12px',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 8, fontSize: '0.8rem', color: '#f87171', lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            {/* Bottom padding inside scroll area */}
            <div style={{ height: 28 }} />
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 24px',
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 10, flexShrink: 0,
          }}>
            {step > 0 && !(startedAtDates && step === 1) && (
              <button
                type="button"
                onClick={back}
                disabled={loading}
                style={{
                  flex: 1, padding: '12px',
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 10, color: 'var(--text-secondary)',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                style={{
                  flex: 2, padding: '12px',
                  background: 'var(--accent)', border: 'none',
                  borderRadius: 10, color: '#000',
                  fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
                }}
              >
                {step === 2 ? 'Review Trip →' : 'Next →'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreate}
                disabled={loading}
                style={{
                  flex: 2, padding: '12px',
                  background: loading ? 'rgba(245,158,11,0.5)' : 'var(--accent)',
                  border: 'none', borderRadius: 10, color: '#000',
                  fontWeight: 700, fontSize: '0.95rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Creating trip…' : '✈️  Create Trip'}
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
