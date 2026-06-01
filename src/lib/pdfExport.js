// src/lib/pdfExport.js
// Proper jsPDF document export — not a screenshot.
// Generates a readable A4 itinerary with branding, day sections, spot details, and travel chips.

import { travelChip } from './travelTime';

const SLOTS      = ['morning', 'afternoon', 'evening'];
const SLOT_LABEL = { morning: 'MORNING', afternoon: 'AFTERNOON', evening: 'EVENING' };

function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', opts);
}

/**
 * Export the full itinerary as a PDF file.
 *
 * @param {object} params
 * @param {Array}  params.days        — from useDayPlanner
 * @param {object} params.allSlots    — { [dayId]: { morning, afternoon, evening } }
 * @param {string} params.city        — city name for filename + header
 * @param {object} params.selectedDest — destination doc with startDate / endDate
 * @param {object} params.trip        — trip doc (name, etc.)
 */
export async function exportItineraryPDF({ days, allSlots, city, selectedDest, trip }) {
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Layout constants
  const PW  = 210;          // page width
  const PH  = 297;          // page height
  const M   = 16;           // margin
  const CW  = PW - M * 2;  // content width
  const BOT = 282;          // bottom limit before new page

  let y = 0;

  // ── Guard: add page if needed ──────────────────────────────────────────────
  function guard(neededH = 20) {
    if (y + neededH > BOT) { doc.addPage(); y = M + 8; }
  }

  // ── Cover / header band ────────────────────────────────────────────────────
  doc.setFillColor(10, 10, 18);
  doc.rect(0, 0, PW, 44, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(245, 158, 11);
  doc.text('VENTURE', M, 19);

  doc.setFontSize(13);
  doc.setTextColor(240, 235, 225);
  const destCity = city ?? selectedDest?.city ?? trip?.name ?? 'Itinerary';
  doc.text(destCity.toUpperCase(), M, 30);

  if (selectedDest?.startDate && selectedDest?.endDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(160, 155, 145);
    const range = `${fmtDate(selectedDest.startDate, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(selectedDest.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    doc.text(range, M, 38.5);
  }

  y = 52;

  // ── Days ───────────────────────────────────────────────────────────────────
  for (const day of days) {
    const slots = allSlots[day.id];
    if (!slots) continue;

    const hasAnySpots = SLOTS.some(s => (slots[s] ?? []).length > 0);
    if (!hasAnySpots) continue;

    guard(28);

    // Day header band
    doc.setFillColor(18, 18, 30);
    doc.roundedRect(M, y, CW, 11, 2, 2, 'F');

    const dayLabel = day.planDate
      ? fmtDate(day.planDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `Day ${day.dayNumber}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(245, 158, 11);
    doc.text(`DAY ${day.dayNumber}`, M + 4, y + 7.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 195, 185);
    doc.text(`  ·  ${dayLabel}`, M + 4 + doc.getTextWidth(`DAY ${day.dayNumber}`), y + 7.2);

    y += 15;

    // All spots in sequential order for travel chips
    const allDaySpots = SLOTS.flatMap(s => slots[s] ?? []);

    for (const slot of SLOTS) {
      const slotSpots = slots[slot] ?? [];
      if (slotSpots.length === 0) continue;

      guard(14);

      // Slot label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(110, 108, 130);
      doc.text(SLOT_LABEL[slot], M + 3, y);
      y += 6;

      for (const spot of slotSpots) {
        guard(24);

        // Travel chip from previous spot (any slot within same day)
        const prevIdx = allDaySpots.findIndex(s => s.dayPlanSpotId === spot.dayPlanSpotId) - 1;
        if (prevIdx >= 0) {
          const chip = travelChip(allDaySpots[prevIdx], spot);
          if (chip) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(130, 128, 148);
            doc.text(`     ${chip.mode === 'walk' ? '-> walk' : '-> transit'}  ${chip.label}`, M + 8, y);
            y += 4.5;
            guard(18);
          }
        }

        // Spot name
        const nameLines = doc.splitTextToSize(spot.name ?? 'Unknown', CW - 12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(28, 26, 40);
        doc.text(nameLines, M + 8, y);
        y += nameLines.length * 5.5;

        // Category
        if (spot.category) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 98, 118);
          doc.text(spot.category, M + 10, y);
          y += 4.5;
        }

        // Address
        if (spot.address) {
          guard(10);
          const addrLines = doc.splitTextToSize(spot.address, CW - 16);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(120, 118, 138);
          doc.text(addrLines, M + 10, y);
          y += addrLines.length * 4.2;
        }

        // Price + duration
        const meta = [];
        if (spot.entryPrice != null) meta.push(spot.entryPrice === 0 ? 'Free entry' : `€${spot.entryPrice} entry`);
        if (spot.visitDurationMinutes) {
          const h = Math.floor(spot.visitDurationMinutes / 60);
          const m = spot.visitDurationMinutes % 60;
          meta.push(h > 0 ? `~${h}h${m > 0 ? `${m}m` : ''} visit` : `~${m}m visit`);
        }
        if (meta.length > 0) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(100, 98, 118);
          doc.text(meta.join('  ·  '), M + 10, y);
          y += 4.5;
        }

        y += 4; // spacing between spots
      }

      y += 3; // spacing between slots
    }

    y += 8; // spacing between days
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 155, 145);
    doc.text('Venture  ·  Hidden Gems Travel Planner  ·  venture.app', M, PH - 6);
    doc.text(`${p} / ${totalPages}`, PW - M, PH - 6, { align: 'right' });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (city ?? selectedDest?.city ?? 'Itinerary').replace(/[^a-zA-Z0-9]/g, '-');
  doc.save(`Venture-${safeName}-Itinerary.pdf`);
}
