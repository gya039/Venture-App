'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import TopNav from '@/components/TopNav';
import { getCachedSpots } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { useTripModal } from '@/components/TripModalProvider';
import { flagEmoji } from '@/utils/flagEmoji';
import ScoreMedallion from '@/components/ScoreMedallion';

/* ── Static city data — includes Unsplash photo IDs ───────────────────────── */
// Photo format: https://images.unsplash.com/photo-{id}?w=800&q=80
const CITIES = [
  { city: 'Amsterdam',   country: 'Netherlands',    code: 'NL', gems: 24, region: 'Europe',   tag: 'Canals & Culture',       vibes: ['Canals','Museums','Bikes','Nightlife'],    photo: '1576924542371-f4f5c9c5e06d' },
  { city: 'Lisbon',      country: 'Portugal',       code: 'PT', gems: 31, region: 'Europe',   tag: 'Sun & History',           vibes: ['Trams','Fado','Pastéis','Viewpoints'],     photo: '1588598198321-9735fd3d2b9b' },
  { city: 'Prague',      country: 'Czech Republic', code: 'CZ', gems: 28, region: 'Europe',   tag: 'Gothic & Beer',           vibes: ['Old Town','Beer','Architecture','Markets'], photo: '1541849546-216549ae216d'   },
  { city: 'Vienna',      country: 'Austria',        code: 'AT', gems: 22, region: 'Europe',   tag: 'Music & Coffee',          vibes: ['Coffee Houses','Opera','Museums','Parks'],  photo: '1516550893923-42d28e5677af' },
  { city: 'Barcelona',   country: 'Spain',          code: 'ES', gems: 35, region: 'Europe',   tag: 'Art & Beach',             vibes: ['Gaudí','Tapas','Beaches','Nightlife'],     photo: '1583422409516-2895a77efded' },
  { city: 'Budapest',    country: 'Hungary',        code: 'HU', gems: 27, region: 'Europe',   tag: 'Baths & Ruin Bars',       vibes: ['Thermal Baths','Ruin Bars','Danube','Food'],photo: '1587974928442-77dc3e0dba72' },
  { city: 'Berlin',      country: 'Germany',        code: 'DE', gems: 40, region: 'Europe',   tag: 'Underground & Art',       vibes: ['Street Art','Clubs','History','Markets'],   photo: '1560969184-10fe8719e047'   },
  { city: 'Rome',        country: 'Italy',          code: 'IT', gems: 33, region: 'Europe',   tag: 'Ancient & Food',          vibes: ['Ruins','Gelato','Piazzas','Vatican'],       photo: '1552832230-c0197dd311b5'   },
  { city: 'Copenhagen',  country: 'Denmark',        code: 'DK', gems: 19, region: 'Europe',   tag: 'Design & Hygge',          vibes: ['Nyhavn','Design','Cycling','New Nordic'],   photo: '1513622470522-26c3c8a854bc' },
  { city: 'Porto',       country: 'Portugal',       code: 'PT', gems: 21, region: 'Europe',   tag: 'Wine & Tiles',            vibes: ['Wine','Azulejos','Ribeira','Bridges'],      photo: '1555881400-74d7acaacd8b',   isNew: true },
  { city: 'Tokyo',       country: 'Japan',          code: 'JP', gems: 48, region: 'Asia',     tag: 'Chaos & Calm',            vibes: ['Ramen','Shrines','Izakayas','Arcades'],     photo: '1540959733332-eab4deabeeaf' },
  { city: 'Kyoto',       country: 'Japan',          code: 'JP', gems: 29, region: 'Asia',     tag: 'Temples & Zen',           vibes: ['Temples','Geisha','Bamboo','Matcha'],       photo: '1493976040374-85c8e12f0c0e' },
  { city: 'Bangkok',     country: 'Thailand',       code: 'TH', gems: 36, region: 'Asia',     tag: 'Street Food & Temples',   vibes: ['Street Food','Temples','Tuk-Tuks','Canals'],photo: '1508009603885-50cf7c579365', isNew: true },
  { city: 'Seoul',       country: 'South Korea',    code: 'KR', gems: 31, region: 'Asia',     tag: 'K-Culture & Food',        vibes: ['K-Pop','BBQ','Hanok','Shopping'],           photo: '1601621915196-2621bfb0cd5e' },
  { city: 'New York',    country: 'United States',  code: 'US', gems: 44, region: 'Americas', tag: 'Boroughs & Culture',      vibes: ['Boroughs','Jazz','Art','Delis'],            photo: '1496442226666-8d4d0e62e6e9' },
  { city: 'Mexico City', country: 'Mexico',         code: 'MX', gems: 38, region: 'Americas', tag: 'Murals & Markets',        vibes: ['Murals','Tacos','Lucha Libre','Markets'],   photo: '1585464231875-d9ef1f5ad396', isNew: true },
];

const REGIONS = ['All', 'Europe', 'Asia', 'Americas'];

/* ── Mapbox city autocomplete ────────────────────────────────────────────── */
async function fetchCitySuggestions(query) {
  if (!query || query.length < 2) return [];
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return [];
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?types=place&language=en&limit=6&access_token=${token}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.features ?? []).map(f => ({
      name:       f.text,
      country:    f.context?.find(c => c.id.startsWith('country'))?.text ?? '',
      place_name: f.place_name,
      id:         f.id,
    }));
  } catch { return []; }
}

/* ── City card — Field Guide edition ────────────────────────────────────── */
function CityCard({ city, country, code, gems, tag, photo, vibes, isNew, isActive, onClick }) {
  const [hoverGems,   setHoverGems]   = useState(null);
  const [loadingGems, setLoadingGems] = useState(false);
  const fetchRef = useRef(null);

  function onMouseEnter() {
    fetchRef.current = setTimeout(async () => {
      if (hoverGems !== null) return;
      setLoadingGems(true);
      try {
        const spots = await getCachedSpots(city);
        setHoverGems(spots.slice(0, 3));
      } catch { setHoverGems([]); }
      finally { setLoadingGems(false); }
    }, 350);
  }

  function onMouseLeave() {
    clearTimeout(fetchRef.current);
  }

  return (
    <div
      className="city-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ outline: isActive ? '2px solid var(--terracotta)' : undefined }}
    >
      {/* ── Photo ── */}
      <div className="cc-photo">
        {photo && (
          <img
            src={`https://images.unsplash.com/photo-${photo}?w=400&h=140&fit=crop&q=75`}
            alt={city}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            onError={e => { e.currentTarget.src = `https://picsum.photos/seed/${city}/400/140`; e.currentTarget.onerror = null; }}
          />
        )}
        <span className="cc-flag">{flagEmoji(code)}</span>
        {isNew
          ? <span className="cc-new">New</span>
          : <span className="cc-live"><span className="d" />Live</span>
        }
      </div>

      {/* ── Body ── */}
      <div className="cc-body">
        <div className="cc-name">{city}</div>
        <div className="cc-country">{country.toUpperCase()}</div>
        <div className="cc-vibe">{tag}</div>
        <div className="cc-foot">
          <span className="cc-gems"><b>{gems}</b> hidden gems</span>
          <span className="cc-arrow">→</span>
        </div>
      </div>

      {/* ── Hover preview overlay ── */}
      <div className="cc-preview">
        <div className="pv-lbl">Top hidden finds</div>
        <div className="pv-city">{city}</div>
        <div className="pv-list">
          {loadingGems && (
            <div style={{ color: 'oklch(0.7 0.02 80)', fontSize: 13 }}>Loading…</div>
          )}
          {!loadingGems && hoverGems && hoverGems.length > 0 && hoverGems.map((g) => (
            <div key={g.id ?? g.name} className="pv-row">
              <ScoreMedallion score={g.hiddennessScore ?? 5} size={34} showDen={false} />
              <span className="pv-nm">{g.name}</span>
            </div>
          ))}
          {!loadingGems && (!hoverGems || hoverGems.length === 0) && (
            <div style={{ color: 'oklch(0.7 0.02 80)', fontSize: 13, fontStyle: 'italic' }}>
              {hoverGems ? 'No cached spots yet' : 'Hover to load…'}
            </div>
          )}
        </div>
        <div className="pv-foot">
          <span>{gems} scored gems</span>
          <span className="open">Open →</span>
        </div>
      </div>
    </div>
  );
}

/* ── Sidebar spot row ─────────────────────────────────────────────────────── */
function SidebarSpotRow({ spot, blurred, cityPhoto }) {
  const level = getHiddennessLevel(spot?.hiddennessScore ?? 1);
  return (
    <div style={{
      display:       'flex',
      gap:           12,
      alignItems:    'flex-start',
      padding:       '12px 20px',
      borderBottom:  '1px solid oklch(0.32 0.02 60)',
      filter:        blurred ? 'blur(4px)' : 'none',
      userSelect:    blurred ? 'none' : 'auto',
      pointerEvents: blurred ? 'none' : 'auto',
      transition:    'background .13s',
    }}
    onMouseEnter={(e) => !blurred && (e.currentTarget.style.background = 'oklch(0.24 0.018 60)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Square thumbnail — tier-coloured swatch if no photo */}
      <div style={{
        width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
        background: `${level.color}22`,
        border: `1px solid ${level.color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {cityPhoto && (
          <img
            src={`https://images.unsplash.com/photo-${cityPhoto}?w=100&h=100&fit=crop&q=70`}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }}
            loading="lazy"
          />
        )}
        <span style={{
          position: 'relative', zIndex: 1,
          fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
          color: level.color,
          textShadow: '0 1px 4px rgba(0,0,0,0.6)',
        }}>
          {spot.hiddennessScore}
        </span>
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 15,
          color: 'oklch(0.95 0.01 84)', lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 3,
        }}>
          {spot.name}
        </p>
        {spot.description && !blurred && (
          <p style={{
            fontSize: 12, color: 'oklch(0.68 0.02 70)', lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', marginBottom: 4,
          }}>
            {spot.description}
          </p>
        )}
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--terracotta)',
        }}>
          {spot.category ?? level.label}
        </span>
      </div>
    </div>
  );
}

/* ── City preview panel — Field Guide redesign ────────────────────────────── */
function CityPanel({ cityData, spots, loading, user, onClose }) {
  const tripModal = useTripModal();
  if (!cityData) return null;

  const VISIBLE_FREE = 3;
  const previewSpots = spots.slice(0, 8);
  const blurFrom = user ? previewSpots.length : VISIBLE_FREE;

  function handlePlanTrip() {
    onClose();
    if (user) tripModal?.openModal(cityData.city);
  }

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'oklch(0.15 0.02 60 / 0.5)', zIndex: 200, animation: 'fadeIn 0.2s ease' }}
      />

      {/* Slide-in panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '100vw',
        background: 'oklch(0.175 0.016 58)',
        borderLeft: '1px solid oklch(0.28 0.018 60)',
        zIndex: 201, display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
        boxShadow: '-12px 0 48px oklch(0.1 0.02 60 / 0.5)',
      }}>

        {/* ── Hero photo header ── */}
        <div style={{ position: 'relative', height: 200, flexShrink: 0, overflow: 'hidden' }}>
          {/* Photo */}
          {cityData.photo ? (
            <img
              src={`https://images.unsplash.com/photo-${cityData.photo}?w=760&h=400&fit=crop&q=80`}
              alt={cityData.city}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, background: 'oklch(0.22 0.025 60)' }} />
          )}
          {/* Gradient overlay for text legibility */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, oklch(0.1 0.02 60 / 0.3) 0%, oklch(0.12 0.02 60 / 0.85) 100%)' }} />

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            style={{
              position: 'absolute', top: 14, right: 14, zIndex: 2,
              width: 32, height: 32, borderRadius: '50%',
              background: 'oklch(0.15 0.02 60 / 0.7)', backdropFilter: 'blur(8px)',
              border: '1px solid oklch(0.4 0.02 60)', color: 'oklch(0.9 0.01 84)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, lineHeight: 1, transition: 'background .14s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'oklch(0.25 0.02 60 / 0.9)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'oklch(0.15 0.02 60 / 0.7)'}
          >×</button>

          {/* City identity */}
          <div style={{ position: 'absolute', bottom: 18, left: 20, right: 20, zIndex: 1 }}>
            <div style={{
              fontFamily: 'var(--serif)', fontWeight: 500,
              fontSize: 30, letterSpacing: '-0.02em', lineHeight: 1,
              color: 'oklch(0.97 0.008 84)',
              marginBottom: 4,
            }}>
              {cityData.city}
            </div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'oklch(0.74 0.03 80)',
            }}>
              {cityData.country}
            </div>
          </div>
        </div>

        {/* ── Vibe chips + gem count ── */}
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid oklch(0.28 0.018 60)', flexShrink: 0 }}>
          {/* Vibe chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {(cityData.vibes ?? [cityData.tag]).map((v) => (
              <span key={v} style={{
                fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600,
                padding: '4px 10px', borderRadius: 999,
                background: 'oklch(0.24 0.022 60)',
                border: '1px solid oklch(0.34 0.022 60)',
                color: 'oklch(0.82 0.03 80)',
              }}>
                {v}
              </span>
            ))}
          </div>
          {/* Gem count */}
          {(spots.length > 0 || !loading) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--terracotta)', flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 11, color: 'oklch(0.72 0.03 78)',
                letterSpacing: '0.04em',
              }}>
                {loading ? 'Loading gems…' : spots.length > 0
                  ? `${spots.length} hidden gems curated`
                  : 'No gems cached yet — start a trip to research'}
              </span>
            </div>
          )}
        </div>

        {/* ── Top picks list ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>

          {/* Section label */}
          {(loading || previewSpots.length > 0) && (
            <div style={{ padding: '12px 20px 6px' }}>
              <p style={{
                fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 700,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'oklch(0.55 0.025 70)',
              }}>
                Top picks
              </p>
            </div>
          )}

          {/* Loading skeletons */}
          {loading && (
            <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 46, height: 46, borderRadius: 10, background: 'oklch(0.24 0.015 60)', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ height: 12, borderRadius: 6, background: 'oklch(0.24 0.015 60)', width: '70%' }} />
                    <div style={{ height: 9, borderRadius: 6, background: 'oklch(0.22 0.012 60)', width: '45%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && spots.length === 0 && (
            <div style={{ padding: '52px 28px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.5 }}>🔍</div>
              <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18, color: 'oklch(0.78 0.03 80)', marginBottom: 8, lineHeight: 1.3 }}>
                No gems found yet
              </p>
              <p style={{ fontSize: 13, color: 'oklch(0.55 0.025 70)', lineHeight: 1.6, maxWidth: 260, margin: '0 auto' }}>
                Start a trip and AI will research {cityData.city}'s best-kept secrets in seconds.
              </p>
            </div>
          )}

          {/* Spot rows */}
          {!loading && previewSpots.length > 0 && (
            <div style={{ position: 'relative' }}>
              {previewSpots.map((spot, i) => (
                <SidebarSpotRow
                  key={spot.id ?? spot.name}
                  spot={spot}
                  blurred={i >= blurFrom}
                  cityPhoto={cityData.photo}
                />
              ))}

              {/* Gate for guests */}
              {!user && spots.length > VISIBLE_FREE && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 180,
                  background: 'linear-gradient(to bottom, transparent, oklch(0.175 0.016 58) 55%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'flex-end', padding: '0 20px 20px',
                }}>
                  <div style={{
                    width: '100%', padding: '16px 18px', borderRadius: 14,
                    background: 'oklch(0.22 0.02 60)',
                    border: '1px solid oklch(0.32 0.025 68)',
                  }}>
                    <p style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, color: 'oklch(0.92 0.01 84)', marginBottom: 4 }}>
                      {spots.length - VISIBLE_FREE} more gems hidden
                    </p>
                    <p style={{ fontSize: 12.5, color: 'oklch(0.62 0.025 70)', lineHeight: 1.5, marginBottom: 12 }}>
                      Sign in free to unlock all spots, maps, and day plans.
                    </p>
                    <Link href="/auth" style={{
                      display: 'block', padding: '10px 16px', textAlign: 'center',
                      background: 'var(--terracotta)', color: 'oklch(0.97 0.008 84)',
                      borderRadius: 10, fontWeight: 700, fontSize: 13.5,
                      textDecoration: 'none', transition: 'background .15s',
                    }}>
                      Sign in free →
                    </Link>
                  </div>
                </div>
              )}

              {/* More hint for signed-in */}
              {user && spots.length > 8 && (
                <div style={{ padding: '12px 20px', borderTop: '1px solid oklch(0.28 0.018 60)', textAlign: 'center' }}>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'oklch(0.55 0.025 70)' }}>
                    +{spots.length - 8} more spots in full trip view
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer CTA ── */}
        <div style={{
          flexShrink: 0, padding: '14px 20px',
          borderTop: '1px solid oklch(0.28 0.018 60)',
          background: 'oklch(0.14 0.015 58)',
        }}>
          {user ? (
            <button
              type="button"
              onClick={handlePlanTrip}
              style={{
                width: '100%', padding: '13px',
                background: 'var(--terracotta)', color: 'oklch(0.97 0.008 84)',
                border: 'none', borderRadius: 12,
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 14.5,
                cursor: 'pointer', transition: 'background .15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--terracotta-deep)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--terracotta)'}
            >
              Plan a trip here →
            </button>
          ) : (
            <Link href="/auth" style={{
              display: 'block', padding: '13px', textAlign: 'center',
              background: 'var(--terracotta)', color: 'oklch(0.97 0.008 84)',
              borderRadius: 12, fontWeight: 700, fontSize: 14.5,
              textDecoration: 'none', transition: 'background .15s',
            }}>
              Plan a trip here →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Main explore page ───────────────────────────────────────────────────── */
export default function ExplorePage() {
  const { user } = useAuth();
  const [region,       setRegion]       = useState('All');
  const [query,        setQuery]        = useState('');
  const [suggestions,  setSuggestions]  = useState([]);
  const [sugLoading,   setSugLoading]   = useState(false);
  const [showSug,      setShowSug]      = useState(false);

  // Panel state
  const [panelCity,    setPanelCity]    = useState(null);   // full city object
  const [panelSpots,   setPanelSpots]   = useState([]);
  const [panelLoading, setPanelLoading] = useState(false);

  const debounceRef = useRef(null);
  const inputRef    = useRef(null);
  const sugRef      = useRef(null);

  const filtered = region === 'All' ? CITIES : CITIES.filter(c => c.region === region);

  /* ── Open city panel ─────────────────────────────────────────────────── */
  const openPanel = useCallback(async (cityData) => {
    // Toggle off if same city clicked again
    if (panelCity?.city === cityData.city) {
      setPanelCity(null);
      setPanelSpots([]);
      return;
    }
    setPanelCity(cityData);
    setPanelSpots([]);
    setPanelLoading(true);
    try {
      const spots = await getCachedSpots(cityData.city);
      setPanelSpots(spots);
    } catch { setPanelSpots([]); }
    finally { setPanelLoading(false); }
  }, [panelCity?.city]);

  const closePanel = useCallback(() => {
    setPanelCity(null);
    setPanelSpots([]);
  }, []);

  /* ── ESC closes panel ─────────────────────────────────────────────── */
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') closePanel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closePanel]);

  /* ── Autocomplete ─────────────────────────────────────────────────── */
  const handleQueryChange = useCallback((val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSug(false); return; }
    setSugLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await fetchCitySuggestions(val);
      setSuggestions(results);
      setShowSug(results.length > 0);
      setSugLoading(false);
    }, 320);
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

  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />

      <main className="page">

        {/* ── Editorial header ── */}
        <div className="explore-hero">
          <div className="eh-eyebrow">Discover the world</div>
          <h1>Find <em>hidden gems</em> in every city.</h1>
          <p className="eh-sub">Click any city to preview its rarest finds. Search worldwide to plan a new trip.</p>
        </div>

        {/* ── Search + region tabs ── */}
        <div className="explore-controls">
          <div className="city-search" style={{ position: 'relative' }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search any city worldwide…"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSug(true); }}
            />
            {sugLoading && (
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
            )}
            {query && !sugLoading && (
              <button onClick={() => { setQuery(''); setSuggestions([]); setShowSug(false); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px 4px', fontSize: '1rem', lineHeight: 1 }}>×</button>
            )}

            {/* Autocomplete dropdown — inside city-search for correct positioning */}
            {showSug && suggestions.length > 0 && (
              <div ref={sugRef} className="autocomplete">
                {suggestions.map(s => (
                  <Link
                    key={s.id}
                    href={user ? '/trips/new' : '/auth'}
                    className="ac-item"
                    onClick={() => { setShowSug(false); setQuery(''); }}
                    style={{ textDecoration: 'none' }}
                  >
                    <span className="ac-flag">{flagEmoji(s.country?.slice(0,2) ?? '')}</span>
                    <span className="ac-nm">{s.name}</span>
                    <span className="ac-co">{s.country}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Region tabs */}
        <div className="region-tabs" style={{ marginBottom: 8 }}>
          {REGIONS.map(r => (
            <button key={r} className={`region-tab${region === r ? ' on' : ''}`} onClick={() => setRegion(r)}>
              {r}
            </button>
          ))}
        </div>

        <div className="result-meta">{filtered.length} cities</div>

        {/* City grid */}
        {filtered.length === 0 ? (
          <div className="no-results">
            <div className="nr-h">No cities in this region yet.</div>
            <div className="nr-b">Start a trip to research any city worldwide with AI.</div>
          </div>
        ) : (
          <div className="city-grid" style={{ marginBottom: 52 }}>
            {filtered.map(dest => (
              <CityCard
                key={dest.city}
                {...dest}
                isActive={panelCity?.city === dest.city}
                onClick={() => openPanel(dest)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Slide-in city panel */}
      <CityPanel
        cityData={panelCity}
        spots={panelSpots}
        loading={panelLoading}
        user={user}
        onClose={closePanel}
      />
    </div>
  );
}
