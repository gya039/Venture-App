/**
 * Canonical spot category taxonomy for Venture.
 *
 * Single source of truth used by:
 *   - The AI research pipeline  (route.js normalises on write)
 *   - The Firestore reader      (getCachedSpots normalises on read)
 *   - The static seed data      (src/data/spots/*.js uses these exact strings)
 *   - All UI components         (DaysBuilder, SpotCard, SpotDrawer, share page)
 *
 * 19 canonical values, Title Case.  No slash-pairs, no compound forms.
 */

// ---------------------------------------------------------------------------
// Canonical values
// ---------------------------------------------------------------------------

export const CANONICAL_CATEGORIES = [
  'Art', 'Architecture', 'Bar', 'Beach', 'Café',
  'Food', 'History', 'Market', 'Museum', 'Music',
  'Nature', 'Neighbourhood', 'Nightlife', 'Offbeat', 'Park',
  'Shopping', 'Spa', 'Spiritual', 'Other',
];

/**
 * Display labels for UI chips and card eyebrows.
 * Currently identical to the stored values — kept separate so display
 * and storage can diverge in future without touching every component.
 */
export const CATEGORY_LABELS = {
  Art:           'Art',
  Architecture:  'Architecture',
  Bar:           'Bar',
  Beach:         'Beach',
  Café:          'Café',
  Food:          'Food',
  History:       'History',
  Market:        'Market',
  Museum:        'Museum',
  Music:         'Music',
  Nature:        'Nature',
  Neighbourhood: 'Neighbourhood',
  Nightlife:     'Nightlife',
  Offbeat:       'Offbeat',
  Park:          'Park',
  Shopping:      'Shopping',
  Spa:           'Spa',
  Spiritual:     'Spiritual',
  Other:         'Other',
};

// ---------------------------------------------------------------------------
// Mapping table  (raw input → canonical value, all keys lowercase)
// ---------------------------------------------------------------------------

const RAW_TO_CANONICAL = {
  // ── Slash-pairs from static seed data ──────────────────────────────────
  'museum / history':          'Museum',
  'market / street food':      'Market',
  'architecture / landmark':   'Architecture',
  'neighbourhood / district':  'Neighbourhood',
  'park / green space':        'Park',
  'gallery / art':             'Art',
  'spiritual / ritual':        'Spiritual',
  'bar / nightlife':           'Bar',
  'nature / viewpoint':        'Nature',
  'unusual / weird':           'Offbeat',
  'restaurant / food':         'Food',
  'underground / subculture':  'Offbeat',
  'beach / water':             'Beach',

  // ── Canonical pass-through (Title Case input) ───────────────────────────
  'art':           'Art',
  'architecture':  'Architecture',
  'bar':           'Bar',
  'beach':         'Beach',
  'café':          'Café',
  'cafe':          'Café',
  'food':          'Food',
  'history':       'History',
  'market':        'Market',
  'museum':        'Museum',
  'music':         'Music',
  'nature':        'Nature',
  'neighbourhood': 'Neighbourhood',
  'nightlife':     'Nightlife',
  'offbeat':       'Offbeat',
  'park':          'Park',
  'shopping':      'Shopping',
  'spa':           'Spa',
  'spiritual':     'Spiritual',
  'other':         'Other',

  // ── AI prompt variants ────────────────────────────────────────────────
  'landmark':        'Architecture',
  'monument':        'Architecture',
  'historic site':   'History',
  'historic':        'History',

  // ── English synonyms / plurals ────────────────────────────────────────
  'museums':         'Museum',
  'gallery':         'Art',
  'galleries':       'Art',
  'art gallery':     'Art',
  'parks':           'Park',
  'garden':          'Park',
  'gardens':         'Park',
  'green space':     'Park',
  'bars':            'Bar',
  'pub':             'Bar',
  'pubs':            'Bar',
  'cafés':           'Café',
  'cafes':           'Café',
  'coffee':          'Café',
  'coffee shop':     'Café',
  'restaurant':      'Food',
  'restaurants':     'Food',
  'dining':          'Food',
  'markets':         'Market',
  'street food':     'Market',
  'shop':            'Shopping',
  'shops':           'Shopping',
  'neighborhood':    'Neighbourhood',
  'neighborhoods':   'Neighbourhood',
  'neighbourhoods':  'Neighbourhood',
  'district':        'Neighbourhood',
  'temple':          'Spiritual',
  'church':          'Spiritual',
  'mosque':          'Spiritual',
  'cathedral':       'Spiritual',
  'shrine':          'Spiritual',
  'unusual':         'Offbeat',
  'underground':     'Offbeat',
  'weird':           'Offbeat',
  'subculture':      'Offbeat',
  'relaxation':      'Spa',
  'wellness':        'Spa',
  'club':            'Nightlife',
  'clubs':           'Nightlife',
  'nightclub':       'Nightlife',
  'nightclubs':      'Nightlife',
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Normalise any raw category string to the canonical set.
 * Case-insensitive; handles slash-pairs, legacy compound forms, and AI variants.
 * Unrecognised values map to 'Other'.
 */
export function normaliseCategory(raw) {
  if (!raw) return 'Other';
  const key = String(raw)
    .toLowerCase()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s*\/\s*/g, ' / ');
  return RAW_TO_CANONICAL[key] ?? 'Other';
}

/**
 * Title-cased display label for any (possibly un-normalised) category string.
 * Safe to call on raw AI output or stored canonical values.
 */
export function categoryLabel(raw) {
  const canonical = normaliseCategory(raw);
  return CATEGORY_LABELS[canonical] ?? canonical;
}
