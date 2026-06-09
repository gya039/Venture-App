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
// Currency helpers
// ---------------------------------------------------------------------------

/**
 * ISO 4217 currency code → display symbol.
 * Used when the spot carries a `currency` field from AI research.
 */
export const ISO_TO_SYMBOL = {
  EUR: '€',  GBP: '£',  USD: '$',   CAD: 'CA$', AUD: 'A$',  NZD: 'NZ$',
  JPY: '¥',  CNY: '¥',  KRW: '₩',  THB: '฿',  INR: '₹',  TRY: '₺',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', PLN: 'zł',
  CZK: 'Kč', HUF: 'Ft', RON: 'lei', BGN: 'лв', HRK: 'kn',
  MXN: 'MX$', BRL: 'R$', ARS: '$',  CLP: '$',  COP: '$',  PEN: 'S/',
  ZAR: 'R',  MAD: 'MAD', EGP: 'E£', NGN: '₦', KES: 'KSh',
  SGD: 'S$', MYR: 'RM',  IDR: 'Rp', PHP: '₱', VND: '₫',
  HKD: 'HK$', TWD: 'NT$', SAR: 'SR', AED: 'AED', ILS: '₪',
};

/**
 * Maps known city names to their local currency symbol.
 * AI-generated spot prices arrive as raw numbers; we apply the right symbol here.
 * Note: Eurozone cities not listed here correctly default to '€' via the fallback.
 */
const CITY_CURRENCY = {
  // UK
  'glasgow': '£', 'edinburgh': '£', 'london': '£', 'manchester': '£',
  'birmingham': '£', 'bristol': '£', 'leeds': '£', 'liverpool': '£',
  'belfast': '£', 'cardiff': '£', 'newcastle': '£', 'sheffield': '£',
  // Ireland (EUR, explicit for clarity)
  'dublin': '€',
  // East Asia — Japan (JPY)
  'tokyo': '¥', 'kyoto': '¥', 'osaka': '¥', 'hiroshima': '¥',
  'nara': '¥', 'fukuoka': '¥', 'sapporo': '¥', 'nagoya': '¥',
  // East Asia — Korea (KRW)
  'seoul': '₩', 'busan': '₩', 'jeju': '₩',
  // East Asia — China (CNY) / special regions
  'beijing': '¥', 'shanghai': '¥', 'hong kong': 'HK$', 'taipei': 'NT$',
  // Southeast Asia — Thailand (THB)
  'bangkok': '฿', 'chiang mai': '฿', 'phuket': '฿', 'pattaya': '฿',
  // Southeast Asia — Vietnam (VND)
  'hanoi': '₫', 'ho chi minh city': '₫', 'ho chi minh': '₫', 'da nang': '₫',
  // Southeast Asia — Singapore (SGD)
  'singapore': 'S$',
  // Southeast Asia — Malaysia (MYR)
  'kuala lumpur': 'RM',
  // Southeast Asia — Indonesia (IDR)
  'bali': 'Rp', 'jakarta': 'Rp', 'yogyakarta': 'Rp',
  // Southeast Asia — Philippines (PHP)
  'manila': '₱', 'cebu': '₱',
  // South Asia — India (INR)
  'mumbai': '₹', 'delhi': '₹', 'new delhi': '₹', 'bangalore': '₹',
  'bengaluru': '₹', 'jaipur': '₹', 'agra': '₹', 'goa': '₹', 'kolkata': '₹',
  // Middle East — UAE (AED)
  'dubai': 'AED', 'abu dhabi': 'AED',
  // Middle East — Turkey (TRY)
  'istanbul': '₺', 'ankara': '₺', 'izmir': '₺',
  // Middle East — Israel (ILS)
  'tel aviv': '₪', 'jerusalem': '₪',
  // Americas — USA (USD)
  'new york': '$', 'los angeles': '$', 'chicago': '$', 'miami': '$',
  'san francisco': '$', 'boston': '$', 'las vegas': '$', 'new orleans': '$',
  'washington': '$', 'seattle': '$', 'austin': '$', 'nashville': '$',
  'portland': '$', 'denver': '$', 'atlanta': '$', 'houston': '$',
  // Americas — Mexico (MXN)
  'mexico city': 'MX$', 'guadalajara': 'MX$', 'oaxaca': 'MX$',
  'cancun': 'MX$', 'tulum': 'MX$',
  // Americas — Canada (CAD)
  'toronto': 'CA$', 'montreal': 'CA$', 'vancouver': 'CA$', 'calgary': 'CA$',
  // Americas — South America
  'buenos aires': '$', 'rio de janeiro': 'R$', 'sao paulo': 'R$',
  'cartagena': '$', 'bogota': '$', 'medellin': '$', 'lima': 'S/',
  // Africa — South Africa (ZAR)
  'cape town': 'R', 'johannesburg': 'R', 'durban': 'R',
  // Africa — Kenya (KES)
  'nairobi': 'KSh',
  // Africa — Morocco (MAD)
  'marrakech': 'MAD', 'fes': 'MAD', 'casablanca': 'MAD',
  // Australia (AUD)
  'sydney': 'A$', 'melbourne': 'A$', 'brisbane': 'A$',
  'perth': 'A$', 'adelaide': 'A$',
  // New Zealand (NZD)
  'auckland': 'NZ$', 'wellington': 'NZ$', 'christchurch': 'NZ$',
  // Nordics — non-EUR
  'stockholm': 'kr', 'gothenburg': 'kr', 'malmö': 'kr', 'malmo': 'kr',
  'oslo': 'kr', 'bergen': 'kr',
  'copenhagen': 'kr',
  // Switzerland (CHF)
  'zurich': 'CHF', 'zürich': 'CHF', 'geneva': 'CHF', 'bern': 'CHF',
};

/** Returns the currency symbol for a city name. Defaults to €. */
export function getCurrencySymbol(city) {
  if (!city) return '€';
  return CITY_CURRENCY[city.toLowerCase()] ?? '€';
}

/**
 * Resolves the currency symbol for a spot.
 * Priority:
 *   1. City-name map (explicit, reliable)
 *   2. Spot's own ISO `currency` field from AI research  (handles any city not in map)
 *   3. Default → '€'
 */
export function getCurrencyForSpot(spot) {
  if (spot?.city) {
    const cityMapped = CITY_CURRENCY[spot.city.toLowerCase()];
    if (cityMapped) return cityMapped;
  }
  if (spot?.currency) {
    const sym = ISO_TO_SYMBOL[spot.currency.toUpperCase()];
    if (sym) return sym;
  }
  return '€';
}

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
    // Format: integer → "£12"; decimal → "£12.5" (symbol derived from city + ISO code)
    const fmt = ep % 1 === 0 ? String(Math.round(ep)) : ep.toFixed(1);
    const sym = getCurrencyForSpot(spot);
    return { priceType: 'paid', label: `${sym}${fmt}`, verifyUrl };
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
