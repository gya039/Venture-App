/**
 * Splits src/data/citySpots.js into per-city files under src/data/spots/
 * and rewrites src/data/citySpots.js as a re-export barrel.
 *
 * Run from the project root: node scripts/split-spots.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const src = readFileSync(join(root, 'src/data/citySpots.js'), 'utf8');
const lines = src.split('\n');

// ── helper functions ────────────────────────────────────────────────────────

function cityToSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function cityToExportName(name) {
  // "Ho Chi Minh City" → "hoChiMinhCitySpots"
  return (
    name
      .split(/\s+/)
      .map((w, i) =>
        i === 0
          ? w[0].toLowerCase() + w.slice(1).toLowerCase()
          : w[0].toUpperCase() + w.slice(1).toLowerCase()
      )
      .join('') + 'Spots'
  );
}

// ── collect spot lines grouped by city ─────────────────────────────────────

const byCity = new Map(); // city name → string[]

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) continue;
  const m = trimmed.match(/city:'([^']+)'/);
  if (!m) continue;
  const city = m[1];
  if (!byCity.has(city)) byCity.set(city, []);
  byCity.get(city).push(line.trimEnd());
}

// ── write per-city files ────────────────────────────────────────────────────

const spotsDir = join(root, 'src/data/spots');
mkdirSync(spotsDir, { recursive: true });

const cityEntries = []; // { city, slug, exportName, count }

for (const [city, cityLines] of byCity) {
  const slug = cityToSlug(city);
  const exportName = cityToExportName(city);

  // strip trailing commas on each object line then join with commas
  const objects = cityLines.map((l) => l.replace(/,\s*$/, '')).join(',\n');

  const fileContent = `export const ${exportName} = [\n${objects},\n];\n`;

  writeFileSync(join(spotsDir, `${slug}.js`), fileContent, 'utf8');
  cityEntries.push({ city, slug, exportName, count: cityLines.length });
  console.log(`  wrote ${slug}.js  (${cityLines.length} spots)`);
}

// ── write barrel index ──────────────────────────────────────────────────────

const imports = cityEntries
  .map((e) => `import { ${e.exportName} } from './${e.slug}.js';`)
  .join('\n');

const spreadList = cityEntries.map((e) => `  ...${e.exportName}`).join(',\n');

const barrelContent = `${imports}

export const citySpots = [
${spreadList},
];
`;

writeFileSync(join(spotsDir, 'index.js'), barrelContent, 'utf8');
console.log('\n  wrote spots/index.js');

// ── rewrite src/data/citySpots.js as thin re-export ────────────────────────

const getStaticSpotsMatch = src.match(
  /\/\*\*[\s\S]*?\*\/\nexport function getStaticSpots[\s\S]+?^}/m
);

const newCitySpots = `/**
 * City spots — static seed data merged with Firestore in getCachedSpots().
 * Source of truth is src/data/spots/*.js — one file per city.
 */
import { citySpots as _citySpots } from './spots/index.js';

export const citySpots = _citySpots;

/**
 * Get static spots for a city — case-insensitive match.
 */
export function getStaticSpots(city) {
  return citySpots.filter(
    (s) => s.city.toLowerCase() === city.toLowerCase()
  );
}
`;

writeFileSync(join(root, 'src/data/citySpots.js'), newCitySpots, 'utf8');
console.log('  rewrote src/data/citySpots.js as barrel re-export');

// ── summary ─────────────────────────────────────────────────────────────────

const total = cityEntries.reduce((s, e) => s + e.count, 0);
console.log(`\nDone. ${cityEntries.length} cities, ${total} spots total.\n`);
cityEntries.sort((a, b) => a.count - b.count);
for (const e of cityEntries) {
  console.log(`  ${e.city.padEnd(24)} ${e.count}`);
}
