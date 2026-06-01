'use client';

import { useState, useEffect } from 'react';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { INTERESTS } from '@/constants/interests';
import { track } from '@/lib/analytics';
import { getTodayHours, getClosureLabel } from '@/utils/spotUtils';
import ScoreMedallion from '@/components/ScoreMedallion';

/**
 * SpotCard — Field Guide edition.
 *
 * Layout: ScoreMedallion (50px) · [mono cat·hood / serif name / italic tier] · icon buttons
 *
 * Props (all existing callers remain compatible):
 *   spot         {object}   Firestore spot doc
 *   active       {boolean}  Highlighted (keyboard nav / map sync)
 *   reveal       {boolean}  Animate on first appearance (streaming)
 *   justFound    {boolean}  Show "Just found" badge
 *   onSelect     {fn}       Row click handler
 *   saved        {boolean}  Starred state
 *   onToggleSave {fn}       (spot, newState) → void
 *   onOpenDrawer {fn}       (spot) → void
 *   onAddToDay   {fn}       (spot) → void
 *   rank         {number?}  Discover mode rank number
 *   savesCount   {number?}  Community save count (Discover mode)
 *   visited      {boolean}
 *   isPastTrip   {boolean}
 *   reviewAggregate {object?} { avgRating, count }
 *   userRating   {number}   0 = not rated
 *   onRate       {fn?}      (spotId, rating) → void
 */
export default function SpotCard({
  spot,
  active       = false,
  reveal       = false,
  justFound    = false,
  onSelect,
  saved        = false,
  onToggleSave,
  onOpenDrawer,
  onAddToDay,
  rank,
  savesCount,
  visited      = false,
  isPastTrip   = false,
  reviewAggregate = null,
  userRating   = 0,
  onRate       = null,
}) {
  const score = spot?.hiddennessScore ?? 1;
  const level = getHiddennessLevel(score);

  // Optimistic bookmark
  const [isSaved, setIsSaved] = useState(saved);
  useEffect(() => { setIsSaved(saved); }, [saved]);

  // Category label: use spot.category, or first interest label
  const catLabel = spot?.category
    ?? INTERESTS.find((i) => (spot?.interests ?? [])[0] === i.id)?.label
    ?? '';


  const todayHrs = getTodayHours(spot?.openingHours);
  const isClosed = todayHrs === 'Closed';

  function handleStar(e) {
    e.stopPropagation();
    const next = !isSaved;
    setIsSaved(next);
    onToggleSave?.(spot, next);
    if (next) track('spot_starred', { spotId: spot.id, city: spot.city, hiddennessScore: score });
  }

  const priceLabel = spot?.entryPrice != null
    ? `€${spot.entryPrice}`
    : null;

  return (
    <div
      className={
        'spotcard' +
        (reveal  ? ' reveal' : '') +
        (active  ? ' active' : '') +
        // hover class `hot` is applied via inline onMouseEnter/Leave so existing map-sync still works
        ''
      }
      style={{ '--sc': `var(${level.cssVar})` }}
      onClick={onSelect}
      onMouseEnter={(e) => { if (!active) e.currentTarget.classList.add('hot'); }}
      onMouseLeave={(e) => { e.currentTarget.classList.remove('hot'); }}
    >
      {/* "Just found" badge — fades out after 2.4s via CSS */}
      {justFound && <span className="justfound">Just found</span>}

      {/* Discover rank */}
      {rank != null && <span className="sc-rank">{rank}</span>}

      {/* Score medallion */}
      <ScoreMedallion score={score} size={50} animate={reveal} />

      {/* Text block — click to open drawer */}
      <div
        className="sc-main"
        onClick={(e) => { if (onOpenDrawer) { e.stopPropagation(); onOpenDrawer(spot); } }}
        style={{ cursor: onOpenDrawer ? 'pointer' : 'inherit' }}
      >
        <div className="sc-cat">
          {catLabel}
        </div>
        <div className="sc-name">
          {spot?.name}
          {visited && (
            <span className="spot-visited-tag" style={{ marginLeft: 6, fontSize: '0.55rem' }}>✓</span>
          )}
        </div>
        <div className="sc-tier">
          {level.label}
          {savesCount != null && (
            <span className="sc-saved">★ {savesCount} saved</span>
          )}
          {/* Compact meta: price · hours */}
          {(priceLabel || (todayHrs && !isClosed)) && (
            <span className="sc-saved">
              {priceLabel ? ` · ${priceLabel}` : ' · Free'}
              {todayHrs && !isClosed && ` · ${todayHrs}`}
              {isClosed && (
                <span style={{ color: 'var(--error)', fontStyle: 'normal' }}> · {getClosureLabel(spot?.openingHours)}</span>
              )}
            </span>
          )}
        </div>

        {/* Closure alert */}
        {spot?.closureStatus && spot.closureStatus !== 'open' && (
          <div style={{
            marginTop: 4,
            fontSize: '0.65rem', fontFamily: 'var(--mono)',
            color: spot.closureStatus === 'permanently_closed' ? 'var(--error)' : 'var(--t3)',
            fontWeight: 700,
          }}>
            {spot.closureStatus === 'temporarily_closed' && '⚠ Temporarily closed'}
            {spot.closureStatus === 'permanently_closed' && '✕ Permanently closed'}
            {spot.closureStatus === 'seasonal'           && '🗓 Seasonal'}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="sc-acts">
        {/* Star */}
        <button
          type="button"
          className={'icbtn' + (isSaved ? ' on' : '')}
          title={isSaved ? 'Remove star' : 'Star this spot'}
          onClick={handleStar}
        >
          <svg viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17l-5.4 2.6 1.2-6L3.3 9.4l6.1-.8z" />
          </svg>
        </button>

        {/* Add to day / open drawer */}
        {onAddToDay && (
          <button
            type="button"
            className="icbtn"
            title="Add to a day"
            onClick={(e) => { e.stopPropagation(); onAddToDay(spot); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Past-trip star rating (shown inline below for rated spots) ── */}
      {isPastTrip && onRate && (
        <div
          style={{
            position: 'absolute', bottom: 8, left: 78, display: 'flex', gap: 2, alignItems: 'center',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[1,2,3,4,5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onRate(spot.id, star)}
              style={{
                background: 'none', border: 'none', padding: '0 1px',
                fontSize: '0.85rem', cursor: 'pointer', lineHeight: 1,
                color: star <= userRating ? 'var(--t5)' : 'var(--faint)',
                transition: 'color 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t5)'}
              onMouseLeave={(e) => e.currentTarget.style.color = star <= userRating ? 'var(--t5)' : 'var(--faint)'}
            >
              {star <= userRating ? '★' : '☆'}
            </button>
          ))}
          {reviewAggregate?.count > 0 && (
            <span style={{ fontSize: '0.62rem', fontFamily: 'var(--mono)', color: 'var(--muted)', marginLeft: 4 }}>
              {reviewAggregate.avgRating.toFixed(1)} ({reviewAggregate.count})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
