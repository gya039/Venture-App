'use client';

import { useState } from 'react';
import Link from 'next/link';
import { flagEmoji } from '@/utils/flagEmoji';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T00:00:00') - new Date()) / 86400000);
}

export default function TripCard({ trip, onDelete }) {
  const { id, name, isMultiCity, destinations = [] } = trip;
  const first = destinations[0];
  const last  = destinations[destinations.length - 1];

  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  if (!first) return null;

  const displayName = name ?? (isMultiCity
    ? destinations.map((d) => d.city).join(' · ')
    : first.city);

  const days          = daysUntil(first.startDate);
  const researchDone  = destinations.every((d) => d.researchDone);
  const noneResearched = destinations.every((d) => !d.researchDone);
  // Research is likely stuck if nothing has been researched at all — shows "0/N destinations"
  const researchStuck = !researchDone && noneResearched && destinations.length > 0;
  const status        = researchDone ? 'ready' : 'pending';
  const tripNights  = first.startDate && last?.endDate
    ? Math.max(0, Math.round((new Date(last.endDate) - new Date(first.startDate)) / 86400000))
    : null;

  return (
    <div style={{ position: 'relative' }}>

      {/* ── Full-card confirm overlay ────────────────────────────────── */}
      {confirming && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
            borderRadius: 16,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, textAlign: 'center', lineHeight: 1.4 }}>
            Delete {displayName}?
          </p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center' }}>
            This can't be undone.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
                color: '#fff', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                setDeleting(true);
                try { await onDelete?.(); } catch {}
              }}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: 'none', background: '#dc2626', color: '#fff',
                cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <Link href={`/trips/${id}`} style={{ textDecoration: 'none', display: 'block' }}>
        <div
          className="tripcard"
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)';    e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
        >
          {/* ── Photo area ── */}
          <div className="tc-photo">
            {trip.coverPhoto && (
              <img
                src={trip.coverPhoto}
                alt={first.city}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <span className="flag">{flagEmoji(first.countryCode)}</span>
            <span className={`tc-status ${researchStuck ? 'stalled' : status}`}>
              <span className="d" />
              {researchDone ? 'Ready' : researchStuck ? 'Stalled' : 'Researching'}
            </span>
            {days !== null && days >= 0 && <span className="tc-cd">{days}d</span>}
            {days !== null && days < 0  && <span className="tc-cd">Ongoing</span>}
            {trip.isPublic && (
              <span style={{
                position: 'absolute', bottom: 8, left: 8,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                color: '#fff', fontSize: '0.65rem', fontWeight: 700,
                padding: '2px 7px', borderRadius: 20, letterSpacing: '0.03em',
              }}>
                🌍 Public
              </span>
            )}
          </div>

          {/* ── Body ── */}
          <div className="tc-body">
            <div className="tc-dest">
              {isMultiCity ? destinations.map((d) => d.city).join(' · ') : displayName}
            </div>
            <div className="tc-dates">
              {fmtDate(first.startDate)}
              {last?.endDate && ` – ${fmtDate(last.endDate)}`}
              {tripNights != null && ` · ${tripNights} night${tripNights !== 1 ? 's' : ''}`}
            </div>
            <div className="tc-foot">
              <span className="tc-len">
                {destinations.filter((d) => d.researchDone).length}/{destinations.length} destinations
              </span>
              <span style={{ color: researchDone ? 'var(--olive)' : researchStuck ? 'var(--error)' : 'var(--muted)' }} className="tc-prog">
                {researchDone ? '✓ scored' : researchStuck ? '⚠ stalled — open to retry' : 'in progress'}
              </span>
            </div>

            {/* Delete button — sits in the card body, clearly labelled */}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
                style={{
                  marginTop: 10, width: '100%', padding: '6px 0',
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
              >
                Delete trip
              </button>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
