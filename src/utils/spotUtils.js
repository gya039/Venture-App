import { INTERESTS } from '@/constants/interests';

/* ── Opening hours helpers ─────────────────────────────────────────────── */
const DAY_KEYS       = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_NAMES      = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
const DAY_FULL_NAMES = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
const JS_DAY_TO_KEY  = ['sun','mon','tue','wed','thu','fri','sat'];

/** "09:00-18:00" → "9am–6pm" */
export function fmtTimeRange(t) {
  if (!t || t.toLowerCase() === 'closed') return 'Closed';
  const parts = t.split('-');
  if (parts.length < 2) return t;
  const fmt = (s) => {
    const [h, m] = (s || '').split(':').map(Number);
    if (isNaN(h)) return s;
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour   = h % 12 || 12;
    return m ? `${hour}:${String(m).padStart(2,'0')}${suffix}` : `${hour}${suffix}`;
  };
  return `${fmt(parts[0])}–${fmt(parts[1])}`;
}

/** Returns today's hours as a display string. */
export function getTodayHours(openingHours) {
  if (!openingHours) return null;
  if (typeof openingHours === 'string') return openingHours;
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const val = openingHours[todayKey];
  if (!val) return null;
  return fmtTimeRange(val);
}

/** Returns array [{key, label, hours, closed, isToday}] for the full week. */
export function getFullSchedule(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return null;
  return DAY_KEYS.map((k) => ({
    key:     k,
    label:   DAY_NAMES[k],
    hours:   openingHours[k] ? fmtTimeRange(openingHours[k]) : '—',
    closed:  !openingHours[k] || openingHours[k].toLowerCase() === 'closed',
    isToday: k === JS_DAY_TO_KEY[new Date().getDay()],
  }));
}

/**
 * Returns a context-aware closure label derived from the openingHours object.
 * Only call this when today is confirmed closed (getTodayHours returned 'Closed').
 *
 * Priority order:
 *   1. "Closed on weekends"        — Mon–Fri all open, both Sat+Sun explicitly closed
 *   2. "Closed Sundays"            — today is Sunday, Saturday is open but Sunday isn't
 *   3. "Closed today · Opens [Day]" — next open day within the week is determinable
 *   4. "Hours vary"                — no open days at all in the data (unreliable)
 *   5. "Closed today"              — fallback
 *
 * "Closed for holiday" requires an external calendar and is not computed here.
 */
export function getClosureLabel(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return 'Closed';

  const today    = new Date();
  const todayKey = JS_DAY_TO_KEY[today.getDay()];

  const isOpenDay = (key) => {
    const val = openingHours[key];
    return Boolean(val) && val.toLowerCase() !== 'closed';
  };

  const satOpen        = isOpenDay('sat');
  const sunOpen        = isOpenDay('sun');
  const weekdaysAllOpen = ['mon', 'tue', 'wed', 'thu', 'fri'].every(isOpenDay);

  // 1. Closed on weekends — Mon–Fri all open, both Sat and Sun closed
  if ((todayKey === 'sat' || todayKey === 'sun') && weekdaysAllOpen && !satOpen && !sunOpen) {
    return 'Closed on weekends';
  }

  // 2. Closed Sundays — today is Sunday, Saturdays are open but Sundays aren't
  if (todayKey === 'sun' && !sunOpen && satOpen) {
    return 'Closed Sundays';
  }

  // 3. Scan forward up to 6 days for the next open day
  for (let i = 1; i <= 6; i++) {
    const nextKey = JS_DAY_TO_KEY[(today.getDay() + i) % 7];
    if (isOpenDay(nextKey)) {
      return `Closed today · Opens ${DAY_FULL_NAMES[nextKey]}`;
    }
  }

  // 4. No open days found anywhere — data is incomplete or unreliable
  if (!DAY_KEYS.some(isOpenDay)) return 'Hours vary';

  // 5. Fallback
  return 'Closed today';
}

/* ── Category icon helpers ─────────────────────────────────────────────── */
export const CATEGORY_ICON_MAP = [
  ['restaurant', '🍽️'], ['cafe',     '☕'], ['bar',     '🍸'],
  ['bakery',     '🥐'], ['food',     '🍜'], ['drink',   '🥂'],
  ['museum',     '🏛️'], ['gallery',  '🎨'], ['theater', '🎭'],
  ['cinema',     '🎬'], ['library',  '📚'],
  ['park',       '🌿'], ['garden',   '🌸'], ['nature',  '🌲'],
  ['beach',      '🏖️'], ['lake',     '🏞️'], ['river',   '🌊'],
  ['market',     '🛍️'], ['shop',     '🛒'], ['shopping','🛍️'],
  ['temple',     '⛩️'], ['church',   '⛪'], ['mosque',  '🕌'],
  ['monument',   '🏰'], ['castle',   '🏯'], ['ruin',    '🏚️'],
  ['viewpoint',  '👁️'], ['lookout',  '🔭'], ['tower',   '🗼'],
  ['spa',        '💆'], ['bath',     '🛁'], ['wellness','🧘'],
  ['nightlife',  '🌙'], ['club',     '🎵'], ['concert', '🎶'],
  ['sport',      '⚽'], ['gym',      '🏋️'],
  ['street',     '🛤️'], ['square',   '🏙️'], ['neighbourhood','🏘️'],
];

export function getCategoryIcon(spot) {
  const cat = (spot.category ?? '').toLowerCase();
  if (cat) {
    for (const [k, v] of CATEGORY_ICON_MAP) {
      if (cat.includes(k)) return v;
    }
  }
  const firstId = (spot.interests ?? [])[0];
  if (firstId) {
    const match = INTERESTS.find((i) => i.id === firstId);
    if (match) return match.icon;
  }
  return '📍';
}
