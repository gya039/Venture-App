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
  'Nature', 'Nightlife', 'Offbeat', 'Park',
  'Shopping', 'Spa', 'Spiritual',
  // 'Neighbourhood' removed — AI prompt now bans it. 'Other' kept for legacy data.
  'Other',
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
  'neighbourhood / district':  'Offbeat',
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
  'neighbourhood': 'Offbeat',
  'nightlife':     'Nightlife',
  'offbeat':       'Offbeat',
  'park':          'Park',
  'shopping':      'Shopping',
  'spa':           'Spa',
  'spiritual':     'Spiritual',
  'other':         'Other',

  // ── AI prompt variants ────────────────────────────────────────────────
  'landmark':           'Architecture',
  'monument':           'Architecture',
  'historic site':      'History',
  'historic':           'History',
  'historic building':  'History',
  'historical':         'History',
  'heritage':           'History',
  'ruins':              'History',
  'ruin':               'History',
  'memorial':           'History',
  'cemetery':           'History',
  'graveyard':          'History',
  'palace':             'Architecture',
  'castle':             'Architecture',
  'tower':              'Architecture',
  'bridge':             'Architecture',
  'rooftop':            'Architecture',
  'viewpoint':          'Nature',
  'vista':              'Nature',
  'lookout':            'Nature',
  'observation':        'Nature',
  'hiking':             'Nature',
  'trail':              'Nature',
  'waterfall':          'Nature',
  'lake':               'Nature',
  'river':              'Nature',
  'canal':              'Nature',
  'botanical':          'Park',
  'botanic':            'Park',
  'reserve':            'Park',
  'forest':             'Park',

  // ── Art & street culture ──────────────────────────────────────────────
  'street art':         'Art',
  'mural':              'Art',
  'sculpture':          'Art',
  'installation':       'Art',
  'exhibition':         'Art',
  'theater':            'Music',
  'theatre':            'Music',
  'opera':              'Music',
  'concert':            'Music',
  'venue':              'Music',
  'comedy':             'Offbeat',
  'cinema':             'Offbeat',
  'film':               'Offbeat',
  'bookshop':           'Shopping',
  'bookstore':          'Shopping',
  'library':            'History',
  'skatepark':          'Offbeat',
  'arcade':             'Offbeat',
  'escape room':        'Offbeat',
  'curiosity':          'Offbeat',
  'quirky':             'Offbeat',

  // ── Wellness ──────────────────────────────────────────────────────────
  'baths':              'Spa',
  'bath':               'Spa',
  'thermal':            'Spa',
  'hammam':             'Spa',
  'sauna':              'Spa',
  'hot spring':         'Spa',
  'onsen':              'Spa',
  'swimming':           'Spa',
  'pool':               'Spa',

  // ── English synonyms / plurals ────────────────────────────────────────
  'museums':         'Museum',
  'gallery':         'Art',
  'galleries':       'Art',
  'art gallery':     'Art',
  'parks':           'Park',
  'garden':          'Park',
  'gardens':         'Park',
  'green space':     'Park',
  'outdoor space':   'Park',
  'bars':            'Bar',
  'pub':             'Bar',
  'pubs':            'Bar',
  'wine bar':        'Bar',
  'cocktail bar':    'Bar',
  'taproom':         'Bar',
  'brewery':         'Bar',
  'distillery':      'Bar',
  'cafés':           'Café',
  'cafes':           'Café',
  'coffee':          'Café',
  'coffee shop':     'Café',
  'bakery':          'Café',
  'patisserie':      'Café',
  'tea house':       'Café',
  'restaurant':      'Food',
  'restaurants':     'Food',
  'dining':          'Food',
  'eatery':          'Food',
  'bistro':          'Food',
  'trattoria':       'Food',
  'taverna':         'Food',
  'food hall':       'Food',
  'food stall':      'Market',
  'markets':         'Market',
  'street food':     'Market',
  'flea market':     'Market',
  'antique':         'Market',
  'shop':            'Shopping',
  'shops':           'Shopping',
  'boutique':        'Shopping',
  'neighborhood':    'Offbeat',
  'neighborhoods':   'Offbeat',
  'neighbourhoods':  'Offbeat',
  'district':        'Offbeat',
  'temple':          'Spiritual',
  'church':          'Spiritual',
  'mosque':          'Spiritual',
  'cathedral':       'Spiritual',
  'shrine':          'Spiritual',
  'synagogue':       'Spiritual',
  'pagoda':          'Spiritual',
  'monastery':       'Spiritual',
  'chapel':          'Spiritual',
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
  'beach bar':       'Beach',
  'coast':           'Beach',
  'seaside':         'Beach',
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

  // 1. Exact map lookup
  if (RAW_TO_CANONICAL[key]) return RAW_TO_CANONICAL[key];

  // 2. Substring fallback — check if any known keyword appears inside the raw string
  //    (catches "Historic Building", "Rooftop Bar", "Botanical Garden", etc.)
  for (const [mapKey, canonical] of Object.entries(RAW_TO_CANONICAL)) {
    if (mapKey.length >= 4 && key.includes(mapKey)) return canonical;
  }

  // 3. Canonical pass-through — AI returned a value that IS already canonical
  const titleCased = String(raw).trim();
  if (CANONICAL_CATEGORIES.includes(titleCased)) return titleCased;

  return 'Other';
}

/**
 * Title-cased display label for any (possibly un-normalised) category string.
 * Safe to call on raw AI output or stored canonical values.
 */
export function categoryLabel(raw) {
  const canonical = normaliseCategory(raw);
  return CATEGORY_LABELS[canonical] ?? canonical;
}
