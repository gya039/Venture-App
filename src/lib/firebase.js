// src/lib/firebase.js
// Firebase app singleton — safe to import in any client component.
// Only initialises when env vars are present (i.e. not during static prerender).

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  getFirestore,
} from 'firebase/firestore';

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

// Skip initialisation during prerender/SSR (no env vars available)
const app = apiKey
  ? getApps().length === 0
    ? initializeApp({
        apiKey,
        authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        measurementId:     process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      })
    : getApp()
  : null;

export const auth = app ? getAuth(app) : null;

// Use in-memory Firestore cache — works on all browsers including Safari iOS/iPadOS.
// IndexedDB-based persistence (persistentLocalCache) was causing silent hangs on
// Safari because of SharedWorker/BroadcastChannel restrictions on that platform.
// Memory cache has no cross-session persistence but is 100% compatible everywhere.
// The service worker handles asset caching; Firestore handles its own network retry.
export const db = app
  ? (() => {
      try {
        return initializeFirestore(app, {
          localCache: memoryLocalCache(),
        });
      } catch {
        // Already initialised (e.g. hot-reload) — fall back to getFirestore
        return getFirestore(app);
      }
    })()
  : null;

export default app;
