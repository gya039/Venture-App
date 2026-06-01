'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useDestination } from '@/hooks/useDestination';
import { INTERESTS } from '@/constants/interests';

// Dynamically import MapView — Mapbox can't run on the server
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div style={{ width:'100%', height:'100%', background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:28, height:28, borderRadius:'50%', border:'2px solid #222', borderTopColor:'#f59e0b', animation:'spin 0.8s linear infinite' }} />
    </div>
  ),
});

export default function MapPage() {
  const { id: tripId }   = useParams();
  const [selectedSpot,   setSelectedSpot]   = useState(null);
  const [filterInterest, setFilterInterest] = useState('');
  const [minScore,       setMinScore]       = useState(1);
  const [skipTourist,    setSkipTourist]    = useState(false);
  const effectiveMin = skipTourist ? Math.max(minScore, 3) : minScore;

  // TODO: in a full implementation, load the trip first to pick the destination.
  // For now we read destId from the URL query (passed when navigating from Trip Detail).
  const [destId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('destId') ?? '';
  });

  const { spots, loading } = useDestination(destId || null);

  const handleSpotClick = useCallback((spot) => setSelectedSpot(spot), []);
  const handleDismiss   = useCallback(() => setSelectedSpot(null), []);

  const presentInterests = INTERESTS.filter(i => spots.some(s => (s.interests ?? []).includes(i.id)));

  // First spot with coords as centre fallback
  const centre = spots.find(s => s.lat && s.lng && !s.coordsMissing);

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0a0a0a', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{
        position:       'relative', zIndex: 20,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '14px 16px',
        paddingTop:     'calc(14px + env(safe-area-inset-top))',
        background:     'rgba(10,10,10,0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom:   '1px solid #222',
      }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#999', fontSize: '0.9rem', textDecoration: 'none' }}>
          ← Research
        </Link>
        <h1 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Map</h1>
        <div style={{ width: 60 }} />
      </header>

      {/* ── Interest filter chips ────────────────────────────────────────── */}
      {presentInterests.length > 0 && (
        <div style={{
          position:       'relative', zIndex: 20,
          display:        'flex',
          gap:            '6px',
          overflowX:      'auto',
          padding:        '10px 14px',
          background:     'rgba(10,10,10,0.85)',
          backdropFilter: 'blur(8px)',
          borderBottom:   '1px solid #1a1a1a',
          scrollbarWidth: 'none',
        }}>
          {[{ id: '', label: 'All', icon: '🗺️' }, ...presentInterests].map(i => (
            <button
              key={i.id}
              onClick={() => setFilterInterest(i.id)}
              style={{
                padding:      '5px 12px',
                borderRadius: '20px',
                border:       `1px solid ${filterInterest === i.id ? '#f59e0b' : '#222'}`,
                background:   filterInterest === i.id ? 'rgba(245,158,11,0.12)' : 'rgba(20,20,20,0.9)',
                color:        filterInterest === i.id ? '#f59e0b' : '#777',
                fontSize:     '0.75rem',
                fontWeight:   filterInterest === i.id ? 600 : 400,
                cursor:       'pointer',
                whiteSpace:   'nowrap',
                flexShrink:   0,
                display:      'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span>{i.icon}</span><span>{i.label}</span>
            </button>
          ))}
          {/* Min score quick filters */}
          <div style={{ width: 1, background: '#333', flexShrink: 0, margin: '0 2px' }} />
          {[
            { label: 'Any', val: 1 },
            { label: '5+',  val: 5 },
            { label: '7+',  val: 7 },
            { label: '9+',  val: 9 },
          ].map(({ label, val }) => (
            <button
              key={val}
              onClick={() => setMinScore(val)}
              style={{
                padding:      '5px 10px',
                borderRadius: '20px',
                border:       `1px solid ${minScore === val ? '#f59e0b' : '#222'}`,
                background:   minScore === val ? 'rgba(245,158,11,0.12)' : 'rgba(20,20,20,0.9)',
                color:        minScore === val ? '#f59e0b' : '#555',
                fontSize:     '0.72rem',
                fontWeight:   minScore === val ? 600 : 400,
                cursor:       'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ✦{label}
            </button>
          ))}
          {/* Skip Tourist Trail toggle */}
          <div style={{ width: 1, background: '#333', flexShrink: 0, margin: '0 2px' }} />
          <button
            onClick={() => setSkipTourist((v) => !v)}
            style={{
              padding: '5px 12px', borderRadius: '20px',
              border:  `1px solid ${skipTourist ? '#f59e0b' : '#222'}`,
              background: skipTourist ? 'rgba(245,158,11,0.12)' : 'rgba(20,20,20,0.9)',
              color: skipTourist ? '#f59e0b' : '#555',
              fontSize: '0.72rem', fontWeight: skipTourist ? 600 : 400,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            🚫 Tourist Trail
          </button>
        </div>
      )}

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapView
          spots={spots}
          centerLat={centre?.lat}
          centerLng={centre?.lng}
          onSpotClick={handleSpotClick}
          filterInterest={filterInterest}
          minScore={effectiveMin}
          focusSpotId={selectedSpot?.id ?? null}
        />

        {/* Spot count badge */}
        {!loading && spots.length > 0 && (
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            background: 'rgba(10,10,10,0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #222',
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: '0.72rem', color: '#777',
          }}>
            {(() => {
              const n = spots.filter(s => {
                const score = s.hiddennessScore ?? 1;
                if (score < effectiveMin) return false;
                if (filterInterest && !(s.interests ?? []).includes(filterInterest)) return false;
                return true;
              }).length;
              return `${n} spot${n !== 1 ? 's' : ''}`;
            })()}
          </div>
        )}
      </div>

      {/* ── Selected spot bottom sheet ──────────────────────────────────── */}
      {selectedSpot && (
        <div style={{
          position:       'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
          background:     'var(--card)',
          borderRadius:   '14px 14px 0 0',
          padding:        '20px',
          paddingBottom:  'calc(20px + env(safe-area-inset-bottom))',
          boxShadow:      '0 -8px 40px rgba(0,0,0,0.6)',
          animation:      'fadeInUp 0.25s ease both',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, flex: 1, marginRight: 12 }}>{selectedSpot.name}</h2>
            <button onClick={() => setSelectedSpot(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
          </div>

          <p style={{ fontSize: '0.82rem', color: '#888', lineHeight: 1.6, marginBottom: 14 }}>
            {selectedSpot.description ?? 'No description available.'}
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <Link
              href={`/spots/${selectedSpot.id}?city=${encodeURIComponent(selectedSpot.city ?? '')}&tripId=${tripId}`}
              style={{ flex: 1, padding: '10px', background: '#f59e0b', color: '#000', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none', textAlign: 'center' }}
            >
              View details →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
