'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
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
import { updateDayPlanSpotSlot } from '@/lib/db';

/* ── Constants ────────────────────────────────────────────────────────────── */
const SLOTS = ['morning', 'afternoon', 'evening'];
const SLOT_ICON  = { morning: '🌅', afternoon: '☀️', evening: '🌙' };
const SLOT_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function groupBySlotFn(spots) {
  return SLOTS.reduce((acc, slot) => {
    acc[slot] = spots.filter((s) => (s.timeOfDay ?? 'morning') === slot);
    return acc;
  }, {});
}

/* ── SpotRow (used in DragOverlay + SortableSpot) ─────────────────────────── */
function SpotRow({ spot, tripId, dragHandleProps = {}, isDragging = false }) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  const href  = `/spots/${spot.id}?city=${encodeURIComponent(spot.city ?? '')}&tripId=${tripId ?? ''}`;

  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:        10,
      padding:    '9px 11px',
      background: isDragging ? 'var(--card-hover)' : 'var(--bg)',
      borderRadius: 8,
      border:     `1px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
      boxShadow:  isDragging ? '0 8px 24px rgba(0,0,0,0.5)' : 'none',
      userSelect: 'none',
    }}>
      {/* Grip handle */}
      <div
        {...dragHandleProps}
        style={{
          flexShrink: 0, cursor: 'grab', color: 'var(--text-muted)',
          lineHeight: 1, padding: '2px 1px', touchAction: 'none',
          ...(dragHandleProps.style ?? {}),
        }}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" opacity="0.5">
          <circle cx="2.5" cy="2" r="1.5" />
          <circle cx="7.5" cy="2" r="1.5" />
          <circle cx="2.5" cy="7" r="1.5" />
          <circle cx="7.5" cy="7" r="1.5" />
          <circle cx="2.5" cy="12" r="1.5" />
          <circle cx="7.5" cy="12" r="1.5" />
        </svg>
      </div>

      {/* Hiddenness dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: level.color, flexShrink: 0,
        boxShadow: `0 0 4px ${level.color}60`,
      }} />

      {/* Name + label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}>
          {spot.name}
        </p>
        <p style={{ fontSize: '0.68rem', color: level.color, fontWeight: 500, marginTop: 1 }}>
          {level.label}
        </p>
      </div>

      {/* Price + link arrow */}
      {!isDragging && (
        <>
          {spot.entryPrice != null ? (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              €{spot.entryPrice}
            </span>
          ) : (
            <span style={{ fontSize: '0.7rem', color: 'var(--teal)', flexShrink: 0 }}>Free</span>
          )}
          <Link
            href={href}
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            ›
          </Link>
        </>
      )}
    </div>
  );
}

/* ── SortableSpot ─────────────────────────────────────────────────────────── */
function SortableSpot({ spot, tripId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: spot.dayPlanSpotId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform:  CSS.Transform.toString(transform),
        transition,
        opacity:    isDragging ? 0.3 : 1,
        marginBottom: 5,
      }}
    >
      <SpotRow
        spot={spot}
        tripId={tripId}
        isDragging={false}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/* ── DroppableSection ─────────────────────────────────────────────────────── */
function DroppableSection({ slot, spots, tripId }) {
  const { setNodeRef, isOver } = useDroppable({ id: slot });
  const isEmpty = spots.length === 0;

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Slot header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
      }}>
        <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>{SLOT_ICON[slot]}</span>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {SLOT_LABEL[slot]}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {spots.length > 0 ? `${spots.length} spot${spots.length !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          minHeight:    isEmpty ? 44 : 'auto',
          borderRadius: 8,
          border:       isEmpty ? `1px dashed ${isOver ? 'var(--accent)' : 'var(--border)'}` : 'none',
          background:   isOver ? 'rgba(245,158,11,0.04)' : 'transparent',
          padding:      isEmpty ? '0' : '0',
          transition:   'background 0.15s, border-color 0.15s',
          display:      'flex',
          flexDirection: 'column',
          alignItems:   isEmpty ? 'center' : 'stretch',
          justifyContent: isEmpty ? 'center' : 'flex-start',
        }}
      >
        <SortableContext
          items={spots.map((s) => s.dayPlanSpotId)}
          strategy={verticalListSortingStrategy}
        >
          {spots.map((spot) => (
            <SortableSpot key={spot.dayPlanSpotId} spot={spot} tripId={tripId} />
          ))}
        </SortableContext>

        {isEmpty && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '10px 8px',
          }}>
            <span style={{ fontSize: '0.68rem', color: isOver ? 'var(--accent)' : 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', lineHeight: 1.5 }}>
              {isOver ? '📌 Drop here' : '＋ Drag a spot here'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── DayPlanColumn ────────────────────────────────────────────────────────── */
export default function DayPlanColumn({ day, tripId, onAddSpot }) {
  const [open, setOpen] = useState(true);

  // Slot state with ref so drag handlers always get fresh data
  const [slots, setSlots_] = useState(() => groupBySlotFn(day.spots));
  const slotsRef = useRef(slots);
  const setSlots = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(slotsRef.current) : updater;
    slotsRef.current = next;
    setSlots_(next);
  }, []);

  // Re-sync when day.spots prop changes (e.g. after refetch)
  useEffect(() => {
    const fresh = groupBySlotFn(day.spots);
    slotsRef.current = fresh;
    setSlots_(fresh);
  }, [day.spots]);

  // Track currently dragged spot for overlay
  const [activeSpot, setActiveSpot] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findSlot(id) {
    for (const slot of SLOTS) {
      if (slotsRef.current[slot].some((s) => s.dayPlanSpotId === id)) return slot;
    }
    return null;
  }

  function onDragStart({ active }) {
    const slot = findSlot(active.id);
    if (!slot) return;
    setActiveSpot(slotsRef.current[slot].find((s) => s.dayPlanSpotId === active.id) ?? null);
  }

  function onDragOver({ active, over }) {
    if (!over) return;
    const activeSlot = findSlot(active.id);
    // Over.id could be a spot ID or a slot name
    const overSlot = SLOTS.includes(over.id) ? over.id : findSlot(over.id);
    if (!activeSlot || !overSlot || activeSlot === overSlot) return;

    setSlots((prev) => {
      const spot = prev[activeSlot].find((s) => s.dayPlanSpotId === active.id);
      if (!spot) return prev;
      return {
        ...prev,
        [activeSlot]: prev[activeSlot].filter((s) => s.dayPlanSpotId !== active.id),
        [overSlot]:   [...prev[overSlot], { ...spot, timeOfDay: overSlot }],
      };
    });
  }

  async function onDragEnd({ active, over }) {
    setActiveSpot(null);
    if (!over || active.id === over.id) return;

    const activeSlot = findSlot(active.id);
    const overSlot   = findSlot(over.id);

    // Reorder within same slot
    if (activeSlot && overSlot && activeSlot === overSlot) {
      setSlots((prev) => {
        const items   = prev[activeSlot];
        const oldIdx  = items.findIndex((s) => s.dayPlanSpotId === active.id);
        const newIdx  = items.findIndex((s) => s.dayPlanSpotId === over.id);
        if (oldIdx < 0 || newIdx < 0) return prev;
        return { ...prev, [activeSlot]: arrayMove(items, oldIdx, newIdx) };
      });
    }

    // Persist all slots to Firestore
    // Small delay so the state settles after arrayMove
    setTimeout(async () => {
      try {
        await Promise.all(
          SLOTS.flatMap((slot) =>
            slotsRef.current[slot].map((spot, idx) =>
              updateDayPlanSpotSlot(spot.dayPlanSpotId, slot, idx)
            )
          )
        );
      } catch (err) {
        console.error('[DayPlanColumn] persist error:', err);
      }
    }, 0);
  }

  const dayLabel  = fmtDate(day.planDate);
  const totalSpots = SLOTS.reduce((n, s) => n + slots[s].length, 0);
  const totalCost  = SLOTS.flatMap((s) => slots[s]).reduce((sum, s) => sum + (s.entryPrice ?? 0), 0);

  return (
    <div style={{
      background:   'var(--card)',
      borderRadius: 12,
      border:       '1px solid var(--border)',
      overflow:     'hidden',
    }}>
      {/* Day header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', background: 'none', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            Day {day.dayNumber}
          </span>
          {dayLabel && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{dayLabel}</span>
          )}
          {totalSpots > 0 && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 600,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              padding: '2px 6px', borderRadius: 10,
            }}>
              {totalSpots}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalCost > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>~€{totalCost}/pp</span>
          )}
          <svg
            width="12" height="12" fill="none" viewBox="0 0 24 24"
            stroke="var(--text-muted)" strokeWidth={2.5}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '14px 14px 10px' }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            {SLOTS.map((slot) => (
              <DroppableSection
                key={slot}
                slot={slot}
                spots={slots[slot]}
                tripId={tripId}
                dayId={day.id}
                dayNumber={day.dayNumber}
              />
            ))}

            {/* Drag overlay (floating ghost) */}
            <DragOverlay>
              {activeSpot ? (
                <SpotRow spot={activeSpot} tripId={tripId} isDragging />
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Add spot button */}
          <button
            type="button"
            onClick={() => onAddSpot?.(day.id, day.dayNumber)}
            style={{
              width: '100%', padding: '9px', marginTop: 6,
              background: 'transparent', border: '1px dashed var(--border)',
              borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.78rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 5, transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            + Add spot to Day {day.dayNumber}
          </button>
        </div>
      )}
    </div>
  );
}
