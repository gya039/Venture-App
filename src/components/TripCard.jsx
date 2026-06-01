'use client';

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
 * Matches `.tripcard` spec: warm paper card, striped photo placeholder,
 * flag + status pill + countdown badge, serif city name, mono dates/meta.
 */
export default function TripCard({ trip }) {
  const { id, name, isMultiCity, destinations = [] } = trip;
  const first  = destinations[0];
  const last   = destinations[destinations.length - 1];
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

  return (
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
  );
}
