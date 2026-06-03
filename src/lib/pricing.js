/**
 * Pricing utilities for Venture.
 *
 * Single source of truth for how entry prices are interpreted and displayed.
 * Handles two incompatible data sources:
 *
 *   • AI / Firestore spots — entryPrice is a number (or null):
 *       0      = genuinely free
 *       null   = unknown (AI couldn't determine price)
 *       12     = €12 entry fee
 *
 *   • Static seed data (src/data/spots/*.js) — entryPrice is a string:
 *       'Free' | 'Free entry' | 'Free (exterior)' etc.
 *       '€8'  | '¥600' | 'HUF 5,000' | '€12–18'
 *       'Free (day pass)'            → pass-included
 *       'Included with KHM entry …'  → pass-included
 *       'Varies' | 'Varies by event' → unknown
 */

// ---------------------------------------------------------------------------
// Core formatter
// ---------------------------------------------------------------------------

/**
 * Returns a structured price descriptor for a spot.
 *
 * priceType:
 *   'free'    — genuinely free to everyone; show "Free"
 *   'pass'    — free only with a city pass; show "Included with pass"
 *   'paid'    — has an entry price; show label + approx + verify link
 *   'unknown' — price not known; show "check price" verify link
 *
 * label:      the human-readable price string, e.g. "€12", "¥600", null for unknown
 * verifyUrl:  Google search URL for paid/unknown; null for free/pass
 */
export function formatPrice(spot) {
  const ep           = spot?.entryPrice;
  const passIncluded = spot?.passIncluded ?? false;
  const verifyUrl    = buildVerifyUrl(spot);

  // ── null / undefined → unknown price ─────────────────────────────────────
  if (ep === null || ep === undefined) {
    return { priceType: 'unknown', label: null, verifyUrl };
  }

  // ── number (AI / Firestore) ───────────────────────────────────────────────
  if (typeof ep === 'number') {
    if (ep === 0) {
      return passIncluded
        ? { priceType: 'pass', label: 'Included with pass', verifyUrl: null }
        : { priceType: 'free', label: 'Free',               verifyUrl: null };
    }
    // Format: integer → "€12"; decimal → "€12.5"
    const fmt = ep % 1 === 0 ? String(Math.round(ep)) : ep.toFixed(1);
    return { priceType: 'paid', label: `€${fmt}`, verifyUrl };
  }

  // ── string (static seed data) ─────────────────────────────────────────────
  const s = String(ep).trim();

  // Pass-included — check BEFORE free to catch "Free (day pass)"
  if (/pass/i.test(s) || /^included/i.test(s) || passIncluded) {
    return { priceType: 'pass', label: 'Included with pass', verifyUrl: null };
  }

  // Free variants
  if (/^free/i.test(s)) {
    return { priceType: 'free', label: 'Free', verifyUrl: null };
  }

  // Unknown / variable — no meaningful price to display
  if (!s || /^varies?/i.test(s) || /^unknown/i.test(s)) {
    return { priceType: 'unknown', label: null, verifyUrl };
  }

  // Everything else is a paid price string that already contains its currency symbol
  return { priceType: 'paid', label: s, verifyUrl };
}

// ---------------------------------------------------------------------------
// Numeric extractor (for pass calculator totals)
// ---------------------------------------------------------------------------

/**
 * Returns the numeric entry price for maths (pass calculator, totalCost).
 * For string prices it parses the first numeric value — imprecise for ranges
 * (e.g. '€12–18' returns 12) but acceptable for budget estimation.
 * Returns 0 for free / unknown / unparseable values.
 */
export function getNumericPrice(spot) {
  const ep = spot?.entryPrice;
  if (!ep) return 0;
  if (typeof ep === 'number') return ep;
  // Remove thousands separators, extract first number (handles '€12', '¥600', 'HUF 5,000')
  const match = String(ep).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildVerifyUrl(spot) {
  const name = spot?.name ?? '';
  const city = spot?.city ?? '';
  const q    = [name, city, 'entry price'].filter(Boolean).join(' ');
  return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : null;
}
