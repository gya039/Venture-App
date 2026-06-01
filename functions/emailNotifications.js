/**
 * emailNotifications.js — Firebase Cloud Function
 *
 * Runs daily via Cloud Scheduler and sends a "7 days until your trip!" reminder
 * email to any user whose trip starts exactly 7 days from now.
 *
 * Setup:
 *  1. Set RESEND_API_KEY:
 *       firebase functions:secrets:set RESEND_API_KEY
 *  2. Set RESEND_FROM (your verified Resend sender domain):
 *       firebase functions:config:set resend.from="Venture <trips@yourdomain.com>"
 *  3. Deploy:
 *       firebase deploy --only functions:sendTripReminders
 *
 * The function uses Cloud Scheduler via the pubsub trigger.
 * In Firebase Console → Cloud Scheduler, create a job:
 *   Schedule: 0 9 * * *   (daily 9am UTC)
 *   Topic:    venture-daily-cron
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

// Initialize Admin SDK (shared with research.js — safe to call multiple times)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

/**
 * Build a simple HTML email body for the trip reminder.
 */
function buildEmailHtml({ userName, tripName, city, startDate, tripUrl }) {
  const dateStr = startDate
    ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
</head>
<body style="background:#080810;color:#f0f0ff;font-family:sans-serif;margin:0;padding:0;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">

    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#f59e0b,#f97316);font-weight:900;font-size:1.5rem;color:#000;">V</div>
    </div>

    <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:8px;color:#f0f0ff;">
      ✈️ 7 days to go, ${userName}!
    </h1>
    <p style="color:#9ca3af;line-height:1.6;margin-bottom:24px;">
      Your trip to <strong style="color:#f0f0ff;">${tripName || city}</strong> starts ${dateStr ? `on ${dateStr}` : 'soon'}.
      Your itinerary is ready — here's a quick look at what you've planned.
    </p>

    <div style="background:#12121e;border:1px solid #1f1f2e;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
      <p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Destination</p>
      <p style="font-size:1.1rem;font-weight:700;color:#f59e0b;">${city}</p>
      ${startDate ? `<p style="color:#9ca3af;font-size:0.85rem;margin-top:4px;">${dateStr}</p>` : ''}
    </div>

    <div style="text-align:center;margin-bottom:32px;">
      <a href="${tripUrl}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:700;font-size:1rem;padding:14px 32px;border-radius:10px;text-decoration:none;">
        Open my itinerary →
      </a>
    </div>

    <p style="color:#6b7280;font-size:0.75rem;text-align:center;line-height:1.6;">
      You're receiving this because you have a trip coming up in Venture.<br/>
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://venture.app'}" style="color:#f59e0b;">Open Venture</a>
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Cloud Function: runs daily, finds trips starting in 7 days, sends reminder emails.
 */
exports.sendTripReminders = onSchedule(
  {
    schedule:  'every day 09:00',
    timeZone:  'UTC',
    secrets:   [RESEND_API_KEY],
    memory:    '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    const resendKey = RESEND_API_KEY.value();
    if (!resendKey) {
      console.warn('[sendTripReminders] RESEND_API_KEY not set — skipping');
      return;
    }

    const { Resend } = require('resend');
    const resend = new Resend(resendKey);

    // Target window: trips starting 7 days from now (±12 hours to catch timezone variation)
    const targetMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const windowStart = admin.firestore.Timestamp.fromMillis(targetMs - 12 * 60 * 60 * 1000);
    const windowEnd   = admin.firestore.Timestamp.fromMillis(targetMs + 12 * 60 * 60 * 1000);

    const tripsSnap = await db.collection('trips')
      .where('firstStartDate', '>=', windowStart)
      .where('firstStartDate', '<=', windowEnd)
      .get();

    if (tripsSnap.empty) {
      console.log('[sendTripReminders] No trips in window');
      return;
    }

    console.log(`[sendTripReminders] Found ${tripsSnap.size} trip(s) in window`);

    const fromAddress = process.env.RESEND_FROM ?? 'Venture <notifications@venture.app>';
    const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? 'https://venture.app';

    await Promise.allSettled(
      tripsSnap.docs.map(async (tripDoc) => {
        const trip = tripDoc.data();
        const userId = trip.userId;
        if (!userId) return;

        // Get user email
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return;
        const userEmail = userDoc.data().email;
        if (!userEmail) return;
        const userName = userDoc.data().displayName ?? userEmail.split('@')[0];

        // Get first destination city
        const destSnap = await db.collection('destinations')
          .where('tripId', '==', tripDoc.id)
          .where('userId', '==', userId)
          .orderBy('sortOrder', 'asc')
          .limit(1)
          .get();
        const city = destSnap.docs[0]?.data()?.city ?? 'your destination';
        const startDateStr = destSnap.docs[0]?.data()?.startDate
          ? destSnap.docs[0].data().startDate.toDate().toISOString().slice(0, 10)
          : null;

        const tripUrl = `${appUrl}/trips/${tripDoc.id}`;
        const html    = buildEmailHtml({ userName, tripName: trip.name, city, startDate: startDateStr, tripUrl });

        const { error } = await resend.emails.send({
          from:    fromAddress,
          to:      userEmail,
          subject: `✈️ 7 days until your trip to ${city}!`,
          html,
        });

        if (error) {
          console.error(`[sendTripReminders] Failed to email ${userEmail}:`, error);
        } else {
          console.log(`[sendTripReminders] Sent reminder to ${userEmail} for trip ${tripDoc.id}`);
        }
      })
    );
  }
);
