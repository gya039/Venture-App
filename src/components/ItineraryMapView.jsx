'use client';

/**
 * ItineraryMapView — shows ONLY the planned spots on a map,
 * connected by day-coloured route lines in visit order.
 * Used in the DaysBuilder "Map" view.
 *
 * Props:
 *   days        – array of day objects (with .id, .dayNumber, .planDate)
 *   allSlots    – { [dayId]: { morning:[], afternoon:[], evening:[] } }
 *   dayColors   – array of hex colour strings (one per day, wraps)
 *   accommodation – { address, lat, lng } | null
 *   city        – string (for the empty state label)
 */

import { useRef, useEffect, useState } from 'react';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const SLOTS  = ['morning', 'afternoon', 'evening'];

// Flatten a day's allSlots entry into an ordered array of spots with coords
function orderedSpots(daySlots) {
  return SLOTS.flatMap((s) => daySlots?.[s] ?? [])
    .filter((sp) => sp.lat && sp.lng && !sp.coordsMissing);
}

export default function ItineraryMapView({ days = [], allSlots = {}, dayColors = [], accommodation = null, city = '' }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const mglRef       = useRef(null);
  const accomRef     = useRef(null);
  const [ready, setReady] = useState(false);
  const [err,   setErr]   = useState(null);

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!TOKEN) { setErr('no-token'); return; }
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    import('mapbox-gl').then((mod) => {
      if (cancelled) return;
      const mgl = mod.default;
      mglRef.current = mgl;
      mgl.accessToken = TOKEN;

      const map = new mgl.Map({
        container:  containerRef.current,
        style:      'mapbox://styles/mapbox/dark-v11',
        zoom:       12,
        center:     [0, 51],   // overwritten by fitBounds below
        interactive: true,
        attributionControl: false,
      });

      map.on('load', () => {
        if (cancelled) { map.remove(); return; }
        mapRef.current = mgl; // store mgl so render effect can use it
        setReady(true);
      });

      // Store map instance separately
      mapRef.current = map;
    }).catch(() => setErr('load-failed'));

    return () => {
      cancelled = true;
      try { mapRef.current?.remove?.(); } catch {}
      mapRef.current = null;
      mglRef.current = null;
    };
  }, []); // eslint-disable-line

  // ── Draw / update markers + routes whenever data or ready state changes ─────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!map || !mgl || !ready) return;

    // Wait for style to be fully loaded before adding sources/layers
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => renderAll(map, mgl));
      return;
    }
    renderAll(map, mgl);
  }, [days, allSlots, dayColors, accommodation, ready]); // eslint-disable-line

  function renderAll(map, mgl) {
    // ── Clean up previous markers and sources ──
    if (accomRef.current) { accomRef.current.remove(); accomRef.current = null; }

    // Remove old route sources/layers
    const style = map.getStyle();
    (style?.layers ?? []).forEach((l) => {
      if (l.id.startsWith('itin-route-')) map.removeLayer(l.id);
    });
    (Object.keys(style?.sources ?? {})).forEach((k) => {
      if (k.startsWith('itin-route-') || k.startsWith('itin-spots-')) map.removeSource(k);
    });

    // Remove old spot markers
    const existing = document.querySelectorAll('.itin-spot-marker');
    existing.forEach((el) => el.remove());

    const allPoints = [];

    // ── Accommodation home-base pin (matches Research map style) ──────────────
    if (accommodation?.lat && accommodation?.lng) {
      allPoints.push([accommodation.lng, accommodation.lat]);

      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, {
        width: '44px', height: '54px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        zIndex: '100', cursor: 'default',
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.55))',
        pointerEvents: 'none',
      });
      wrapper.className = 'itin-spot-marker';

      const head = document.createElement('div');
      Object.assign(head.style, {
        width: '44px', height: '44px',
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        background: 'linear-gradient(135deg,#f59e0b,#d97706)',
        border: '3px solid #fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      });

      const icon = document.createElement('div');
      Object.assign(icon.style, { transform: 'rotate(45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '5px', marginBottom: '5px' });
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="white" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';
      head.appendChild(icon);
      wrapper.appendChild(head);

      accomRef.current = new mgl.Marker({ element: wrapper, anchor: 'bottom-left' })
        .setLngLat([accommodation.lng, accommodation.lat])
        .addTo(map);
    }

    // ── Per-day: spot markers + route line ────────────────────────────────────
    days.forEach((day, idx) => {
      const color  = dayColors[idx % dayColors.length] ?? '#f59e0b';
      const spots  = orderedSpots(allSlots[day.id]);
      if (!spots.length) return;

      const coords = spots.map((sp) => [sp.lng, sp.lat]);
      allPoints.push(...coords);

      // Route polyline
      const srcId   = `itin-route-${day.id}`;
      const layerId = `itin-route-line-${day.id}`;
      if (!map.getSource(srcId)) {
        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
        });
        map.addLayer({
          id:   layerId,
          type: 'line',
          source: srcId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color':   color,
            'line-width':   2.5,
            'line-opacity': 0.7,
            'line-dasharray': [1, 2.5],
          },
        });
      }

      // Spot markers — numbered circles in the day colour
      spots.forEach((sp, i) => {
        const el = document.createElement('div');
        el.className = 'itin-spot-marker';
        Object.assign(el.style, {
          width: '26px', height: '26px', borderRadius: '50%',
          background: color,
          border: '2.5px solid #fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: '700', color: '#000',
          boxShadow: `0 0 8px ${color}60, 0 2px 6px rgba(0,0,0,0.4)`,
          cursor: 'default', userSelect: 'none', zIndex: '5',
          fontFamily: 'var(--font-sans, sans-serif)',
        });
        el.textContent = i + 1;

        new mgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([sp.lng, sp.lat])
          .setPopup(
            new mgl.Popup({ offset: 16, closeButton: false, className: 'venture-popup', maxWidth: '220px' })
              .setHTML(`<div style="padding:10px 14px"><div style="font-family:var(--mono,monospace);font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${color};margin-bottom:3px">Day ${day.dayNumber} · Stop ${i + 1}</div><div style="font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.2">${sp.name}</div></div>`)
          )
          .addTo(map);
      });
    });

    // ── Fit map to all points ─────────────────────────────────────────────────
    if (allPoints.length === 1) {
      map.flyTo({ center: allPoints[0], zoom: 14 });
    } else if (allPoints.length > 1) {
      const lngs = allPoints.map((p) => p[0]);
      const lats = allPoints.map((p) => p[1]);
      map.fitBounds(
        [[Math.min(...lngs) - 0.006, Math.min(...lats) - 0.006],
         [Math.max(...lngs) + 0.006, Math.max(...lats) + 0.006]],
        { padding: 48, maxZoom: 15, duration: 600 },
      );
    }
  }

  // ── Error / empty states ────────────────────────────────────────────────────
  if (err === 'no-token') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--muted)', fontSize: '0.82rem' }}>
        <span style={{ fontSize: '2rem' }}>🗺️</span>
        <p>Mapbox token needed to show the map.</p>
      </div>
    );
  }

  const totalPlanned = days.reduce((n, d) => n + orderedSpots(allSlots[d.id]).length, 0);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading spinner */}
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--map-paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Empty state overlay */}
      {ready && totalPlanned === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(14,14,22,0.82)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
            padding: '18px 24px', textAlign: 'center', maxWidth: 260,
          }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', lineHeight: 1.6 }}>
              Add spots to your days to see the route map for {city || 'your trip'}.
            </p>
          </div>
        </div>
      )}

      {/* Day legend — bottom-left */}
      {ready && totalPlanned > 0 && (
        <div style={{
          position: 'absolute', bottom: 16, left: 10,
          background: 'rgba(14,14,22,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5,
          zIndex: 10,
        }}>
          {days.filter((d) => orderedSpots(allSlots[d.id]).length > 0).map((day, idx) => {
            const color = dayColors[idx % dayColors.length] ?? '#f59e0b';
            const count = orderedSpots(allSlots[day.id]).length;
            return (
              <div key={day.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' }}>
                  Day {day.dayNumber} · {count} stop{count !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
