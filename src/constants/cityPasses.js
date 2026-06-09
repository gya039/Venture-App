/**
 * City pass reference data for the Day Pass Calculator.
 * Prices in EUR (approximate, 2024–2025).
 *
 * Each city has one or more pass tiers keyed by duration in days.
 * `includesTransport` — whether the pass covers public transit.
 * `coverageNote`      — short description of what's included.
 * `link`             — official purchase URL.
 */
export const CITY_PASSES = {
  // ── Amsterdam ─────────────────────────────────────────────────────────
  Amsterdam: {
    name: 'I amsterdam City Card',
    emoji: '🇳🇱',
    tiers: [
      { days: 1, price: 65,  label: '24 h' },
      { days: 2, price: 95,  label: '48 h' },
      { days: 3, price: 115, label: '72 h' },
      { days: 4, price: 130, label: '96 h' },
    ],
    includesTransport: true,
    transportValue: 10, // estimated daily public-transport value
    coverageNote: 'Free entry to 70+ museums & attractions + GVB transit',
    link: 'https://www.iamsterdam.com/en/city-card',
  },

  // ── Paris ──────────────────────────────────────────────────────────────
  Paris: {
    name: 'Paris Museum Pass',
    emoji: '🇫🇷',
    tiers: [
      { days: 2, price: 52, label: '2 days' },
      { days: 4, price: 67, label: '4 days' },
      { days: 6, price: 82, label: '6 days' },
    ],
    includesTransport: false,
    transportValue: 0,
    coverageNote: 'Skip-the-line entry to 50+ museums & monuments',
    link: 'https://www.parismuseumpass.com',
  },

  // ── Rome ───────────────────────────────────────────────────────────────
  Rome: {
    name: 'Roma Pass',
    emoji: '🇮🇹',
    tiers: [
      { days: 2, price: 32, label: '48 h' },
      { days: 3, price: 52, label: '72 h' },
    ],
    includesTransport: true,
    transportValue: 7,
    coverageNote: '1–2 free museums + discounts + metro/bus included',
    link: 'https://www.romapass.it',
  },

  // ── Barcelona ──────────────────────────────────────────────────────────
  Barcelona: {
    name: 'Barcelona Card',
    emoji: '🇪🇸',
    tiers: [
      { days: 2, price: 35, label: '2 days' },
      { days: 3, price: 45, label: '3 days' },
      { days: 4, price: 55, label: '4 days' },
      { days: 5, price: 60, label: '5 days' },
    ],
    includesTransport: true,
    transportValue: 9,
    coverageNote: 'Free/discounted museums + unlimited metro & bus',
    link: 'https://www.barcelonacard.com',
  },

  // ── Vienna ─────────────────────────────────────────────────────────────
  Vienna: {
    name: 'Vienna City Card',
    emoji: '🇦🇹',
    tiers: [
      { days: 1, price: 17, label: '24 h' },
      { days: 2, price: 25, label: '48 h' },
      { days: 3, price: 29, label: '72 h' },
    ],
    includesTransport: true,
    transportValue: 8,
    coverageNote: 'Unlimited transit + discounts at 210+ sights',
    link: 'https://www.wiencitycard.at',
  },

  // ── Prague ─────────────────────────────────────────────────────────────
  Prague: {
    name: 'Prague City Pass',
    emoji: '🇨🇿',
    tiers: [
      { days: 2, price: 45, label: '2 days' },
      { days: 4, price: 55, label: '4 days' },
    ],
    includesTransport: false,
    transportValue: 0,
    coverageNote: 'Free entry to Prague Castle, National Museum & more',
    link: 'https://www.praguecitycard.com',
  },

  // ── Lisbon ─────────────────────────────────────────────────────────────
  Lisbon: {
    name: 'Lisboa Card',
    emoji: '🇵🇹',
    tiers: [
      { days: 1, price: 22, label: '24 h' },
      { days: 2, price: 37, label: '48 h' },
      { days: 3, price: 46, label: '72 h' },
    ],
    includesTransport: true,
    transportValue: 8,
    coverageNote: 'Free entry to 39 museums + metro, tram & bus',
    link: 'https://www.lisboacard.org',
  },

  // ── Berlin ─────────────────────────────────────────────────────────────
  Berlin: {
    name: 'Berlin WelcomeCard + Museums',
    emoji: '🇩🇪',
    tiers: [
      { days: 2, price: 43, label: '48 h' },
      { days: 3, price: 52, label: '72 h' },
      { days: 5, price: 69, label: '5 days' },
    ],
    includesTransport: true,
    transportValue: 10,
    coverageNote: 'Free entry to 30+ museums (Museum Island) + all transit',
    link: 'https://www.visitberlin.de/en/berlin-welcomecard',
  },

  // ── Budapest ───────────────────────────────────────────────────────────
  Budapest: {
    name: 'Budapest Card',
    emoji: '🇭🇺',
    tiers: [
      { days: 1, price: 33, label: '24 h' },
      { days: 2, price: 49, label: '48 h' },
      { days: 3, price: 59, label: '72 h' },
    ],
    includesTransport: true,
    transportValue: 7,
    coverageNote: 'Free museums, thermal baths discounts + all transit',
    link: 'https://www.budapestcard.com',
  },

  // ── Porto ──────────────────────────────────────────────────────────────
  Porto: {
    name: 'Porto Card',
    emoji: '🇵🇹',
    tiers: [
      { days: 1, price: 13, label: '1 day' },
      { days: 2, price: 20, label: '2 days' },
      { days: 3, price: 26, label: '3 days' },
      { days: 4, price: 33, label: '4 days' },
    ],
    includesTransport: true,
    transportValue: 7,
    coverageNote: 'Free entry to 6 museums + unlimited metro & bus',
    link: 'https://www.portocard.pt',
  },

  // ── Copenhagen ─────────────────────────────────────────────────────────
  Copenhagen: {
    name: 'Copenhagen Card',
    emoji: '🇩🇰',
    tiers: [
      { days: 1, price: 59, label: '24 h' },
      { days: 2, price: 89, label: '48 h' },
      { days: 3, price: 109, label: '72 h' },
    ],
    includesTransport: true,
    transportValue: 12,
    coverageNote: 'Free entry to 89 attractions + metro, train & bus',
    link: 'https://www.copenhagencard.com',
  },

  // ── Edinburgh ──────────────────────────────────────────────────────────
  Edinburgh: {
    name: 'Royal Edinburgh Ticket',
    emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    currency: '£',
    tiers: [
      { days: 3, price: 43, label: '3 days' },
    ],
    includesTransport: false,
    transportValue: 0,
    coverageNote: 'Skip-the-line entry: Edinburgh Castle + Palace of Holyroodhouse',
    link: 'https://www.edinburghcastle.scot/royal-edinburgh-ticket',
  },
};

/**
 * Find the best matching pass data for a given city name.
 * Case-insensitive, partial-match friendly.
 */
export function getCityPass(city) {
  if (!city) return null;
  const key = Object.keys(CITY_PASSES).find(
    (k) => k.toLowerCase() === city.toLowerCase()
      || city.toLowerCase().includes(k.toLowerCase())
      || k.toLowerCase().includes(city.toLowerCase())
  );
  return key ? { ...CITY_PASSES[key], city: key } : null;
}

/**
 * Given a pass and a number of days, return the best (cheapest sufficient) tier.
 */
export function getBestTier(pass, tripDays) {
  if (!pass?.tiers?.length) return null;
  // Find cheapest tier that covers tripDays
  const sufficient = pass.tiers.filter((t) => t.days >= tripDays);
  if (sufficient.length) return sufficient[0]; // already sorted cheapest first
  // If trip is longer than any tier, use the longest tier
  return pass.tiers[pass.tiers.length - 1];
}
