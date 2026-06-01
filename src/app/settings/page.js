'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, updateProfile } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { getUser, updateUserPrefs, getResearchedCities, clearCityCache } from '@/lib/db';
import InterestPicker from '@/components/InterestPicker';
import { useToast } from '@/components/ToastProvider';
import TopNav from '@/components/TopNav';

/* ── Constants ────────────────────────────────────────────────────────────── */
const CURRENCIES = [
  { code: 'GBP', symbol: '£',  label: 'British Pound'    },
  { code: 'EUR', symbol: '€',  label: 'Euro'              },
  { code: 'USD', symbol: '$',  label: 'US Dollar'         },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen'      },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar'   },
  { code: 'CHF', symbol: 'Fr', label: 'Swiss Franc'       },
  { code: 'SEK', symbol: 'kr', label: 'Swedish Krona'     },
];

const INPUT = {
  width: '100%', padding: '10px 14px',
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.875rem',
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
};

/* ── Sub-components ───────────────────────────────────────────────────────── */
function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <p style={{
        fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
      }}>{title}</p>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {children}
      </div>
    </section>
  );
}

function Row({ label, sublabel, children, last }) {
  return (
    <div style={{
      padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--border)', gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</p>
        {sublabel && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{sublabel}</p>}
      </div>
      {children}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const router   = useRouter();
  const { user } = useAuth();
  const toast    = useToast();

  const [prefs, setPrefs]     = useState(null);   // loaded from Firestore
  const [prefsLoading, setPL] = useState(true);

  // Editable fields
  const [currency,    setCurrency]    = useState('GBP');
  const [displayName, setDisplayName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving,  setNameSaving]  = useState(false);
  const [interests,   setInterests]   = useState([]);
  const [intSaving,   setIntSaving]   = useState(false);
  const [homeCity,    setHomeCity]    = useState('');
  const [homeSaving,  setHomeSaving]  = useState(false);
  const [delConfirm,  setDelConfirm]  = useState(false);

  // Home city autocomplete
  const [homeSugg,     setHomeSugg]     = useState([]);
  const [showHomeSugg, setShowHomeSugg] = useState(false);
  const homeDeb = useRef(null);

  // Cached research
  const [cachedCities, setCachedCities] = useState([]);
  const [clearing,     setClearing]     = useState(null);

  /* ── Load prefs from Firestore ── */
  useEffect(() => {
    if (!user) return;
    getUser(user.uid).then((doc) => {
      if (doc) {
        setCurrency(doc.currency ?? 'GBP');
        setInterests(doc.interests ?? []);
        setHomeCity(doc.homeCity ?? '');
      }
      setDisplayName(user.displayName ?? user.email?.split('@')[0] ?? '');
      setPL(false);
    }).catch(() => {
      setDisplayName(user.displayName ?? user.email?.split('@')[0] ?? '');
      setPL(false);
    });
  }, [user]);

  /* ── Load cached cities ── */
  useEffect(() => {
    if (!user) return;
    getResearchedCities(user.uid).then(setCachedCities).catch(() => {});
  }, [user]);

  /* ── Handlers ── */
  const handleCurrency = async (code) => {
    const prev = currency; setCurrency(code);
    try { await updateUserPrefs(user.uid, { currency: code }); toast.success(`Currency set to ${code}`); }
    catch { setCurrency(prev); toast.error('Failed to save currency.'); }
  };

  const saveDisplayName = async () => {
    if (!user || !displayName.trim()) return;
    setNameSaving(true);
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      await updateUserPrefs(user.uid, { displayName: displayName.trim() });
      setNameEditing(false);
      toast.success('Display name updated.');
    } catch { toast.error('Failed to update name.'); }
    finally { setNameSaving(false); }
  };

  const saveInterests = async (newInterests) => {
    setInterests(newInterests);
    if (!user) return;
    setIntSaving(true);
    try { await updateUserPrefs(user.uid, { interests: newInterests }); toast.success('Interests saved.'); }
    catch { toast.error('Failed to save interests.'); }
    finally { setIntSaving(false); }
  };

  const saveHomeCity = async () => {
    if (!user) return;
    setHomeSaving(true);
    try { await updateUserPrefs(user.uid, { homeCity: homeCity.trim() || null }); toast.success('Home city saved.'); }
    catch { toast.error('Failed to save home city.'); }
    finally { setHomeSaving(false); }
  };

  // Home city Mapbox autocomplete
  const onHomeCityInput = (val) => {
    setHomeCity(val);
    clearTimeout(homeDeb.current);
    if (val.length < 2) { setHomeSugg([]); setShowHomeSugg(false); return; }
    homeDeb.current = setTimeout(async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) return;
        const r = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?types=place&limit=4&access_token=${token}`
        );
        const d = await r.json();
        setHomeSugg((d.features ?? []).map((f) => f.text));
        setShowHomeSugg(true);
      } catch {}
    }, 280);
  };

  const handleClearCity = async (city) => {
    setClearing(city);
    try {
      await clearCityCache(city);
      setCachedCities((prev) => prev.filter((c) => c !== city));
      toast.success(`Cache cleared for ${city}.`);
    } catch { toast.error(`Failed to clear ${city} cache.`); }
    finally { setClearing(null); }
  };

  const handleSignOut = async () => { await signOut(auth); router.push('/auth'); };

  if (prefsLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
        <TopNav />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="skeleton" style={{ width: 300, height: 120, borderRadius: 14 }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <TopNav />

      <main style={{ flex: 1, padding: '40px 36px', maxWidth: 680, width: '100%', margin: '0 auto' }}>

        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 4 }}>Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Manage your account and preferences</p>
        </div>

        {/* ── Account ── */}
        <Section title="Account">
          {/* Display name */}
          <Row label="Display name" sublabel="Shown on your dashboard greeting">
            {nameEditing ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setNameEditing(false); }}
                  autoFocus
                  style={{ ...INPUT, width: 180, padding: '7px 10px' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                />
                <button onClick={saveDisplayName} disabled={nameSaving} style={{
                  padding: '7px 14px', background: 'var(--accent)', color: '#000',
                  border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                }}>{nameSaving ? '…' : 'Save'}</button>
                <button onClick={() => setNameEditing(false)} style={{
                  padding: '7px 10px', background: 'none', border: '1px solid var(--border)',
                  borderRadius: 7, color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer',
                }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{displayName || '—'}</span>
                <button onClick={() => setNameEditing(true)} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 7,
                  color: 'var(--text-secondary)', fontSize: '0.78rem', padding: '5px 12px', cursor: 'pointer',
                }}>Edit</button>
              </div>
            )}
          </Row>
          <Row label="Email" sublabel="Managed by Firebase Auth" last>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email ?? '—'}
            </span>
          </Row>
        </Section>

        {/* ── Preferences ── */}
        <Section title="Preferences">
          {/* Currency */}
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: 4 }}>Currency</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>Used for price display across the app</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {CURRENCIES.map(({ code, symbol, label }) => (
                <button key={code} onClick={() => handleCurrency(code)} style={{
                  padding: '9px 10px', borderRadius: 10,
                  border: `1.5px solid ${currency === code ? 'var(--accent)' : 'var(--border)'}`,
                  background: currency === code ? 'var(--accent-dim)' : 'var(--bg)',
                  color: currency === code ? 'var(--accent)' : 'var(--text-primary)',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}>
                  <p style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 1 }}>{symbol} {code}</p>
                  <p style={{ fontSize: '0.65rem', color: currency === code ? 'var(--accent)' : 'var(--text-muted)', opacity: 0.85 }}>{label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Home city */}
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)', position: 'relative' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: 4 }}>Home city</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Used to personalise explore suggestions
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="text"
                  placeholder="e.g. London"
                  value={homeCity}
                  onChange={(e) => onHomeCityInput(e.target.value)}
                  style={INPUT}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; if (homeSugg.length) setShowHomeSugg(true); }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; setTimeout(() => setShowHomeSugg(false), 150); }}
                />
                {showHomeSugg && homeSugg.length > 0 && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 10, overflow: 'hidden', zIndex: 10, boxShadow: 'var(--shadow-lg)',
                  }}>
                    {homeSugg.map((s, i) => (
                      <button key={i} type="button" onMouseDown={() => { setHomeCity(s); setShowHomeSugg(false); }} style={{
                        width: '100%', padding: '9px 12px', background: 'none', border: 'none',
                        borderBottom: i < homeSugg.length - 1 ? '1px solid var(--border)' : 'none',
                        textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)',
                      }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                      >{s}</button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={saveHomeCity} disabled={homeSaving} style={{
                flexShrink: 0, padding: '10px 16px', background: 'var(--accent)', color: '#000',
                border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              }}>
                {homeSaving ? '…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Default interests */}
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: 4 }}>
              Default interests
              {intSaving && <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Saving…</span>}
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Pre-fills when creating a new trip
            </p>
            <InterestPicker selected={interests} onChange={saveInterests} />
          </div>
        </Section>

        {/* ── Cached research ── */}
        {cachedCities.length > 0 && (
          <Section title="Cached Research">
            <div style={{ padding: '4px 0' }}>
              {cachedCities.map((city, i) => (
                <div key={city} style={{
                  padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: i < cachedCities.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{city}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>AI research cached</p>
                  </div>
                  <button
                    onClick={() => handleClearCity(city)}
                    disabled={clearing === city}
                    style={{
                      padding: '5px 12px', background: 'none',
                      border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7,
                      color: clearing === city ? 'var(--text-muted)' : '#ef4444',
                      fontSize: '0.75rem', cursor: clearing === city ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {clearing === city ? '…' : 'Clear'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 20px', background: 'rgba(245,158,11,0.04)', borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Clearing removes the AI research cache for that city. It will re-research automatically when you next open the trip (~$0.02).
              </p>
            </div>
          </Section>
        )}

        {/* ── Danger zone ── */}
        <Section title="Danger zone">
          <button onClick={handleSignOut} style={{
            width: '100%', background: 'none', border: 'none',
            padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
            borderBottom: '1px solid var(--border)', textAlign: 'left', transition: 'background 0.15s',
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Sign out
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>

          {!delConfirm ? (
            <button onClick={() => setDelConfirm(true)} style={{
              width: '100%', background: 'none', border: 'none',
              padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              color: 'var(--error)', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer', textAlign: 'left',
            }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Delete account
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          ) : (
            <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.06)', borderTop: '1px solid rgba(239,68,68,0.15)' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 12, fontWeight: 500 }}>
                This will permanently delete your account and all trips. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { toast.info('Account deletion is disabled in this build.'); setDelConfirm(false); }} style={{
                  padding: '8px 16px', background: 'var(--error)', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                }}>Yes, delete</button>
                <button onClick={() => setDelConfirm(false)} style={{
                  padding: '8px 16px', background: 'none', border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer',
                }}>Cancel</button>
              </div>
            </div>
          )}
        </Section>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Venture v0.1 · Built for curious travellers
        </p>
      </main>
    </div>
  );
}
