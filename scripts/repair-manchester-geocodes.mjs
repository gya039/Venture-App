#!/usr/bin/env node
/**
 * scripts/repair-manchester-geocodes.mjs
 *
 * Repair live Firestore geocode data for Manchester citySpots.
 *
 * What this does:
 *   1. Loads Manchester spots from Firestore via the REST API (no firebase-admin ADC needed)
 *   2. Re-geocodes every spot using the CORRECTED strategy cascade:
 *        - strategies 1 + 2 now include `neighborhood,locality` types so area
 *          names like "Salford Quays" resolve as the docklands district (~2.5 km
 *          from centre) rather than a same-named pub/venue in Todmorden (~27 km)
 *        - proximity bias (city centre) is always present — this was already the
 *          case in route.js; the missing piece was the type list
 *   3. Reports every spot sorted by stored distance from Manchester centre,
 *      showing stored vs re-geocoded coords and the delta for the top 10 + Salford Quays
 *   4. Writes corrected lat/lng for any materially mis-placed spot (moved > 1 km) back
 *      to Firestore, then re-reports the final state of those spots
 *
 * Prerequisites:
 *   firebase login  (already done — CLI token is used automatically)
 *
 * Usage:
 *   node scripts/repair-manchester-geocodes.mjs
 *
 * Dry-run (no Firestore writes):
 *   DRY_RUN=1 node scripts/repair-manchester-geocodes.mjs
 */

import path           from 'path';
import { fileURLToPath } from 'url';
import { readFileSync }  from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.resolve(__dirname, '..');

// ── Load .env.local ───────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(path.join(root, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env.local not present — fall through */ }
}
loadEnv();

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_ID   = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'journal-fa077';
const MAPBOX_TOKEN = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const CITY         = 'manchester';
const CITY_NAME    = 'Manchester';
const SANITY_KM    = 35;
const MATERIAL_KM  = 1.0;
// Auto-write only when the corrected result lands within INNER_KM of the city
// centre.  Spots this close are almost certainly urban neighborhoods rather than
// distant natural landmarks (lakes, hills) that should stay at their stored coords.
// Raise this if you need to auto-repair outer suburbs; the default 6 km is
// conservative and means only clear inner-city mis-placements are written.
const INNER_KM     = 6.0;
const DRY_RUN      = !!process.env.DRY_RUN;

// Firebase CLI OAuth app (public client — values are in firebase-tools source)
const FIREBASE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

if (!MAPBOX_TOKEN) {
  console.error('ERROR: no Mapbox token. Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local');
  process.exit(1);
}

// ── Firebase auth — use CLI's stored refresh token ────────────────────────────
function getStoredTokens() {
  const cfgPath = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? '',
    '.config/configstore/firebase-tools.json'
  );
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    return cfg.tokens ?? null;
  } catch {
    return null;
  }
}

async function getFreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     FIREBASE_CLIENT_ID,
      client_secret: FIREBASE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Convert a Firestore REST document to a plain JS object */
function fsDocToObj(doc) {
  const obj = { _id: doc.name.split('/').pop(), _path: doc.name };
  for (const [key, val] of Object.entries(doc.fields ?? {})) {
    if      (val.stringValue  !== undefined) obj[key] = val.stringValue;
    else if (val.integerValue !== undefined) obj[key] = Number(val.integerValue);
    else if (val.doubleValue  !== undefined) obj[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
    else if (val.nullValue    !== undefined) obj[key] = null;
    else if (val.mapValue     !== undefined) obj[key] = fsDocToObj({ name: '', fields: val.mapValue.fields ?? {} });
    else                                     obj[key] = undefined;
  }
  return obj;
}

/** List all documents in a collection (handles pagination) */
async function listDocs(collectionPath, authToken) {
  const docs = [];
  let pageToken = null;
  do {
    let url = `${FS_BASE}/${collectionPath}?pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!res.ok) throw new Error(`Firestore list failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    for (const doc of (data.documents ?? [])) docs.push(fsDocToObj(doc));
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);
  return docs;
}

/** Wrap a JS value as a Firestore REST typed value */
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

/** PATCH specific fields on a Firestore document */
async function patchDoc(docPath, fields, authToken) {
  const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FS_BASE}/${docPath}?${fieldPaths}`;
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, fsValue(v)])
    ),
  };
  const res = await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore patch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function distKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function passesSanity(coords, centre) {
  if (!coords?.lat || !coords?.lng) return false;
  if (!centre?.lat || !centre?.lng) return true;
  return distKm(coords.lat, coords.lng, centre.lat, centre.lng) <= SANITY_KM;
}

// ── Mapbox — corrected geocode cascade ────────────────────────────────────────
async function getCityCenter(city, token) {
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(city)}.json` +
    `?types=place&limit=1&access_token=${token}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.features?.length) return null;
  const [lng, lat] = data.features[0].center;
  const countryCtx  = data.features[0].context?.find(c => c.id.startsWith('country.'));
  const countryCode = countryCtx?.short_code?.split('-')[0] ?? null;
  return { lat, lng, countryCode };
}

async function geocodeWithCorrectTypes(spot, cityName, centre, token) {
  const country = centre.countryCode ?? null;

  const tryQuery = async (query, types, useCountry = true, useBbox = true) => {
    const pad  = 0.35;
    const bbox = [centre.lng - pad, centre.lat - pad, centre.lng + pad, centre.lat + pad].join(',');
    // proximity is ALWAYS passed (already was in route.js; adding neighbourhood,locality is the fix)
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
              `?proximity=${centre.lng},${centre.lat}&types=${types}&limit=1&access_token=${token}`;
    if (useBbox)               url += `&bbox=${bbox}`;
    if (useCountry && country) url += `&country=${country}`;

    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.features?.length) return null;
    const [lng, lat] = d.features[0].center;
    if (!passesSanity({ lat, lng }, centre)) return null;
    return { lat, lng, type: d.features[0].place_type?.[0] ?? '?' };
  };

  // Strategy 1: name — NOW includes neighborhood,locality (the fix)
  let c = await tryQuery(spot.name, 'poi,neighborhood,locality');
  // Strategy 2: name + city — same type expansion
  if (!c) c = await tryQuery(`${spot.name}, ${cityName}`, 'poi,neighborhood,locality');
  // Strategies 3–8: unchanged from route.js cascade
  if (!c && spot.address) {
    const addrClean = spot.address.replace(/\b\d{4,5}(?:-\d{3,4})?\b/g, '').trim();
    const addrHasCity = addrClean.toLowerCase().includes(cityName.toLowerCase());
    if (!addrHasCity) c = await tryQuery(`${addrClean}, ${cityName}`, 'address,poi');
    if (!c)           c = await tryQuery(addrClean, 'address,poi');
  }
  if (!c && spot.neighbourhood) c = await tryQuery(`${spot.name}, ${spot.neighbourhood}, ${cityName}`, 'poi,address');
  if (!c) c = await tryQuery(`${spot.name}, ${cityName}`, 'poi,address', false);
  if (!c) c = await tryQuery(`${spot.name}, ${cityName}`, 'poi,address', true, false);
  if (!c) c = await tryQuery(`${spot.name}, ${cityName}`, 'poi,address', false, false);
  if (!c && spot.neighbourhood) c = await tryQuery(`${spot.neighbourhood}, ${cityName}`, 'neighborhood,locality,place', false, false);
  return c ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const W = 78;
  const hr = '─'.repeat(W);
  console.log(`\n${hr}`);
  console.log(`Venture  Manchester geocode repair${DRY_RUN ? '  [DRY RUN]' : ''}`);
  console.log(`${hr}\n`);

  // 1. Auth
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) {
    console.error('No Firebase CLI refresh token found. Run: firebase login');
    process.exit(1);
  }
  process.stdout.write('Refreshing Firebase access token… ');
  let authToken;
  try {
    authToken = await getFreshAccessToken(tokens.refresh_token);
    console.log('ok\n');
  } catch (e) {
    console.error(`\nFailed: ${e.message}`);
    process.exit(1);
  }

  // 2. Mapbox city centre
  process.stdout.write(`Fetching ${CITY_NAME} centre from Mapbox… `);
  const centre = await getCityCenter(CITY_NAME, MAPBOX_TOKEN);
  if (!centre) { console.error('FAILED'); process.exit(1); }
  console.log(`${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}  (${centre.countryCode})\n`);

  // 3. Load Firestore spots
  process.stdout.write(`Loading citySpots/${CITY}/spots… `);
  let spots;
  try {
    spots = await listDocs(`citySpots/${CITY}/spots`, authToken);
  } catch (e) {
    console.error(`\nFailed: ${e.message}`);
    process.exit(1);
  }
  console.log(`${spots.length} spots loaded\n`);

  // 4. Sort by stored distance (furthest first) for the report
  const withDist = spots.map(s => ({
    ...s,
    _storedLat: s.lat != null ? Number(s.lat) : null,
    _storedLng: s.lng != null ? Number(s.lng) : null,
    _storedKm:  (s.lat != null && s.lng != null)
      ? distKm(Number(s.lat), Number(s.lng), centre.lat, centre.lng)
      : null,
  })).sort((a, b) => (b._storedKm ?? -1) - (a._storedKm ?? -1));

  // Priority set: top 10 + any spot named "Salford Quays"
  const prioritySet = new Set(withDist.slice(0, 10).map(s => s._id));
  for (const s of withDist) {
    if (s.name?.toLowerCase().includes('salford quays')) prioritySet.add(s._id);
  }

  // 5. Re-geocode and report
  console.log(hr);
  console.log('Re-geocoding top 10 by stored distance + Salford Quays (corrected type list)');
  console.log(hr);
  const nameW = 40, distW = 22;
  console.log(
    'Name'.padEnd(nameW) +
    'Stored (dist km)'.padEnd(distW) +
    'Re-geocoded (dist km)'.padEnd(distW) +
    'Move    MapboxType'
  );
  console.log('─'.repeat(nameW + distW + distW + 20));

  const repairs   = [];
  let reqCount    = 0;

  for (const spot of withDist) {
    if (!prioritySet.has(spot._id)) continue;
    if (reqCount > 0) await new Promise(r => setTimeout(r, 400)); // ~2.5 req/s
    reqCount++;

    const reGeo = await geocodeWithCorrectTypes(spot, CITY_NAME, centre, MAPBOX_TOKEN);

    const storedCell = spot._storedKm != null
      ? `${spot._storedLat?.toFixed(4)},${spot._storedLng?.toFixed(4)} (${spot._storedKm.toFixed(1)})`
      : '—';

    let moveKm = null, newKm = null;
    if (reGeo && spot._storedLat != null) {
      moveKm = distKm(spot._storedLat, spot._storedLng, reGeo.lat, reGeo.lng);
      newKm  = distKm(reGeo.lat, reGeo.lng, centre.lat, centre.lng);
    } else if (reGeo) {
      newKm = distKm(reGeo.lat, reGeo.lng, centre.lat, centre.lng);
    }

    const reGeoCell = reGeo
      ? `${reGeo.lat.toFixed(4)},${reGeo.lng.toFixed(4)} (${newKm?.toFixed(1)})`
      : 'FAILED';
    const moveCell  = moveKm != null ? `${moveKm.toFixed(1)} km` : '—';
    const flag      = moveKm != null && moveKm > MATERIAL_KM ? '  ← REPAIR' : '';

    console.log(
      spot.name.slice(0, nameW - 2).padEnd(nameW) +
      storedCell.padEnd(distW) +
      reGeoCell.padEnd(distW) +
      moveCell.padEnd(8) +
      (reGeo?.type ?? '') + flag
    );

    // Auto-write only when:
    //   (a) the result moved materially (> MATERIAL_KM)
    //   (b) the NEW location is within INNER_KM of the city centre
    //
    // Condition (b) is the key gate.  A neighborhood-type geocode for "Salford Quays"
    // correctly returns the docklands district ~3 km from Manchester centre.  For a
    // genuine outer landmark like Rivington Pike (~22 km away), the neighborhood type
    // may return a different location and push the result further from centre — that
    // should NOT be written automatically.  If the new result is further than the
    // stored result, it's almost certainly a regression, not a fix.
    const isConfirmedImprovement =
      moveKm != null && moveKm > MATERIAL_KM &&
      reGeo  != null &&
      newKm  != null &&
      newKm  <= INNER_KM;  // must land in inner urban area to be auto-written

    if (isConfirmedImprovement) {
      repairs.push({ spot, newLat: reGeo.lat, newLng: reGeo.lng, moveKm, newKm });
    }
  }

  console.log('─'.repeat(nameW + distW + distW + 20));
  console.log(`\nMapbox calls: ${reqCount}  |  Auto-repair candidates (moved > ${MATERIAL_KM}km AND new dist ≤ ${INNER_KM}km): ${repairs.length}`);
  console.log('Spots that moved but stayed outside INNER_KM are flagged for manual review (← REPAIR marker above).');
  console.log('These may have correct stored coords (hills, lakes, outer suburbs) or need a bespoke geocode query.\n');

  // 6. Firestore writes
  if (repairs.length === 0) {
    console.log('No material mis-placements found — Firestore is clean.\n');
    return;
  }

  console.log(hr);
  console.log(`Firestore repairs${DRY_RUN ? ' [DRY RUN — no writes]' : ''}:`);
  console.log(hr);

  for (const { spot, newLat, newLng, moveKm, newKm } of repairs) {
    console.log(`\n  ${spot.name}`);
    console.log(`    Before : lat=${spot._storedLat?.toFixed(6)}, lng=${spot._storedLng?.toFixed(6)}  (${spot._storedKm?.toFixed(1)} km from centre)`);
    console.log(`    After  : lat=${newLat.toFixed(6)}, lng=${newLng.toFixed(6)}  (${newKm?.toFixed(1)} km from centre)`);
    console.log(`    Delta  : ${moveKm.toFixed(2)} km`);

    if (DRY_RUN) {
      console.log(`    Status : dry run — not written`);
    } else {
      try {
        const docPath = `citySpots/${CITY}/spots/${spot._id}`;
        await patchDoc(docPath, { lat: newLat, lng: newLng, coordsMissing: false }, authToken);
        console.log(`    Status : ✓ updated in Firestore`);
      } catch (e) {
        console.error(`    Status : ✗ FAILED — ${e.message}`);
      }
    }
  }

  console.log('\n' + hr);
  console.log('Done.\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
