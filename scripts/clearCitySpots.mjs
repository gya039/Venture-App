/**
 * scripts/clearCitySpots.mjs
 *
 * One-time cleanup: deletes every spot document from every city in
 * the citySpots/{city}/spots subcollection.  Run this after deploying
 * the Mapbox-geocoding fix so that trips re-research with accurate coords.
 *
 * Prerequisites:
 *   1. Firebase CLI installed and logged in:  firebase login
 *   2. Run from the functions/ directory (firebase-admin is installed there):
 *
 *        cd functions
 *        GOOGLE_CLOUD_PROJECT=<your-project-id> node ../scripts/clearCitySpots.mjs
 *
 *   The project ID is NEXT_PUBLIC_FIREBASE_PROJECT_ID in your .env.local
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const cityRefs = await db.collection('citySpots').listDocuments();
if (!cityRefs.length) {
  console.log('No cities found in citySpots — nothing to clear.');
  process.exit(0);
}

console.log(`Found ${cityRefs.length} cit${cityRefs.length === 1 ? 'y' : 'ies'} to clear…`);

let totalDeleted = 0;

for (const cityRef of cityRefs) {
  const spotsSnap = await cityRef.collection('spots').get();
  if (!spotsSnap.size) {
    console.log(`  ${cityRef.id}: no spots`);
    continue;
  }

  // writeBatch limit is 500; typical city cache ≤ 30 spots
  const batch = db.batch();
  spotsSnap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();

  totalDeleted += spotsSnap.size;
  console.log(`  ${cityRef.id}: deleted ${spotsSnap.size} spot${spotsSnap.size === 1 ? '' : 's'}`);
}

console.log(`\nDone — ${totalDeleted} total spot${totalDeleted === 1 ? '' : 's'} deleted.`);
console.log('Users will get fresh Mapbox-geocoded coordinates on their next research run.');
