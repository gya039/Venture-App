'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getTrip, addSpotToDayPlan } from '@/lib/db';
import { useDestination } from '@/hooks/useDestination';
import { useDayPlanner } from '@/hooks/useDayPlanner';
import { runResearch } from '@/lib/functions';
import SpotCard from '@/components/SpotCard';
import ResearchLoader from '@/components/ResearchLoader';
import CountdownBadge from '@/components/CountdownBadge';
import DayPlanColumn from '@/components/DayPlanColumn';
import DayPassCalculator from '@/components/DayPassCalculator';
import Sidebar from '@/components/Sidebar';
import { INTERESTS } from '@/constants/interests';

/* ── Date helpers ─────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  });
}

function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map((c) =>
    String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))
  ).join('');
}

/* ── Tab component ────────────────────────────────────────────────────────── */
function Tab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background:   'none',
        border:       'none',
        padding:      '10px 0',
        fontSize:     '0.88rem',
        fontWeight:   active ? 600 : 400,
        color:        active ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor:       'pointer',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        transition:   'color 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function TripDetailPage() {
  const { id: tripId }      = useParams();
  const { user, authReady } = useAuth();

  const [trip,           setTrip]          = useState(null);
  const [tripLoading,    setTripLoading]   = useState(true);
  const [tripError,      setTripError]     = useState(null);
  const [selectedIdx,    setSelectedIdx]   = useState(0);
  const [activeTab,      setActiveTab]     = useState('Research');
  const [filterInterest, setFilterInterest]= useState('');
  const [isResearching,  setIsResearching] = useState(false);
  const [researchError,  setResearchError] = useState(null);

  // Add-spot-to-day modal
  const [addSpotModal,   setAddSpotModal]  = useState(null); // { dayPlanId, dayNumber }
  const [spotSearch,     setSpotSearch]    = useState('');
  const [addingSpot,     setAddingSpot]    = useState(null); // spotId being added
  const [addedSpots,     setAddedSpots]    = useState(new Set());

  /* ── Load trip ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!tripId || !authReady) return;
    getTrip(tripId)
      .then((t) => {
        setTrip(t);
        if (!t) setTripError('Trip not found.');
      })
      .catch((err) => setTripError(err.message))
      .finally(() => setTripLoading(false));
  }, [tripId, authReady]);

  /* ── Destination + spots ────────────────────────────────────────────────── */
  const selectedDest = trip?.destinations?.[selectedIdx] ?? null;
  const { spots, loading: spotsLoading, refetch } = useDestination(selectedDest?.id);
  const { days, loading: daysLoading, refetch: refetchDays } = useDayPlanner(selectedDest?.id, selectedDest?.city);

  /* ── Auto-trigger research ──────────────────────────────────────────────── */
  const triggerResearch = useCallback(async (force = false) => {
    if (!selectedDest) return;
    setIsResearching(true);
    setResearchError(null);
    try {
      await runResearch(selectedDest.city, trip?.interests ?? [], selectedDest.id, force);
      await refetch();
    } catch (err) {
      console.error('Research error:', err);
      setResearchError(
        err?.message?.includes('not configured')
          ? 'Firebase Functions are not deployed yet. Run: firebase deploy --only functions'
          : (err.message ?? 'Research failed. Please try again.')
      );
    } finally {
      setIsResearching(false);
    }
  }, [selectedDest, trip, refetch]);

  useEffect(() => {
    // Auto-trigger when: spots are empty, not already researching, no prior error
    if (spotsLoading || isResearching || researchError) return;
    if (!selectedDest) return;
    if (spots.length > 0) return;
    triggerResearch();
  }, [selectedDest?.id, spots.length, spotsLoading, isResearching]);

  // Reset interest filter when destination changes
  useEffect(() => { setFilterInterest(''); }, [selectedDest?.id]);

  /* ── Derived data ───────────────────────────────────────────────────────── */
  const filteredSpots = filterInterest
    ? spots.filter((s) => (s.interests ?? []).includes(filterInterest))
    : spots;

  // Interest chips — only show interests that appear in at least one spot
  const presentInterests = INTERESTS.filter((i) =>
    spots.some((s) => (s.interests ?? []).includes(i.id))
  );

  /* ── Loading / error shell ──────────────────────────────────────────────── */
  if (tripLoading || !authReady) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (tripError || !trip) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <div style={{ flex: 1, padding: '40px 48px' }}>
          <p style={{ color: 'var(--text-muted)' }}>{tripError ?? 'Trip not found.'}</p>
          <Link href="/" style={{ color: 'var(--accent)', fontSize: '0.85rem', marginTop: '12px', display: 'inline-block' }}>← Back to trips</Link>
        </div>
      </div>
    );
  }

  /* ── Compute header info ────────────────────────────────────────────────── */
  const firstDest = trip.destinations[0];
  const lastDest  = trip.destinations[trip.destinations.length - 1];
  const headerTitle = trip.name
    ?? (trip.isMultiCity
        ? trip.destinations.map((d) => d.city).join(' · ')
        : `${flagEmoji(firstDest?.countryCode)} ${firstDest?.city}`);
  const dateRange = `${fmtDate(firstDest?.startDate)} – ${fmtDate(lastDest?.endDate)}`;

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
    <div style={{ flex: 1, minWidth: 0, maxWidth: 860, paddingBottom: 48 }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{ padding: '40px 48px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <Link href="/" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Trips</Link>
          <Link
            href={`/trips/${tripId}/map?destId=${selectedDest?.id ?? ''}`}
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          '4px',
              color:        'var(--text-secondary)',
              fontSize:     '0.82rem',
              background:   'var(--card)',
              border:       '1px solid var(--border)',
              borderRadius: '6px',
              padding:      '5px 10px',
              textDecoration:'none',
            }}
          >
            🗺️ Map
          </Link>
        </div>

        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '8px', letterSpacing: '-0.01em' }}>
          {headerTitle}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{dateRange}</span>
          <CountdownBadge date={firstDest?.startDate} />
        </div>

        {/* ── Destination tabs (multi-city) ──────────────────────────────── */}
        {trip.isMultiCity && trip.destinations.length > 1 && (
          <div style={{
            display:      'flex',
            gap:          '8px',
            overflowX:    'auto',
            marginTop:    '14px',
            paddingBottom:'2px',
          }}>
            {trip.destinations.map((dest, idx) => (
              <button
                key={dest.id}
                onClick={() => setSelectedIdx(idx)}
                style={{
                  padding:      '7px 14px',
                  borderRadius: '8px',
                  border:       `1px solid ${selectedIdx === idx ? 'var(--accent)' : 'var(--border)'}`,
                  background:   selectedIdx === idx ? 'rgba(245,158,11,0.1)' : 'var(--card)',
                  color:        selectedIdx === idx ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight:   selectedIdx === idx ? 600 : 400,
                  fontSize:     '0.82rem',
                  cursor:       'pointer',
                  whiteSpace:   'nowrap',
                  flexShrink:   0,
                  transition:   'border-color 0.15s, background 0.15s',
                }}
              >
                {flagEmoji(dest.countryCode)} {dest.city}
              </button>
            ))}
          </div>
        )}

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div style={{
          display:      'flex',
          gap:          '20px',
          marginTop:    '16px',
          borderBottom: '1px solid var(--border)',
        }}>
          {['Research', 'Days', 'Pass'].map((t) => (
            <Tab key={t} label={t} active={activeTab === t} onClick={() => setActiveTab(t)} />
          ))}
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <main style={{ padding: '24px 48px' }}>

        {/* ════════════════ RESEARCH TAB ════════════════ */}
        {activeTab === 'Research' && (
          <div>

            {/* Research running */}
            {isResearching && (
              <ResearchLoader city={selectedDest?.city} />
            )}

            {/* Research error */}
            {researchError && !isResearching && (
              <div style={{
                padding:      '14px 16px',
                background:   'rgba(239,68,68,0.08)',
                border:       '1px solid rgba(239,68,68,0.2)',
                borderRadius: '10px',
                marginBottom: '16px',
              }}>
                <p style={{ color: '#f87171', fontSize: '0.83rem', lineHeight: 1.55 }}>{researchError}</p>
                <button
                  onClick={() => triggerResearch()}
                  style={{
                    marginTop:    '10px',
                    background:   'none',
                    border:       '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '6px',
                    color:        '#f87171',
                    fontSize:     '0.78rem',
                    padding:      '5px 12px',
                    cursor:       'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Interest filter chips */}
            {!isResearching && spots.length > 0 && presentInterests.length > 0 && (
              <div style={{
                display:    'flex',
                gap:        '6px',
                overflowX:  'auto',
                marginBottom:'16px',
                paddingBottom:'2px',
              }}>
                {/* "All" chip */}
                <button
                  onClick={() => setFilterInterest('')}
                  style={{
                    padding:      '5px 12px',
                    borderRadius: '20px',
                    border:       `1px solid ${filterInterest === '' ? 'var(--accent)' : 'var(--border)'}`,
                    background:   filterInterest === '' ? 'rgba(245,158,11,0.1)' : 'var(--card)',
                    color:        filterInterest === '' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize:     '0.78rem',
                    fontWeight:   filterInterest === '' ? 600 : 400,
                    cursor:       'pointer',
                    flexShrink:   0,
                    whiteSpace:   'nowrap',
                  }}
                >
                  All
                </button>
                {presentInterests.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setFilterInterest(filterInterest === i.id ? '' : i.id)}
                    style={{
                      padding:      '5px 12px',
                      borderRadius: '20px',
                      border:       `1px solid ${filterInterest === i.id ? 'var(--accent)' : 'var(--border)'}`,
                      background:   filterInterest === i.id ? 'rgba(245,158,11,0.1)' : 'var(--card)',
                      color:        filterInterest === i.id ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize:     '0.78rem',
                      fontWeight:   filterInterest === i.id ? 600 : 400,
                      cursor:       'pointer',
                      flexShrink:   0,
                      whiteSpace:   'nowrap',
                      display:      'flex',
                      alignItems:   'center',
                      gap:          '4px',
                    }}
                  >
                    <span>{i.icon}</span>
                    <span>{i.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Spot list */}
            {!isResearching && filteredSpots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredSpots.map((spot) => (
                  <SpotCard
                    key={spot.id}
                    spot={spot}
                    destId={selectedDest?.id}
                    tripId={tripId}
                  />
                ))}

                {/* Refresh research */}
                <div style={{ textAlign: 'center', marginTop: '8px' }}>
                  <button
                    onClick={() => triggerResearch(true)}
                    disabled={isResearching}
                    style={{
                      background:   'none',
                      border:       '1px solid var(--border)',
                      borderRadius: '8px',
                      color:        'var(--text-muted)',
                      fontSize:     '0.78rem',
                      padding:      '8px 16px',
                      cursor:       isResearching ? 'not-allowed' : 'pointer',
                    }}
                  >
                    🔄 Refresh Research
                  </button>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    ~$0.02 · clears cache &amp; re-runs AI
                  </p>
                </div>
              </div>
            )}

            {/* Empty: filter returned no results */}
            {!isResearching && spots.length > 0 && filteredSpots.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '0.85rem' }}>No spots match this filter.</p>
                <button
                  onClick={() => setFilterInterest('')}
                  style={{ marginTop: '8px', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════ DAYS TAB ════════════════ */}
        {activeTab === 'Days' && (
          <div>
            {daysLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ height: 120, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i*0.1}s` }} />
                ))}
              </div>
            ) : days.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📅</div>
                <p style={{ fontSize: '0.85rem' }}>No day plans yet.</p>
                <p style={{ fontSize: '0.78rem', marginTop: '6px', lineHeight: 1.5 }}>Create a trip with dates to auto-generate day slots.</p>
              </div>
            ) : (
              <>
                {/* Running cost total */}
                {(() => {
                  const total = days.reduce((s, d) => s + d.totalCost, 0);
                  const spotCount = days.reduce((s, d) => s + d.spots.length, 0);
                  return total > 0 ? (
                    <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{spotCount} spot{spotCount !== 1 ? 's' : ''} planned</p>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>Entries so far</p>
                      </div>
                      <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent)' }}>~€{total}/pp</p>
                    </div>
                  ) : null;
                })()}

                {/* Day columns */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {days.map(day => (
                    <DayPlanColumn
                      key={day.id}
                      day={day}
                      tripId={tripId}
                      onAddSpot={(dayPlanId, dayNumber) => {
                        setAddSpotModal({ dayPlanId, dayNumber });
                        setSpotSearch('');
                        setAddedSpots(new Set());
                      }}
                    />
                  ))}
                </div>

                {spots.length === 0 && (
                  <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <button onClick={() => setActiveTab('Research')} style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                      Research spots first →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ════════════════ PASS TAB ════════════════ */}
        {activeTab === 'Pass' && (
          <div>
            {/* Header */}
            <div style={{ marginBottom: 18 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 4 }}>City Pass Calculator</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Should you buy a tourist pass? We crunch your day plan to find out.
              </p>
            </div>

            {daysLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2].map(i => (
                  <div key={i} style={{ height: 80, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                ))}
              </div>
            ) : (
              <DayPassCalculator
                city={selectedDest?.city}
                days={days}
                tripDays={(() => {
                  if (!selectedDest?.startDate || !selectedDest?.endDate) return 1;
                  const ms = new Date(selectedDest.endDate) - new Date(selectedDest.startDate);
                  return Math.max(1, Math.round(ms / 86400000) + 1);
                })()}
              />
            )}
          </div>
        )}

      </main>

      {/* ── Add-spot-to-day modal ────────────────────────────────────── */}
      {addSpotModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setAddSpotModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
        >
          <div style={{ width: '100%', background: 'var(--card)', borderRadius: '16px 16px 0 0', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', maxHeight: '75dvh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Add to Day {addSpotModal.dayNumber}</p>
              <button onClick={() => setAddSpotModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Search spots…"
              value={spotSearch}
              onChange={e => setSpotSearch(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />

            {/* Spot list */}
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {spots
                .filter(s => !spotSearch || s.name.toLowerCase().includes(spotSearch.toLowerCase()))
                .map(spot => {
                  const added = addedSpots.has(spot.id);
                  const adding = addingSpot === spot.id;
                  return (
                    <button
                      key={spot.id}
                      disabled={adding || added}
                      onClick={async () => {
                        setAddingSpot(spot.id);
                        try {
                          await addSpotToDayPlan(addSpotModal.dayPlanId, spot.id, spot.city, 'morning');
                          setAddedSpots(prev => new Set([...prev, spot.id]));
                          refetchDays();
                        } catch (err) { console.error(err); }
                        finally { setAddingSpot(null); }
                      }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: added ? 'rgba(34,197,94,0.08)' : 'var(--bg)', border: `1px solid ${added ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`, borderRadius: 8, cursor: added || adding ? 'default' : 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{spot.name}</span>
                      <span style={{ fontSize: '0.72rem', color: added ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                        {added ? '✓ Added' : adding ? '…' : '+ Add'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}
