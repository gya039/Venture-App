/**
 * analytics.js — thin PostHog wrapper.
 *
 * Usage:
 *   import { track } from '@/lib/analytics';
 *   track('trip_created', { city: 'Lisbon' });
 *
 * Add NEXT_PUBLIC_POSTHOG_KEY to .env.local to enable.
 * If the key is absent, all calls are silent no-ops.
 */

let ph = null; // posthog instance, loaded lazily

async function getPosthog() {
  if (typeof window === 'undefined') return null;
  if (ph) return ph;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const { default: posthog } = await import('posthog-js');
  if (!posthog.__loaded) {
    posthog.init(key, {
      api_host:       process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: false, // we use Next.js router events instead
      capture_pageleave: true,
      persistence:    'localStorage',
      autocapture:    false,
    });
  }
  ph = posthog;
  return ph;
}

/** Identify a signed-in user */
export async function identifyUser(uid, email) {
  const p = await getPosthog();
  p?.identify(uid, { email });
}

/** Reset identity on sign-out */
export async function resetAnalytics() {
  const p = await getPosthog();
  p?.reset();
}

/** Fire a named event with optional properties */
export async function track(event, props = {}) {
  const p = await getPosthog();
  p?.capture(event, props);
}

/*
 * Standard event names used across the app:
 *
 *  trip_created            { city, interests[] }
 *  research_completed      { city, spotCount }
 *  spot_starred            { spotId, city, hiddennessScore }
 *  spot_added_to_day       { spotId, city, slot }
 *  itinerary_exported      { tripId, dayCount }
 *  itinerary_shared        { tripId }
 *  onboarding_completed    { interests[] }
 *  install_prompt_accepted {}
 */
