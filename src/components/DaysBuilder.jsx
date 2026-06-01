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
import {
  addSpotToDayPlan,
  addEventToDayPlan,
  removeDayPlanSpot,
  updateDayPlanSpotSlot,
  saveTripAsTemplate,
} from '@/lib/db';
import { travelChip, haversineKm, fmtKm } from '@/lib/travelTime';
import { exportItineraryPDF } from '@/lib/pdfExport';
import { track } from '@/lib/analytics';

/* ── Constants ────────────────────────────────────────────────────────────── */
const SLOTS      = ['morning', 'afternoon', 'evening'];
const SLOT_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const SLOT_COLOR = { morning: '#f59e0b', afternoon: '#fb923c', evening: '#b45309' };

/* ── Category normalisation — collapses duplicate/mis-cased taxonomy ─────── */
const CATEGORY_ALIASES = {
  'museum': 'Museum', 'museums': 'Museum',
  'art': 'Art', 'art gallery': 'Art', 'gallery': 'Art', 'galleries': 'Art',
  'park': 'Park', 'park-green-space': 'Park', 'parks': 'Park', 'green space': 'Park',
  'garden': 'Garden', 'gardens': 'Garden',
  'restaurant': 'Restaurant', 'restaurants': 'Restaurant',
  'cafe': 'Café', 'café': 'Café', 'cafes': 'Café', 'cafés': 'Café',
  'coffee': 'Café', 'coffee shop': 'Café',
  'bar': 'Bar', 'bars': 'Bar',
  'street art': 'Street Art',
  'architecture': 'Architecture',
  'market': 'Market', 'markets': 'Market',
  'shop': 'Shop', 'shopping': 'Shop',
  'viewpoint': 'Viewpoint', 'vista': 'Viewpoint',
  'neighbourhood': 'Neighbourhood', 'neighborhood': 'Neighbourhood',
  'beach': 'Beach',
  'historic site': 'Historic Site', 'historic': 'Historic Site',
  'landmark': 'Landmark', 'monument': 'Landmark',
  'street food': 'Street Food',
  'nature': 'Nature',
  'temple': 'Temple', 'church': 'Church', 'cathedral': 'Cathedral',
  'nightlife': 'Nightlife',
  'cultural': 'Cultural', 'cultural site': 'Cultural',
  'theatre': 'Theatre', 'theater': 'Theatre',
};
function normalizeCategory(raw) {
  if (!raw) return '';
  const key = raw.toLowerCase().trim().replace(/_/g, ' ');
  return CATEGORY_ALIASES[key]
    ?? key.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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
            {spot.entryPrice != null ? (
              <span style={{ fontSize: '0.67rem', color: spot.entryPrice === 0 ? 'var(--teal, #22c55e)' : 'var(--muted)' }}>
                {spot.entryPrice === 0 ? 'Free' : `€${spot.entryPrice}`}
              </span>
            ) : null}
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
              {isPlacingActive ? '📌 Tap to add here' : isOver ? '📌 Drop here' : '+ Drag a spot here'}
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
function DaySection({ day, slots, onRemove, isTouch, placingSpot, onPlaceHere, events = [], onAddEvent }) {
  const [open, setOpen] = useState(true);

  const allSpots = SLOTS.flatMap(s => slots[s] ?? []);
  const totalSpots    = allSpots.length;
  const totalCost     = allSpots.reduce((s, sp) => s + (sp.entryPrice ?? 0), 0);
  const totalDuration = allSpots.reduce((s, sp) => s + (sp.visitDurationMinutes ?? 0), 0);

  let totalDistKm = 0;
  for (let i = 0; i < allSpots.length - 1; i++) {
    const a = allSpots[i], b = allSpots[i + 1];
    if (a.lat && a.lng && b.lat && b.lng && !a.coordsMissing && !b.coordsMissing) {
      totalDistKm += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }

  return (
    <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 10 }}>
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
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
            Day {day.dayNumber}
          </span>
          {day.planDate && (
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              · {fmtDayLabel(day.planDate)}
            </span>
          )}
          {totalSpots > 0 && (
            <span style={{ fontSize: '0.63rem', fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 7px', borderRadius: 10 }}>
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

          {/* ── Recurring events on this day ──────────────────────────── */}
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
                <div style={{
                  fontSize: '0.6rem', fontFamily: 'var(--mono)', letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--terracotta)', marginBottom: 8, fontWeight: 700,
                }}>
                  🎪 Recurring events on this {dayOfWeek}
                </div>
                {dayEvents.map((event, i) => (
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
  selectedDest,
  user,
  onRefetch,
  onSwitchToResearch,
  onToggleSave,
  toast,
  events = [],       // recurring events (Glasgow only)
}) {
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
    () => [...new Set(pickerBase.map(s => normalizeCategory(s.category)).filter(Boolean))].sort(),
    [pickerBase],
  );

  const pickerSpots = useMemo(() => {
    let s = pickerBase;
    if (pickerCategories_.size > 0) s = s.filter(sp => pickerCategories_.has(normalizeCategory(sp.category ?? '')));
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
    Object.values(allSlots_).reduce((sum, d) => sum + SLOTS.flatMap(sl => d[sl] ?? []).reduce((s, sp) => s + (sp.entryPrice ?? 0), 0), 0),
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
        <p>Create a trip with dates to auto-generate day slots, then drag your starred spots into them.</p>
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
                    <p style={{ fontSize: '0.8rem', lineHeight: 1.6, marginBottom: 14 }}>
                      No starred spots yet.<br />Star spots in Research to build your itinerary.
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

          {/* Scrollable day list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {days.map(day => (
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
              />
            ))}

            {/* No spots yet */}
            {totalSpots === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>📅</div>
                <p style={{ fontSize: '0.88rem', lineHeight: 1.7, marginBottom: 18, maxWidth: 320, margin: '0 auto 18px' }}>
                  Star spots in Research, then drag them from the sidebar into your day slots.
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
