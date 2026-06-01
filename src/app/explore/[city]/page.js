'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TopNav from '@/components/TopNav';
import { getCachedSpots } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { INTERESTS } from '@/constants/interests';
import { useTripModal } from '@/components/TripModalProvider';

const CITY_META = {
  amsterdam:   { country: 'Netherlands',    tagline: 'Canals, culture and the streets tourists miss',      gradient: ['#667eea','#764ba2'], emoji: '🇳🇱' },
  lisbon:      { country: 'Portugal',       tagline: 'Sun-soaked tiles and Atlantic soul',                 gradient: ['#f093fb','#f5576c'], emoji: '🇵🇹' },
  prague:      { country: 'Czech Republic', tagline: 'Gothic spires and hidden courtyards',                gradient: ['#4facfe','#00f2fe'], emoji: '🇨🇿' },
  vienna:      { country: 'Austria',        tagline: 'Imperial grandeur beyond the tourist trail',         gradient: ['#43e97b','#38f9d7'], emoji: '🇦🇹' },
  barcelona:   { country: 'Spain',          tagline: 'Architecture, beach and a city that never sleeps',   gradient: ['#fa709a','#fee140'], emoji: '🇪🇸' },
  budapest:    { country: 'Hungary',        tagline: 'Thermal baths, ruin bars and the Danube',            gradient: ['#a18cd1','#fbc2eb'], emoji: '🇭🇺' },
  berlin:      { country: 'Germany',        tagline: 'Underground culture and reinvented spaces',          gradient: ['#fccb90','#d57eeb'], emoji: '🇩🇪' },
  rome:        { country: 'Italy',          tagline: 'Two thousand years hiding in plain sight',           gradient: ['#f6d365','#fda085'], emoji: '🇮🇹' },
  copenhagen:  { country: 'Denmark',        tagline: 'Hygge, design and Nordic calm',                      gradient: ['#89f7fe','#66a6ff'], emoji: '🇩🇰' },
  porto:       { country: 'Portugal',       tagline: 'Port wine, azulejos and Atlantic light',             gradient: ['#ffecd2','#fcb69f'], emoji: '🇵🇹' },
  tokyo:       { country: 'Japan',          tagline: 'Infinite layers of chaos and tranquility',           gradient: ['#ff9a9e','#fecfef'], emoji: '🇯🇵' },
  kyoto:       { country: 'Japan',          tagline: 'Bamboo groves, temples and forgotten gardens',       gradient: ['#a1c4fd','#c2e9fb'], emoji: '🇯🇵' },
  bangkok:     { country: 'Thailand',       tagline: 'Street food, temples and thousand smiles',           gradient: ['#f7971e','#ffd200'], emoji: '🇹🇭' },
  seoul:       { country: 'South Korea',    tagline: 'K-culture, late nights and incredible food',         gradient: ['#4776e6','#8e54e9'], emoji: '🇰🇷' },
  'new york':  { country: 'United States',  tagline: 'Five boroughs of hidden culture and food',           gradient: ['#373b44','#4286f4'], emoji: '🇺🇸' },
  'mexico city':{ country: 'Mexico',        tagline: 'Murals, markets and culinary magic',                 gradient: ['#e96c1e','#c0392b'], emoji: '🇲🇽' },
};

// Guests can see this many spots before blur gate
const FREE_SPOTS = 4;

/* ── Gem card ─────────────────────────────────────────────────────────────── */
function GemCard({ spot, blurred }) {
  const level = getHiddennessLevel(spot?.hiddennessScore ?? 1);
  const interestIcons = (spot.interests ?? [])
    .map((id) => INTERESTS.find((i) => i.id === id))
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div style={{
      background:   'var(--card)',
      border:       `1px solid ${blurred ? 'var(--border)' : `${level.color}20`}`,
      borderRadius: 14,
      padding:      '18px 20px',
      display:      'flex',
      flexDirection:'column',
      gap:          10,
      filter:       blurred ? 'blur(6px)' : 'none',
      userSelect:   blurred ? 'none' : 'auto',
      pointerEvents: blurred ? 'none' : 'auto',
      transition:   'box-shadow 0.15s, transform 0.15s, filter 0.2s',
    }}
      onMouseEnter={e => { if (!blurred) { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Name + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)', flex: 1 }}>
          {spot.name}
        </h3>
        <span style={{
          flexShrink: 0, fontSize: '0.63rem', fontWeight: 700, padding: '3px 8px',
          borderRadius: 20, background: `${level.color}18`, color: level.color,
          border: `1px solid ${level.color}35`, whiteSpace: 'nowrap',
        }}>
          {level.label} · {spot.hiddennessScore}/10
        </span>
      </div>

      {spot.description && (
        <p style={{
          fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {spot.description}
        </p>
      )}

      {spot.whyHidden && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>
          💡 {spot.whyHidden}
        </p>
      )}

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        {spot.address && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {spot.address}
          </span>
        )}
        {spot.entryPrice != null ? (
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>
            €{spot.entryPrice === 0 ? '0 · Free' : spot.entryPrice}
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#22c55e', flexShrink: 0 }}>Free</span>
        )}
        {interestIcons.length > 0 && (
          <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
            {interestIcons.map(i => (
              <span key={i.id} title={i.label} style={{ fontSize: '0.75rem' }}>{i.icon}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function CityDetailPage() {
  const { city: citySlug } = useParams();
  const { user } = useAuth();
  const tripModal = useTripModal();

  const cityKey  = decodeURIComponent(citySlug ?? '').toLowerCase();
  const meta     = CITY_META[cityKey] ?? {
    country: '', tagline: 'Hidden gems waiting to be discovered',
    gradient: ['#1B2B4B', '#2D4270'], emoji: '🌍',
  };
  const cityName = cityKey.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const [spots,          setSpots]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [activeInterest, setActiveInterest] = useState('');
  const [minScore,       setMinScore]       = useState(1);
  const [hideTourist,    setHideTourist]    = useState(false);
  const [sortMode,       setSortMode]       = useState('score'); // 'score' | 'az' | 'random'
  const [sessionSeed]                       = useState(() => Date.now());

  useEffect(() => {
    if (!cityName) return;
    setLoading(true);
    getCachedSpots(cityName)
      .then(setSpots)
      .catch(() => setSpots([]))
      .finally(() => setLoading(false));
  }, [cityName]);

  // Interests present in cached spots
  const presentInterests = INTERESTS.filter(i =>
    spots.some(s => (s.interests ?? []).includes(i.id))
  );

  const effectiveMin = hideTourist ? Math.max(minScore, 3) : minScore;
  const filtered = (() => {
    const base = spots.filter(s => {
      const score = s.hiddennessScore ?? 1;
      if (score < effectiveMin) return false;
      if (activeInterest && !(s.interests ?? []).includes(activeInterest)) return false;
      return true;
    });
    if (sortMode === 'az') {
      return [...base].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }
    if (sortMode === 'random') {
      // Weighted random: higher score = more likely to appear first
      const seeded = (n) => { let x = Math.sin(n + sessionSeed) * 10000; return x - Math.floor(x); };
      return [...base].sort((a, b) => {
        const wa = (a.hiddennessScore ?? 1) * seeded(base.indexOf(a));
        const wb = (b.hiddennessScore ?? 1) * seeded(base.indexOf(b));
        return wb - wa;
      });
    }
    // default: score desc (already sorted by Firestore)
    return base;
  })();

  // How many spots can guests see?
  const guestVisible = user ? filtered.length : Math.min(FREE_SPOTS, filtered.length);
  const hiddenCount  = user ? 0 : Math.max(0, filtered.length - FREE_SPOTS);

  function handlePlanTrip() {
    if (user) tripModal?.openModal(cityName);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <TopNav />

      <div style={{ flex: 1, minWidth: 0 }}>

        {/* ── Hero ───────────────────────────────────────────────────── */}
        <div style={{
          background: `linear-gradient(135deg, ${meta.gradient[0]}, ${meta.gradient[1]})`,
          padding: '60px 48px 48px',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Link href="/explore" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem',
              marginBottom: 20, textDecoration: 'none',
            }}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              All cities
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: '3rem' }}>{meta.emoji}</span>
              <div>
                <h1 style={{ fontSize: '2.8rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                  {cityName}
                </h1>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem', marginTop: 4 }}>{meta.country}</p>
              </div>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1.05rem', maxWidth: 480, lineHeight: 1.6 }}>
              {meta.tagline}
            </p>
            {spots.length > 0 && (
              <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: '6px 14px', backdropFilter: 'blur(8px)' }}>
                <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>✦ {spots.length} hidden gems found</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div style={{ padding: '40px 48px', maxWidth: 1100 }}>

          {/* ── Filter bar ── */}
          {!loading && spots.length > 0 && (
            <div style={{ marginBottom: 28 }}>

              {/* Row 1: category chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button
                  onClick={() => setActiveInterest('')}
                  style={{
                    padding: '6px 15px', borderRadius: 20,
                    border: `1px solid ${activeInterest === '' ? 'var(--accent)' : 'var(--border)'}`,
                    background: activeInterest === '' ? 'var(--accent-dim)' : 'var(--card)',
                    color: activeInterest === '' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: '0.8rem', fontWeight: activeInterest === '' ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >All</button>
                {presentInterests.map(i => (
                  <button
                    key={i.id}
                    onClick={() => setActiveInterest(activeInterest === i.id ? '' : i.id)}
                    style={{
                      padding: '6px 13px', borderRadius: 20,
                      border: `1px solid ${activeInterest === i.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: activeInterest === i.id ? 'var(--accent-dim)' : 'var(--card)',
                      color: activeInterest === i.id ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: '0.8rem', fontWeight: activeInterest === i.id ? 600 : 400,
                      cursor: 'pointer', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span>{i.icon}</span><span>{i.label}</span>
                  </button>
                ))}
              </div>

              {/* Row 2: score slider + toggles + sort + result count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

                {/* Gem score slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>✦ {minScore}+</span>
                  <input
                    type="range" min={1} max={9} step={1} value={minScore}
                    onChange={e => setMinScore(Number(e.target.value))}
                    style={{ width: 90, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>10</span>
                </div>

                {/* Skip Tourist Trail */}
                <button
                  onClick={() => setHideTourist(v => !v)}
                  style={{
                    padding: '5px 12px', borderRadius: 20,
                    border: `1px solid ${hideTourist ? 'var(--accent)' : 'var(--border)'}`,
                    background: hideTourist ? 'var(--accent-dim)' : 'var(--card)',
                    color: hideTourist ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: '0.78rem', fontWeight: hideTourist ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  🚫 Skip Tourist Trail
                </button>

                {/* Sort */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['score','✦ Score'],['random','🔀 Shuffle'],['az','A–Z']].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setSortMode(val)}
                      style={{
                        padding: '5px 11px', borderRadius: 20,
                        border: `1px solid ${sortMode === val ? 'var(--accent)' : 'var(--border)'}`,
                        background: sortMode === val ? 'var(--accent-dim)' : 'var(--card)',
                        color: sortMode === val ? 'var(--accent)' : 'var(--text-muted)',
                        fontSize: '0.75rem', fontWeight: sortMode === val ? 600 : 400,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >{label}</button>
                  ))}
                </div>

                {/* Result count */}
                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {filtered.length} gem{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Loading skeletons */}
          {loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="skeleton" style={{ height: 160, borderRadius: 14, animationDelay: `${i*0.1}s` }} />
              ))}
            </div>
          )}

          {/* No spots cached */}
          {!loading && spots.length === 0 && (
            <div style={{ textAlign: 'center', padding: '64px 24px' }}>
              <p style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔍</p>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: 8 }}>No gems cached yet</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, maxWidth: 360, margin: '0 auto 28px' }}>
                Start a trip to {cityName} and our AI will research hidden gems from Reddit, travel blogs, and local sources in about 20 seconds.
              </p>
              {user ? (
                <button
                  type="button"
                  onClick={handlePlanTrip}
                  style={{
                    display: 'inline-block', padding: '12px 28px',
                    background: 'var(--accent)', color: '#000',
                    border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                    cursor: 'pointer',
                  }}
                >
                  Plan a trip to {cityName} →
                </button>
              ) : (
                <Link href="/auth" style={{
                  display: 'inline-block', padding: '12px 28px',
                  background: 'var(--accent)', color: '#000',
                  borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                }}>
                  Sign in to start →
                </Link>
              )}
            </div>
          )}

          {/* Gems grid + blur gate */}
          {!loading && filtered.length > 0 && (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {filtered.map((spot, i) => (
                  <GemCard
                    key={spot.id ?? spot.name}
                    spot={spot}
                    blurred={i >= guestVisible}
                  />
                ))}
              </div>

              {/* Guest blur gate overlay */}
              {!user && hiddenCount > 0 && (
                <div style={{
                  position:     'absolute',
                  bottom:       0,
                  left:         0,
                  right:        0,
                  height:       280,
                  background:   'linear-gradient(to bottom, transparent 0%, rgba(8,8,16,0.97) 40%, var(--bg) 100%)',
                  display:      'flex',
                  flexDirection:'column',
                  alignItems:   'center',
                  justifyContent:'flex-end',
                  padding:      '0 24px 40px',
                  textAlign:    'center',
                }}>
                  <div style={{
                    background:    'rgba(15,15,26,0.97)',
                    backdropFilter: 'blur(16px)',
                    border:         '1px solid rgba(245,158,11,0.2)',
                    borderRadius:   20,
                    padding:        '28px 32px',
                    maxWidth:       440,
                    width:          '100%',
                    boxShadow:      '0 16px 60px rgba(0,0,0,0.6)',
                  }}>
                    <div style={{ fontSize: '2rem', marginBottom: 10 }}>🔒</div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 8 }}>
                      {hiddenCount} more gems locked
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: 22 }}>
                      Sign in free to unlock every spot, see them on a map, and build day-by-day plans. No credit card needed.
                    </p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Link href="/auth" style={{
                        flex: 1, display: 'block',
                        padding: '12px',
                        background: 'var(--accent)', color: '#000',
                        borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                        textDecoration: 'none', textAlign: 'center',
                        boxShadow: '0 4px 20px rgba(245,158,11,0.25)',
                      }}>
                        Sign in free →
                      </Link>
                      <Link href="/auth?mode=signup" style={{
                        flex: 1, display: 'block',
                        padding: '12px',
                        background: 'transparent', color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 10, fontWeight: 600, fontSize: '0.875rem',
                        textDecoration: 'none', textAlign: 'center',
                      }}>
                        Create account
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Signed-in user: empty filter result */}
              {user && filtered.length === 0 && activeInterest && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 32, fontSize: '0.9rem' }}>
                  No gems in this category.{' '}
                  <button onClick={() => setActiveInterest('')}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                    Show all
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Sticky footer CTA ────────────────────────────────────── */}
        <div style={{
          position:         'sticky',
          bottom:           0,
          background:       'rgba(8,8,16,0.92)',
          backdropFilter:   'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop:        '1px solid var(--border)',
          padding:          '16px 48px',
          display:          'flex',
          alignItems:       'center',
          justifyContent:   'space-between',
          gap:              16,
        }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              Ready to explore {cityName}?
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {user ? 'AI researches 20+ spots in under a minute' : 'Sign in free — AI researches any city in seconds'}
            </p>
          </div>
          {user ? (
            <button
              type="button"
              onClick={handlePlanTrip}
              style={{
                padding:      '11px 24px',
                background:   'var(--accent)',
                border:       'none',
                color:        '#000',
                borderRadius: 10,
                fontWeight:   700,
                fontSize:     '0.875rem',
                cursor:       'pointer',
                whiteSpace:   'nowrap',
              }}
            >
              Plan a trip here →
            </button>
          ) : (
            <Link href="/auth" style={{
              padding: '11px 24px', background: 'var(--accent)', color: '#000',
              borderRadius: 10, fontWeight: 700, fontSize: '0.875rem',
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              Sign in to plan →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
