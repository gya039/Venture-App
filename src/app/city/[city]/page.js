'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSavedSpots } from '@/hooks/useSavedSpots';
import { useTripModal } from '@/components/TripModalProvider';
import {
  getCachedSpots,
  getPreviewRefreshCount,
  incrementPreviewRefresh,
  PREVIEW_REFRESH_LIMIT,
} from '@/lib/db';
import { runResearch } from '@/lib/functions';
import SpotCard from '@/components/SpotCard';
import SpotDrawer from '@/components/SpotDrawer';
import MapView from '@/components/MapView';
import { flagEmoji } from '@/utils/flagEmoji';

/* ── Score filter options (mirrors trip page) ─────────────────────────────── */
const SCORE_OPTS = [
  { label: 'All',  min: 0 },
  { label: '5+',   min: 5 },
  { label: '7+',   min: 7 },
  { label: '9+',   min: 9 },
];

/* ── Back-arrow icon ──────────────────────────────────────────────────────── */
function ArrowLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function CityPreviewPage() {
  return <Suspense fallback={null}><CityPreviewContent /></Suspense>;
}

function CityPreviewContent() {
  const params       = useParams();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const tripModal    = useTripModal();

  const cityName    = decodeURIComponent(params?.city ?? '');
  const countryCode = searchParams?.get('cc') ?? '';

  /* ── Auth guard — redirect guests to /auth with a return URL ── */
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const returnTo = `/city/${params?.city ?? ''}${countryCode ? `?cc=${countryCode}` : ''}`;
      router.replace(`/auth?redirect=${encodeURIComponent(returnTo)}`);
    }
  }, [authLoading, user]); // eslint-disable-line

  /* ── Fetch cached spots for this city ── */
  const [spots,        setSpots]        = useState([]);
  const [spotsLoading, setSpotsLoading] = useState(true);

  useEffect(() => {
    if (!cityName || !user) return;
    setSpotsLoading(true);
    getCachedSpots(cityName)
      .then(setSpots)
      .catch(() => setSpots([]))
      .finally(() => setSpotsLoading(false));
  }, [cityName, user?.uid]); // eslint-disable-line

  /* ── Saved spots (works without a trip) ── */
  const { savedIds, toggle: toggleSave } = useSavedSpots(user?.uid);

  /* ── UI state ── */
  const [selectedSpotId,  setSelectedSpotId]  = useState(null);
  const [drawerSpot,      setDrawerSpot]      = useState(null);
  const [mapMounted,      setMapMounted]      = useState(false);
  const [mobileView,      setMobileView]      = useState('list');
  const [showDatesPrompt, setShowDatesPrompt] = useState(false);

  /* ── Refresh credit (1 ever for dateless preview) ── */
  const [refreshCount,   setRefreshCount]   = useState(null); // null = loading
  const [isRefreshing,   setIsRefreshing]   = useState(false);
  const [refreshStatus,  setRefreshStatus]  = useState('');
  const [unlocated,      setUnlocated]      = useState([]);

  /* ── Filters ── */
  const [searchQuery, setSearchQuery] = useState('');
  const [minScore,    setMinScore]    = useState(0);

  /* ── Load refresh credit from Firestore ── */
  useEffect(() => {
    if (!user?.uid || !cityName) return;
    getPreviewRefreshCount(user.uid, cityName)
      .then(setRefreshCount)
      .catch(() => setRefreshCount(0));
  }, [user?.uid, cityName]); // eslint-disable-line

  /* ── Mount map as soon as we have coordinates ── */
  useEffect(() => {
    if (spots.length > 0) setMapMounted(true);
  }, [spots.length]);

  /* ── Derived: filtered spot list ── */
  const filteredSpots = spots.filter((s) => {
    if (minScore > 0 && (s.hiddennessScore ?? 0) < minScore) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!s.name?.toLowerCase().includes(q) &&
          !s.description?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /* ── Handlers ── */
  const handleSpotClick = useCallback((spot) => {
    setSelectedSpotId(spot.id);
    // drawer opens only via the popup's "Open details →" button (onOpenDrawer)
  }, []);

  const openWithDates = useCallback(() => {
    setShowDatesPrompt(false);
    tripModal?.openModal(cityName, [], { startAtDates: true, countryCode });
  }, [tripModal, cityName, countryCode]);

  /* ── One-time research refresh ── */
  const handleRefresh = useCallback(async () => {
    if (!user?.uid || (refreshCount ?? 0) >= PREVIEW_REFRESH_LIMIT) return;
    setIsRefreshing(true);
    setRefreshStatus('Consulting AI researcher…');
    const newSpots = [];
    try {
      await runResearch(cityName, [], undefined, true, {
        onSpot:    (spot) => { newSpots.push(spot); setSpots([...newSpots]); },
        onStatus:  (msg)  => setRefreshStatus(msg),
        onSummary: (s)    => {
          setRefreshStatus(`${s.geocoded} spots mapped`);
          if (s.unlocated?.length > 0) setUnlocated(s.unlocated);
        },
      });
      await incrementPreviewRefresh(user.uid, cityName);
      setRefreshCount(c => (c ?? 0) + 1);
    } catch (err) {
      console.error('[Preview refresh]', err);
      setRefreshStatus('Research failed — try again later');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setRefreshStatus(''), 3000);
    }
  }, [user?.uid, cityName, refreshCount]); // eslint-disable-line

  /* ── Loading / redirect pending ── */
  if (authLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', background: 'var(--paper)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }
  if (!user) return null; // redirect in flight

  /* ── Page ── */
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', overflow: 'hidden',
      background: 'var(--paper)',
    }}>

      {/* ════════════════════════════════════════════════════════════════
          BANNER — slim header that signals exploration mode
      ════════════════════════════════════════════════════════════════ */}
      <header style={{
        flexShrink: 0, height: 52,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 16px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--card)',
      }}>

        {/* Back to Explore */}
        <Link
          href="/explore"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            color: 'var(--muted)', fontSize: '0.78rem', fontWeight: 500,
            textDecoration: 'none', flexShrink: 0,
            transition: 'color 0.15s',
          }}
        >
          <ArrowLeft /> Explore
        </Link>

        <div style={{ width: 1, height: 20, background: 'var(--line)', flexShrink: 0 }} />

        {/* City name + EXPLORE chip */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: '0.92rem', fontWeight: 700, color: 'var(--ink)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {countryCode ? `${flagEmoji(countryCode)} ` : ''}{cityName}
          </span>
          <span style={{
            flexShrink: 0,
            fontFamily: 'var(--mono)', fontSize: '0.58rem', fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 4,
            background: 'var(--paper-2)', color: 'var(--muted)',
            border: '1px solid var(--line)',
          }}>
            Explore
          </span>
        </div>

        {/* Primary CTA — converts to a real trip */}
        <button
          type="button"
          onClick={() => tripModal?.openModal(cityName, [], { startAtDates: true, countryCode })}
          style={{
            flexShrink: 0, padding: '7px 14px',
            background: 'var(--terracotta)', color: '#fff',
            border: 'none', borderRadius: 8,
            fontSize: '0.8rem', fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--terracotta-deep)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--terracotta)'}
        >
          Add dates →
        </button>
      </header>

      {/* ── Mobile list / map toggle (hidden on desktop via CSS) ── */}
      <div
        className="mobile-view-toggle"
        style={{
          borderBottom: '1px solid var(--border)',
          padding: '8px 16px', gap: 8,
          background: 'var(--bg)', flexShrink: 0,
        }}
      >
        {['list', 'map'].map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setMobileView(v)}
            style={{
              flex: 1, padding: '8px', borderRadius: 8,
              border: `1px solid ${mobileView === v ? 'var(--accent)' : 'var(--border)'}`,
              background: mobileView === v ? 'var(--accent-dim)' : 'transparent',
              color: mobileView === v ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: mobileView === v ? 600 : 400,
              fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {v === 'list' ? '☰ List' : '🗺 Map'}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          CONTENT — two-column layout (spot list + map)
      ════════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left: spot list ─────────────────────────────────────── */}
        <div
          className="research-list-panel"
          data-hidden={mobileView !== 'list' ? 'true' : 'false'}
          style={{
            width: 380, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--line)',
            overflow: 'hidden', minHeight: 0,
          }}
        >

          {/* Filter bar — reuses trip-page CSS classes */}
          <div className="filter-bar" style={{ flexShrink: 0 }}>
            <div className="fb-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                placeholder="Search spots…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0 }}
                >×</button>
              )}
            </div>

            {/* Score chips */}
            <div style={{ display: 'flex', gap: 5 }}>
              {SCORE_OPTS.map(o => (
                <button
                  key={o.min}
                  type="button"
                  className={`chip${minScore === o.min ? ' on' : ''}`}
                  onClick={() => setMinScore(o.min)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Refresh strip ── */}
          {refreshCount !== null && !spotsLoading && (
            <div style={{
              flexShrink: 0, padding: '7px 14px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--paper-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              {refreshCount < PREVIEW_REFRESH_LIMIT ? (
                /* Credit available */
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', padding: 0,
                    color: isRefreshing ? 'var(--muted)' : 'var(--terracotta)',
                    fontSize: '0.72rem', fontFamily: 'var(--mono)',
                    fontWeight: 700, cursor: isRefreshing ? 'default' : 'pointer',
                    letterSpacing: '0.04em',
                    transition: 'color 0.15s',
                  }}
                >
                  <span style={{
                    display: 'inline-block',
                    animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                  }}>↻</span>
                  {isRefreshing
                    ? (refreshStatus || 'Researching…')
                    : 'Refresh spots · 1 use'}
                </button>
              ) : (
                /* Credit used */
                <span style={{
                  fontSize: '0.68rem', color: 'var(--muted)',
                  fontFamily: 'var(--mono)', letterSpacing: '0.04em',
                }}>
                  ↻ Research refreshed
                </span>
              )}
            </div>
          )}

          {/* Unlocated notice — shown after a refresh if any spots couldn't be geocoded */}
          {unlocated.length > 0 && (
            <div style={{
              flexShrink: 0, padding: '8px 14px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--paper-2)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <p style={{ flex: 1, fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Found {spots.length} spot{spots.length !== 1 ? 's' : ''}.{' '}
                {unlocated.length} couldn't be placed on the map and weren't saved:{' '}
                {unlocated.map((u) => u.name).join(', ')}.
              </p>
              <button
                type="button"
                onClick={() => setUnlocated([])}
                style={{
                  background: 'none', border: 'none', padding: 0, flexShrink: 0,
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1,
                }}
              >×</button>
            </div>
          )}

          {/* Spot count strip */}
          <div style={{
            flexShrink: 0, padding: '5px 14px',
            fontSize: '0.68rem', color: 'var(--muted)',
            fontFamily: 'var(--mono)', letterSpacing: '0.04em',
            borderBottom: '1px solid var(--line)',
            background: 'var(--paper-2)',
          }}>
            {spotsLoading || isRefreshing
              ? (refreshStatus || 'Loading gems…')
              : `${filteredSpots.length} hidden gem${filteredSpots.length !== 1 ? 's' : ''} · ${cityName}`}
          </div>

          {/* Scrollable spot list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {spotsLoading ? (
              /* Loading skeletons */
              <div>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} style={{
                    padding: '12px 14px', borderBottom: '1px solid var(--line)',
                    display: 'flex', gap: 10, alignItems: 'center',
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--line)', flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ height: 11, borderRadius: 4, background: 'var(--line)', width: '62%' }} />
                      <div style={{ height: 9, borderRadius: 4, background: 'var(--line)', width: '40%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredSpots.length === 0 ? (
              /* Empty state */
              <div style={{ padding: '52px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 14, opacity: 0.35 }}>🔍</div>
                <p style={{
                  fontFamily: 'var(--serif)', fontStyle: 'italic',
                  fontSize: 16, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 12,
                }}>
                  {spots.length === 0
                    ? `No gems cached for ${cityName} yet`
                    : 'No spots match your filters'}
                </p>
                {spots.length === 0 && (
                  <button
                    type="button"
                    onClick={() => tripModal?.openModal(cityName, [], { startAtDates: true, countryCode })}
                    style={{
                      background: 'none', border: 'none',
                      color: 'var(--terracotta)', fontSize: '0.82rem',
                      fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Add dates to research this city →
                  </button>
                )}
              </div>
            ) : (
              /* Spot cards — onQuickAdd shows the dates prompt instead of day selector */
              filteredSpots.map(s => (
                <SpotCard
                  key={s.id ?? s.name}
                  spot={s}
                  active={selectedSpotId === s.id}
                  justFound={false}
                  onSelect={() => { setSelectedSpotId(s.id); setDrawerSpot(s); }}
                  onQuickAdd={() => setShowDatesPrompt(true)}
                  savedIds={savedIds}
                  onToggleSave={toggleSave}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Right: map ──────────────────────────────────────────── */}
        <div
          className="research-map-panel"
          data-hidden={mobileView !== 'map' ? 'true' : 'false'}
          style={{ flex: 1, position: 'relative', background: 'var(--paper-2)', minWidth: 0 }}
        >
          {/* Inset frame — matches trip page */}
          <div style={{
            position: 'absolute', inset: 14,
            borderRadius: 18, overflow: 'hidden',
            border: '1px solid var(--line)',
            boxShadow: '0 2px 8px oklch(0.3 0.02 60 / 0.08), 0 12px 32px -8px oklch(0.3 0.02 60 / 0.18)',
          }}>
            {mapMounted ? (
              <MapView
                key={cityName}
                spots={filteredSpots}
                centerLat={spots.find(s => s.lat)?.lat}
                centerLng={spots.find(s => s.lng)?.lng}
                onSpotClick={handleSpotClick}
                onOpenDrawer={setDrawerSpot}
                minScore={minScore || 1}
                focusSpotId={selectedSpotId}
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0, background: 'var(--map-paper)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 10,
              }}>
                <span style={{ fontSize: '2rem', opacity: 0.3 }}>🗺️</span>
                <p style={{
                  fontSize: '0.78rem', color: 'var(--muted)',
                  fontFamily: 'var(--mono)', letterSpacing: '0.04em',
                }}>
                  {spotsLoading ? `Loading ${cityName}…` : 'Map loads with spots…'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          SPOT DRAWER — same as trip page, days=[] shows "add dates" copy
      ════════════════════════════════════════════════════════════════ */}
      {drawerSpot && (
        <SpotDrawer
          spot={drawerSpot}
          days={[]}
          userId={user?.uid ?? null}
          onClose={() => { setDrawerSpot(null); setSelectedSpotId(null); }}
          onAddToDay={() => { setDrawerSpot(null); setShowDatesPrompt(true); }}
          starred={savedIds.has(drawerSpot.id)}
          onStar={(id) => {
            const s = spots.find(x => x.id === id);
            if (s) toggleSave(s, !savedIds.has(id));
          }}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════
          "ADD DATES" BOTTOM SHEET
          Shown when user taps + on a spot — gates the day plan action
      ════════════════════════════════════════════════════════════════ */}
      {showDatesPrompt && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowDatesPrompt(false); }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 300, padding: '0 0 env(safe-area-inset-bottom)',
          }}
        >
          <div style={{
            width: '100%', maxWidth: 480,
            background: 'var(--card)',
            borderRadius: '16px 16px 0 0',
            padding: 24,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-start', marginBottom: 16,
            }}>
              <div style={{ paddingRight: 16 }}>
                <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ink)', marginBottom: 5 }}>
                  Save spots to a day plan
                </p>
                <p style={{ fontSize: '0.83rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                  Add your travel dates to {cityName} to start building your itinerary —
                  day slots, timing, and a city pass calculator.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDatesPrompt(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--muted)', cursor: 'pointer',
                  fontSize: '1.3rem', lineHeight: 1, flexShrink: 0,
                }}
              >×</button>
            </div>

            <button
              type="button"
              onClick={openWithDates}
              style={{
                width: '100%', padding: '12px', borderRadius: 10,
                background: 'var(--terracotta)', border: 'none',
                color: '#fff', fontSize: '0.95rem', fontWeight: 700,
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--terracotta-deep)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--terracotta)'}
            >
              Add dates to {cityName} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
