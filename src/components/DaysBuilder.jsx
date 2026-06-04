'use client';

/**
 * DaysBuilder — two-panel itinerary planner.
 *
 * Left panel  (300px): spot picker — starred / all toggle, search, draggable cards
 * Right panel (flex):  collapsible day sections with Morning / Afternoon / Evening drop zones
 *
 * DnD architecture: single DndContext owns everything so cross-day drag works.
 *   Picker items  → drag ID:  pick__<spotId>
 *   Placed items  → drag ID:  <dayPlanSpotId>   (Firestore doc ID)
 *   Drop zones    → zone ID:  zone__<dayId>__<slot>
 */

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getHiddennessLevel } from '@/constants/hiddenness';
import { getTodayHours, getClosureLabel } from '@/utils/spotUtils';
import { categoryLabel } from '@/lib/categories';
import { formatPrice, getNumericPrice } from '@/lib/pricing';
import {
  addSpotToDayPlan,
  addEventToDayPlan,
  removeDayPlanSpot,
  updateDayPlanSpotSlot,
  saveTripAsTemplate,
  updateTripAccommodation,
} from '@/lib/db';
import { travelChip, haversineKm, fmtKm, suggestOrder, totalDistKm } from '@/lib/travelTime';
import ItineraryMapView from '@/components/ItineraryMapView';
import { exportItineraryPDF } from '@/lib/pdfExport';
import { track } from '@/lib/analytics';

/* ── Constants ────────────────────────────────────────────────────────────── */
const SLOTS      = ['morning', 'afternoon', 'evening'];
const SLOT_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const SLOT_COLOR = { morning: '#f59e0b', afternoon: '#fb923c', evening: '#b45309' };

// Distinct accent per day so the itinerary is visually readable at a glance
const DAY_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316'];

// Category normalisation is now handled by src/lib/categories.js (categoryLabel).
// All spot.category values are canonical Title Case — no local alias map needed.

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function initSlots(days) {
  const result = {};
  days.forEach(day => {
    const grouped = { morning: [], afternoon: [], evening: [] };
    const seen = new Set(); // deduplicate by dayPlanSpotId as a render-side safety net
    (day.spots ?? []).forEach(spot => {
      if (seen.has(spot.dayPlanSpotId)) return;
      seen.add(spot.dayPlanSpotId);
      const slot = SLOTS.includes(spot.timeOfDay) ? spot.timeOfDay : 'morning';
      grouped[slot].push(spot);
    });
    result[day.id] = grouped;
  });
  return result;
}

function fmtDayLabel(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function fmtDuration(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''}`;
  return `${m}m`;
}

/* ── HouseIcon — used for accommodation marker everywhere ─────────────────── */
function HouseIcon({ size = 15, color = 'var(--muted)' } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
  );
}

/* ── GripIcon ──────────────────────────────────────────────────────────────── */
function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" opacity="0.5">
      <circle cx="2.5" cy="2"  r="1.5" />
      <circle cx="7.5" cy="2"  r="1.5" />
      <circle cx="2.5" cy="7"  r="1.5" />
      <circle cx="7.5" cy="7"  r="1.5" />
      <circle cx="2.5" cy="12" r="1.5" />
      <circle cx="7.5" cy="12" r="1.5" />
    </svg>
  );
}

/* ── PickerSpot (draggable on pointer · tap-to-select on touch) ────────────── */
function PickerSpot({ spot, isAdded, onAdd, isTouch, placing, onSelectForPlace }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pick__${spot.id}`,
    data: { type: 'picker', spot },
    disabled: isTouch, // pointer-sensor drag disabled on coarse-pointer devices
  });
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);

  function handleCardClick(e) {
    if (!isTouch || isAdded) return;
    e.stopPropagation(); // don't bubble to root cancel handler
    onSelectForPlace(placing ? null : spot);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onClick={handleCardClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9,
        padding: '10px 10px 10px 8px', borderRadius: 9, marginBottom: 5,
        border: `1px solid ${placing ? 'var(--terracotta)' : isAdded ? 'var(--line)' : level.color + '30'}`,
        background: placing
          ? 'color-mix(in oklch, var(--terracotta) 9%, var(--card))'
          : 'var(--card)',
        opacity: isDragging ? 0.3 : isAdded ? 0.5 : 1,
        userSelect: 'none',
        transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
        '--sc': `var(${level.cssVar})`,
        cursor: isTouch && !isAdded ? 'pointer' : 'default',
        animation: placing ? 'placing-pulse 1.4s ease-in-out infinite' : 'none',
      }}
    >
      {/* Grip (pointer) · select indicator (touch) */}
      {isTouch ? (
        <div style={{
          flexShrink: 0, width: 14, paddingTop: 3,
          color: placing ? 'var(--terracotta)' : 'color-mix(in srgb, var(--muted) 60%, transparent)',
          fontSize: '0.6rem', lineHeight: 1,
          display: 'flex', alignItems: 'center',
        }}>
          {placing ? '●' : '○'}
        </div>
      ) : (
        <div
          {...listeners}
          style={{ flexShrink: 0, paddingTop: 2, color: 'var(--muted)', cursor: 'grab', touchAction: 'none', opacity: 0.65 }}
        >
          <GripIcon />
        </div>
      )}

      {/* Score badge */}
      <span style={{
        flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
        background: level.color, color: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.62rem', fontWeight: 700, marginTop: 1,
        boxShadow: `0 0 6px ${level.color}55`,
      }}>
        {spot.hiddennessScore ?? 1}
      </span>

      {/* Text block */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {spot.category && (
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: level.color, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2, lineHeight: 1 }}>
            {spot.category}
          </div>
        )}
        <div style={{
          fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3,
          color: isAdded ? 'var(--muted)' : 'var(--ink)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {isAdded && <span style={{ color: level.color }}>✓ </span>}{spot.name}
        </div>
      </div>

      {/* Quick-add button — adds directly to Day 1 */}
      <button
        type="button"
        disabled={isAdded}
        onClick={(e) => { e.stopPropagation(); onAdd(spot); }}
        style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
          border: isAdded ? '1px solid var(--line)' : 'none',
          background: isAdded ? 'transparent' : 'var(--accent)',
          color: isAdded ? 'var(--muted)' : '#000',
          fontSize: '0.75rem', fontWeight: 700, cursor: isAdded ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          marginTop: 1,
        }}
        title={isAdded ? 'Already in plan' : 'Add to Day 1'}
      >
        {isAdded ? '✓' : '+'}
      </button>
    </div>
  );
}

/* ── PickerSpotOverlay (drag ghost for picker) ────────────────────────────── */
function PickerSpotOverlay({ spot }) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      borderRadius: 8, border: `1px solid ${level.color}60`,
      background: 'var(--card)', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      maxWidth: 260, userSelect: 'none',
    }}>
      <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: level.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 700 }}>
        {spot.hiddennessScore ?? 1}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</div>
        <div style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>{spot.category}</div>
      </div>
    </div>
  );
}

/* ── PlacedSpotCard (sortable placed card inside a slot) ──────────────────── */
function PlacedSpotCard({ spot, onRemove }) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: spot.dayPlanSpotId, data: { type: 'placed', spot } });

  const todayHrs  = getTodayHours(spot.openingHours);
  const isClosed  = todayHrs === 'Closed';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.2 : 1, marginBottom: 6 }}
    >
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 10px',
        borderRadius: 8, border: `1px solid ${level.color}28`,
        background: 'var(--card)',
        boxShadow: isDragging ? '0 8px 28px rgba(0,0,0,0.45)' : 'none',
      }}>
        {/* Grip */}
        <div
          {...attributes} {...listeners}
          style={{ flexShrink: 0, paddingTop: 3, color: 'var(--muted)', cursor: 'grab', touchAction: 'none', lineHeight: 0 }}
        >
          <GripIcon />
        </div>

        {/* Score */}
        <span style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
          background: level.color, color: '#000', marginTop: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.62rem', fontWeight: 700,
        }}>
          {spot.hiddennessScore ?? 1}
        </span>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
            {spot.name}
          </div>
          <div style={{ fontSize: '0.7rem', color: level.color, fontWeight: 500, marginTop: 2 }}>
            {[spot.category, spot.neighbourhood].filter(Boolean).join(' · ')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {spot.visitDurationMinutes ? (
              <span style={{ fontSize: '0.67rem', color: 'var(--muted)' }}>⏱ {fmtDuration(spot.visitDurationMinutes)}</span>
            ) : null}
            {(() => {
              const p = formatPrice(spot);
              if (p.priceType === 'free') return <span style={{ fontSize: '0.67rem', color: 'var(--teal, #22c55e)' }}>Free</span>;
              if (p.priceType === 'pass') return <span style={{ fontSize: '0.67rem', color: 'var(--t5, #f59e0b)' }}>Pass</span>;
              if (p.priceType === 'paid') return <span style={{ fontSize: '0.67rem', color: 'var(--muted)' }}>{p.label}</span>;
              return null; // unknown → omit in mini chip to avoid clutter
            })()}
            {todayHrs ? (
              <span style={{ fontSize: '0.67rem', color: isClosed ? 'var(--error)' : 'var(--muted)' }}>
                {isClosed ? getClosureLabel(spot.openingHours) : `Today ${todayHrs}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Remove */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(spot.dayPlanSpotId); }}
          style={{
            flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
            border: '1px solid var(--line)', background: 'transparent',
            color: 'var(--muted)', fontSize: '0.8rem', lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--error)'; e.currentTarget.style.color = 'var(--error)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
        >
          ×
        </button>
      </div>

      {/* ── Event uncertainty notice — always shown for events ─────────── */}
      {spot.isEvent && (
        <div style={{
          marginTop: 6, padding: '5px 10px',
          borderRadius: 7,
          background: spot.confidence < 0.6
            ? 'color-mix(in oklch, var(--error) 7%, transparent)'
            : 'color-mix(in oklch, var(--t3) 8%, transparent)',
          border: `1px solid ${spot.confidence < 0.6
            ? 'color-mix(in oklch, var(--error) 22%, transparent)'
            : 'color-mix(in oklch, var(--t3) 22%, transparent)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <span style={{
            fontSize: '0.6rem', fontFamily: 'var(--mono)', letterSpacing: '0.04em',
            color: spot.confidence < 0.6 ? 'var(--error)' : 'var(--t3)',
            fontWeight: 700,
          }}>
            {spot.confidence < 0.6
              ? '⚠⚠ Uncertain — verify before you go'
              : '⚠ Always double-check times'}
          </span>
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent((spot.name ?? '') + ' ' + (spot.venue ?? '') + ' Glasgow')}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: '0.6rem', fontFamily: 'var(--mono)', fontWeight: 700,
              color: spot.confidence < 0.6 ? 'var(--error)' : 'var(--t3)',
              textDecoration: 'none', flexShrink: 0,
            }}
          >
            Verify →
          </a>
        </div>
      )}
    </div>
  );
}

/* ── PlacedSpotOverlay (drag ghost for placed cards) ───────────────────────── */
function PlacedSpotOverlay({ spot }) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px',
      borderRadius: 8, border: `1px solid ${level.color}50`,
      background: 'var(--card)', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      maxWidth: 320, userSelect: 'none',
    }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: level.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', fontWeight: 700 }}>
        {spot.hiddennessScore ?? 1}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</div>
        <div style={{ fontSize: '0.7rem', color: level.color, fontWeight: 500 }}>{spot.category}</div>
      </div>
    </div>
  );
}

/* ── TravelChip ────────────────────────────────────────────────────────────── */
function TravelChip({ spotA, spotB }) {
  const chip = travelChip(spotA, spotB);
  if (!chip) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '2px 4px', marginBottom: 4, marginLeft: 30,
      fontSize: '0.67rem', color: 'var(--muted)',
    }}>
      <span style={{ opacity: 0.7 }}>{chip.mode === 'walk' ? '🚶' : '🚌'}</span>
      <span>{chip.label}</span>
    </div>
  );
}

/* ── SlotZone (droppable slot section · tap-to-place on touch) ─────────────── */
function SlotZone({ slot, dayId, spots, onRemove, isTouch, placingSpot, onPlaceHere }) {
  const zoneId = `zone__${dayId}__${slot}`;
  // Disable dnd-kit droppable on touch — we use tap instead
  const { setNodeRef, isOver } = useDroppable({ id: zoneId, disabled: isTouch });
  const isEmpty = spots.length === 0;
  const isPlacingActive = isTouch && placingSpot !== null;

  function handleZoneTap(e) {
    if (!isPlacingActive) return;
    e.stopPropagation(); // don't bubble to root cancel handler
    onPlaceHere(dayId, slot);
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Slot header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, paddingLeft: 8, borderLeft: `2.5px solid ${SLOT_COLOR[slot]}` }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--mono, monospace)' }}>
          {SLOT_LABEL[slot]}
        </span>
        {spots.length > 0 && !isPlacingActive && (
          <span style={{ fontSize: '0.63rem', color: 'var(--muted)', marginLeft: 'auto', paddingRight: 4 }}>
            {spots.length} spot{spots.length !== 1 ? 's' : ''}
          </span>
        )}
        {/* "Add here" pill — visible only when placing is active */}
        {isPlacingActive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlaceHere(dayId, slot); }}
            style={{
              marginLeft: 'auto', flexShrink: 0,
              padding: '3px 9px', borderRadius: 6,
              background: 'var(--terracotta)', color: '#fff',
              border: 'none', fontSize: '0.62rem', fontWeight: 700,
              cursor: 'pointer', lineHeight: 1.4,
            }}
          >
            Add here
          </button>
        )}
      </div>

      {/* Drop zone — tappable when placing is active */}
      <div
        ref={setNodeRef}
        onClick={isPlacingActive ? handleZoneTap : undefined}
        style={{
          minHeight:    isEmpty ? 44 : 'auto',
          borderRadius: 8,
          border: isEmpty
            ? `1.5px dashed ${isPlacingActive ? 'color-mix(in srgb,var(--terracotta) 55%,transparent)' : isOver ? 'var(--accent)' : 'var(--line)'}`
            : isPlacingActive ? `1.5px dashed color-mix(in srgb,var(--terracotta) 40%,transparent)` : isOver ? `1.5px dashed var(--accent)` : 'none',
          background: isPlacingActive
            ? 'color-mix(in oklch, var(--terracotta) 3%, transparent)'
            : isOver ? 'rgba(245,158,11,0.04)' : 'transparent',
          transition:   'border-color 0.15s, background 0.15s',
          display:      'flex', flexDirection: 'column',
          alignItems:   isEmpty ? 'center' : 'stretch',
          justifyContent: isEmpty ? 'center' : 'flex-start',
          cursor: isPlacingActive ? 'pointer' : 'default',
        }}
      >
        <SortableContext items={spots.map(s => s.dayPlanSpotId)} strategy={verticalListSortingStrategy}>
          {spots.map((spot, idx) => (
            <Fragment key={spot.dayPlanSpotId}>
              <PlacedSpotCard spot={spot} onRemove={onRemove} />
              {idx < spots.length - 1 && <TravelChip spotA={spot} spotB={spots[idx + 1]} />}
            </Fragment>
          ))}
        </SortableContext>

        {isEmpty && (
          <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{
              fontSize: '0.67rem', fontStyle: 'italic',
              color: isPlacingActive
                ? 'color-mix(in srgb, var(--terracotta) 75%, transparent)'
                : isOver ? 'var(--accent)' : 'color-mix(in srgb, var(--muted) 55%, transparent)',
            }}>
              {isPlacingActive ? '📌 Tap to add here' : isOver ? '📌 Drop here' : 'Tap + to add, or drag here'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── EventSuggestionCard ──────────────────────────────────────────────────── */
function EventSuggestionCard({ event, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [selSlot, setSelSlot] = useState(() => {
    // Auto-pick slot from event time
    if (!event.time) return 'morning';
    const h = parseInt(event.time.split(':')[0], 10);
    if (h >= 18) return 'evening';
    if (h >= 12) return 'afternoon';
    return 'morning';
  });

  const isLowConf = (event.confidence ?? 1) < 0.6;

  return (
    <div style={{
      marginBottom: 8, padding: '10px 12px',
      borderRadius: 10,
      border: `1px solid ${isLowConf ? 'color-mix(in oklch, var(--error) 20%, var(--line))' : 'color-mix(in oklch, var(--terracotta) 30%, var(--line))'}`,
      background: isLowConf ? 'color-mix(in oklch, var(--error) 4%, var(--card))' : 'color-mix(in oklch, var(--terracotta) 4%, var(--card))',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>
            {event.name}
          </div>
          {event.venue && (
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
              {event.venue}{event.neighbourhood ? ` · ${event.neighbourhood}` : ''}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <span style={{
            display: 'inline-block', padding: '1px 7px', borderRadius: 8,
            background: 'color-mix(in oklch, var(--terracotta) 12%, transparent)',
            color: 'var(--terracotta)', fontSize: '0.6rem', fontWeight: 700,
            fontFamily: 'var(--mono)', letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {event.recurrence} · {event.day?.slice(0, 3)}
          </span>
          {event.time && (
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
              {event.time}
            </div>
          )}
        </div>
      </div>

      {/* Uncertainty notice */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8, padding: '4px 8px', borderRadius: 6,
        background: isLowConf ? 'color-mix(in oklch, var(--error) 8%, transparent)' : 'color-mix(in oklch, var(--t3) 6%, transparent)',
      }}>
        <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', fontWeight: 700, color: isLowConf ? 'var(--error)' : 'var(--t3)' }}>
          {isLowConf ? '⚠⚠ Uncertain — verify before you go' : '⚠ Always double-check times before you go'}
        </span>
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent((event.name ?? '') + ' Glasgow')}`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', fontWeight: 700, color: isLowConf ? 'var(--error)' : 'var(--t3)', textDecoration: 'none', flexShrink: 0, marginLeft: 6 }}
        >
          Verify →
        </a>
      </div>

      {/* Slot picker + Add button */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {SLOTS.map(slot => (
          <button
            key={slot}
            type="button"
            onClick={() => setSelSlot(slot)}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: '0.67rem', fontWeight: 500,
              border: `1px solid ${selSlot === slot ? 'var(--terracotta)' : 'var(--line)'}`,
              background: selSlot === slot ? 'color-mix(in oklch, var(--terracotta) 10%, transparent)' : 'transparent',
              color: selSlot === slot ? 'var(--terracotta)' : 'var(--muted)',
              cursor: 'pointer', transition: 'all 0.1s',
            }}
          >
            {selSlot === slot && (slot === 'morning' ? '🌅' : slot === 'afternoon' ? '☀️' : '🌙')} {SLOT_LABEL[slot]}
          </button>
        ))}
        <button
          type="button"
          disabled={adding}
          onClick={async () => { setAdding(true); try { await onAdd(selSlot); } finally { setAdding(false); } }}
          style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: 6,
            background: 'var(--terracotta)', color: '#fff',
            border: 'none', fontSize: '0.7rem', fontWeight: 700,
            cursor: adding ? 'default' : 'pointer', opacity: adding ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          {adding ? '…' : '+ Add'}
        </button>
      </div>
    </div>
  );
}

/* ── DaySection (collapsible day card) ────────────────────────────────────── */
function DaySection({ day, slots, onRemove, isTouch, placingSpot, onPlaceHere, events = [], onAddEvent, dayColor = '#f59e0b', accommodation = null }) {
  const [open,          setOpen]          = useState(true);
  const [eventsOpen,    setEventsOpen]    = useState(false);
  const [suggDismissed, setSuggDismissed] = useState(false);
  const [applying,      setApplying]      = useState(false);

  const allSpots = SLOTS.flatMap(s => slots[s] ?? []);
  const totalSpots    = allSpots.length;
  const totalCost     = allSpots.reduce((s, sp) => s + getNumericPrice(sp), 0);
  const totalDuration = allSpots.reduce((s, sp) => s + (sp.visitDurationMinutes ?? 0), 0);

  // Use imported totalDistKm under a local alias to avoid shadowing the function import
  const dayDistKm = totalDistKm(allSpots);

  // ── Route suggestion (nearest-neighbour) ──────────────────────────────────
  const suggested  = suggestOrder(allSpots, accommodation?.lat ?? null, accommodation?.lng ?? null);
  const suggDistKm = totalDistKm(suggested);
  const saving     = dayDistKm - suggDistKm;
  // Show suggestion only when: 3+ spots with coords, saves >0.3 km, saves >15%
  const geocodedCount = allSpots.filter(s => s.lat && s.lng && !s.coordsMissing).length;
  const showSuggestion = !suggDismissed && geocodedCount >= 3 && saving > 0.3 && saving / dayDistKm > 0.15;

  // Check if suggested order is meaningfully different from current
  const currentIds  = allSpots.map(s => s.dayPlanSpotId).join(',');
  const suggestedIds = suggested.map(s => s.dayPlanSpotId).join(',');
  const isSameOrder = currentIds === suggestedIds;

  async function applyOrder() {
    if (applying) return;
    setApplying(true);
    try {
      // Redistribute into slots proportionally based on original counts
      const counts = SLOTS.map(sl => (slots[sl] ?? []).length);
      let idx = 0;
      for (let si = 0; si < SLOTS.length; si++) {
        const slot = SLOTS[si];
        for (let k = 0; k < counts[si]; k++) {
          const spot = suggested[idx++];
          if (spot) await updateDayPlanSpotSlot(spot.dayPlanSpotId, slot, k);
        }
      }
      setSuggDismissed(true); // hide banner after applying
    } catch (err) {
      console.error('[DaySection] applyOrder error:', err);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', borderLeft: `3px solid ${dayColor}`, overflow: 'hidden', marginBottom: 10 }}>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: dayColor, lineHeight: 1 }}>
            Day {day.dayNumber}
          </span>
          {day.planDate && (
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              · {fmtDayLabel(day.planDate)}
            </span>
          )}
          {totalSpots > 0 && (
            <span style={{ fontSize: '0.63rem', fontWeight: 600, background: `color-mix(in oklch, ${dayColor} 15%, transparent)`, color: dayColor, padding: '2px 7px', borderRadius: 10 }}>
              {totalSpots}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalCost > 0 && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>~€{totalCost}/pp</span>}
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="var(--muted)" strokeWidth={2.5}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '14px 14px 10px' }}>

          {/* ── Route suggestion banner ─────────────────────────────────── */}
          {showSuggestion && !isSameOrder && (
            <div style={{
              marginBottom: 12, padding: '10px 12px',
              borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
              background: `color-mix(in oklch, ${dayColor} 10%, var(--card))`,
              border: `1px solid color-mix(in oklch, ${dayColor} 30%, transparent)`,
            }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={dayColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
                  Better route saves {fmtKm(saving)}
                </p>
                <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '2px 0 0', lineHeight: 1.4 }}>
                  {accommodation?.address ? 'From your home base' : 'Nearest-neighbour reorder'} — {fmtKm(suggDistKm)} total vs {fmtKm(dayDistKm)} now
                </p>
              </div>
              <button
                type="button"
                onClick={applyOrder}
                disabled={applying}
                style={{
                  flexShrink: 0, padding: '5px 11px', borderRadius: 6,
                  background: dayColor, border: 'none', color: '#000',
                  fontSize: '0.72rem', fontWeight: 700,
                  cursor: applying ? 'wait' : 'pointer', opacity: applying ? 0.6 : 1,
                }}
              >
                {applying ? '…' : 'Optimise'}
              </button>
              <button
                type="button"
                onClick={() => setSuggDismissed(true)}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px' }}
              >
                ×
              </button>
            </div>
          )}

          {SLOTS.map(slot => (
            <SlotZone
              key={slot}
              slot={slot}
              dayId={day.id}
              spots={slots[slot] ?? []}
              onRemove={onRemove}
              isTouch={isTouch}
              placingSpot={placingSpot}
              onPlaceHere={onPlaceHere}
            />
          ))}

          {/* ── Recurring events on this day (collapsed by default) ────── */}
          {(() => {
            const dayOfWeek = day.planDate
              ? new Date(day.planDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
              : null;
            const dayEvents = dayOfWeek
              ? events.filter((e) => e.day === dayOfWeek && !e.coordsMissing)
              : [];
            if (!dayEvents.length) return null;
            return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {/* Toggle row — always visible */}
                <button
                  type="button"
                  onClick={() => setEventsOpen((v) => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: eventsOpen ? 10 : 0,
                  }}
                >
                  <span style={{
                    fontSize: '0.6rem', fontFamily: 'var(--mono)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--terracotta)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    🎪 {dayEvents.length} recurring event{dayEvents.length !== 1 ? 's' : ''} on this {dayOfWeek}
                  </span>
                  <svg
                    width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="var(--terracotta)" strokeWidth={2.5} strokeLinecap="round"
                    style={{ transform: eventsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s', flexShrink: 0 }}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {/* Event cards — shown only when expanded */}
                {eventsOpen && dayEvents.map((event, i) => (
                  <EventSuggestionCard
                    key={event.id ?? i}
                    event={event}
                    onAdd={(slot) => onAddEvent(day.id, event, slot)}
                  />
                ))}
              </div>
            );
          })()}

          {/* Day summary footer */}
          {totalSpots > 0 && (
            <div style={{
              marginTop: 8, paddingTop: 8,
              borderTop: '1px solid var(--border)',
              display: 'flex', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                📍 {totalSpots} spot{totalSpots !== 1 ? 's' : ''}
              </span>
              {totalDuration > 0 && (
                <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                  ⏱ ~{fmtDuration(totalDuration)}
                </span>
              )}
              {totalDistKm > 0.1 && (
                <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                  🚶 ~{fmtKm(totalDistKm)}
                </span>
              )}
              {totalCost > 0 && (
                <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                  💶 ~€{totalCost}/pp
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── AccommodationField ────────────────────────────────────────────────────── */
// Compact input with live Mapbox autocomplete (addresses + POIs).
// Typing a hotel name, street address, or neighbourhood surfaces real suggestions
// with exact coordinates — no guessing from raw text.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

async function fetchAccomSuggestions(query) {
  if (!query || query.length < 2 || !MAPBOX_TOKEN) return [];
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?types=address,poi&limit=6&access_token=${MAPBOX_TOKEN}`;
    const res  = await fetch(url);
    const data = await res.json();
    return (data.features ?? []).map((f) => ({
      name:      f.text,
      fullName:  f.place_name,
      lat:       f.center[1],
      lng:       f.center[0],
    }));
  } catch { return []; }
}

function AccommodationField({ tripId, initial }) {
  const [value,    setValue]    = useState(initial?.address ?? '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(!!initial?.address);
  const [editing,  setEditing]  = useState(!initial?.address);
  const [suggs,    setSuggs]    = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (initial?.address && !editing) { setValue(initial.address); setSaved(true); }
  }, [initial?.address]); // eslint-disable-line

  function onType(val) {
    setValue(val); setSaved(false);
    clearTimeout(debRef.current);
    if (val.length < 2) { setSuggs([]); setShowSugg(false); return; }
    debRef.current = setTimeout(async () => {
      const results = await fetchAccomSuggestions(val);
      setSuggs(results);
      setShowSugg(results.length > 0);
    }, 260);
  }

  async function pickSuggestion(s) {
    setValue(s.fullName);
    setSuggs([]); setShowSugg(false);
    setSaving(true);
    try {
      await updateTripAccommodation(tripId, { address: s.fullName, lat: s.lat, lng: s.lng });
      setSaved(true); setEditing(false);
    } catch (err) { console.error('[AccommodationField]', err); }
    finally { setSaving(false); }
  }

  async function saveRaw() {
    if (!value.trim()) { await updateTripAccommodation(tripId, null); setSaved(false); return; }
    setSaving(true);
    try {
      // Last-chance geocode for typed text that wasn't picked from suggestions
      const results = await fetchAccomSuggestions(value);
      const best = results[0];
      await updateTripAccommodation(tripId, best
        ? { address: best.fullName, lat: best.lat, lng: best.lng }
        : { address: value.trim(), lat: null, lng: null });
      if (best) setValue(best.fullName);
      setSaved(true); setEditing(false);
    } catch (err) { console.error('[AccommodationField]', err); }
    finally { setSaving(false); }
  }

  // Saved / display state
  if (!editing && saved) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <HouseIcon />
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <button type="button" onClick={() => { setEditing(true); setSuggs([]); setShowSugg(false); }}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0, padding: '2px 4px' }}>
          Edit
        </button>
      </div>
    );
  }

  // Editing / input state
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <HouseIcon />
        <input
          type="text"
          placeholder="Hotel name, address, or neighbourhood…"
          value={value}
          onChange={e => onType(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { setShowSugg(false); saveRaw(); }
            if (e.key === 'Escape') { setShowSugg(false); setEditing(false); setValue(initial?.address ?? ''); }
          }}
          onBlur={() => setTimeout(() => setShowSugg(false), 180)}
          style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: '0.78rem', outline: 'none', minWidth: 0 }}
          autoFocus={editing && !!initial?.address}
        />
        <button type="button" disabled={saving} onClick={saveRaw}
          style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? '…' : 'Set'}
        </button>
      </div>

      {/* Autocomplete dropdown */}
      {showSugg && suggs.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          {suggs.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => pickSuggestion(s)}
              style={{ width: '100%', padding: '9px 12px', background: 'none', border: 'none', borderBottom: i < suggs.length - 1 ? '1px solid var(--border)' : 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.fullName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   DaysBuilder — main export
══════════════════════════════════════════════════════════════════════════════ */
export default function DaysBuilder({
  days,
  daysLoading,
  spots,
  savedIds,
  city,
  tripId,
  trip,
  accommodation,     // live accommodation state from page.js (overrides trip.accommodation)
  selectedDest,
  user,
  onRefetch,
  onSwitchToResearch,
  onToggleSave,
  toast,
  events = [],       // recurring events (Glasgow only)
}) {
  // Resolve accommodation — prefer the live prop (instantly updated on save)
  // fall back to trip.accommodation for backward compatibility
  const resolvedAccommodation = accommodation ?? trip?.accommodation ?? null;
  /* ── Slot state (mirrors days prop, optimistically updated by DnD) ───────── */
  const [allSlots_, setAllSlots_] = useState(() => initSlots(days));
  const allSlotsRef = useRef(allSlots_);
  const setAllSlots = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(allSlotsRef.current) : updater;
    allSlotsRef.current = next;
    setAllSlots_(next);
  }, []);

  // Re-sync when days prop changes (after refetch)
  useEffect(() => {
    const fresh = initSlots(days);
    allSlotsRef.current = fresh;
    setAllSlots_(fresh);
  }, [days]);

  /* ── Spot lookup map ─────────────────────────────────────────────────────── */
  const spotMap = useMemo(() => Object.fromEntries(spots.map(s => [s.id, s])), [spots]);

  /* ── Spot IDs already placed (for dimming in picker) ────────────────────── */
  const addedSpotIds = useMemo(() => {
    const ids = new Set();
    Object.values(allSlots_).forEach(day => {
      SLOTS.forEach(slot => { (day[slot] ?? []).forEach(s => ids.add(s.id)); });
    });
    return ids;
  }, [allSlots_]);

  /* ── Touch + mobile detection ───────────────────────────────────────────── */
  const [isTouch,  setIsTouch]  = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqTouch  = window.matchMedia('(pointer: coarse)');
    const mqMobile = window.matchMedia('(max-width: 700px)');
    setIsTouch(mqTouch.matches);
    setIsMobile(mqMobile.matches);
    const onTouch  = (e) => setIsTouch(e.matches);
    const onMobile = (e) => setIsMobile(e.matches);
    mqTouch.addEventListener('change', onTouch);
    mqMobile.addEventListener('change', onMobile);
    return () => {
      mqTouch.removeEventListener('change', onTouch);
      mqMobile.removeEventListener('change', onMobile);
    };
  }, []);

  /* ── Tap-to-place state (touch only) ─────────────────────────────────────── */
  const [placingSpot, setPlacingSpot] = useState(null); // spot selected for placement

  /* ── Plan view toggle ('list' | 'map') ──────────────────────────────────── */
  const [planView, setPlanView] = useState('list');

  /* ── Generate itinerary modal ───────────────────────────────────────────── */
  const [genModalOpen,      setGenModalOpen]      = useState(false);
  const [genSelectedDayIds, setGenSelectedDayIds] = useState(new Set());
  const [generating,        setGenerating]        = useState(false);
  const [genError,          setGenError]          = useState(null);

  /* ── Mobile panel toggle ('picker' | 'planner') ─────────────────────────── */
  const [mobilePanel, setMobilePanel] = useState('planner');

  /* ── Add-to-plan bottom sheet ────────────────────────────────────────────── */
  const [sheetSpot,      setSheetSpot]      = useState(null); // spot being scheduled
  const [sheetDayId,     setSheetDayId]     = useState(null); // expanded day row

  /* ── Filters sheet (mobile) ──────────────────────────────────────────────── */
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);

  /* ── Picker state ────────────────────────────────────────────────────────── */
  const [pickerMode,       setPickerMode]       = useState('starred'); // 'starred' | 'all'
  const [pickerSearch,     setPickerSearch]     = useState('');
  const [pickerCategories_, setPickerCategories_] = useState(new Set()); // multi-select
  const [pickerMinScore,   setPickerMinScore]   = useState(0);

  // Reset filters (and any active placing) when mode toggles
  useEffect(() => { setPickerCategories_(new Set()); setPickerMinScore(0); setPlacingSpot(null); }, [pickerMode]);

  /* ── Adding guard — prevents double-write on rapid clicks or drag+click ─── */
  const addingRef = useRef(new Set()); // Set of spotIds currently being added

  /* ── DnD active item (for overlay) ──────────────────────────────────────── */
  const [activeItem, setActiveItem] = useState(null); // { type: 'picker'|'placed', spot }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ── DnD helpers ─────────────────────────────────────────────────────────── */
  function findInSlots(dayPlanSpotId, src = allSlotsRef.current) {
    for (const dayId of Object.keys(src)) {
      for (const slot of SLOTS) {
        const arr = src[dayId]?.[slot] ?? [];
        const idx = arr.findIndex(s => s.dayPlanSpotId === dayPlanSpotId);
        if (idx >= 0) return { dayId, slot, idx };
      }
    }
    return null;
  }

  function resolveContainer(id, src = allSlotsRef.current) {
    const s = String(id);
    if (s.startsWith('zone__')) {
      const parts = s.split('__');
      return { dayId: parts[1], slot: parts[2] };
    }
    const loc = findInSlots(s, src);
    return loc ? { dayId: loc.dayId, slot: loc.slot } : null;
  }

  /* ── DnD event handlers ──────────────────────────────────────────────────── */
  function onDragStart({ active }) {
    const id = String(active.id);
    if (id.startsWith('pick__')) {
      const spot = spotMap[id.replace('pick__', '')];
      setActiveItem({ type: 'picker', spot });
    } else {
      const loc = findInSlots(id);
      if (loc) {
        const spot = allSlotsRef.current[loc.dayId][loc.slot][loc.idx];
        setActiveItem({ type: 'placed', spot });
      }
    }
  }

  function onDragOver({ active, over }) {
    if (!over) return;
    const activeId = String(active.id);
    if (activeId.startsWith('pick__')) return; // picker drops handled in onDragEnd

    // Current location of the dragged item
    let srcDayId, srcSlot;
    for (const dayId of Object.keys(allSlotsRef.current)) {
      for (const s of SLOTS) {
        if ((allSlotsRef.current[dayId]?.[s] ?? []).some(sp => sp.dayPlanSpotId === activeId)) {
          srcDayId = dayId; srcSlot = s;
          break;
        }
      }
      if (srcDayId) break;
    }
    if (!srcDayId) return;

    const tgt = resolveContainer(over.id);
    if (!tgt || (tgt.dayId === srcDayId && tgt.slot === srcSlot)) return;

    // Optimistic cross-container move
    setAllSlots(prev => {
      const spot = prev[srcDayId]?.[srcSlot]?.find(sp => sp.dayPlanSpotId === activeId);
      if (!spot) return prev;
      return {
        ...prev,
        [srcDayId]: { ...prev[srcDayId], [srcSlot]: prev[srcDayId][srcSlot].filter(sp => sp.dayPlanSpotId !== activeId) },
        [tgt.dayId]: { ...prev[tgt.dayId], [tgt.slot]: [...(prev[tgt.dayId]?.[tgt.slot] ?? []), { ...spot, timeOfDay: tgt.slot }] },
      };
    });
  }

  async function onDragEnd({ active, over }) {
    setActiveItem(null);

    if (!over) {
      // Cancelled — restore from props
      setAllSlots(initSlots(days));
      return;
    }

    const activeId = String(active.id);
    const overId   = String(over.id);

    // ── Case 1: Picker drop ─────────────────────────────────────────────────
    if (activeId.startsWith('pick__')) {
      const spotId = activeId.replace('pick__', '');
      const tgt    = resolveContainer(overId);
      if (!tgt) return;
      const day = days.find(d => d.id === tgt.dayId);
      if (!day) return;
      const addKey = `${spotId}:${tgt.slot}`;
      if (addingRef.current.has(addKey)) return; // in-flight guard
      addingRef.current.add(addKey);
      try {
        await addSpotToDayPlan(day.id, spotId, city, tgt.slot);
        onRefetch();
      } catch (err) {
        console.error('[DaysBuilder] addSpotToDayPlan:', err);
        toast?.error?.('Failed to add spot');
      } finally {
        addingRef.current.delete(addKey);
      }
      return;
    }

    // ── Case 2: Placed spot drop ────────────────────────────────────────────
    // Find current location after any onDragOver moves
    let srcDayId, srcSlot;
    for (const dayId of Object.keys(allSlotsRef.current)) {
      for (const s of SLOTS) {
        if ((allSlotsRef.current[dayId]?.[s] ?? []).some(sp => sp.dayPlanSpotId === activeId)) {
          srcDayId = dayId; srcSlot = s;
          break;
        }
      }
      if (srcDayId) break;
    }
    if (!srcDayId) return;

    const tgt = resolveContainer(overId);
    if (!tgt) return;

    // Same container + dropped on another spot → apply arrayMove
    if (tgt.dayId === srcDayId && tgt.slot === srcSlot && !overId.startsWith('zone__')) {
      setAllSlots(prev => {
        const items  = prev[tgt.dayId][tgt.slot];
        const oldIdx = items.findIndex(s => s.dayPlanSpotId === activeId);
        const newIdx = items.findIndex(s => s.dayPlanSpotId === overId);
        if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return prev;
        return { ...prev, [tgt.dayId]: { ...prev[tgt.dayId], [tgt.slot]: arrayMove(items, oldIdx, newIdx) } };
      });
    }

    // Persist entire state to Firestore
    setTimeout(async () => {
      try {
        const writes = [];
        for (const dayId of Object.keys(allSlotsRef.current)) {
          for (const slot of SLOTS) {
            (allSlotsRef.current[dayId]?.[slot] ?? []).forEach((sp, idx) => {
              writes.push(updateDayPlanSpotSlot(sp.dayPlanSpotId, slot, idx));
            });
          }
        }
        await Promise.all(writes);
      } catch (err) {
        console.error('[DaysBuilder] persist error:', err);
      }
    }, 0);
  }

  /* ── Remove spot ─────────────────────────────────────────────────────────── */
  async function handleRemove(dayPlanSpotId) {
    // Optimistic remove
    setAllSlots(prev => {
      const next = {};
      for (const dayId of Object.keys(prev)) {
        next[dayId] = {};
        for (const slot of SLOTS) {
          next[dayId][slot] = (prev[dayId]?.[slot] ?? []).filter(s => s.dayPlanSpotId !== dayPlanSpotId);
        }
      }
      return next;
    });
    try {
      await removeDayPlanSpot(dayPlanSpotId);
    } catch (err) {
      console.error('[DaysBuilder] remove error:', err);
      onRefetch(); // restore on failure
    }
  }

  /* ── Picker quick-add (click) → Day 1, Morning ───────────────────────────── */
  async function handlePickerAdd(spot) {
    const firstDay = days[0];
    if (!firstDay) return;
    const addKey = `${spot.id}:morning`;
    if (addingRef.current.has(addKey)) return; // in-flight guard
    addingRef.current.add(addKey);
    try {
      await addSpotToDayPlan(firstDay.id, spot.id, city, 'morning');
      onRefetch();
    } catch (err) {
      console.error('[DaysBuilder] quickAdd error:', err);
    } finally {
      addingRef.current.delete(addKey);
    }
  }

  /* ── Touch: tap-to-place handler ────────────────────────────────────────── */
  async function handlePlaceSpot(dayId, slot) {
    if (!placingSpot) return;
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    const addKey = `${placingSpot.id}:${slot}`;
    if (addingRef.current.has(addKey)) return;
    addingRef.current.add(addKey);
    const spotToPlace = placingSpot;
    setPlacingSpot(null); // clear immediately for snappy UX
    try {
      await addSpotToDayPlan(day.id, spotToPlace.id, city, slot);
      onRefetch();
      toast?.success?.(`${spotToPlace.name} added to Day ${day.dayNumber}`);
    } catch (err) {
      console.error('[DaysBuilder] placeSpot error:', err);
      toast?.error?.('Failed to add spot');
    } finally {
      addingRef.current.delete(addKey);
    }
  }

  /* ── Touch: select spot for placing; auto-navigate to planner on mobile ─── */
  function handleSelectForPlace(spot) {
    setPlacingSpot(spot);
    if (spot !== null && isMobile) setMobilePanel('planner');
  }

  /* ── Add recurring event to a day slot ──────────────────────────────────── */
  async function handleAddEvent(dayId, event, slot) {
    try {
      await addEventToDayPlan(dayId, event, city, slot);
      onRefetch();
      toast?.success?.(`${event.name} added to plan`);
    } catch (err) {
      console.error('[DaysBuilder] addEventToDayPlan:', err);
      toast?.error?.('Failed to add event');
    }
  }

  /* ── Bottom sheet: open (auto-expands first day) ─────────────────────────── */
  function handleOpenSheet(spot) {
    setSheetSpot(spot);
    setSheetDayId(days[0]?.id ?? null); // pre-expand first day for one-less-tap
  }

  /* ── Bottom sheet: place the spot ───────────────────────────────────────── */
  async function handleSheetPlace(dayId, slot) {
    if (!sheetSpot) return;
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    const addKey = `${sheetSpot.id}:${slot}`;
    if (addingRef.current.has(addKey)) return;
    addingRef.current.add(addKey);
    const spotToAdd = sheetSpot;
    setSheetSpot(null); // close sheet immediately (snappy)
    setSheetDayId(null);
    try {
      await addSpotToDayPlan(day.id, spotToAdd.id, city, slot);
      onRefetch();
      toast?.success?.(`${spotToAdd.name} → Day ${day.dayNumber} ${SLOT_LABEL[slot]}`);
    } catch (err) {
      console.error('[DaysBuilder] sheetPlace error:', err);
      toast?.error?.('Failed to add spot');
    } finally {
      addingRef.current.delete(addKey);
    }
  }

  /* ── Bottom sheet: "Just save it" (star without scheduling) ─────────────── */
  function handleSheetSave() {
    if (!sheetSpot) return;
    const already = savedIds.has(sheetSpot.id);
    if (!already && onToggleSave) onToggleSave(sheetSpot, true);
    const name = sheetSpot.name;
    setSheetSpot(null);
    setSheetDayId(null);
    toast?.success?.(already ? `${name} already saved` : `${name} saved ★`);
  }

  /* ── Picker list ─────────────────────────────────────────────────────────── */
  const pickerBase = useMemo(
    () => pickerMode === 'starred' ? spots.filter(s => savedIds.has(s.id)) : spots,
    [spots, savedIds, pickerMode],
  );

  const availableCategories = useMemo(
    () => [...new Set(pickerBase.map(s => s.category).filter(Boolean))].sort(),
    [pickerBase],
  );

  const pickerSpots = useMemo(() => {
    let s = pickerBase;
    if (pickerCategories_.size > 0) s = s.filter(sp => pickerCategories_.has(sp.category ?? ''));
    if (pickerMinScore > 0) s = s.filter(sp => (sp.hiddennessScore ?? 1) >= pickerMinScore);
    const q = pickerSearch.toLowerCase().trim();
    if (q) s = s.filter(sp => sp.name?.toLowerCase().includes(q) || sp.category?.toLowerCase().includes(q));
    return [...s].sort((a, b) => (b.hiddennessScore ?? 0) - (a.hiddennessScore ?? 0));
  }, [pickerBase, pickerCategories_, pickerMinScore, pickerSearch]);

  /* ── Totals ─────────────────────────────────────────────────────────────── */
  const totalSpots = useMemo(() =>
    Object.values(allSlots_).reduce((sum, d) => sum + SLOTS.reduce((s, sl) => s + (d[sl]?.length ?? 0), 0), 0),
    [allSlots_]
  );
  const totalCost = useMemo(() =>
    Object.values(allSlots_).reduce((sum, d) => sum + SLOTS.flatMap(sl => d[sl] ?? []).reduce((s, sp) => s + getNumericPrice(sp), 0), 0),
    [allSlots_]
  );

  /* ── Loading / no-days states ────────────────────────────────────────────── */
  if (daysLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: '20px', overflowY: 'auto' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 100, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
    );
  }

  if (!days.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📅</div>
        <h3>No day plans yet</h3>
        <p>Create a trip with dates to auto-generate day slots, then tap + on any spot to add it.</p>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <><DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {/* Tapping outside picker/slots cancels placing mode */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden', minHeight: 0 }}
        onClick={() => { if (placingSpot) setPlacingSpot(null); }}
      >

        {/* ── Mobile tab bar — Spots ↔ Plan ─────────────────────────────── */}
        {isMobile && (
          <div style={{
            flexShrink: 0, display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}>
            {[
              { id: 'picker',  label: '★ Spots',   count: pickerSpots.length },
              { id: 'planner', label: '📅 Plan',    count: totalSpots || null },
            ].map(({ id, label, count }) => {
              const active = mobilePanel === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMobilePanel(id); }}
                  style={{
                    flex: 1, padding: '11px 8px',
                    border: 'none', borderBottom: active ? '2px solid var(--terracotta)' : '2px solid transparent',
                    background: 'transparent',
                    color: active ? 'var(--ink)' : 'var(--muted)',
                    fontSize: '0.8rem', fontWeight: active ? 700 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}
                >
                  {label}
                  {count != null && count > 0 && (
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700,
                      background: active ? 'var(--terracotta)' : 'var(--line-strong)',
                      color: active ? '#fff' : 'var(--muted)',
                      padding: '1px 6px', borderRadius: 9,
                      transition: 'all 0.15s',
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ══ Left: Spot Picker ════════════════════════════════════════════ */}
        <div style={{
          ...(isMobile
            ? { flex: 1, width: '100%', display: mobilePanel === 'picker' ? 'flex' : 'none' }
            : { width: 300, flexShrink: 0, display: 'flex', borderRight: '1px solid var(--border)' }
          ),
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}>
          {/* Starred / All toggle */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {[['starred', '★ Starred'], ['all', '☰ All spots']].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPickerMode(mode)}
                  style={{
                    flex: 1, padding: '6px 8px', border: 'none',
                    background: pickerMode === mode ? 'var(--accent-dim)' : 'transparent',
                    color: pickerMode === mode ? 'var(--accent)' : 'var(--muted)',
                    fontSize: '0.73rem', fontWeight: pickerMode === mode ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Search + Filters button */}
          {(() => {
            const activeFilterCount = pickerCategories_.size + (pickerMinScore > 0 ? 1 : 0);
            return (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 7, alignItems: 'center' }}>
                {/* Search input */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0, color: 'var(--muted)' }}>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search spots…"
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: '0.78rem', outline: 'none' }}
                  />
                  {pickerSearch && (
                    <button type="button" onClick={() => setPickerSearch('')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>

                {/* Filters button — mobile only */}
                {isMobile && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFiltersSheetOpen(true); }}
                    style={{
                      flexShrink: 0, height: 32, padding: '0 11px',
                      border: `1.5px solid ${activeFilterCount > 0 ? 'var(--terracotta)' : 'var(--border)'}`,
                      borderRadius: 8,
                      background: activeFilterCount > 0 ? 'color-mix(in oklch, var(--terracotta) 9%, transparent)' : 'transparent',
                      color: activeFilterCount > 0 ? 'var(--terracotta)' : 'var(--muted)',
                      fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                      <path d="M4 6h16M7 12h10M10 18h4"/>
                    </svg>
                    {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : 'Filters'}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Category + score chips — desktop only */}
          {!isMobile && availableCategories.length > 1 && (
            <div style={{ padding: '6px 12px 5px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <button type="button" className={'chip' + (pickerCategories_.size === 0 ? ' on' : '')} onClick={() => setPickerCategories_(new Set())} style={{ fontSize: '0.67rem', padding: '4px 10px' }}>All</button>
                {availableCategories.map(cat => (
                  <button key={cat} type="button"
                    className={'chip' + (pickerCategories_.has(cat) ? ' on' : '')}
                    onClick={() => setPickerCategories_(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; })}
                    style={{ fontSize: '0.67rem', padding: '4px 10px' }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isMobile && (
            <div style={{ padding: '5px 12px 5px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[{ label: 'All scores', min: 0 }, { label: '5+ Secret', min: 5 }, { label: '7+ Radar', min: 7 }, { label: '9+ Ultra', min: 9 }].map(({ label, min }) => (
                  <button key={min} type="button"
                    className={'chip' + (pickerMinScore === min ? ' on' : '')}
                    onClick={() => setPickerMinScore(pickerMinScore === min && min !== 0 ? 0 : min)}
                    style={{ fontSize: '0.67rem', padding: '4px 10px' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Spot list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {pickerSpots.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--muted)' }}>
                {pickerMode === 'starred' ? (
                  <>
                    <div style={{ fontSize: '1.8rem', marginBottom: 10 }}>★</div>
                    <p style={{ fontSize: '0.8rem', lineHeight: 1.6, marginBottom: 6, color: 'var(--ink)' }}>
                      No saved spots yet.
                    </p>
                    <p style={{ fontSize: '0.75rem', lineHeight: 1.65, marginBottom: 14, color: 'var(--muted)', maxWidth: 200, margin: '0 auto 14px' }}>
                      ★ Save spots you like, then add them to a day to build your itinerary.
                    </p>
                    <button
                      type="button"
                      onClick={onSwitchToResearch}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      ← Go to Research
                    </button>
                  </>
                ) : (
                  <p style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>No spots match your search.</p>
                )}
              </div>
            ) : (
              pickerSpots.map(spot => (
                <PickerSpot
                  key={spot.id}
                  spot={spot}
                  isAdded={addedSpotIds.has(spot.id)}
                  onAdd={handleOpenSheet}
                  isTouch={isTouch}
                  placing={placingSpot?.id === spot.id}
                  onSelectForPlace={handleSelectForPlace}
                />
              ))
            )}
          </div>
        </div>

        {/* ══ Right: Day Planner ═══════════════════════════════════════════ */}
        <div style={{
          flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0,
          display: isMobile && mobilePanel !== 'planner' ? 'none' : 'flex',
        }}>

          {/* ── Placing banner (touch only) — visible when a spot is selected ── */}
          {isTouch && placingSpot && (
            <div style={{
              flexShrink: 0, padding: '8px 14px',
              background: 'color-mix(in oklch, var(--terracotta) 10%, var(--card))',
              borderBottom: '1px solid color-mix(in oklch, var(--terracotta) 22%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>📌</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--terracotta)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {placingSpot.name}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--muted)', marginTop: 1 }}>
                    Tap a slot to place it there
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPlacingSpot(null); }}
                style={{
                  flexShrink: 0, background: 'none', border: 'none',
                  color: 'var(--muted)', cursor: 'pointer',
                  fontSize: '1.15rem', lineHeight: 1, padding: '4px',
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Toolbar */}
          <div style={{
            flexShrink: 0, padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg)',
          }}>
            {/* List / Map toggle */}
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
              {[['list', '☰ List'], ['map', '🗺 Map']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setPlanView(v)}
                  style={{
                    padding: '5px 10px', border: 'none', fontSize: '0.73rem',
                    background: planView === v ? 'var(--accent-dim)' : 'transparent',
                    color:      planView === v ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: planView === v ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >{label}</button>
              ))}
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {totalSpots > 0 && (
                <>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {totalSpots} spot{totalSpots !== 1 ? 's' : ''} planned
                  </span>
                  {totalCost > 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>
                      ~€{totalCost}/pp
                    </span>
                  )}
                </>
              )}
            </div>

            {/* ✨ Generate itinerary */}
            <button
              type="button"
              onClick={() => {
                setGenSelectedDayIds(new Set(days.map((d) => d.id)));
                setGenError(null);
                setGenModalOpen(true);
              }}
              style={{
                padding: '6px 12px', borderRadius: 8,
                background: 'linear-gradient(135deg, color-mix(in oklch, var(--terracotta) 80%, #8b5cf6) 0%, #8b5cf6 100%)',
                border: 'none', color: '#fff',
                fontSize: '0.75rem', fontWeight: 700,
                cursor: 'pointer', transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              ✨ Generate
            </button>

            {/* PDF export */}
            <button
              type="button"
              onClick={async () => {
                try {
                  toast?.info?.('Generating PDF…');
                  await exportItineraryPDF({ days, allSlots: allSlotsRef.current, city, selectedDest, trip });
                  track('itinerary_exported', { tripId, dayCount: days.length });
                } catch (err) {
                  console.error('[DaysBuilder] PDF error:', err);
                  toast?.error?.('PDF export failed');
                }
              }}
              style={{
                padding: '6px 12px', borderRadius: 8,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
            >
              ⬇ PDF
            </button>

            {/* Save as template */}
            <button
              type="button"
              title="Share this itinerary as a community template"
              onClick={async () => {
                if (!selectedDest?.city || !user?.uid) return;
                try {
                  await saveTripAsTemplate(selectedDest.city, user.uid, days);
                  toast?.success?.('Template saved! Others planning ' + selectedDest.city + ' can discover it.');
                } catch (e) {
                  console.error(e);
                  toast?.error?.('Could not save template');
                }
              }}
              style={{
                padding: '6px 12px', borderRadius: 8,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
            >
              📋 Template
            </button>
          </div>

          {/* ── Itinerary map view ── */}
          {planView === 'map' && (
            <ItineraryMapView
              days={days}
              allSlots={allSlots_}
              dayColors={DAY_COLORS}
              accommodation={resolvedAccommodation}
              city={city}
            />
          )}

          {/* ── Day list view ── */}
          {planView === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {days.map((day, dayIndex) => (
                <DaySection
                  key={day.id}
                  day={day}
                  slots={allSlots_[day.id] ?? { morning: [], afternoon: [], evening: [] }}
                  onRemove={handleRemove}
                  isTouch={isTouch}
                  placingSpot={placingSpot}
                  onPlaceHere={handlePlaceSpot}
                  events={events}
                  onAddEvent={handleAddEvent}
                  dayColor={DAY_COLORS[dayIndex % DAY_COLORS.length]}
                  accommodation={resolvedAccommodation}
                />
              ))}

              {/* No spots yet */}
              {totalSpots === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>📅</div>
                  <p style={{ fontSize: '0.88rem', lineHeight: 1.7, marginBottom: 18, maxWidth: 320, margin: '0 auto 18px' }}>
                    Star spots in Research, then tap + on any spot to add it to your plan.
                  </p>
                  <button
                    type="button"
                    onClick={onSwitchToResearch}
                    style={{
                      background: 'var(--accent)', color: '#000', border: 'none',
                      borderRadius: 8, padding: '10px 22px', fontWeight: 600,
                      fontSize: '0.875rem', cursor: 'pointer',
                    }}
                  >
                    ← Research spots
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeItem?.type === 'picker' && activeItem.spot && <PickerSpotOverlay spot={activeItem.spot} />}
        {activeItem?.type === 'placed' && activeItem.spot && <PlacedSpotOverlay spot={activeItem.spot} />}
      </DragOverlay>
    </DndContext>

    {/* ── Filters bottom sheet (mobile) ────────────────────────────────── */}
    {filtersSheetOpen && (() => {
      const activeFilterCount = pickerCategories_.size + (pickerMinScore > 0 ? 1 : 0);
      return (
        <>
          <div
            onClick={() => setFiltersSheetOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          />
          <div
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
              background: 'var(--card)', borderRadius: '20px 20px 0 0',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.28)',
              animation: 'slideUp 0.22s ease',
              maxHeight: '80dvh', display: 'flex', flexDirection: 'column',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)' }}>Filters</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => { setPickerCategories_(new Set()); setPickerMinScore(0); }}
                    style={{ background: 'none', border: 'none', color: 'var(--terracotta)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: '2px 6px' }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFiltersSheetOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: '2px 4px' }}
                >×</button>
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>

              {/* Show: Starred / All */}
              <div style={{ padding: '14px 18px 10px' }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Show</div>
                <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {[['starred', '★ Starred'], ['all', '☰ All spots']].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPickerMode(mode)}
                      style={{
                        flex: 1, padding: '9px 8px', border: 'none',
                        background: pickerMode === mode ? 'var(--accent-dim)' : 'transparent',
                        color: pickerMode === mode ? 'var(--accent)' : 'var(--muted)',
                        fontSize: '0.78rem', fontWeight: pickerMode === mode ? 700 : 400,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories */}
              {availableCategories.length > 1 && (
                <div style={{ padding: '6px 18px 12px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '12px 0 10px' }}>Category</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button type="button" className={'chip' + (pickerCategories_.size === 0 ? ' on' : '')} onClick={() => setPickerCategories_(new Set())} style={{ fontSize: '0.74rem', padding: '6px 12px' }}>All</button>
                    {availableCategories.map(cat => (
                      <button key={cat} type="button"
                        className={'chip' + (pickerCategories_.has(cat) ? ' on' : '')}
                        onClick={() => setPickerCategories_(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; })}
                        style={{ fontSize: '0.74rem', padding: '6px 12px' }}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Score */}
              <div style={{ padding: '6px 18px 14px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '12px 0 10px' }}>Hiddenness score</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[{ label: 'All scores', min: 0 }, { label: '5+ Secret', min: 5 }, { label: '7+ Off-radar', min: 7 }, { label: '9+ Ultra hidden', min: 9 }].map(({ label, min }) => (
                    <button key={min} type="button"
                      className={'chip' + (pickerMinScore === min ? ' on' : '')}
                      onClick={() => setPickerMinScore(pickerMinScore === min && min !== 0 ? 0 : min)}
                      style={{ fontSize: '0.74rem', padding: '6px 12px' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Done button */}
            <div style={{ flexShrink: 0, padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setFiltersSheetOpen(false)}
                style={{
                  width: '100%', padding: '13px',
                  background: 'var(--terracotta)', color: '#fff',
                  border: 'none', borderRadius: 12,
                  fontSize: '0.9rem', fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {activeFilterCount > 0 ? `Show results · ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active` : 'Done'}
              </button>
            </div>
          </div>
        </>
      );
    })()}

    {/* ── Generate Itinerary Modal ─────────────────────────────────────── */}
    {genModalOpen && (
      <>
        <div
          onClick={() => { if (!generating) setGenModalOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: 'var(--card)', borderRadius: '20px 20px 0 0',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.35)',
            animation: 'slideUp 0.22s ease',
            maxHeight: '85dvh', display: 'flex', flexDirection: 'column',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span>✨</span> Generate Itinerary
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.55, maxWidth: 320 }}>
                  AI picks the best spots for each day — checking opening hours and clustering nearby places. Starred spots get priority.
                </p>
              </div>
              {!generating && (
                <button type="button" onClick={() => setGenModalOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, flexShrink: 0, padding: '2px 4px' }}>
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Day picker */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
              Which days should I plan?
            </div>

            {/* Select / deselect all */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button"
                onClick={() => setGenSelectedDayIds(new Set(days.map((d) => d.id)))}
                style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--muted)', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer' }}>
                All days
              </button>
              <button type="button"
                onClick={() => setGenSelectedDayIds(new Set())}
                style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--muted)', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer' }}>
                None
              </button>
            </div>

            {days.map((day, di) => {
              const isSelected = genSelectedDayIds.has(day.id);
              const dayColor   = DAY_COLORS[di % DAY_COLORS.length];
              const hasSpots   = Object.values(allSlots_[day.id] ?? {}).some((arr) => arr.length > 0);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => {
                    const next = new Set(genSelectedDayIds);
                    if (next.has(day.id)) next.delete(day.id);
                    else next.add(day.id);
                    setGenSelectedDayIds(next);
                  }}
                  style={{
                    width: '100%', marginBottom: 8, padding: '12px 14px',
                    borderRadius: 10,
                    borderTop:    `1.5px solid ${isSelected ? dayColor : 'var(--border)'}`,
                    borderRight:  `1.5px solid ${isSelected ? dayColor : 'var(--border)'}`,
                    borderBottom: `1.5px solid ${isSelected ? dayColor : 'var(--border)'}`,
                    borderLeft:   `4px solid ${dayColor}`,
                    background: isSelected ? `color-mix(in oklch, ${dayColor} 8%, var(--card))` : 'var(--card)',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSelected ? dayColor : 'var(--muted)'}`,
                    background: isSelected ? dayColor : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.12s',
                  }}>
                    {isSelected && (
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#000" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: isSelected ? 'var(--ink)' : 'var(--ink-soft)' }}>
                      Day {day.dayNumber}
                      {day.planDate && (
                        <span style={{ fontWeight: 400, fontSize: '0.76rem', color: 'var(--muted)', marginLeft: 7 }}>
                          · {fmtDayLabel(day.planDate)}
                        </span>
                      )}
                    </div>
                    {hasSpots && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 2 }}>
                        Already has spots · will be added to
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Info note */}
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'color-mix(in oklch, var(--ink) 4%, transparent)', border: '1px solid var(--line)' }}>
              <p style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--ink)' }}>Note:</strong> Generated spots are added alongside any existing ones. Places that are closed on that day are automatically skipped. You can always remove individual spots after.
              </p>
            </div>
          </div>

          {/* Error */}
          {genError && (
            <div style={{ padding: '10px 18px', background: 'color-mix(in oklch, var(--error) 7%, transparent)', borderTop: '1px solid color-mix(in oklch, var(--error) 20%, transparent)', flexShrink: 0 }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--error)', lineHeight: 1.5 }}>{genError}</p>
            </div>
          )}

          {/* Footer */}
          <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              disabled={generating || genSelectedDayIds.size === 0 || spots.length === 0}
              onClick={async () => {
                if (genSelectedDayIds.size === 0 || spots.length === 0 || generating) return;
                setGenerating(true);
                setGenError(null);
                try {
                  const selectedDays = days.filter((d) => genSelectedDayIds.has(d.id));
                  const res = await fetch('/api/generate-itinerary', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      city,
                      days: selectedDays,
                      spots,
                      accommodation: resolvedAccommodation,
                      savedSpotIds: [...savedIds], // starred spots get priority in the AI prompt
                    }),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error ?? `Generation failed (${res.status})`);
                  }
                  const { assignments } = await res.json();
                  if (!assignments?.length) throw new Error('AI returned no assignments. Try with more spots saved.');

                  // Apply assignments
                  let applied = 0;
                  for (const a of assignments) {
                    const day = days.find((d) => d.id === a.dayId);
                    if (!day) continue;
                    try {
                      await addSpotToDayPlan(a.dayId, a.spotId, city, a.slot);
                      applied++;
                    } catch { /* spot may already exist in plan */ }
                  }
                  onRefetch();
                  setGenModalOpen(false);
                  toast?.success?.(`✨ ${applied} spots added across ${genSelectedDayIds.size} day${genSelectedDayIds.size !== 1 ? 's' : ''}!`);
                } catch (err) {
                  console.error('[generate-itinerary]', err);
                  setGenError(err.message ?? 'Generation failed. Please try again.');
                } finally {
                  setGenerating(false);
                }
              }}
              style={{
                width: '100%', padding: '14px',
                background: generating || genSelectedDayIds.size === 0
                  ? 'var(--line)'
                  : 'linear-gradient(135deg, color-mix(in oklch, var(--terracotta) 80%, #8b5cf6) 0%, #8b5cf6 100%)',
                border: 'none', color: '#fff',
                borderRadius: 13,
                fontSize: '0.92rem', fontWeight: 700,
                cursor: generating || genSelectedDayIds.size === 0 ? 'not-allowed' : 'pointer',
                opacity: spots.length === 0 ? 0.4 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'opacity 0.15s',
              }}
            >
              {generating ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Generating…
                </>
              ) : spots.length === 0 ? (
                'Research spots first'
              ) : genSelectedDayIds.size === 0 ? (
                'Select at least one day'
              ) : (
                `✨ Generate itinerary for ${genSelectedDayIds.size} day${genSelectedDayIds.size !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>
      </>
    )}

    {/* ── Add-to-plan bottom sheet ──────────────────────────────────────── */}
    {sheetSpot && (() => {
      const level = getHiddennessLevel(sheetSpot.hiddennessScore ?? 1);
      const isSaved = savedIds.has(sheetSpot.id);
      return (
        <>
          {/* Backdrop */}
          <div
            onClick={() => { setSheetSpot(null); setSheetDayId(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(2px)' }}
          />

          {/* Sheet */}
          <div
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
              background: 'var(--card)', borderRadius: '20px 20px 0 0',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.30)',
              animation: 'slideUp 0.22s ease',
              maxHeight: '82dvh', display: 'flex', flexDirection: 'column',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '18px 18px 14px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <span style={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                background: level.color, color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.68rem', fontWeight: 700, marginTop: 2,
                boxShadow: `0 0 6px ${level.color}55`,
              }}>
                {sheetSpot.hiddennessScore ?? 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
                  {sheetSpot.name}
                </div>
                {sheetSpot.category && (
                  <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginTop: 3 }}>
                    {sheetSpot.category}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setSheetSpot(null); setSheetDayId(null); }}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: '2px 4px' }}
              >×</button>
            </div>

            {/* Day list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '12px 18px 6px' }}>
                Choose a day &amp; time
              </div>

              {days.map((day) => {
                const expanded = sheetDayId === day.id;
                return (
                  <div key={day.id}>
                    {/* Day row */}
                    <button
                      type="button"
                      onClick={() => setSheetDayId(expanded ? null : day.id)}
                      style={{
                        width: '100%', padding: '12px 18px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        border: 'none',
                        borderLeft: `3px solid ${expanded ? 'var(--terracotta)' : 'transparent'}`,
                        background: expanded ? 'color-mix(in oklch, var(--terracotta) 5%, var(--card))' : 'transparent',
                        cursor: 'pointer', transition: 'background 0.12s',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: expanded ? 700 : 500, color: expanded ? 'var(--terracotta)' : 'var(--ink)' }}>
                          Day {day.dayNumber}
                        </span>
                        {day.planDate && (
                          <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>
                            · {fmtDayLabel(day.planDate)}
                          </span>
                        )}
                      </div>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
                        style={{ color: 'var(--muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s', flexShrink: 0 }}>
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>

                    {/* Slot buttons — only when expanded */}
                    {expanded && (
                      <div style={{
                        display: 'flex', gap: 8, padding: '8px 18px 14px',
                        background: 'color-mix(in oklch, var(--terracotta) 3%, var(--card))',
                      }}>
                        {[
                          ['morning',   '🌅', 'Morning'],
                          ['afternoon', '☀️', 'Afternoon'],
                          ['evening',   '🌙', 'Evening'],
                        ].map(([slot, icon, label]) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => handleSheetPlace(day.id, slot)}
                            style={{
                              flex: 1, padding: '11px 6px',
                              border: '1.5px solid var(--terracotta)',
                              borderRadius: 11, background: 'transparent',
                              color: 'var(--terracotta)',
                              fontSize: '0.75rem', fontWeight: 600,
                              cursor: 'pointer', transition: 'all 0.12s',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--terracotta) 12%, transparent)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={{ fontSize: '1.05rem' }}>{icon}</span>
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Empty — no days planned yet */}
              {days.length === 0 && (
                <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem' }}>
                  No day plans yet.<br />Add dates to your trip to create day slots.
                </div>
              )}
            </div>

            {/* Footer — "Just save it" */}
            <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={handleSheetSave}
                style={{
                  width: '100%', padding: '12px',
                  background: isSaved ? 'color-mix(in oklch, var(--terracotta) 6%, transparent)' : 'transparent',
                  border: `1.5px solid ${isSaved ? 'var(--terracotta)' : 'var(--line-strong)'}`,
                  borderRadius: 12,
                  color: isSaved ? 'var(--terracotta)' : 'var(--ink-soft)',
                  fontSize: '0.84rem', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.14s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                }}
              >
                <span style={{ fontSize: '0.9rem' }}>{isSaved ? '★' : '☆'}</span>
                {isSaved ? 'Already saved' : 'Just save it'}
              </button>
            </div>
          </div>
        </>
      );
    })()}
    </>
  );
}
