'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getSpot, getDayPlans, addSpotToDayPlan } from '@/lib/db';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { INTERESTS } from '@/constants/interests';


/* ── Helpers ──────────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

const TIME_OPTIONS = ['morning', 'afternoon', 'evening'];

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function SpotDetailPage() {
  return <Suspense fallback={null}><SpotDetailContent /></Suspense>;
}

function SpotDetailContent() {
  const { id: spotId } = useParams();
  const searchParams   = useSearchParams();
  const { user }       = useAuth();

  const city   = searchParams.get('city')   ?? '';
  const destId = searchParams.get('destId') ?? '';
  const tripId = searchParams.get('tripId') ?? '';

  const [spot,           setSpot]          = useState(null);
  const [loading,        setLoading]       = useState(true);
  const [error,          setError]         = useState(null);

  // "Add to Day Plan" modal state
  const [showDayPicker,  setShowDayPicker] = useState(false);
  const [dayPlans,       setDayPlans]      = useState([]);
  const [dayPlansLoading,setDayPlansLoad]  = useState(false);
  const [selectedDay,    setSelectedDay]   = useState(null);
  const [selectedTime,   setSelectedTime]  = useState('morning');
  const [adding,         setAdding]        = useState(false);
  const [addSuccess,     setAddSuccess]    = useState(false);

  /* ── Load spot ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!spotId || !city) { setLoading(false); return; }
    getSpot(city, spotId)
      .then((s) => { setSpot(s); if (!s) setError('Spot not found.'); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [spotId, city]);

  /* ── Load day plans when picker opens ──────────────────────────────────── */
  const openDayPicker = async () => {
    setShowDayPicker(true);
    if (!destId || !user?.uid || dayPlans.length > 0) return;
    setDayPlansLoad(true);
    try {
      const plans = await getDayPlans(destId, user.uid);
      setDayPlans(plans);
      if (plans.length > 0) setSelectedDay(plans[0].id);
    } catch (err) {
      console.error('getDayPlans error:', err);
    } finally {
      setDayPlansLoad(false);
    }
  };

  /* ── Add to day plan ────────────────────────────────────────────────────── */
  const handleAddToDay = async () => {
    if (!selectedDay || !spot) return;
    setAdding(true);
    try {
      await addSpotToDayPlan(selectedDay, spotId, city, selectedTime);
      setAddSuccess(true);
      setTimeout(() => setShowDayPicker(false), 1200);
    } catch (err) {
      console.error('addSpotToDayPlan error:', err);
    } finally {
      setAdding(false);
    }
  };

  /* ── Loading / error ────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
      </div>
    );
  }

  if (error || !spot) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>{error ?? 'Spot not found.'}</p>
        {tripId && (
          <Link href={`/trips/${tripId}`} style={{ color: 'var(--accent)', fontSize: '0.85rem', marginTop: '12px', display: 'inline-block' }}>
            ← Back to trip
          </Link>
        )}
      </div>
    );
  }

  const level     = getHiddennessLevel(spot.hiddennessScore ?? 1);
  const pct       = Math.round(((spot.hiddennessScore ?? 1) / 10) * 100);
  const backHref  = tripId ? `/trips/${tripId}` : '/';
  const backLabel = tripId ? '← Research' : '← Back';

  const spotInterests = (spot.interests ?? [])
    .map((id) => INTERESTS.find((i) => i.id === id))
    .filter(Boolean);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom))' }}>

      {/* Header */}
      <header style={{
        padding:      '16px 20px',
        paddingTop:   'calc(16px + env(safe-area-inset-top))',
        borderBottom: '1px solid var(--border)',
        display:      'flex',
        alignItems:   'center',
        gap:          '12px',
      }}>
        <Link href={backHref} style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flexShrink: 0 }}>
          {backLabel}
        </Link>
        <h1 style={{
          fontSize:     '1rem',
          fontWeight:   600,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {spot.name}
        </h1>
      </header>

      <div style={{ padding: '20px' }}>

        {/* ── Hiddenness ──────────────────────────────────────────────────── */}
        <div style={{
          background:    'var(--card)',
          border:        '1px solid var(--border)',
          borderLeft:    `4px solid ${level.color}`,
          borderRadius:  '10px',
          padding:       '16px',
          marginBottom:  '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{
              width:        '10px',
              height:       '10px',
              borderRadius: '50%',
              background:   level.color,
              flexShrink:   0,
              boxShadow:    `0 0 8px ${level.color}60`,
            }} />
            <span style={{ color: level.color, fontWeight: 700, fontSize: '0.9rem' }}>{level.label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{spot.hiddennessScore}/10</span>
          </div>
          {/* Score bar */}
          <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border)' }}>
            <div style={{
              width:        `${pct}%`,
              height:       '100%',
              borderRadius: '2px',
              background:   level.color,
              boxShadow:    `0 0 6px ${level.color}80`,
            }} />
          </div>
        </div>

        {/* ── Description ─────────────────────────────────────────────────── */}
        {spot.description && (
          <p style={{
            fontSize:     '0.9rem',
            color:        'var(--text-secondary)',
            lineHeight:   1.7,
            marginBottom: '20px',
          }}>
            {spot.description}
          </p>
        )}

        {/* ── Why it's hidden ─────────────────────────────────────────────── */}
        {spot.whyHidden && (
          <div style={{
            background:   'rgba(245,158,11,0.06)',
            border:       '1px solid rgba(245,158,11,0.2)',
            borderRadius: '10px',
            padding:      '14px 16px',
            marginBottom: '20px',
          }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
              Why it's hidden
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {spot.whyHidden}
            </p>
          </div>
        )}

        {/* ── Closure status ──────────────────────────────────────────────── */}
        {spot.closureStatus && spot.closureStatus !== 'open' && (
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent((spot.name ?? '') + ' ' + (spot.city ?? city) + ' opening hours')}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:        'block',
              background:     spot.closureStatus === 'permanently_closed' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
              border:         `1px solid ${spot.closureStatus === 'permanently_closed' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
              borderRadius:   10,
              padding:        '12px 16px',
              marginBottom:   20,
              textDecoration: 'none',
            }}
          >
            <p style={{ fontSize: '0.85rem', fontWeight: 700, color: spot.closureStatus === 'permanently_closed' ? '#ef4444' : '#f59e0b', marginBottom: 4 }}>
              {spot.closureStatus === 'temporarily_closed' && '⚠️ May be temporarily closed'}
              {spot.closureStatus === 'permanently_closed' && '✕ This place has permanently closed'}
              {spot.closureStatus === 'seasonal'           && '🗓 Seasonal opening'}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              AI research may be out of date — tap to check current status on Google →
            </p>
          </a>
        )}

        {/* ── Opening hours ────────────────────────────────────────────────── */}
        {spot.openingHours && (
          <div style={{ marginBottom: 20 }}>
            <p style={{
              fontSize:      '0.72rem',
              fontWeight:    600,
              color:         'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom:  10,
            }}>
              Opening Hours
            </p>
            {typeof spot.openingHours === 'object' ? (
              <div style={{
                background:   'var(--card)',
                border:       '1px solid var(--border)',
                borderRadius: 10,
                overflow:     'hidden',
              }}>
                {['mon','tue','wed','thu','fri','sat','sun'].map((key) => {
                  const NAMES   = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
                  const TODAY   = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
                  const val     = spot.openingHours[key];
                  const isToday = key === TODAY;
                  const isClosed = !val || val.toLowerCase() === 'closed';

                  // Format "09:00-18:00" → "9am – 6pm"
                  let display = 'Closed';
                  if (!isClosed) {
                    const [open, close] = val.split('-');
                    const fmt = (s) => {
                      const [h, m] = (s || '').split(':').map(Number);
                      if (isNaN(h)) return s;
                      const suf  = h >= 12 ? 'pm' : 'am';
                      const hour = h % 12 || 12;
                      return m ? `${hour}:${String(m).padStart(2,'0')}${suf}` : `${hour}${suf}`;
                    };
                    display = `${fmt(open)} – ${fmt(close)}`;
                  }

                  return (
                    <div key={key} style={{
                      display:        'flex',
                      justifyContent: 'space-between',
                      alignItems:     'center',
                      padding:        '9px 14px',
                      background:     isToday ? 'rgba(245,158,11,0.07)' : 'transparent',
                      borderLeft:     `3px solid ${isToday ? 'var(--accent)' : 'transparent'}`,
                      borderBottom:   key !== 'sun' ? '1px solid var(--border)' : 'none',
                    }}>
                      <span style={{
                        fontSize:   '0.82rem',
                        fontWeight: isToday ? 700 : 400,
                        color:      isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                        display:    'flex',
                        alignItems: 'center',
                        gap:        6,
                      }}>
                        {NAMES[key]}
                        {isToday && (
                          <span style={{ fontSize: '0.65rem', background: 'var(--accent)', color: '#000', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                            TODAY
                          </span>
                        )}
                      </span>
                      <span style={{
                        fontSize:   '0.82rem',
                        fontWeight: isToday ? 600 : 400,
                        color:      isClosed ? '#ef4444' : (isToday ? 'var(--text-primary)' : 'var(--text-muted)'),
                      }}>
                        {display}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                ⏰ {spot.openingHours}
              </p>
            )}
            {/* Always-visible hours disclaimer */}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent((spot.name ?? '') + ' ' + (spot.city ?? city) + ' opening hours')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:        'inline-flex',
                alignItems:     'center',
                gap:            4,
                marginTop:      6,
                fontSize:       '0.72rem',
                color:          'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              🔗 AI-sourced · Verify current hours before visiting
            </a>
          </div>
        )}

        {/* ── Meta row ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          {spot.address && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>📍</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{spot.address}</span>
            </div>
          )}
          {spotInterests.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>🏷️</span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {spotInterests.map((i) => (
                  <span key={i.id} style={{
                    fontSize:     '0.75rem',
                    color:        'var(--text-secondary)',
                    background:   'var(--card)',
                    border:       '1px solid var(--border)',
                    borderRadius: '5px',
                    padding:      '2px 8px',
                  }}>
                    {i.icon} {i.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {spot.entryPrice != null ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>💶</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                €{spot.entryPrice} per person
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>💶</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--green)' }}>Free entry</span>
            </div>
          )}
        </div>

        {/* ── Sources ─────────────────────────────────────────────────────── */}
        {(spot.sources ?? []).length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <p style={{
              fontSize:      '0.72rem',
              fontWeight:    600,
              color:         'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom:  '10px',
            }}>
              Sources
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {spot.sources.map((src, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>·</span>
                  {src.url ? (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.8rem', color: 'var(--blue)', textDecoration: 'none' }}
                    >
                      {src.label ?? src.url}
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {src.label ?? 'Unknown source'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Add to Day Plan button ───────────────────────────────────────── */}
        {destId && (
          <button
            onClick={openDayPicker}
            style={{
              width:        '100%',
              padding:      '14px',
              background:   'var(--accent)',
              color:        '#000',
              border:       'none',
              borderRadius: '10px',
              fontWeight:   700,
              fontSize:     '0.95rem',
              cursor:       'pointer',
              transition:   'background 0.15s',
            }}
            onMouseEnter={(e) => (e.target.style.background = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.target.style.background = 'var(--accent)')}
          >
            + Add to Day Plan
          </button>
        )}
      </div>

      {/* ── Day Plan picker modal ────────────────────────────────────────── */}
      {showDayPicker && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowDayPicker(false); }}
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(0,0,0,0.7)',
            display:        'flex',
            alignItems:     'flex-end',
            zIndex:         100,
          }}
        >
          <div style={{
            width:         '100%',
            background:    'var(--card)',
            borderRadius:  '16px 16px 0 0',
            padding:       '20px',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          }}>
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '16px' }}>Add to Day Plan</p>

            {dayPlansLoading && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>Loading days…</p>
            )}

            {!dayPlansLoading && dayPlans.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
                No day plans found. Create a trip with dates to generate them.
              </p>
            )}

            {/* Day picker */}
            {dayPlans.length > 0 && (
              <>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>Day</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', maxHeight: '160px', overflowY: 'auto' }}>
                  {dayPlans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedDay(plan.id)}
                      style={{
                        padding:      '10px 14px',
                        borderRadius: '8px',
                        border:       `1px solid ${selectedDay === plan.id ? 'var(--accent)' : 'var(--border)'}`,
                        background:   selectedDay === plan.id ? 'rgba(245,158,11,0.1)' : 'var(--bg)',
                        color:        selectedDay === plan.id ? 'var(--accent)' : 'var(--text-secondary)',
                        fontWeight:   selectedDay === plan.id ? 600 : 400,
                        fontSize:     '0.85rem',
                        cursor:       'pointer',
                        textAlign:    'left',
                      }}
                    >
                      Day {plan.dayNumber} · {fmtDate(plan.planDate)}
                    </button>
                  ))}
                </div>

                {/* Time of day picker */}
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>Time of day</p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                  {TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setSelectedTime(t)}
                      style={{
                        flex:         1,
                        padding:      '8px',
                        borderRadius: '8px',
                        border:       `1px solid ${selectedTime === t ? 'var(--accent)' : 'var(--border)'}`,
                        background:   selectedTime === t ? 'rgba(245,158,11,0.1)' : 'var(--bg)',
                        color:        selectedTime === t ? 'var(--accent)' : 'var(--text-secondary)',
                        fontSize:     '0.78rem',
                        fontWeight:   selectedTime === t ? 600 : 400,
                        cursor:       'pointer',
                        textTransform:'capitalize',
                      }}
                    >
                      {t === 'morning' ? '🌅' : t === 'afternoon' ? '☀️' : '🌙'} {t}
                    </button>
                  ))}
                </div>

                {addSuccess ? (
                  <div style={{ textAlign: 'center', padding: '10px', color: 'var(--green)', fontWeight: 600 }}>
                    ✓ Added to Day {dayPlans.find(p => p.id === selectedDay)?.dayNumber}!
                  </div>
                ) : (
                  <button
                    onClick={handleAddToDay}
                    disabled={adding || !selectedDay}
                    style={{
                      width:        '100%',
                      padding:      '13px',
                      background:   'var(--accent)',
                      color:        '#000',
                      border:       'none',
                      borderRadius: '10px',
                      fontWeight:   700,
                      fontSize:     '0.9rem',
                      cursor:       adding ? 'not-allowed' : 'pointer',
                      opacity:      adding ? 0.7 : 1,
                    }}
                  >
                    {adding ? 'Adding…' : 'Add to Plan'}
                  </button>
                )}
              </>
            )}

            {/* Cancel */}
            {!addSuccess && (
              <button
                onClick={() => setShowDayPicker(false)}
                style={{
                  width:      '100%',
                  padding:    '12px',
                  background: 'none',
                  border:     'none',
                  color:      'var(--text-muted)',
                  fontSize:   '0.85rem',
                  cursor:     'pointer',
                  marginTop:  '8px',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
