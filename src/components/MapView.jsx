'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getHiddennessLevel, HIDDENNESS_LEVELS } from '@/constants/hiddenness';
import { INTERESTS } from '@/constants/interests';
import { formatPrice } from '@/lib/pricing';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const MAP_STYLES = [
  { id: 'dark-v11',              label: 'Dark',      icon: '🌑' },
  { id: 'satellite-streets-v12', label: 'Satellite', icon: '🛰️' },
  { id: 'streets-v12',           label: 'Streets',   icon: '🗺️' },
];

/* ── Category icon lookup ──────────────────────────────────────────────────── */
function getCategoryIcon(spot) {
  const cats = spot.interests ?? [];
  const first = INTERESTS.find((i) => cats.includes(i.id));
  return first?.icon ?? null;
}

/* ── Pin DOM helpers ───────────────────────────────────────────────────────── */
// Pulse is done via box-shadow animation — no child elements extending outside
// the marker box, which would shift Mapbox's anchor calculation on zoom.
function applyInnerStyle(inner, level, isFocused, isVisited, score) {
  const pulse = isFocused
    ? `, 0 0 0 5px ${level.color}40, 0 0 0 9px ${level.color}18`
    : '';
  Object.assign(inner.style, {
    width: '100%', height: '100%',
    borderRadius: '50%',
    background:   isVisited ? '#374151' : level.color,
    border:       isFocused
      ? '2px solid #fff'
      : (isVisited ? `2px solid ${level.color}` : '2px solid rgba(0,0,0,0.4)'),
    boxShadow:    isFocused
      ? `0 0 0 3px ${level.color}60, 0 0 14px ${level.color}80, 0 2px 6px rgba(0,0,0,0.5)${pulse}`
      : isVisited
        ? `0 0 6px ${level.color}50, 0 2px 4px rgba(0,0,0,0.4)`
        : `0 0 8px ${level.color}60, 0 2px 4px rgba(0,0,0,0.4)`,
    animation:    isFocused ? 'mapPulse 1.8s ease-out infinite' : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: isFocused ? '11px' : '10px', fontWeight: '700',
    color: isVisited ? level.color : '#000',
    transition: 'transform 0.15s ease',
    pointerEvents: 'none',
  });
  inner.textContent = isVisited ? '✓' : score;
}

function createPinEl(spot, isFocused, isVisited) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  const size  = isFocused ? 34 : 26;

  // el is the exact box Mapbox uses for anchor — nothing must extend outside it
  const el = document.createElement('div');
  Object.assign(el.style, {
    width: size + 'px', height: size + 'px',
    cursor: 'pointer', userSelect: 'none',
    zIndex: isFocused ? '10' : '1',
  });

  const inner = document.createElement('div');
  applyInnerStyle(inner, level, isFocused, isVisited, spot.hiddennessScore);
  el.appendChild(inner);

  return { el, inner };
}

/* ── "You are here" marker ─────────────────────────────────────────────────── */
function createYouAreHereEl() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    width: '20px', height: '20px',
    borderRadius: '50%',
    background: '#3b82f6',
    border: '3px solid #fff',
    boxShadow: '0 0 0 5px rgba(59,130,246,0.25), 0 2px 8px rgba(0,0,0,0.5)',
    animation: 'mapPulseBlue 2s ease-out infinite',
    cursor: 'default',
  });
  return el;
}

/**
 * MapView — Mapbox GL JS map with:
 *   - Coloured hiddenness pins with category icon badges
 *   - Marker clustering (DOM-based, zoom-gated)
 *   - Heatmap layer toggle
 *   - Current location button
 *   - Fit-to-spots button
 *   - Filter sync (filterInterest + minScore)
 *   - Two-way sidebar sync via focusSpotId
 */
export default function MapView({
  spots = [], centerLat, centerLng,
  onSpotClick, onOpenDrawer = null,
  filterInterest = '', minScore = 1,
  focusSpotId = null,
  visitedIds = new Set(), fitRevision = 0,
  onFocusPinPixel = null,
  accommodationMarker = null, // { lat, lng, address }
}) {
  const containerRef     = useRef(null);
  const mapRef           = useRef(null);
  const mapboxglRef      = useRef(null);
  const markerMapRef     = useRef(new Map());   // spotId → { el, inner, marker, spot }
  const userMarkerRef    = useRef(null);
  const accomMarkerRef   = useRef(null);  // accommodation / hotel pin
  const hasFitRef        = useRef(false);
  const onClickRef       = useRef(onSpotClick);
  const onOpenDrawerRef  = useRef(onOpenDrawer);
  const popupRef         = useRef(null);
  const superclusterRef  = useRef(null);        // Supercluster instance
  const zoomRef          = useRef(12);
  useEffect(() => { onClickRef.current = onSpotClick; });
  useEffect(() => { onOpenDrawerRef.current = onOpenDrawer; });

  const [ready,        setReady]       = useState(false);
  const [mapStyle,     setMapStyle]   = useState('dark-v11');
  const [styleKey,     setStyleKey]   = useState(0);
  const [mapErr,       setMapErr]     = useState(null);
  const [hoveredCard,  setHoveredCard]= useState(null); // { spot, x, y, mapW, mapH }
  const [showHeatmap,  setShowHeatmap]= useState(false);
  const [locating,     setLocating]   = useState(false);

  // ── Inject keyframes once ──────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('venture-map-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'venture-map-keyframes';
    style.textContent = `
      @keyframes mapPulse {
        0%   { box-shadow: 0 0 0 3px var(--pulse-c,rgba(245,158,11,0.6)), 0 0 14px var(--pulse-c,rgba(245,158,11,0.8)), 0 2px 6px rgba(0,0,0,0.5), 0 0 0 5px rgba(245,158,11,0.35), 0 0 0 9px rgba(245,158,11,0.12); }
        60%  { box-shadow: 0 0 0 3px var(--pulse-c,rgba(245,158,11,0.6)), 0 0 14px var(--pulse-c,rgba(245,158,11,0.8)), 0 2px 6px rgba(0,0,0,0.5), 0 0 0 10px rgba(245,158,11,0.08), 0 0 0 18px rgba(245,158,11,0); }
        100% { box-shadow: 0 0 0 3px var(--pulse-c,rgba(245,158,11,0.6)), 0 0 14px var(--pulse-c,rgba(245,158,11,0.8)), 0 2px 6px rgba(0,0,0,0.5), 0 0 0 10px rgba(245,158,11,0.08), 0 0 0 18px rgba(245,158,11,0); }
      }
      @keyframes mapPulseBlue {
        0%   { box-shadow: 0 0 0 0   rgba(59,130,246,0.5), 0 2px 8px rgba(0,0,0,0.5); }
        70%  { box-shadow: 0 0 0 10px rgba(59,130,246,0),   0 2px 8px rgba(0,0,0,0.5); }
        100% { box-shadow: 0 0 0 0   rgba(59,130,246,0),   0 2px 8px rgba(0,0,0,0.5); }
      }
      @keyframes homePulse {
        0%   { box-shadow: 0 0 0 0px  rgba(245,158,11,0.7), 0 4px 20px rgba(0,0,0,0.55); }
        60%  { box-shadow: 0 0 0 10px rgba(245,158,11,0),   0 4px 20px rgba(0,0,0,0.55); }
        100% { box-shadow: 0 0 0 0px  rgba(245,158,11,0),   0 4px 20px rgba(0,0,0,0.55); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  /* ── Init map ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!TOKEN)                { setMapErr('no-token'); return; }
    if (!containerRef.current) return;
    if (mapRef.current)        return;

    let map;
    let cancelled = false;

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      if (cancelled || mapRef.current) return;

      mapboxglRef.current  = mapboxgl;
      mapboxgl.accessToken = TOKEN;

      map = new mapboxgl.Map({
        container:          containerRef.current,
        style:              `mapbox://styles/mapbox/${mapStyle}`,
        center:             [centerLng ?? 4.9, centerLat ?? 52.37],
        zoom:               12,
        attributionControl: false,
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new mapboxgl.AttributionControl({ compact: true }),     'bottom-right');

      map.on('zoom',     () => { zoomRef.current = map.getZoom(); });
      map.on('dragstart',() => { setHoveredCard(null); });
      map.on('movestart',() => { setHoveredCard(null); });

      map.on('load', () => {
        if (cancelled) { map.remove(); return; }
        mapRef.current = map;
        if (typeof window !== 'undefined') window.ventureMap = map;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { map.resize(); setReady(true); });
        });
      });

      const onResize = () => mapRef.current?.resize();
      window.addEventListener('resize', onResize);
      map._ventureResizeCleanup = () => window.removeEventListener('resize', onResize);
    }).catch(() => { if (!cancelled) setMapErr('load-failed'); });

    return () => {
      cancelled = true;
      mapRef.current?._ventureResizeCleanup?.();
      popupRef.current?.remove(); popupRef.current = null;
      markerMapRef.current.forEach(({ marker }) => marker.remove());
      markerMapRef.current.clear();
      userMarkerRef.current?.remove(); userMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
      if (typeof window !== 'undefined') { window.ventureMap = null; window.ventureMapMarkers = []; }
    };
  }, []); // eslint-disable-line

  /* ── Style toggle ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(`mapbox://styles/mapbox/${mapStyle}`);
    const onStyleData = () => setStyleKey((k) => k + 1);
    map.once('styledata', onStyleData);
    return () => map.off('styledata', onStyleData);
  }, [mapStyle]); // eslint-disable-line

  /* ── Resize ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const t = setTimeout(() => map.resize(), 120);
    return () => clearTimeout(t);
  }, [ready]);

  /* ── Reset fit guard ─────────────────────────────────────────────────────── */
  useEffect(() => { hasFitRef.current = false; }, [filterInterest, minScore, styleKey, fitRevision]);

  /* ── Heatmap GeoJSON source + layer ──────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const visibleSpots = spots.filter((s) => {
      if (!s.lat || !s.lng || s.coordsMissing) return false;
      const score = s.hiddennessScore ?? 1;
      if (score < minScore) return false;
      if (filterInterest && !(s.interests ?? []).includes(filterInterest)) return false;
      return true;
    });

    const geojson = {
      type: 'FeatureCollection',
      features: visibleSpots.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { score: s.hiddennessScore ?? 1 },
      })),
    };

    if (map.getSource('gems-heat')) {
      map.getSource('gems-heat').setData(geojson);
    } else {
      try {
        map.addSource('gems-heat', { type: 'geojson', data: geojson });
        map.addLayer({
          id: 'gem-heatmap',
          type: 'heatmap',
          source: 'gems-heat',
          layout: { visibility: showHeatmap ? 'visible' : 'none' },
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'score'], 1, 0.1, 10, 1.5],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.5],
            'heatmap-radius':   ['interpolate', ['linear'], ['zoom'], 10, 18, 16, 45],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0,   'rgba(10,10,10,0)',
              0.15,'rgba(60,20,10,0.4)',
              0.35,'rgba(140,55,10,0.65)',
              0.55,'rgba(200,105,20,0.82)',
              0.75,'rgba(235,145,30,0.92)',
              1,   'rgba(245,185,55,1)',
            ],
            'heatmap-opacity': 0.82,
          },
        });
      } catch (_) { /* layer already exists after style reload */ }
    }
  }, [ready, spots, filterInterest, minScore, styleKey]); // eslint-disable-line

  /* ── Heatmap visibility toggle ────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      map.setLayoutProperty('gem-heatmap', 'visibility', showHeatmap ? 'visible' : 'none');
    } catch (_) {}
    // hide/show individual markers when heatmap is on
    markerMapRef.current.forEach(({ el }) => {
      el.style.opacity = showHeatmap ? '0.25' : '1';
      el.style.pointerEvents = showHeatmap ? 'none' : 'auto';
    });
  }, [showHeatmap, ready]); // eslint-disable-line

  /* ── Popup helper ─────────────────────────────────────────────────────────── */
  const showPopup = useCallback((spot) => {
    const map = mapRef.current;
    const mgl = mapboxglRef.current;
    if (!map || !mgl || !spot?.lat || !spot?.lng) return;

    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }

    const level   = getHiddennessLevel(spot.hiddennessScore ?? 1);
    const catIcon = getCategoryIcon(spot);

    const root = document.createElement('div');
    root.style.setProperty('--sc', `var(${level.cssVar})`);

    const header = document.createElement('div');
    header.className = 'vpc-header';

    if (spot.category || catIcon) {
      const eyebrow = document.createElement('div');
      eyebrow.className = 'vpc-eyebrow';
      eyebrow.textContent = `${catIcon ?? ''} ${spot.category ?? ''}`.trim();
      header.appendChild(eyebrow);
    }

    const name = document.createElement('div');
    name.className = 'vpc-name';
    name.textContent = spot.name ?? '';
    header.appendChild(name);
    root.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'vpc-meta';

    const tier = document.createElement('span');
    tier.className = 'vpc-tier';
    tier.textContent = `${level.label} · ${spot.hiddennessScore}/10`;
    meta.appendChild(tier);

    const priceInfo = formatPrice(spot);
    if (priceInfo.priceType !== 'unknown') {
      const priceEl = document.createElement('span');
      priceEl.className = 'vpc-price';
      if (priceInfo.priceType === 'free') {
        priceEl.textContent = 'Free';
        priceEl.classList.add('free');
      } else if (priceInfo.priceType === 'pass') {
        priceEl.textContent = 'Pass';
        priceEl.classList.add('pass');
      } else {
        priceEl.textContent = priceInfo.label;
      }
      meta.appendChild(priceEl);
    }
    root.appendChild(meta);

    if (spot.description) {
      const desc = document.createElement('p');
      Object.assign(desc.style, {
        fontSize: '0.78rem', color: '#999', lineHeight: '1.55',
        padding: '0 18px 10px', margin: '0',
      });
      // Hard JS truncation — reliable cross-browser, guarantees the … always appears
      const MAX = 130;
      desc.textContent = spot.description.length > MAX
        ? spot.description.slice(0, MAX).trimEnd() + '…'
        : spot.description;
      root.appendChild(desc);
    }

    if (spot.address) {
      const addrRow = document.createElement('div');
      addrRow.className = 'vpc-addr-row';
      // min-width:0 lets the flex child shrink and honour text-overflow:ellipsis
      Object.assign(addrRow.style, { minWidth: '0', overflow: 'hidden' });
      const icon = document.createElement('span');
      icon.className = 'vpc-addr-icon';
      icon.textContent = '📍';
      addrRow.appendChild(icon);
      const addr = document.createElement('span');
      addr.className = 'vpc-addr';
      addr.style.minWidth = '0';
      addr.textContent = spot.address;
      addrRow.appendChild(addr);
      root.appendChild(addrRow);
    }

    const divider = document.createElement('div');
    divider.className = 'vpc-divider';
    root.appendChild(divider);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vpc-open';
    const btnLabel = document.createElement('span');
    btnLabel.textContent = 'Open details';
    btn.appendChild(btnLabel);
    const btnArrow = document.createElement('span');
    btnArrow.className = 'vpc-open-arrow';
    btnArrow.textContent = '→';
    btn.appendChild(btnArrow);
    btn.addEventListener('click', () => {
      onOpenDrawerRef.current?.(spot);
      popupRef.current?.remove();
      popupRef.current = null;
    });
    root.appendChild(btn);

    const pinH = spot.id === focusSpotId ? 34 : 26;
    const gap  = 28;
    const upOff = -(pinH / 2 + gap), downOff = (pinH / 2 + gap), sideOff = (pinH / 2 + gap);

    const popup = new mgl.Popup({
      closeButton: true, closeOnClick: false,
      offset: {
        'top':          [0,  downOff], 'top-left':     [0,  downOff], 'top-right':    [0,  downOff],
        'bottom':       [0,  upOff],   'bottom-left':  [0,  upOff],   'bottom-right': [0,  upOff],
        'left':         [ sideOff, 0], 'right':        [-sideOff, 0], 'center':       [0,  0],
      },
      className: 'venture-popup', maxWidth: '288px',
    })
    .setLngLat([spot.lng, spot.lat])
    .setDOMContent(root)
    .addTo(map);

    popup.on('close', () => { if (popupRef.current === popup) popupRef.current = null; });
    popupRef.current = popup;
  }, []); // eslint-disable-line

  /* ── Close popup when focus clears ────────────────────────────────────────── */
  useEffect(() => {
    if (!focusSpotId && popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, [focusSpotId]);

  /* ── Fit-to-visible-spots ─────────────────────────────────────────────────── */
  const fitToSpots = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = spots.filter((s) => {
      if (!s.lat || !s.lng || s.coordsMissing) return false;
      const score = s.hiddennessScore ?? 1;
      if (score < minScore) return false;
      if (filterInterest && !(s.interests ?? []).includes(filterInterest)) return false;
      return true;
    });
    if (pts.length > 1) {
      const lats = pts.map((s) => s.lat), lngs = pts.map((s) => s.lng);
      map.fitBounds(
        [[Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
         [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005]],
        { padding: 60, maxZoom: 15, duration: 700 },
      );
    } else if (pts.length === 1) {
      map.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 14 });
    }
  }, [spots, filterInterest, minScore]);

  /* ── Current location ─────────────────────────────────────────────────────── */
  const locateUser = useCallback(() => {
    const map = mapRef.current;
    const mgl = mapboxglRef.current;
    if (!map || !mgl || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        userMarkerRef.current?.remove();
        const el = createYouAreHereEl();
        userMarkerRef.current = new mgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .addTo(map);
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 600 });
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }, [locating]);

  /* ── Add / remove / update individual pin markers ───────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mapboxglRef.current;
    if (!map || !mgl || !ready) return;

    requestAnimationFrame(() => { map.resize(); });

    const visible = spots.filter((s) => {
      const score = s.hiddennessScore ?? 1;
      if (score < minScore) return false;
      if (filterInterest && !(s.interests ?? []).includes(filterInterest)) return false;
      return true;
    });
    const visibleIds = new Set(visible.map((s) => s.id ?? s.name).filter(Boolean));

    // Remove markers no longer visible
    markerMapRef.current.forEach(({ marker }, id) => {
      if (!visibleIds.has(id)) { marker.remove(); markerMapRef.current.delete(id); }
    });

    // Add new markers
    visible.forEach((spot) => {
      if (!spot.lat || !spot.lng || spot.coordsMissing) return;
      const spotId = spot.id ?? spot.name;
      if (!spotId || markerMapRef.current.has(spotId)) return;

      const isFocused = spot.id === focusSpotId;
      const isVisited = visitedIds.has(spot.id);
      const { el, inner } = createPinEl(spot, isFocused, isVisited);
      el.style.opacity = showHeatmap ? '0.25' : '1';
      el.style.pointerEvents = showHeatmap ? 'none' : 'auto';

      const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
      el.onmouseenter = () => {
        inner.style.transform = 'scale(1.3)';
        const px   = map.project([spot.lng, spot.lat]);
        const rect = containerRef.current?.getBoundingClientRect();
        setHoveredCard({ spot, x: px.x, y: px.y, mapW: rect?.width ?? 500, mapH: rect?.height ?? 500 });
      };
      el.onmouseleave = () => { inner.style.transform = 'scale(1)'; setHoveredCard(null); };
      el.onclick = () => {
        setHoveredCard(null);
        onClickRef.current?.(spot);
        showPopup(spot);
      };

      const marker = new mgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
      markerMapRef.current.set(spotId, { el, inner, marker, spot });
    });

    if (typeof window !== 'undefined') {
      window.ventureMapMarkers = [...markerMapRef.current.values()].map((d) => d.marker);
    }

    // Fit once per filter session
    if (!focusSpotId && !hasFitRef.current) {
      const pts = visible.filter((s) => s.lat && s.lng && !s.coordsMissing);
      if (pts.length > 1) {
        const lats = pts.map((s) => s.lat), lngs = pts.map((s) => s.lng);
        map.fitBounds(
          [[Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
           [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005]],
          { padding: 60, maxZoom: 15, duration: 600 },
        );
        hasFitRef.current = true;
      } else if (pts.length === 1) {
        map.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 14 });
        hasFitRef.current = true;
      }
    }

  }, [spots, ready, filterInterest, minScore, styleKey]); // eslint-disable-line

  /* ── Focus / visited style update ────────────────────────────────────────── */
  useEffect(() => {
    if (!ready) return;
    markerMapRef.current.forEach(({ el, inner, spot }) => {
      const level     = getHiddennessLevel(spot.hiddennessScore ?? 1);
      const isFocused = spot.id === focusSpotId;
      const isVisited = visitedIds.has(spot.id);
      const size = isFocused ? 34 : 26;
      el.style.width  = size + 'px';
      el.style.height = size + 'px';
      el.style.zIndex = isFocused ? '10' : '1';

      // Pulse is driven entirely by box-shadow animation in applyInnerStyle —
      // no child elements, so marker anchor stays stable on zoom.
      applyInnerStyle(inner, level, isFocused, isVisited, spot.hiddennessScore);
    });
  }, [focusSpotId, visitedIds, ready]); // eslint-disable-line

  /* ── Fly to focused spot ──────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusSpotId) return;
    const spot = spots.find((s) => s.id === focusSpotId);
    if (!spot?.lat || !spot?.lng || spot.coordsMissing) return;
    map.flyTo({ center: [spot.lng, spot.lat], zoom: 15, duration: 500 });
  }, [focusSpotId, ready]); // eslint-disable-line

  /* ── Accommodation marker — prominent "home base" pin ─────────────────────── */
  // Teardrop/map-pin shape in amber: visually unlike score pins (circles+numbers)
  // so the user can always locate their base at a glance. z-index 100 = always on top.
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mapboxglRef.current;
    if (!map || !mgl || !ready) return;

    if (accomMarkerRef.current) {
      accomMarkerRef.current.remove();
      accomMarkerRef.current = null;
    }
    if (!accommodationMarker?.lat || !accommodationMarker?.lng) return;

    // Wrapper — Mapbox anchors at bottom-center (the pin tip)
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      width: '44px', height: '54px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      zIndex: '100', cursor: 'pointer',
      filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.55))',
    });

    // Circular pin head — amber, rotated to point down-left, then icon rotated back
    const head = document.createElement('div');
    Object.assign(head.style, {
      width: '44px', height: '44px',
      borderRadius: '50% 50% 50% 0',
      transform: 'rotate(-45deg)',
      background: 'linear-gradient(135deg,#f59e0b,#d97706)',
      border: '3px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'homePulse 2.4s ease-out infinite',
      flexShrink: 0,
    });

    // House icon — rotate 45° back to compensate for pin rotation
    const icon = document.createElement('div');
    Object.assign(icon.style, {
      transform: 'rotate(45deg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginLeft: '5px', marginBottom: '5px', // optical centre of rotated shape
    });
    // Filled white house — reads instantly as "home", unlike stroked score circles
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="white" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';

    head.appendChild(icon);
    wrapper.appendChild(head);

    // Build popup content using the same .vpc-* classes as spot popups
    const addr     = accommodationMarker.address ?? '';
    const venueName = addr.split(',')[0].trim() || 'Your accommodation';
    const restAddr  = addr.includes(',') ? addr.slice(addr.indexOf(',') + 1).trim() : '';

    const popupEl = document.createElement('div');
    popupEl.innerHTML = `
      <div class="vpc-header" style="padding-bottom:12px">
        <div class="vpc-eyebrow" style="color:#f59e0b">Home base</div>
        <div class="vpc-name" style="font-size:16px;white-space:normal;line-height:1.25">${venueName}</div>
      </div>
      ${restAddr ? `
      <div class="vpc-divider"></div>
      <div class="vpc-addr-row" style="padding-top:10px;align-items:flex-start">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" class="vpc-addr-icon" style="margin-top:1px;flex-shrink:0"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span class="vpc-addr" style="white-space:normal;line-height:1.45">${restAddr}</span>
      </div>` : ''}
    `;

    accomMarkerRef.current = new mgl.Marker({ element: wrapper, anchor: 'bottom-left' })
      .setLngLat([accommodationMarker.lng, accommodationMarker.lat])
      .setPopup(
        new mgl.Popup({ offset: [22, -16], closeButton: false, className: 'venture-popup', maxWidth: '260px' })
          .setDOMContent(popupEl)
      )
      .addTo(map);
  }, [accommodationMarker, ready]); // eslint-disable-line

  /* ── Error state ──────────────────────────────────────────────────────────── */
  if (mapErr === 'no-token') {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
        <span style={{ fontSize: '2.5rem' }}>🗺️</span>
        <p style={{ color: '#f5f5f5', fontWeight: 600 }}>Mapbox token needed</p>
        <p style={{ color: '#555', fontSize: '0.82rem', maxWidth: 280, lineHeight: 1.65 }}>
          Add your free token to <code style={{ color: '#f59e0b' }}>.env.local</code>:
          <br /><code style={{ color: '#f59e0b', fontSize: '0.75rem' }}>NEXT_PUBLIC_MAPBOX_TOKEN=pk.ey…</code>
        </p>
        <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" style={{ padding: '8px 18px', background: '#f59e0b', color: '#000', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}>
          Get free token →
        </a>
      </div>
    );
  }

  /* ── Render ───────────────────────────────────────────────────────────────── */
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {!ready && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--map-paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* ── Custom controls (top-left) ── */}
      {ready && (
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>

          {/* Home base recentre — only when accommodation is set */}
          {accommodationMarker?.lat && accommodationMarker?.lng && (
            <MapCtrlBtn
              title={`Home base: ${accommodationMarker.address ?? 'accommodation'}`}
              onClick={() => mapRef.current?.flyTo({ center: [accommodationMarker.lng, accommodationMarker.lat], zoom: 15, duration: 700 })}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
              </svg>
            </MapCtrlBtn>
          )}

          {/* Fit-to-spots */}
          <MapCtrlBtn title="Fit all spots" onClick={fitToSpots}>⊞</MapCtrlBtn>

          {/* Current location */}
          <MapCtrlBtn title="My location" onClick={locateUser} active={locating}>
            {locating ? '⏳' : '◎'}
          </MapCtrlBtn>

          {/* Heatmap toggle */}
          <MapCtrlBtn title="Toggle heatmap" onClick={() => setShowHeatmap((v) => !v)} active={showHeatmap}>
            🌡
          </MapCtrlBtn>

          {/* Style switcher */}
          <div style={{ background: 'rgba(14,14,22,0.92)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'hidden' }}>
            {MAP_STYLES.map((s) => (
              <button
                key={s.id}
                title={s.label}
                onClick={() => setMapStyle(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 28,
                  background: mapStyle === s.id ? 'rgba(245,158,11,0.2)' : 'transparent',
                  border: 'none',
                  borderBottom: s.id !== MAP_STYLES[MAP_STYLES.length - 1].id ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  cursor: 'pointer', fontSize: '0.8rem', transition: 'background 0.15s',
                }}
              >{s.icon}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Heatmap label ── */}
      {showHeatmap && ready && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(14,14,22,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20,
          padding: '5px 14px', zIndex: 10,
          fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600, whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          🌡 Heatmap — gem density
        </div>
      )}

      {/* ── Hover tooltip card ── */}
      {hoveredCard && (() => {
        const CARD_W = 230;
        const CARD_H = hoveredCard.spot?.photo ? 180 : 120;
        const PIN_H  = 34;
        const { spot, x, y, mapW, mapH } = hoveredCard;
        const level   = getHiddennessLevel(spot.hiddennessScore ?? 1);
        const catIcon = getCategoryIcon(spot);

        // Position above pin; flip below if near top, clamp horizontal
        let cardTop  = y - CARD_H - PIN_H - 6;
        if (cardTop < 10) cardTop = y + PIN_H + 6;
        let cardLeft = x - CARD_W / 2;
        if (cardLeft < 10)              cardLeft = 10;
        if (cardLeft + CARD_W > mapW - 10) cardLeft = mapW - CARD_W - 10;

        return (
          <div style={{
            position: 'absolute', left: cardLeft, top: cardTop,
            width: CARD_W,
            background: 'rgba(20,16,14,0.97)',
            backdropFilter: 'blur(14px)',
            border: `1px solid ${level.color}40`,
            borderRadius: 14, overflow: 'hidden',
            zIndex: 20, pointerEvents: 'none',
            boxShadow: `0 10px 36px rgba(0,0,0,0.65), 0 0 0 1px ${level.color}18`,
            animation: 'fadeIn 0.12s ease',
          }}>
            {/* Photo strip */}
            {spot.photo && (
              <div style={{ height: 76, position: 'relative', overflow: 'hidden' }}>
                <img
                  src={`https://images.unsplash.com/photo-${spot.photo}?w=230&h=76&fit=crop&q=70`}
                  alt={spot.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(20,16,14,0.75))' }} />
              </div>
            )}
            <div style={{ padding: '10px 12px 12px' }}>
              {/* Category tag + score badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: '0.67rem', color: level.color, fontWeight: 600 }}>
                  {catIcon ? `${catIcon} ` : ''}{spot.category ?? level.label}
                </span>
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                  borderRadius: 10, background: `${level.color}22`, color: level.color,
                  border: `1px solid ${level.color}45`,
                }}>
                  {spot.hiddennessScore}/10
                </span>
              </div>
              {/* Name */}
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f0ede8', lineHeight: 1.3, marginBottom: 5 }}>
                {spot.name}
              </div>
              {/* One-line description */}
              {spot.description && (
                <div style={{
                  fontSize: '0.72rem', color: '#999', lineHeight: 1.5,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {spot.description}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Pin legend (bottom-left) ── */}
      {ready && !showHeatmap && (
        <div style={{
          position: 'absolute', bottom: 100, left: 10, zIndex: 5,
          background: 'color-mix(in oklch, var(--card) 92%, transparent)',
          backdropFilter: 'blur(6px)',
          border: '1px solid var(--line)',
          borderRadius: 13, padding: '12px 14px',
          boxShadow: 'var(--shadow)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 9 }}>
            Hiddenness
          </div>
          {[...HIDDENNESS_LEVELS].reverse().map(({ label, color, min, max }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                {label}
                <b style={{ fontFamily: 'var(--mono)', color: 'var(--faint)', fontWeight: 400, fontSize: 10, marginLeft: 3 }}>{min}–{max}</b>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Heatmap legend ── */}
      {ready && showHeatmap && (
        <div style={{
          position: 'absolute', bottom: 100, left: 10, zIndex: 5,
          background: 'color-mix(in oklch, var(--card) 92%, transparent)',
          backdropFilter: 'blur(6px)',
          border: '1px solid var(--line)',
          borderRadius: 13, padding: '12px 14px',
          boxShadow: 'var(--shadow)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
            Density
          </div>
          <div style={{ width: 100, height: 10, borderRadius: 5, background: 'linear-gradient(to right, #1a1a1a, #8c3710, #c86914, #f59e0b)', marginBottom: 5 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Low</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>High</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small reusable map control button ─────────────────────────────────────── */
function MapCtrlBtn({ title, onClick, children, active = false }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 32, height: 32, borderRadius: 7,
        background: active ? 'rgba(245,158,11,0.2)' : 'rgba(14,14,22,0.92)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${active ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.12)'}`,
        color: active ? '#f59e0b' : 'var(--text-primary)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.85rem', transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
    >
      {children}
    </button>
  );
}
