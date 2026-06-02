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

/**
 * TripCard — Field Guide edition.
 * Props:
 *   trip      {object}   trip doc
 *   onDelete  {fn?}      async () => void — called after user confirms deletion
 */
export default function TripCard({ trip, onDelete }) {
  const { id, name, isMultiCity, destinations = [] } = trip;
  const first  = destinations[0];
  const last   = destinations[destinations.length - 1];

  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  if (!first) return null;

  const displayName = name ?? (isMultiCity
    ? destinations.map((d) => d.city).join(' · ')
    : first.city);

  const days = daysUntil(first.startDate);
  const researchDone = destinations.every((d) => d.researchDone);
  const status = researchDone ? 'ready' : 'pending';

  const tripNights = first.startDate && last?.endDate
    ? Math.max(0, Math.round((new Date(last.endDate) - new Date(first.startDate)) / 86400000))
    : null;

  async function handleDelete(e) {
    e.stopPropagation();
    setDeleting(true);
    try { await onDelete?.(); } catch {}
    // listener auto-removes the card — no state reset needed
  }

  return (
    <div style={{ position: 'relative', display: 'block' }}>

      {/* ── Confirm overlay — sits outside Link so clicks don't navigate ── */}
      {confirming && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
            borderRadius: 'inherit', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, textAlign: 'center', lineHeight: 1.35 }}>
            Delete {displayName}?
          </p>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center' }}>
            This can't be undone.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
                color: '#fff', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: 'none', background: '#dc2626',
                color: '#fff', cursor: deleting ? 'default' : 'pointer',
                opacity: deleting ? 0.6 : 1,
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

            {/* Status pill */}
            <span className={`tc-status ${status}`}>
              <span className="d" />
              {researchDone ? 'Ready' : 'Researching'}
            </span>

            {/* Countdown badge */}
            {days !== null && days >= 0 && (
              <span className="tc-cd">{days}d</span>
            )}
            {days !== null && days < 0 && (
              <span className="tc-cd">Ongoing</span>
            )}

            {/* Delete button — top-right of photo */}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
                title="Delete trip"
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 5,
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)', border: 'none',
                  color: '#fff', fontSize: '1rem', lineHeight: 1,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#dc2626'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}
              >
                ×
              </button>
            )}
          </div>

          {/* ── Body ── */}
          <div className="tc-body">
            <div className="tc-dest">
              {isMultiCity
                ? destinations.map((d) => d.city).join(' · ')
                : displayName}
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
              <span className={`tc-prog`} style={{ color: researchDone ? 'var(--olive)' : 'var(--muted)' }}>
                {researchDone ? '✓ scored' : 'in progress'}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
