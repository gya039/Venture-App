'use client';

/**
 * ItineraryMapView — day-coloured route map for the Days planner.
 *
 * Props:
 *   days          – array of day objects (with .id, .dayNumber, .planDate)
 *   allSlots      – { [dayId]: { morning:[], afternoon:[], evening:[] } }
 *   dayColors     – array of hex colour strings (one per day, wraps)
 *   accommodation – { address, lat, lng } | null
 *   city          – string (empty-state label)
 */

import { useRef, useEffect, useState, useCallback } from 'react';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const SLOTS  = ['morning', 'afternoon', 'evening'];

function orderedSpots(daySlots) {
  return SLOTS.flatMap((s) => daySlots?.[s] ?? [])
    .filter((sp) => sp.lat && sp.lng && !sp.coordsMissing);
}

export default function ItineraryMapView({ days = [], allSlots = {}, dayColors = [], accommodation = null, city = '', onVisibleDaysChange = null }) {
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);
  const mglRef          = useRef(null);
  const accomRef        = useRef(null);
  const markersByDay    = useRef({}); // { [dayId]: Marker[] }

  const [ready,       setReady]       = useState(false);
  const [err,         setErr]         = useState(null);
  const [visibleDays, setVisibleDays] = useState(new Set());

  // ── Init map ─────────────────────────────────────────────────────────────────
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
        center:     [0, 51],
        interactive: true,
        attributionControl: false,
      });

      map.on('load', () => {
        if (cancelled) { map.remove(); return; }
        setReady(true);
      });

      mapRef.current = map;
    }).catch(() => setErr('load-failed'));

    return () => {
      cancelled = true;
      try { mapRef.current?.remove?.(); } catch {}
      mapRef.current = null;
      mglRef.current = null;
    };
  }, []); // eslint-disable-line

  // ── Reset visible days when the day list changes ──────────────────────────────
  useEffect(() => {
    setVisibleDays(new Set(days.map((d) => d.id)));
  }, [days.map((d) => d.id).join(',')]); // eslint-disable-line

  // ── Draw / update whenever data or ready state changes ────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!map || !mgl || !ready) return;

    if (!map.isStyleLoaded()) {
      map.once('styledata', () => renderAll(map, mgl));
      return;
    }
    renderAll(map, mgl);
  }, [days, allSlots, dayColors, accommodation, ready]); // eslint-disable-line

  // ── Sync visible days up to DaysBuilder so the picker sidebar can filter ──────
  useEffect(() => {
    onVisibleDaysChange?.(visibleDays);
  }, [visibleDays]); // eslint-disable-line

  // ── Toggle a single day's visibility ─────────────────────────────────────────
  const toggleDay = useCallback((dayId, solo = false) => {
    const map = mapRef.current;

    setVisibleDays((prev) => {
      let next;

      if (solo) {
        // Solo mode: if this day is already the only visible one, show all; else show only this day
        if (prev.size === 1 && prev.has(dayId)) {
          next = new Set(days.map((d) => d.id));
        } else {
          next = new Set([dayId]);
        }
      } else {
        next = new Set(prev);
        if (next.has(dayId)) next.delete(dayId);
        else next.add(dayId);
      }

      // Apply visibility to layers + markers
      days.forEach((d) => {
        const visible = next.has(d.id);
        if (map) {
          if (map.getLayer(`itin-route-line-${d.id}`)) {
            map.setLayoutProperty(`itin-route-line-${d.id}`, 'visibility', visible ? 'visible' : 'none');
          }
        }
        (markersByDay.current[d.id] ?? []).forEach((m) => {
          m.getElement().style.display = visible ? '' : 'none';
        });
      });

      // Fit camera to the newly visible days
      if (map) fitToVisible(map, next);

      return next;
    });
  }, [days]); // eslint-disable-line

  // ── Fit map to a given set of visible day IDs ─────────────────────────────────
  function fitToVisible(map, visSet) {
    const pts = [];
    if (accommodation?.lat && accommodation?.lng) pts.push([accommodation.lng, accommodation.lat]);
    days.forEach((d) => {
      if (!visSet.has(d.id)) return;
      orderedSpots(allSlots[d.id]).forEach((sp) => pts.push([sp.lng, sp.lat]));
    });
    if (pts.length === 1) { map.flyTo({ center: pts[0], zoom: 14, duration: 600 }); return; }
    if (pts.length < 1) return;
    const lngs = pts.map((p) => p[0]);
    const lats  = pts.map((p) => p[1]);
    map.fitBounds(
      [[Math.min(...lngs) - 0.006, Math.min(...lats) - 0.006],
       [Math.max(...lngs) + 0.006, Math.max(...lats) + 0.006]],
      { padding: 60, maxZoom: 15, duration: 600 },
    );
  }

  // ── Render all markers + route lines ─────────────────────────────────────────
  function renderAll(map, mgl) {
    // Clean up previous markers
    if (accomRef.current) { accomRef.current.remove(); accomRef.current = null; }
    Object.values(markersByDay.current).flat().forEach((m) => { try { m.remove(); } catch {} });
    markersByDay.current = {};

    // Remove previous route layers then sources.
    // Wrapped in try-catch per entry: if any removal throws (e.g. layer already gone,
    // or source still has a dependent layer due to a partial earlier cleanup), the error
    // would otherwise abort renderAll before any new markers are added — blank map.
    const style = map.getStyle();
    (style?.layers ?? []).forEach((l) => {
      if (l.id.startsWith('itin-route-')) { try { map.removeLayer(l.id); } catch {} }
    });
    Object.keys(style?.sources ?? {}).forEach((k) => {
      if (k.startsWith('itin-route-') || k.startsWith('itin-spots-')) { try { map.removeSource(k); } catch {} }
    });

    const allPoints = [];

    // ── Accommodation home-base pin ───────────────────────────────────────────
    if (accommodation?.lat && accommodation?.lng) {
      allPoints.push([accommodation.lng, accommodation.lat]);

      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, {
        width: '44px', height: '54px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        zIndex: '100', cursor: 'default',
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.55))',
      });

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
        .setPopup(new mgl.Popup({ offset: 20, closeButton: false, maxWidth: '200px' })
          .setHTML(`<div style="padding:10px 14px"><div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f59e0b;margin-bottom:3px">HOME BASE</div><div style="font-size:13px;font-weight:600;color:#1a1a1a;line-height:1.3">${accommodation.address}</div></div>`))
        .addTo(map);
    }

    // ── Per-day routes + markers ──────────────────────────────────────────────
    days.forEach((day, idx) => {
      const color  = dayColors[idx % dayColors.length] ?? '#f59e0b';
      const spots  = orderedSpots(allSlots[day.id]);
      if (!spots.length) return;

      markersByDay.current[day.id] = [];

      const coords  = spots.map((sp) => [sp.lng, sp.lat]);
      allPoints.push(...coords);

      // Route polyline.
      // If cleanup partially failed (source still exists), update its data in place via
      // setData() — the old guard `if (!getSource)` would silently keep stale 2-3 coord
      // data and never update it, which is why the route line under-drew stops.
      const srcId      = `itin-route-${day.id}`;
      const layerId    = `itin-route-line-${day.id}`;
      const routeData  = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
      try {
        if (map.getSource(srcId)) {
          // Source survived cleanup: update its coordinates in place
          map.getSource(srcId).setData(routeData);
        } else {
          map.addSource(srcId, { type: 'geojson', data: routeData });
          map.addLayer({
            id:     layerId,
            type:   'line',
            source: srcId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint:  {
              'line-color':     color,
              'line-width':     2.5,
              'line-opacity':   0.75,
              'line-dasharray': [1, 2.5],
            },
          });
        }
      } catch (err) {
        console.warn('[ItineraryMapView] route source/layer error for day', day.dayNumber, err);
      }

      // Numbered spot markers — isolated per spot so one bad coordinate doesn't
      // abort the whole forEach and leave the rest of the day's pins un-drawn.
      spots.forEach((sp, i) => {
        try {
          // Guard: skip spots with missing/zero coordinates — Number(null)=0 which
          // is a valid coord but places the marker in the Atlantic, not the city.
          const lng = Number(sp.lng);
          const lat = Number(sp.lat);
          if (!lng || !lat) {
            console.warn('[ItineraryMapView] skipping spot with no coords:', sp.name, sp.lng, sp.lat);
            return;
          }

          const el = document.createElement('div');
          Object.assign(el.style, {
            width: '26px', height: '26px', borderRadius: '50%',
            background: color, border: '2.5px solid #fff',
            display: 'grid', placeItems: 'center',
            fontSize: '10px', fontWeight: '800', color: '#000',
            lineHeight: '1', textAlign: 'center',
            boxSizing: 'border-box',
            boxShadow: `0 0 8px ${color}60, 0 2px 6px rgba(0,0,0,0.4)`,
            cursor: 'pointer', userSelect: 'none', zIndex: '5',
            fontFamily: 'ui-monospace, monospace',
          });
          el.textContent = i + 1;

          const marker = new mgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat]) // already validated + coerced above
            .setPopup(
              new mgl.Popup({ offset: 16, closeButton: false, maxWidth: '220px' })
                .setHTML(`<div style="padding:10px 14px"><div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${color};margin-bottom:3px">Day ${day.dayNumber} · Stop ${i + 1}</div><div style="font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.2">${sp.name}</div>${sp.category ? `<div style="font-size:11px;color:#666;margin-top:3px">${sp.category}</div>` : ''}</div>`)
            )
            .addTo(map);

          markersByDay.current[day.id].push(marker);
        } catch (err) {
          console.warn('[ItineraryMapView] marker error for spot', sp.name, err);
        }
      });
    });

    // ── Fit to all points ─────────────────────────────────────────────────────
    if (allPoints.length === 1) {
      map.flyTo({ center: allPoints[0], zoom: 14 });
    } else if (allPoints.length > 1) {
      const lngs = allPoints.map((p) => p[0]);
      const lats  = allPoints.map((p) => p[1]);
      map.fitBounds(
        [[Math.min(...lngs) - 0.006, Math.min(...lats) - 0.006],
         [Math.max(...lngs) + 0.006, Math.max(...lats) + 0.006]],
        { padding: 48, maxZoom: 15, duration: 600 },
      );
    }
  }

  // ── Error state ───────────────────────────────────────────────────────────────
  if (err === 'no-token') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--muted)', fontSize: '0.82rem' }}>
        <span style={{ fontSize: '2rem' }}>🗺️</span>
        <p>Mapbox token needed to show the map.</p>
      </div>
    );
  }

  const daysWithSpots = days.filter((d) => orderedSpots(allSlots[d.id]).length > 0);
  const totalPlanned  = daysWithSpots.reduce((n, d) => n + orderedSpots(allSlots[d.id]).length, 0);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading spinner */}
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--map-paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Empty state */}
      {ready && totalPlanned === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(14,14,22,0.82)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '18px 24px', textAlign: 'center', maxWidth: 260 }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', lineHeight: 1.6 }}>
              Add spots to your days to see the route map for {city || 'your trip'}.
            </p>
          </div>
        </div>
      )}

      {/* Interactive day legend — bottom-left */}
      {ready && daysWithSpots.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 16, left: 10, zIndex: 10,
          background: 'rgba(14,14,22,0.9)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          padding: '8px 6px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {/* "All days" reset — only shown when not all days are visible */}
          {visibleDays.size < daysWithSpots.length && (
            <button
              type="button"
              onClick={() => {
                const allIds = new Set(days.map((d) => d.id));
                setVisibleDays(allIds);
                days.forEach((d) => {
                  if (mapRef.current) {
                    try { mapRef.current.setLayoutProperty(`itin-route-line-${d.id}`, 'visibility', 'visible'); } catch {}
                  }
                  (markersByDay.current[d.id] ?? []).forEach((m) => { m.getElement().style.display = ''; });
                });
                if (mapRef.current) fitToVisible(mapRef.current, allIds);
              }}
              style={{ padding: '4px 10px', marginBottom: 4, borderRadius: 7, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', fontSize: '0.63rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}
            >
              Show all
            </button>
          )}

          {daysWithSpots.map((day, idx) => {
            const color   = dayColors[idx % dayColors.length] ?? '#f59e0b';
            const count   = orderedSpots(allSlots[day.id]).length;
            const visible = visibleDays.has(day.id);
            return (
              <button
                key={day.id}
                type="button"
                title="Click to solo this day · click again to show all"
                onClick={() => toggleDay(day.id, true)}
                style={{
                  padding: '6px 10px', borderRadius: 8,
                  border: `1px solid ${visible ? color + '50' : 'rgba(255,255,255,0.08)'}`,
                  background: visible ? `${color}18` : 'transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: visible ? 1 : 0.38,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: visible ? color : 'rgba(255,255,255,0.3)', flexShrink: 0, transition: 'background 0.15s' }} />
                <span style={{ fontSize: '0.68rem', color: visible ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', fontWeight: visible ? 600 : 400 }}>
                  Day {day.dayNumber} · {count} stop{count !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
