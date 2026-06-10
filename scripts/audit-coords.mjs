#!/usr/bin/env node
/**
 * scripts/audit-coords.mjs
 *
 * Audit static seed spot coordinates for plausibility.
 *
 * For every spot in the static seed dataset, computes the haversine distance
 * from the known city centre and prints any spot further than THRESHOLD_KM.
 *
 * Usage:
 *   node scripts/audit-coords.mjs              # default 35 km threshold
 *   node scripts/audit-coords.mjs --km 20      # tighter threshold
 *   node scripts/audit-coords.mjs --city London # single city
 *
 * NOTE: Manchester has no static seed file; its spots live in Firestore
 * (populated by the live research pipeline).  Salford Quays' bad coordinates
 * came from a Mapbox geocode that returned a point ~27 km from Manchester
 * centre — just inside the 35 km threshold at the time of research.
 * To repair Firestore data, re-run the research pipeline for Manchester
 * (which will use the updated GEOCODE_SANITY_KM guard and the proximity bias)
 * or manually correct via the Firestore console.
 */

import path   from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ── City centre lookup table ──────────────────────────────────────────────────
// Authoritative centre points (lat, lng) for all seeded cities.
// Source: city-centre Wikipedia coordinates rounded to 4 d.p.
const CITY_CENTRES = {
  'Amsterdam':      { lat: 52.3676, lng:  4.9041 },
  'Bangkok':        { lat: 13.7563, lng: 100.5018 },
  'Barcelona':      { lat: 41.3851, lng:  2.1734 },
  'Berlin':         { lat: 52.5200, lng: 13.4050 },
  'Budapest':       { lat: 47.4979, lng: 19.0402 },
  'Chiang Mai':     { lat: 18.7061, lng: 98.9817 },
  'Copenhagen':     { lat: 55.6761, lng: 12.5683 },
  'Dublin':         { lat: 53.3498, lng: -6.2603 },
  'Edinburgh':      { lat: 55.9533, lng: -3.1883 },
  'Hanoi':          { lat: 21.0278, lng: 105.8342 },
  'Ho Chi Minh City': { lat: 10.8231, lng: 106.6297 },
  'Istanbul':       { lat: 41.0082, lng: 28.9784 },
  'Krakow':         { lat: 50.0647, lng: 19.9450 },
  'Kyoto':          { lat: 35.0116, lng: 135.7681 },
  'Lisbon':         { lat: 38.7223, lng: -9.1393 },
  'London':         { lat: 51.5074, lng: -0.1278 },
  'Marrakech':      { lat: 31.6295, lng: -7.9811 },
  'Mexico City':    { lat: 19.4326, lng: -99.1332 },
  'Naples':         { lat: 40.8518, lng: 14.2681 },
  'New Orleans':    { lat: 29.9511, lng: -90.0715 },
  'New York':       { lat: 40.7128, lng: -74.0060 },
  'Oaxaca':         { lat: 17.0732, lng: -96.7266 },
  'Osaka':          { lat: 34.6937, lng: 135.5023 },
  'Paris':          { lat: 48.8566, lng:  2.3522 },
  'Porto':          { lat: 41.1579, lng: -8.6291 },
  'Prague':         { lat: 50.0755, lng: 14.4378 },
  'Rome':           { lat: 41.9028, lng: 12.4964 },
  'Seoul':          { lat: 37.5665, lng: 126.9780 },
  'Seville':        { lat: 37.3891, lng: -5.9845 },
  'Tallinn':        { lat: 59.4370, lng: 24.7536 },
  'Tbilisi':        { lat: 41.6938, lng: 44.8015 },
  'Tokyo':          { lat: 35.6762, lng: 139.6503 },
  'Vienna':         { lat: 48.2082, lng: 16.3738 },
  'Vilnius':        { lat: 54.6872, lng: 25.2797 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function distKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let km     = 35;
  let city   = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--km'   && args[i + 1]) { km   = Number(args[++i]); }
    if (args[i] === '--city' && args[i + 1]) { city = args[++i]; }
  }
  return { km, city };
}

// ── Load seed data (dynamic import avoids transpile requirement) ──────────────

const require = createRequire(import.meta.url);

async function loadAllSpots() {
  // Dynamic import of the ES module index; works under Node with --experimental-vm-modules
  // or via tsx/esm loaders.  Falls back to listing files directly.
  try {
    // Resolve aliases manually: @/ → src/
    const indexPath = path.join(root, 'src/data/spots/index.js');

    // Patch: rewrite @/ alias on-the-fly via a tiny loader shim isn't feasible
    // without build tools.  Instead, import each file individually.
    const files = [
      ['Amsterdam',       'amsterdam.js',       'amsterdamSpots'],
      ['Bangkok',         'bangkok.js',         'bangkokSpots'],
      ['Barcelona',       'barcelona.js',       'barcelonaSpots'],
      ['Berlin',          'berlin.js',          'berlinSpots'],
      ['Budapest',        'budapest.js',        'budapestSpots'],
      ['Chiang Mai',      'chiang-mai.js',      'chiangMaiSpots'],
      ['Copenhagen',      'copenhagen.js',      'copenhagenSpots'],
      ['Dublin',          'dublin.js',          'dublinSpots'],
      ['Edinburgh',       'edinburgh.js',       'edinburghSpots'],
      ['Hanoi',           'hanoi.js',           'hanoiSpots'],
      ['Ho Chi Minh City','ho-chi-minh-city.js','hoChiMinhCitySpots'],
      ['Istanbul',        'istanbul.js',        'istanbulSpots'],
      ['Krakow',          'krakow.js',          'krakowSpots'],
      ['Kyoto',           'kyoto.js',           'kyotoSpots'],
      ['Lisbon',          'lisbon.js',          'lisbonSpots'],
      ['London',          'london.js',          'londonSpots'],
      ['Marrakech',       'marrakech.js',       'marrakechSpots'],
      ['Mexico City',     'mexico-city.js',     'mexicoCitySpots'],
      ['Naples',          'naples.js',          'naplesSpots'],
      ['New Orleans',     'new-orleans.js',     'newOrleansSpots'],
      ['New York',        'new-york.js',        'newYorkSpots'],
      ['Oaxaca',          'oaxaca.js',          'oaxacaSpots'],
      ['Osaka',           'osaka.js',           'osakaSpots'],
      ['Paris',           'paris.js',           'parisSpots'],
      ['Porto',           'porto.js',           'portoSpots'],
      ['Prague',          'prague.js',          'pragueSpots'],
      ['Rome',            'rome.js',            'romeSpots'],
      ['Seoul',           'seoul.js',           'seoulSpots'],
      ['Seville',         'seville.js',         'sevilleSpots'],
      ['Tallinn',         'tallinn.js',         'tallinnSpots'],
      ['Tbilisi',         'tbilisi.js',         'tbilisiSpots'],
      ['Tokyo',           'tokyo.js',           'tokyoSpots'],
      ['Vienna',          'vienna.js',          'viennaSpots'],
      ['Vilnius',         'vilnius.js',          'vilniusSpots'],
    ];

    const all = [];
    for (const [cityName, file, exportName] of files) {
      const filePath = `file://${path.join(root, 'src/data/spots', file)}`;
      try {
        const mod = await import(filePath);
        const spots = mod[exportName] ?? [];
        for (const s of spots) all.push({ ...s, _city: cityName });
      } catch (e) {
        console.warn(`  [warn] could not load ${file}: ${e.message}`);
      }
    }
    return all;
  } catch (e) {
    console.error('Fatal: could not load seed data:', e.message);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { km: THRESHOLD, city: filterCity } = parseArgs();

  console.log(`\nVenture seed-data coordinate audit`);
  console.log(`Threshold : ${THRESHOLD} km from city centre`);
  if (filterCity) console.log(`City filter: ${filterCity}`);
  console.log('─'.repeat(72));

  const allSpots = await loadAllSpots();
  const total    = allSpots.length;

  const outliers  = [];
  const noCoords  = [];
  const noCenter  = [];
  const verified  = []; // genuinely distant spots (kept with a note)

  // Known-genuine distant spots: verified against Wikipedia / Google Maps.
  // These are real day-trip destinations that legitimately exceed the city
  // centre threshold.  The planner will correctly cluster them as day-trips.
  const VERIFIED_DISTANT = new Set([
    // Oaxaca region (state is large; all sites are genuine day-trips)
    'San José del Pacífico',          // 106 km S — mountain village, psychedelic tourism
    'Miahuatlán de Porfirio Díaz Monday Market', // 85 km S — indigenous market
    'Hierve el Agua',                 // 53 km E — petrified waterfall
    'Mitla Archaeological Zone',      // 43 km E — Zapotec ruins, most-visited from Oaxaca
    'Papalometl Mezcal Palenques (Small Distilleries)', // 40 km — correct agave highlands
    // Chiang Mai region
    'Royal Project Highland Gardens (Doi Ang Khang)', // 92 km N, Myanmar border
    'Doi Inthanon National Park',     // 54 km SW — Thailand's highest peak
    // Hanoi region
    'Ninh Bình — Tràng An UNESCO Landscape', // 87 km S — UNESCO site, standard day trip
    // Ho Chi Minh City region
    'Cần Giờ Mangrove Biosphere Reserve',    // 57 km S — UNESCO biosphere reserve
    'Củ Chi Tunnels — Bến Dược Site',        // 41 km NW — major historic site
    // Tbilisi region
    'Kvevri Wine Tasting in Old Kakheti',    // 61 km E — Georgia's wine country
    // Tallinn region
    'Viru Bog Walk',                  // 61 km SE — correct (Lahemaa National Park)
    // New Orleans region
    'Whitney Plantation (Slavery Museum)',   // 57 km W — actual location in Wallace, LA
    'Whitney Plantation (not Oak Alley)',    // same plantation, slightly different coords
    // Krakow region
    'Auschwitz-Birkenau',             // 53 km W — correct (Oświęcim); most-visited from Krakow
    // Osaka region
    'Akashi Straits from Maiko Beach',       // 47 km W — Maiko/Akashi area (Kobe coast)
    // Copenhagen region
    'Kronborg Castle Casements',      // 40 km N — Elsinore/Helsingør; correct location
  ]);

  for (const spot of allSpots) {
    if (filterCity && spot._city !== filterCity) continue;

    const centre = CITY_CENTRES[spot._city];
    if (!centre) { noCenter.push(spot); continue; }

    const lat = Number(spot.lat);
    const lng = Number(spot.lng);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) { noCoords.push(spot); continue; }

    const d = distKm(lat, lng, centre.lat, centre.lng);
    if (d > THRESHOLD) {
      if (VERIFIED_DISTANT.has(spot.id) || VERIFIED_DISTANT.has(spot.name)) {
        verified.push({ ...spot, _distKm: d });
      } else {
        outliers.push({ ...spot, _distKm: d });
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\nTotal seed spots audited : ${filterCity ? allSpots.filter(s => s._city === filterCity).length : total}`);
  console.log(`Spots missing coordinates: ${noCoords.length}`);
  console.log(`Cities missing centre    : ${[...new Set(noCenter.map(s => s._city))].join(', ') || 'none'}`);
  console.log(`\nOUTLIERS (> ${THRESHOLD} km from city centre):`);
  console.log('─'.repeat(72));

  if (outliers.length === 0) {
    console.log('  ✓  None — all static seed spots are within the sanity threshold.\n');
  } else {
    outliers
      .sort((a, b) => b._distKm - a._distKm)
      .forEach(s => {
        const centre = CITY_CENTRES[s._city];
        console.log(
          `  ✗  ${s.name.padEnd(42)} | ${s._city.padEnd(16)} | ${s._distKm.toFixed(1).padStart(5)} km` +
          `\n       stored  (${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)})` +
          `  centre (${centre.lat}, ${centre.lng})`
        );
      });
    console.log();
  }

  if (verified.length > 0) {
    console.log(`VERIFIED DISTANT (genuinely far, intentionally kept):`);
    verified.forEach(s => console.log(`  ✓  ${s.name} | ${s._city} | ${s._distKm.toFixed(1)} km`));
    console.log();
  }

  console.log(`\nManchester note:`);
  console.log(`  Manchester has no static seed file. Spots (including Salford Quays) are`);
  console.log(`  stored in Firestore, populated by the live research pipeline.`);
  console.log(`  Salford Quays' bad coords came from a Mapbox geocode that returned a`);
  console.log(`  point ~27 km from Manchester centre — inside the 35 km threshold at`);
  console.log(`  research time. To repair: re-run research for Manchester (the updated`);
  console.log(`  proximity bias + sanity guard will produce correct coords) or correct`);
  console.log(`  lat/lng directly in the Firestore citySpots/manchester/spots collection.`);
  console.log(`  Correct Salford Quays coords: lat 53.4732, lng -2.2998 (~2.5 km W of centre).\n`);

  process.exit(outliers.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
