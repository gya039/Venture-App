'use client';

// AccommodationField — compact "home base" input with live Mapbox autocomplete.
// Renders in the Research tab so it's next to the map where the marker appears.
// Typing a hotel name, street address, or neighbourhood shows real suggestions
// with exact coordinates — picked location is pinned on the Research map instantly.

import { useState, useRef, useEffect } from 'react';
import { updateTripAccommodation } from '@/lib/db';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

async function fetchSuggestions(query) {
  if (!query || query.length < 2 || !TOKEN) return [];
  try {
    const res  = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?types=address,poi&limit=6&access_token=${TOKEN}`
    );
    const data = await res.json();
    return (data.features ?? []).map((f) => ({
      name:     f.text,
      fullName: f.place_name,
      lat:      f.center[1],
      lng:      f.center[0],
    }));
  } catch { return []; }
}

function HouseIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} style={{ flexShrink: 0 }}>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

export default function AccommodationField({ tripId, accommodation, onSaved }) {
  const [value,    setValue]    = useState(accommodation?.address ?? '');
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [suggs,    setSuggs]    = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const debRef = useRef(null);
  const inputRef = useRef(null);

  // Sync when trip data updates (e.g. after save or page reload)
  useEffect(() => {
    if (!editing) setValue(accommodation?.address ?? '');
  }, [accommodation?.address, editing]);

  function onType(val) {
    setValue(val);
    clearTimeout(debRef.current);
    if (val.length < 2) { setSuggs([]); setShowSugg(false); return; }
    setLoading(true);
    debRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(val);
      setSuggs(results);
      setShowSugg(results.length > 0);
      setLoading(false);
    }, 260);
  }

  async function pickSuggestion(s) {
    setValue(s.fullName);
    setSuggs([]); setShowSugg(false);
    setSaving(true);
    try {
      await updateTripAccommodation(tripId, { address: s.fullName, lat: s.lat, lng: s.lng });
      onSaved?.({ address: s.fullName, lat: s.lat, lng: s.lng });
      setEditing(false);
    } catch (err) { console.error('[AccommodationField]', err); }
    finally { setSaving(false); }
  }

  async function saveRaw() {
    if (!value.trim()) {
      await updateTripAccommodation(tripId, null).catch(() => {});
      onSaved?.(null);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const results = await fetchSuggestions(value);
      const best = results[0];
      const toSave = best
        ? { address: best.fullName, lat: best.lat, lng: best.lng }
        : { address: value.trim(), lat: null, lng: null };
      await updateTripAccommodation(tripId, toSave);
      if (best) setValue(best.fullName);
      onSaved?.(toSave);
      setEditing(false);
    } catch (err) { console.error('[AccommodationField]', err); }
    finally { setSaving(false); }
  }

  /* ── Saved / display row ── */
  if (!editing && accommodation?.address) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', flexShrink: 0,
      }}>
        <HouseIcon color="var(--accent)" />
        <span style={{
          flex: 1, fontSize: '0.78rem', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {accommodation.address}
        </span>
        <button
          type="button"
          onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
        >
          Change
        </button>
      </div>
    );
  }

  /* ── Empty prompt (no address set yet) ── */
  if (!editing && !accommodation?.address) {
    return (
      <button
        type="button"
        onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 16px', width: '100%',
          background: 'var(--bg)', border: 'none',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-muted)', fontSize: '0.78rem',
          cursor: 'pointer', textAlign: 'left', flexShrink: 0,
        }}
      >
        <HouseIcon color="var(--text-muted)" />
        <span>Add home base address — pin it on the map</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>+ Add</span>
      </button>
    );
  }

  /* ── Editing / input state ── */
  return (
    <div style={{
      background: 'var(--bg)', borderBottom: '1px solid var(--border)',
      flexShrink: 0, position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
        <HouseIcon color="var(--accent)" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Hotel name, address, or neighbourhood…"
          value={value}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  { setShowSugg(false); saveRaw(); }
            if (e.key === 'Escape') { setShowSugg(false); setEditing(false); setValue(accommodation?.address ?? ''); }
          }}
          onBlur={() => setTimeout(() => setShowSugg(false), 180)}
          style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', minWidth: 0 }}
          autoFocus
        />
        {loading && (
          <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
        )}
        <button type="button" disabled={saving} onClick={saveRaw}
          style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#000', fontSize: '0.75rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? '…' : 'Set'}
        </button>
        <button type="button" onClick={() => { setEditing(false); setValue(accommodation?.address ?? ''); setShowSugg(false); }}
          style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>
          ×
        </button>
      </div>

      {/* Suggestions dropdown */}
      {showSugg && suggs.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {suggs.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => pickSuggestion(s)}
              style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', borderBottom: i < suggs.length - 1 ? '1px solid var(--border)' : 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--card)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <HouseIcon color="var(--text-muted)" />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{s.fullName}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
