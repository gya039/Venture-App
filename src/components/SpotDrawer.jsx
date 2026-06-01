'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { saveSpotNote, getSpotNote } from '@/lib/db';
import { getTodayHours, getFullSchedule, getClosureLabel } from '@/utils/spotUtils';
import ScoreMedallion from '@/components/ScoreMedallion';

const SLOTS      = ['morning', 'afternoon', 'evening'];
const SLOT_ICONS = { morning: '🌅', afternoon: '☀️', evening: '🌙' };

/**
 * SpotDrawer — Field Guide bottom sheet.
 *
 * Props:
 *   spot       Firestore spot object (null = hidden)
 *   days       Array of day plan objects [{ id, dayNumber }]
 *   userId     string | null
 *   onClose    fn()
 *   onAddToDay async fn(dayPlanId, spot, slot)
 *   starred    boolean
 *   onStar     fn(spotId)
 */
export default function SpotDrawer({ spot, days = [], userId, onClose, onAddToDay, starred = false, onStar }) {
  const level = getHiddennessLevel(spot?.hiddennessScore ?? 1);

  /* ── Personal note + visited ──────────────────────────────────── */
  const [note,      setNote]      = useState('');
  const [visited,   setVisited]   = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const noteTimer = useRef(null);

  useEffect(() => {
    if (!userId || !spot?.id) return;
    getSpotNote(userId, spot.id).then((d) => {
      if (d) { setNote(d.note ?? ''); setVisited(d.visited ?? false); }
    }).catch(() => {});
  }, [userId, spot?.id]);

  const persistNote = useCallback(async (n, v) => {
    if (!userId || !spot?.id) return;
    try { await saveSpotNote(userId, spot.id, { note: n, visited: v }); setNoteSaved(true); }
    catch {}
  }, [userId, spot?.id]);

  function handleNoteChange(val) {
    setNote(val); setNoteSaved(false);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => persistNote(val, visited), 800);
  }

  async function handleVisitedToggle() {
    const next = !visited;
    setVisited(next);
    await persistNote(note, next);
  }

  /* ── Add to day ──────────────────────────────────────────────── */
  const [selDay,  setSelDay]  = useState('');
  const [selSlot, setSelSlot] = useState('morning');
  const [adding,  setAdding]  = useState(false);
  const [added,   setAdded]   = useState(false);

  useEffect(() => {
    if (days.length > 0 && !selDay) setSelDay(days[0].id);
  }, [days, selDay]);

  async function handleAdd() {
    if (!selDay || adding || added) return;
    setAdding(true);
    try { await onAddToDay?.(selDay, spot, selSlot); setAdded(true); }
    catch {}
    finally { setAdding(false); }
  }

  /* ── Escape + lock body scroll ───────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  /* ── Early return after hooks ────────────────────────────────── */
  if (!spot) return null;

  const schedule  = getFullSchedule(spot.openingHours);
  const todayHrs  = getTodayHours(spot.openingHours);
  const isClosed  = todayHrs === 'Closed';

  const coordLabel = spot.coordinates?.lat != null
    ? `${spot.coordinates.lat.toFixed(4)}°N ${Math.abs(spot.coordinates.lng ?? 0).toFixed(4)}°${(spot.coordinates.lng ?? 0) < 0 ? 'W' : 'E'}`
    : null;

  const mapsUrl = spot.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((spot.name ?? '') + ' ' + (spot.address ?? ''))}`
    : null;

  const panel = (
    <>
      {/* Scrim */}
      <div className="scrim" onClick={onClose} />

      {/* Drawer sheet */}
      <div className="drawer" style={{ '--sc': `var(${level.cssVar})` }}>
        <div className="grip" />

        <div className="drawer-scroll" style={{ paddingBottom: 24 }}>

          {/* ── Photo placeholder ── */}
          <div className="dr-photo">
            <span className="ph-lab">
              [ photo · {(spot.category ?? 'spot').toLowerCase()} · {spot.city ?? ''} ]
            </span>

            {/* Visited toggle */}
            <label style={{ position: 'absolute', left: 14, top: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={visited}
                onChange={handleVisitedToggle}
                style={{ width: 12, height: 12, accentColor: 'var(--olive)', cursor: 'pointer' }}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: visited ? 'var(--olive)' : 'var(--muted)', fontWeight: 700 }}>
                {visited ? 'Visited ✓' : 'Mark visited'}
              </span>
            </label>

            {/* Hero medallion */}
            <div className="dr-hero">
              <ScoreMedallion score={spot.hiddennessScore ?? 1} size={74} animate showDen />
            </div>

            {/* Tier band */}
            <span className="dr-heroband">{level.label}</span>
          </div>

          {/* ── Body ── */}
          <div className="dr-body">
            <div className="dr-cat">
              {spot.category}
              {coordLabel && <span style={{ marginLeft: 8 }}>{coordLabel}</span>}
            </div>
            <h2 className="dr-name">{spot.name}</h2>
            <div className="dr-tier">
              {level.label} — hiddenness {spot.hiddennessScore ?? 1}/10
              {todayHrs && (
                <span style={{ marginLeft: 12, fontFamily: 'var(--mono)', fontSize: 11, fontStyle: 'normal', color: isClosed ? 'var(--error)' : 'var(--muted)' }}>
                  {isClosed ? `⏰ ${getClosureLabel(spot.openingHours)}` : `⏰ Today ${todayHrs}`}
                </span>
              )}
            </div>

            {/* Closure warning */}
            {spot.closureStatus && spot.closureStatus !== 'open' && (
              <div style={{ marginTop: 12, padding: '9px 13px', borderRadius: 10, background: spot.closureStatus === 'permanently_closed' ? 'color-mix(in oklch, var(--error) 8%, transparent)' : 'color-mix(in oklch, var(--t3) 12%, transparent)', border: `1px solid ${spot.closureStatus === 'permanently_closed' ? 'color-mix(in oklch, var(--error) 25%, transparent)' : 'color-mix(in oklch, var(--t3) 30%, transparent)'}` }}>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em', fontWeight: 700, color: spot.closureStatus === 'permanently_closed' ? 'var(--error)' : 'var(--t3)' }}>
                  {spot.closureStatus === 'temporarily_closed' && '⚠ May be temporarily closed'}
                  {spot.closureStatus === 'permanently_closed' && '✕ Permanently closed'}
                  {spot.closureStatus === 'seasonal'           && '🗓 Seasonal — hours vary'}
                </p>
              </div>
            )}

            {/* Why hidden */}
            {spot.whyHidden && (
              <div className="dr-why">
                <div className="wl">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/>
                  </svg>
                  Why it's hidden
                </div>
                <p>{spot.whyHidden}</p>
              </div>
            )}

            {/* Description */}
            {spot.description && <p className="dr-desc">{spot.description}</p>}

            {/* Tips */}
            {spot.tips?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p className="dr-section-lbl">Insider Tips</p>
                {spot.tips.map((tip, i) => (
                  <p key={i} style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 5, paddingLeft: 12, borderLeft: `2px solid color-mix(in oklch, var(${level.cssVar}) 30%, transparent)` }}>
                    {tip}
                  </p>
                ))}
              </div>
            )}

            {/* Facts grid */}
            <div className="dr-facts">
              {/* Opening hours */}
              {schedule ? (
                <div className="dr-fact" style={{ gridColumn: '1 / -1' }}>
                  <div className="fl">Opening Hours</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px 16px', marginTop: 4 }}>
                    {schedule.map(({ key, label, hours, closed, isToday }) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderLeft: isToday ? `2px solid var(${level.cssVar})` : '2px solid transparent', paddingLeft: isToday ? 6 : 0 }}>
                        <span style={{ fontSize: 11.5, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--ink)' : 'var(--ink-soft)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {label}{isToday && <span style={{ fontSize: 9, color: `var(${level.cssVar})`, marginLeft: 4 }}>today</span>}
                        </span>
                        <span style={{ fontSize: 11.5, color: closed ? 'var(--error)' : isToday ? 'var(--ink)' : 'var(--muted)', fontFamily: 'var(--mono)', fontWeight: isToday ? 600 : 400 }}>
                          {hours}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : typeof spot.openingHours === 'string' && spot.openingHours ? (
                <div className="dr-fact" style={{ gridColumn: '1 / -1' }}>
                  <div className="fl">Opening Hours</div>
                  <div className="fv">{spot.openingHours}</div>
                </div>
              ) : null}

              {/* Entry cost */}
              <div className="dr-fact">
                <div className="fl">Entry</div>
                <div className="fv" style={{ color: spot.entryPrice == null ? 'var(--olive)' : undefined }}>
                  {spot.entryPrice == null ? 'Free' : `€${spot.entryPrice}/pp`}
                </div>
              </div>

              {/* Visit duration */}
              {spot.visitDurationMinutes && (
                <div className="dr-fact">
                  <div className="fl">Typical visit</div>
                  <div className="fv">
                    ~{spot.visitDurationMinutes < 60
                      ? `${spot.visitDurationMinutes} min`
                      : `${Math.round(spot.visitDurationMinutes / 60)} hr`}
                  </div>
                </div>
              )}

              {/* Address */}
              {spot.address && (
                <div className="dr-fact" style={{ gridColumn: '1 / -1' }}>
                  <div className="fl">Address</div>
                  <div className="fv">{spot.address}</div>
                </div>
              )}

              {/* Maps link */}
              {mapsUrl && (
                <div className="dr-fact" style={{ gridColumn: '1 / -1' }}>
                  <div className="fl">Find it</div>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="fv link">
                    Open in Google Maps ↗
                  </a>
                </div>
              )}
            </div>

            {/* Interest / category tags */}
            {spot.interests?.length > 0 && (
              <div className="dr-cats">
                {spot.interests.map((id) => (
                  <span className="ct" key={id}>{id}</span>
                ))}
              </div>
            )}

            {/* ── Add to day plan ── */}
            {days.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p className="dr-section-lbl" style={{ marginBottom: 10 }}>Add to Day Plan</p>
                {added ? (
                  <p style={{ fontSize: 14, color: 'var(--olive)', fontWeight: 600 }}>✓ Added to your day plan</p>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      value={selDay}
                      onChange={(e) => setSelDay(e.target.value)}
                      style={{ flex: 1, minWidth: 90, background: 'var(--paper-2)', border: '1px solid var(--line-strong)', borderRadius: 9, padding: '8px 10px', color: 'var(--ink)', fontSize: 13.5, outline: 'none', cursor: 'pointer' }}
                    >
                      {days.map((d) => (
                        <option key={d.id} value={d.id}>Day {d.dayNumber}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {SLOTS.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSelSlot(slot)}
                          style={{
                            padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                            border: `1px solid ${selSlot === slot ? `var(${level.cssVar})` : 'var(--line-strong)'}`,
                            background: selSlot === slot ? `color-mix(in oklch, var(${level.cssVar}) 10%, transparent)` : 'transparent',
                            color: selSlot === slot ? `var(${level.cssVar})` : 'var(--muted)',
                            cursor: 'pointer', transition: 'all 0.12s',
                            display: 'flex', alignItems: 'center', gap: 3,
                          }}
                        >
                          {SLOT_ICONS[slot]} {slot.charAt(0).toUpperCase() + slot.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Personal notes ── */}
            {userId && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <p className="dr-section-lbl">My Notes</p>
                  {noteSaved && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--olive)' }}>✓ Saved</span>
                  )}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Private notes, reminders, or thoughts…"
                  rows={3}
                  style={{
                    width: '100%', resize: 'vertical',
                    background: 'var(--paper-2)', border: '1px solid var(--line-strong)',
                    borderRadius: 11, padding: '10px 13px',
                    color: 'var(--ink)', fontSize: 13.5, lineHeight: 1.55,
                    fontFamily: 'inherit', outline: 'none',
                    transition: 'border-color 0.15s', boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--ink)'}
                  onBlur={(e)  => e.currentTarget.style.borderColor = 'var(--line-strong)'}
                />
              </div>
            )}

            {/* Verify hours link */}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent((spot.name ?? '') + ' ' + (spot.city ?? '') + ' opening hours')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ink)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
            >
              🔍 Verify hours on Google
            </a>
          </div>
        </div>

        {/* ── Sticky action bar ── */}
        <div className="dr-actions">
          {days.length > 0 && !added && (
            <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={adding}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {adding ? 'Adding…' : 'Add to a day'}
            </button>
          )}
          {added && (
            <button type="button" className="btn btn-secondary on" disabled style={{ flex: 1 }}>
              ✓ Added to plan
            </button>
          )}
          <button
            type="button"
            className={'btn btn-secondary' + (starred ? ' on' : '')}
            onClick={() => onStar?.(spot.id)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17l-5.4 2.6 1.2-6L3.3 9.4l6.1-.8z" />
            </svg>
            {starred ? 'Starred' : 'Star'}
          </button>
        </div>
      </div>
    </>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(panel, document.body);
}
