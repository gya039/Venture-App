'use client';

import { useEffect, useRef, useState } from 'react';
import { getHiddennessLevel } from '@/constants/hiddenness';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/**
 * MapView — Mapbox GL JS map with coloured hiddenness pins.
 *
 * Props:
 *   spots          {object[]}  Spot docs with lat/lng/hiddennessScore
 *   centerLat      {number}
 *   centerLng      {number}
 *   onSpotClick    {fn}        Called with spot when a marker is tapped
 *   filterInterest {string}    Hides pins not matching this interest
 *   focusSpotId    {string}    When this changes, fly to that spot + highlight its pin
 */
export default function MapView({ spots = [], centerLat, centerLng, onSpotClick, filterInterest = '', focusSpotId = null }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markersRef   = useRef([]);
  const [ready,  setReady]  = useState(false);
  const [mapErr, setMapErr] = useState(null);

  /* ── Init map ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!TOKEN)                   { setMapErr('no-token');    return; }
    if (!containerRef.current)    return;
    if (mapRef.current)           return;

    let map;
    let resizeObs;

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      mapboxgl.accessToken = TOKEN;

      map = new mapboxgl.Map({
        container:          containerRef.current,
        style:              'mapbox://styles/mapbox/dark-v11',
        center:             [centerLng ?? 4.9, centerLat ?? 52.37],
        zoom:               12,
        attributionControl: false,
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new mapboxgl.AttributionControl({ compact: true }),    'bottom-right');

      map.on('load', () => {
        mapRef.current = map;
        // Double rAF: first lets the browser finish the flex layout pass,
        // second lets Mapbox's own rAF queue drain before we place markers.
        // Without this, the map canvas can report 0×0 and all markers
        // land at top-left until the user triggers a zoom/pan.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            map.resize();
            setReady(true);
          });
        });
      });

      // Debounced ResizeObserver — avoids calling resize() during transient
      // flex-layout changes (hover state, filter chips expanding, etc.)
      // that would snap all markers back to top-left mid-render.
      if (containerRef.current && typeof ResizeObserver !== 'undefined') {
        let resizeTimer;
        resizeObs = new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => { mapRef.current?.resize(); }, 50);
        });
        resizeObs.observe(containerRef.current);
      }
    }).catch(() => setMapErr('load-failed'));

    return () => {
      resizeObs?.disconnect();
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line

  // Keep onSpotClick in a ref so changing the callback never re-creates markers
  const onSpotClickRef = useRef(onSpotClick);
  useEffect(() => { onSpotClickRef.current = onSpotClick; });

  // Store spot→element map so we can highlight the focused pin
  const markerElemsRef = useRef({}); // spotId → DOM element

  /* ── Update markers ───────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      markerElemsRef.current = {};

      const visible = filterInterest
        ? spots.filter(s => (s.interests ?? []).includes(filterInterest))
        : spots;

      visible.forEach(spot => {
        if (!spot.lat || !spot.lng || spot.coordsMissing) return;
        const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
        const isFocused = spot.id === focusSpotId;

        const el = document.createElement('div');
        Object.assign(el.style, {
          width:        isFocused ? '34px' : '26px',
          height:       isFocused ? '34px' : '26px',
          borderRadius: '50%',
          background:   level.color,
          border:       isFocused ? '2px solid #fff' : '2px solid rgba(0,0,0,0.4)',
          boxShadow:    isFocused
            ? `0 0 0 3px ${level.color}60, 0 0 18px ${level.color}80, 0 2px 8px rgba(0,0,0,0.5)`
            : `0 0 8px ${level.color}60, 0 2px 4px rgba(0,0,0,0.4)`,
          cursor:       'pointer',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          fontSize:     isFocused ? '11px' : '10px',
          fontWeight:   '700',
          color:        '#000',
          transition:   'all 0.2s ease',
          userSelect:   'none',
          zIndex:       isFocused ? '10' : '1',
        });
        el.textContent  = spot.hiddennessScore;
        el.onmouseenter = () => { if (spot.id !== focusSpotId) el.style.transform = 'scale(1.3)'; };
        el.onmouseleave = () => { if (spot.id !== focusSpotId) el.style.transform = 'scale(1)'; };
        el.onclick      = () => onSpotClickRef.current?.(spot);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([spot.lng, spot.lat])
          .addTo(map);
        markersRef.current.push(marker);
        markerElemsRef.current[spot.id] = el;
      });

      // Fit bounds to all visible spots (only on initial load, not focus change)
      if (!focusSpotId) {
        const withCoords = visible.filter(s => s.lat && s.lng && !s.coordsMissing);
        if (withCoords.length > 1) {
          const lats = withCoords.map(s => s.lat);
          const lngs = withCoords.map(s => s.lng);
          map.fitBounds(
            [[Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
             [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005]],
            { padding: 60, maxZoom: 15, duration: 600 }
          );
        } else if (withCoords.length === 1) {
          map.flyTo({ center: [withCoords[0].lng, withCoords[0].lat], zoom: 14 });
        }
      }
    });
  }, [spots, ready, filterInterest]); // eslint-disable-line — onSpotClick intentionally via ref

  /* ── Fly to focused spot ──────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusSpotId) return;
    const spot = spots.find(s => s.id === focusSpotId);
    if (!spot?.lat || !spot?.lng || spot.coordsMissing) return;
    map.flyTo({ center: [spot.lng, spot.lat], zoom: 15, duration: 500 });
  }, [focusSpotId, ready]); // eslint-disable-line

  /* ── Error / loading states ───────────────────────────────────────────── */
  if (mapErr === 'no-token') {
    return (
      <div style={{ width:'100%', height:'100%', background:'#111', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:24, textAlign:'center' }}>
        <span style={{ fontSize:'2.5rem' }}>🗺️</span>
        <p style={{ color:'#f5f5f5', fontWeight:600 }}>Mapbox token needed</p>
        <p style={{ color:'#555', fontSize:'0.82rem', maxWidth:280, lineHeight:1.65 }}>
          Add your free token to <code style={{ color:'#f59e0b' }}>.env.local</code>:
          <br /><code style={{ color:'#f59e0b', fontSize:'0.75rem' }}>NEXT_PUBLIC_MAPBOX_TOKEN=pk.ey…</code>
        </p>
        <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" style={{ padding:'8px 18px', background:'#f59e0b', color:'#000', borderRadius:8, fontSize:'0.82rem', fontWeight:600, textDecoration:'none' }}>
          Get free token →
        </a>
      </div>
    );
  }

  // Both wrapper and container use position:absolute inset:0.
  // This fills the nearest positioned ancestor (the flex panel with
  // position:relative in the trips page) without relying on CSS height
  // inheritance through flex children — which is the source of the
  // "markers snap to top-left on hover" glitch.
  return (
    <div style={{ position:'absolute', inset:0 }}>
      <div ref={containerRef} style={{ position:'absolute', inset:0 }} />
      {!ready && (
        <div style={{ position:'absolute', inset:0, background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:28, height:28, borderRadius:'50%', border:'2px solid #222', borderTopColor:'#f59e0b', animation:'spin 0.8s linear infinite' }} />
        </div>
      )}
    </div>
  );
}
