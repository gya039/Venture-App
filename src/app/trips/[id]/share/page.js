'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getTripPublic, getTripByToken, getDayPlansPublic, getDayPlanSpotsPublic, getCachedSpots } from '@/lib/db';
import { formatPrice } from '@/lib/pricing';
import { getHiddennessLevel } from '@/constants/hiddenness';
import ScoreMedallion from '@/components/ScoreMedallion';

/* ── Helpers ────────────────────────────────────────────────── */
function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map((c) =>
    String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))
  ).join('');
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const SLOTS = ['morning', 'afternoon', 'evening'];
const SLOT_LABELS = { morning: '🌅 Morning', afternoon: '☀️ Afternoon', evening: '🌙 Evening' };

/* ── Spot row in itinerary ───────────────────────────────────── */
const VERIFY_LINK_STYLE = {
  color: 'inherit', fontSize: '0.8em',
  textDecoration: 'underline', textDecorationStyle: 'dotted',
  textUnderlineOffset: '2px',
};

function ShareSpot({ spot }) {
  const level = getHiddennessLevel(spot.hiddennessScore ?? 1);
  const price = formatPrice(spot);
  return (
    <div className="share-spot" style={{ '--sc': `var(${level.cssVar ?? '--t3'})` }}>
      <ScoreMedallion score={spot.hiddennessScore ?? 5} size={40} showDen={false} />
      <div className="ss-info">
        <div className="ss-nm">{spot.name}</div>
        <div className="ss-mt">
          {spot.category && `${spot.category} · `}
          {level.label}
          {price.priceType === 'free'    && ' · Free'}
          {price.priceType === 'pass'    && ' · Included with pass'}
          {price.priceType === 'paid'    && (
            <>{' · ≈'}{price.label}{' · '}<a href={price.verifyUrl} target="_blank" rel="noopener noreferrer" style={VERIFY_LINK_STYLE}>verify →</a></>
          )}
          {price.priceType === 'unknown' && price.verifyUrl && (
            <>{' · '}<a href={price.verifyUrl} target="_blank" rel="noopener noreferrer" style={VERIFY_LINK_STYLE}>check price →</a></>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Day card ────────────────────────────────────────────────── */
function ShareDay({ day, spotMap }) {
  const grouped = SLOTS.reduce((acc, slot) => {
    acc[slot] = (day.spots ?? [])
      .filter((s) => (s.timeOfDay ?? 'morning') === slot)
      // spotMap is a flat { spotId → spot } map (same shape as useDayPlanner).
      // Events have name inline (spotId is null) so their spread is just {}.
      .map((s) => ({ ...s, ...(s.spotId ? (spotMap[s.spotId] ?? {}) : {}) }))
      .filter((s) => s.name);
    return acc;
  }, {});

  const totalSpots = SLOTS.reduce((n, s) => n + grouped[s].length, 0);

  if (totalSpots === 0) return null;

  return (
    <div className="share-day">
      <div className="sd-head">
        <div className="sd-n">{day.dayNumber}</div>
        <span className="sd-t">Day {day.dayNumber}</span>
        {day.planDate && <span className="sd-date">{fmtDateShort(day.planDate)}</span>}
      </div>
      <div className="share-slots">
        {SLOTS.map((slot) => {
          const slotSpots = grouped[slot];
          return (
            <div key={slot} className="share-slot">
              <div className="ss-lbl">
                <span className="dot" />
                {SLOT_LABELS[slot].split(' ')[1]}
              </div>
              {slotSpots.length > 0
                ? slotSpots.map((spot, i) => <ShareSpot key={spot.dayPlanSpotId ?? i} spot={spot} />)
                : <div className="ss-empty">Nothing planned</div>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Destination section ─────────────────────────────────────── */
function DestSection({ dest }) {
  const [days,    setDays]    = useState([]);
  const [spotMap, setSpotMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dest?.id) { setLoading(false); return; }
    async function load() {
      try {
        // Fetch day plans + their spot stubs in parallel with the city spot cache.
        // Mirror useDayPlanner exactly: one getCachedSpots(dest.city) call builds
        // a flat { spotId → spot } map — no dependency on spotCity stored per doc
        // (that field can be missing or case-mismatched on older data).
        const [dayPlans, allCitySpots] = await Promise.all([
          getDayPlansPublic(dest.id),
          getCachedSpots(dest.city),
        ]);
        const flatSpotMap = Object.fromEntries(allCitySpots.map(s => [s.id, s]));

        const plansWithSpots = await Promise.all(
          dayPlans.map(async (plan) => {
            const spots = await getDayPlanSpotsPublic(plan.id);
            return { ...plan, spots };
          })
        );

        setDays(plansWithSpots);
        setSpotMap(flatSpotMap);
      } catch (err) {
        console.error('[SharePage] load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dest?.id]); // eslint-disable-line

  return (
    <div style={{ marginBottom: 44 }}>
      {dest.city && (
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 28, letterSpacing: '-0.015em', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{flagEmoji(dest.countryCode)}</span>
            {dest.city}
          </h2>
          {dest.startDate && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.03em' }}>
              {fmtDate(dest.startDate)}{dest.endDate ? ` – ${fmtDate(dest.endDate)}` : ''}
            </p>
          )}
        </div>
      )}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map((i) => <div key={i} className="skel" style={{ height: 80, borderRadius: 14 }} />)}
        </div>
      ) : days.length === 0 ? (
        <div style={{ padding: 20, border: '1.5px dashed var(--line)', borderRadius: 14, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--faint)' }}>No day plans added yet</p>
        </div>
      ) : (
        days.filter((d) => (d.spots ?? []).length > 0).map((day) => (
          <ShareDay key={day.id} day={day} spotMap={spotMap} />
        ))
      )}
    </div>
  );
}

/* ── Main (inner — needs useSearchParams, so wrapped in Suspense below) ── */
function SharePageInner() {
  const { id: tripId }  = useParams();
  const searchParams    = useSearchParams();
  const token           = searchParams.get('token');

  const [trip,    setTrip]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (!tripId) return;
    const fetcher = token
      ? getTripByToken(tripId, token)   // private link
      : getTripPublic(tripId);           // public link
    fetcher
      .then((t) => { setTrip(t); if (!t) setError('not_found'); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tripId, token]); // eslint-disable-line

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  if (error || !trip) return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <span style={{ fontSize: '3rem' }}>🗺️</span>
      <p style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22, color: 'var(--ink)' }}>Itinerary not found</p>
      <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 300, lineHeight: 1.6 }}>
        {token
          ? 'This private link may have been revoked, or the URL is incomplete.'
          : "This share link may have expired, or the trip hasn't been made public yet."}
      </p>
      <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none', flex: 'none' }}>Plan your own trip →</Link>
    </div>
  );

  const firstDest = trip.destinations[0];
  const title = trip.name ?? (trip.isMultiCity
    ? trip.destinations.map((d) => d.city).join(' · ')
    : firstDest?.city ?? 'Trip');

  const totalDays = trip.destinations.reduce((sum, d) => {
    if (!d.startDate || !d.endDate) return sum;
    return sum + Math.max(0, Math.round((new Date(d.endDate + 'T00:00:00') - new Date(d.startDate + 'T00:00:00')) / 86400000));
  }, 0);

  const creatorInitials = (trip.creatorEmail ?? trip.creatorName ?? 'V').slice(0, 2).toUpperCase();
  const creatorName     = trip.creatorName ?? trip.creatorEmail?.split('@')[0] ?? 'A Venturer';

  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>

      {/* ── Sticky nav ── */}
      <div className="share-top">
        <Link href="/" className="wordmark">
          Venture<sup>N48°51′</sup>
        </Link>
        <span className="ro-badge">{token ? '🔒 Private · View only' : 'Read only'}</span>
        <div style={{ flex: 1 }} />
        <Link href="/auth" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
          Plan your own trip →
        </Link>
      </div>

      {/* ── Hero ── */}
      <div className="share-hero">
        <div className="sh-cover">
          <div className="grid" />
        </div>
        <div className="sh-content">
          <div className="sh-eyebrow">{token ? 'Venture · Private itinerary' : 'Venture · Public itinerary'}</div>
          <h1>
            {title}
            {!trip.isMultiCity && firstDest?.countryCode && (
              <span className="flag">{flagEmoji(firstDest.countryCode)}</span>
            )}
          </h1>
          <div className="sh-meta">
            {totalDays > 0 && (
              <div className="sh-fact">
                <div className="v">{totalDays}</div>
                <div className="k">nights</div>
              </div>
            )}
            {firstDest?.startDate && (
              <div className="sh-fact">
                <div className="v" style={{ fontSize: 18 }}>{fmtDate(firstDest.startDate)}</div>
                <div className="k">departure</div>
              </div>
            )}
            <div className="sh-fact">
              <div className="v">{trip.destinations.length}</div>
              <div className="k">{trip.destinations.length === 1 ? 'destination' : 'cities'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="share-body">

        {/* Curator byline */}
        <div className="share-byline">
          <div className="sb-av">{creatorInitials}</div>
          <div className="sb-tx">
            Itinerary curated by <b>{creatorName}</b> using Venture's AI research.
          </div>
          <div className="sb-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={copyLink}
              style={{ border: '1px solid var(--line-strong)', cursor: 'pointer' }}
            >
              {copied ? '✓ Copied!' : '🔗 Copy link'}
            </button>
          </div>
        </div>

        {/* Day-by-day itinerary */}
        {trip.destinations.map((dest) => (
          <DestSection key={dest.id} dest={dest} />
        ))}

        {/* "Find your own gems" CTA */}
        <div className="share-cta">
          <div className="sc-meds">
            {[9, 8, 7, 6, 5].map((s) => (
              <ScoreMedallion key={s} score={s} size={46} showDen={false} />
            ))}
          </div>
          <h2>Your next trip is <em>hiding something.</em></h2>
          <p>Let Venture's AI find the spots most travellers never discover — scored and mapped for free.</p>
          <Link href="/auth" className="btn btn-primary" style={{ textDecoration: 'none', flex: 'none' }}>
            Find your hidden gems →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Export: wrapped in Suspense so useSearchParams works ─────── */
export default function SharePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--line)', borderTopColor: 'var(--terracotta)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    }>
      <SharePageInner />
    </Suspense>
  );
}
