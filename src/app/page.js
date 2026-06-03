'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useTrips } from '@/hooks/useTrips';
import { useSavedSpots } from '@/hooks/useSavedSpots';
import { getUser, getDayPlans, getPublicTripsLike, deleteTrip } from '@/lib/db';
import TripCard from '@/components/TripCard';
import TopNav from '@/components/TopNav';
import InstallBanner from '@/components/InstallBanner';
import OnboardingModal from '@/components/OnboardingModal';
import { useTripModal } from '@/components/TripModalProvider';
import ScoreMedallion from '@/components/ScoreMedallion';
import { flagEmoji } from '@/utils/flagEmoji';
import { getHiddennessLevel } from '@/constants/hiddenness';

/* ── Helpers ──────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T00:00:00') - Date.now()) / 86_400_000);
}

/* ── Hero next-trip card ───────────────────────────────────────── */
function TripHero({ trip, onDelete }) {
  const first = trip.destinations?.[0];
  const last  = trip.destinations?.[trip.destinations.length - 1];
  if (!first) return null;

  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const days      = daysUntil(first.startDate);
  const displayCity = trip.isMultiCity
    ? trip.destinations.map((d) => d.city).join(' · ')
    : first.city;

  const researchPct = (() => {
    const total = trip.destinations.length;
    const done  = trip.destinations.filter((d) => d.researchDone).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  })();

  // Fetch the rarest spots for this trip's destinations
  const [rarests, setRarests] = useState([]);
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    Promise.all(
      (trip.destinations ?? []).map((dest) =>
        dest.id ? getDayPlans(dest.id, user.uid).catch(() => []) : Promise.resolve([])
      )
    ).then((allDayPlans) => {
      if (cancelled) return;
      // getDayPlans gives day plan objects, each with spots
      // Pull scores from the trip's destination.researchDone for rarest finds
    });
    return () => { cancelled = true; };
  }, [trip.id, user?.uid]); // eslint-disable-line

  const tripDates = first.startDate
    ? `${fmtDateShort(first.startDate)}${last?.endDate ? ` – ${fmtDateShort(last.endDate)}` : ''}`
    : 'Dates TBD';

  const nights = first.startDate && last?.endDate
    ? Math.max(1, Math.round((new Date(last.endDate) - new Date(first.startDate)) / 86400000))
    : null;

  return (
    <div className="hero-trip" style={{ position: 'relative' }}>
      {confirming && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
            borderRadius: 'inherit',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, textAlign: 'center', lineHeight: 1.4, margin: 0 }}>
            Delete {displayCity}?
          </p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center', margin: 0 }}>
            This can't be undone.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
                color: '#fff', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                setDeleting(true);
                try { await onDelete?.(); } catch (err) { setDeleting(false); }
              }}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: 'none', background: '#dc2626', color: '#fff',
                cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
      {/* ── Left panel ── */}
      <div className="hero-left">
        <div className="hero-eyebrow">Next departure</div>

        <div className="hero-city">
          {displayCity}
          {!trip.isMultiCity && <span className="flag">{flagEmoji(first.countryCode)}</span>}
        </div>

        <div className="hero-meta">
          {first.country && `${first.country} · `}
          {tripDates}
          {nights && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
        </div>

        <div className="hero-progress">
          {/* Research progress */}
          <div className="hp-row">
            <span className="lbl">
              {researchPct === 100 && (
                <span className="dc">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                </span>
              )}
              {researchPct === 100 ? 'Research complete' : 'Researching…'}
            </span>
            <span className="ct">
              {trip.destinations.filter((d) => d.researchDone).length}/{trip.destinations.length} destinations
            </span>
          </div>
          <div className="hp-bar">
            <i style={{ width: `${researchPct}%` }} />
          </div>

          {/* Rarest finds — medallions from rarest-scored spots (show placeholder if none) */}
          <div className="hero-finds">
            <span className="ff-lbl">Rarest finds</span>
            <span className="ff-meds">
              {/* Show placeholder medallions based on research completion */}
              {researchPct === 100
                ? [9, 8, 7].map((s, i) => <ScoreMedallion key={i} score={s} size={40} />)
                : [5, 4, 3].map((s, i) => <ScoreMedallion key={i} score={s} size={40} />)
              }
            </span>
          </div>

          <div className="hero-cta">
            <Link href={`/trips/${trip.id}`} className="btn btn-primary">Open trip →</Link>
            <Link href={`/trips/${trip.id}/share`} className="btn btn-secondary">Share itinerary</Link>
          </div>

          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={{
                marginTop: 8, background: 'transparent', border: 'none',
                color: 'var(--muted)', fontSize: 'var(--text-xs)', fontWeight: 600,
                cursor: 'pointer', padding: 0,
                textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >
              Delete trip
            </button>
          )}
        </div>
      </div>

      {/* ── Right panel (photo placeholder + countdown dial) ── */}
      <div className="hero-right">
        {days !== null && (
          <div className="countdown-badge">
            <span className="cd-num">
              {days < 0 ? '✈' : days === 0 ? '🎉' : days}
            </span>
            <span className="cd-lab">
              {days < 0 ? 'ongoing' : days === 0 ? 'today!' : days === 1 ? 'day to go' : 'days to go'}
            </span>
          </div>
        )}
        {trip.coverPhoto
          ? <img src={trip.coverPhoto} alt={first.city} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
          : <span className="hero-photo-lab">[ photo · {first.city ?? 'city'} ]</span>
        }
      </div>
    </div>
  );
}

/* ── Stats strip (3-col, large serif numbers) ─────────────────── */
function StatsStrip({ trips, savedCount }) {
  const citiesExplored = new Set(
    trips
      .flatMap((t) => t.destinations ?? [])
      .filter((d) => d.researchDone)
      .map((d) => d.city)
  ).size;

  return (
    <div className="stats">
      <div className="stat">
        <div className="sn">{citiesExplored}<span className="sm-unit">+</span></div>
        <div className="sl">Cities explored</div>
      </div>
      <div className="stat">
        <div className="sn">{savedCount}</div>
        <div className="sl">Spots saved</div>
      </div>
      <div className="stat">
        <div className="sn">{trips.length}</div>
        <div className="sl">Total trips</div>
      </div>
    </div>
  );
}

/* ── Past trips (collapsible 2-col grid) ──────────────────────── */
function PastSection({ past, onDelete }) {
  const [open,       setOpen]       = useState(false);
  const [confirmId,  setConfirmId]  = useState(null); // tripId being confirmed
  const [deletingId, setDeletingId] = useState(null);

  return (
    <div>
      <button
        type="button"
        className={`past-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pt-l">
          Past trips <span className="cnt">{past.length}</span>
        </span>
        <span className="chev">▾</span>
      </button>

      <div className={`past-list${open ? '' : ' closed'}`} style={{ maxHeight: open ? 800 : 0 }}>
        {past.map((t) => {
          const first = t.destinations?.[0];
          if (!first) return null;
          const label = t.name ?? (t.isMultiCity
            ? t.destinations.map((d) => d.city).join(' · ')
            : first.city);
          const isConfirming = confirmId === t.id;
          const isDeleting   = deletingId === t.id;

          return (
            <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Link href={`/trips/${t.id}`} className="past-row" style={{ flex: 1 }}>
                <span className="pr-flag">{flagEmoji(first.countryCode)}</span>
                <span className="pr-main">
                  <span className="pr-dest">{label}</span>
                  <div className="pr-meta">
                    {fmtDate(first.startDate)}{first.endDate && ` · ${fmtDate(first.endDate)}`}
                  </div>
                </span>
                <span className="pr-done">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                  Completed
                </span>
              </Link>

              {/* Delete control */}
              {!isConfirming ? (
                <button
                  type="button"
                  onClick={() => setConfirmId(t.id)}
                  style={{
                    flexShrink: 0, marginLeft: 8,
                    background: 'transparent', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--muted)',
                    fontSize: 'var(--text-xs)', fontWeight: 600,
                    cursor: 'pointer', padding: '4px 8px',
                    transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
                >
                  Delete trip
                </button>
              ) : (
                <div
                  style={{
                    position: 'absolute', inset: 0, zIndex: 10,
                    background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
                    borderRadius: 8,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: 16,
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <p style={{ color: '#fff', fontWeight: 700, fontSize: 13, textAlign: 'center', lineHeight: 1.4, margin: 0 }}>
                    Delete {label}?
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, textAlign: 'center', margin: 0 }}>
                    This can't be undone.
                  </p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
                        color: '#fff', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={async () => {
                        setDeletingId(t.id);
                        try { await onDelete?.(t.id); } catch (err) {}
                        setDeletingId(null);
                        setConfirmId(null);
                      }}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                        border: 'none', background: '#dc2626', color: '#fff',
                        cursor: isDeleting ? 'default' : 'pointer',
                        opacity: isDeleting ? 0.5 : 1,
                      }}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Public itinerary cards ───────────────────────────────────── */
function TripsLikeYours({ userCities, currentUserId }) {
  const [publicTrips, setPublicTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userCities.length || !currentUserId) { setLoading(false); return; }
    getPublicTripsLike(userCities, currentUserId)
      .then(setPublicTrips)
      .catch(() => setPublicTrips([]))
      .finally(() => setLoading(false));
  }, [userCities.join(','), currentUserId]); // eslint-disable-line

  if (loading || !publicTrips.length) return null;

  return (
    <section className="section">
      <div className="sec-head">
        <h2>Trips like yours</h2>
        <Link href="/explore" className="viewall">Browse community →</Link>
      </div>
      <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14.5, color: 'var(--ink-soft)', margin: '-6px 0 16px' }}>
        Public itineraries from Venture travellers heading where you are.
      </p>
      <div className="shelf">
        {publicTrips.map((trip) => {
          const first = trip.destinations?.[0];
          if (!first) return null;
          const label = trip.name ?? (trip.isMultiCity
            ? trip.destinations.map((d) => d.city).join(' · ')
            : first.city);
          const avgScore = Math.round(
            (trip.destinations ?? []).reduce((s, d) => s + (d.avgHiddenness ?? 5), 0)
            / Math.max(1, trip.destinations?.length ?? 1)
          );
          const creatorInitials = (trip.creatorEmail ?? trip.creatorName ?? '??')
            .slice(0, 2).toUpperCase();

          return (
            <a
              key={trip.id}
              href={`/trips/${trip.id}/share`}
              className="pubcard"
              style={{ '--sc': `var(--t${Math.min(5, Math.ceil(avgScore / 2))})` }}
            >
              <div className="pub-top">
                <span className="pub-tag">Public itinerary</span>
                <ScoreMedallion score={avgScore} size={38} showDen={false} />
              </div>
              <div className="pub-city">
                {first.city}
                <span style={{ fontSize: '0.7em' }}>{flagEmoji(first.countryCode)}</span>
              </div>
              <div className="pub-vibe">{trip.vibe ?? 'Hidden gems itinerary'}</div>
              <div className="pub-stats">
                {trip.destinations?.length ?? 1} destination{(trip.destinations?.length ?? 1) !== 1 ? 's' : ''} · avg hiddenness {avgScore}
              </div>
              <div className="pub-foot">
                <span className="pub-av">{creatorInitials}</span>
                <span className="pub-by">by <b>{trip.creatorName ?? trip.creatorEmail?.split('@')[0] ?? 'Venturer'}</b></span>
                <span className="pub-view">View →</span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/* ── Floating hero discovery card ────────────────────────────── */
const HERO_CARDS = [
  { cls: 'c1', score: 9,  cat: 'Tile workshop',  name: 'Cortiço & Netos',    cssVar: '--t5' },
  { cls: 'c2', score: 10, cat: 'Street art',      name: 'Underdogs Gallery',  cssVar: '--t5' },
  { cls: 'c3', score: 7,  cat: 'Fado tavern',     name: 'Tasca do Chico',     cssVar: '--t4' },
];
const TIERS = [
  { v: '--t1', name: 'Tourist Trail',  rng: '1–2',  desc: 'On every tour bus route'    },
  { v: '--t2', name: 'Well-Trodden',   rng: '3–4',  desc: 'Popular, still worth it'    },
  { v: '--t3', name: 'Worth a Detour', rng: '5–6',  desc: 'Off the main drag'           },
  { v: '--t4', name: 'Local Secret',   rng: '7–8',  desc: "The locals' choice"          },
  { v: '--t5', name: 'Off the Radar',  rng: '9–10', desc: 'Almost nobody finds it'     },
];
const SPECTRUM_SCORES = [2, 4, 6, 8, 10];

/* ── Guest home — full marketing page ────────────────────────── */
function GuestHome() {
  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />

      {/* ══ Hero ══ */}
      <section className="mk-hero">
        <div>
          <div className="mh-eyebrow">AI-scored hidden gems</div>
          <h1>Discover what most tourists <em>never</em> find.</h1>
          <p className="mh-sub">
            Venture's AI researches the spots locals love and scores every one from 1 to 10 on how hidden it is.
            Build your trip around the secrets — not the crowds.
          </p>
          <div className="mh-cta">
            <Link href="/auth" className="btn btn-primary btn-lg" style={{ textDecoration: 'none', flex: 'none' }}>
              Get started free →
            </Link>
            <Link href="/explore" className="btn btn-secondary btn-lg" style={{ textDecoration: 'none', flex: 'none' }}>
              Browse cities
            </Link>
          </div>
          <div className="mh-note">
            <span className="dot" />
            No credit card · free forever · any city, anywhere
          </div>
        </div>

        {/* Floating cards visual */}
        <div className="mh-visual">
          <div className="mh-mapbg" />
          <div className="mh-pin p1" style={{ background: 'var(--t5)' }}><b>10</b></div>
          <div className="mh-pin p2" style={{ background: 'var(--t3)' }}><b>6</b></div>
          {HERO_CARDS.map(({ cls, score, cat, name, cssVar }) => (
            <div key={cls} className={`mh-card ${cls}`} style={{ '--sc': `var(${cssVar})` }}>
              <ScoreMedallion score={score} size={46} showDen={false} />
              <div className="mc-info">
                <div className="mc-cat">{cat}</div>
                <div className="mc-nm">{name}</div>
                <div className="mc-tier">{TIERS.find((t) => t.v === cssVar)?.name}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ Hiddenness spectrum ══ */}
      <section className="mk-section bordered" id="how">
        <div className="sec-eyebrow">The hiddenness score</div>
        <h2>One number tells you if it's a <em>secret</em> or a trap.</h2>
        <p className="sec-lede">
          Every spot Venture finds is scored 1–10. A 1 is on every tour bus route.
          A 10 is somewhere even seasoned travellers walk right past.
        </p>
        <div className="spectrum">
          <div className="spectrum-bar">
            {TIERS.map((t) => <span key={t.v} style={{ background: `var(${t.v})` }} />)}
          </div>
          <div className="spectrum-meds">
            {TIERS.map((t, i) => (
              <div key={t.v} className="sm-item">
                <ScoreMedallion score={SPECTRUM_SCORES[i]} size={50} showDen={false} />
                <div>
                  <div className="sm-name">{t.name}</div>
                  <div className="sm-rng">{t.rng}</div>
                </div>
                <div className="sm-desc">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ Features ══ */}
      <section className="mk-section bordered" id="features">
        <div className="sec-eyebrow">How Venture works</div>
        <h2>Research, map, and plan — <em>around the gems</em>.</h2>
        <div className="features">
          {[
            {
              num: '01', title: 'AI research',
              desc: 'Tell us a city and your interests. Our AI surfaces dozens of hidden gems and scores each one for hiddenness — streaming them in live as it discovers them.',
              icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/></svg>,
            },
            {
              num: '02', title: 'Map view',
              desc: "See every gem on a colour-coded map. The rarer the find, the warmer the pin — so the whole city becomes a heatmap of what tourists miss.",
              icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>,
            },
            {
              num: '03', title: 'Day planner',
              desc: "Drag your favourites into a day-by-day itinerary. Venture totals the cost and even tells you whether the city tourist pass is worth buying.",
              icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>,
            },
          ].map(({ num, title, desc, icon }) => (
            <div key={num} className="feature">
              <div className="fnum">{num}</div>
              <div className="ficon">{icon}</div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ Social proof stats ══ */}
      <section className="mk-section bordered">
        <div className="proof">
          <div className="pstat"><div className="pn">16+</div><div className="pl">Featured cities</div></div>
          <div className="pstat"><div className="pn">1–10</div><div className="pl">Hiddenness score</div></div>
          <div className="pstat"><div className="pn">Free</div><div className="pl">Forever, no card needed</div></div>
        </div>
      </section>

      {/* ══ Dark final CTA ══ */}
      <section className="mk-section">
        <div className="final-cta">
          <div className="sec-eyebrow" style={{ color: 'oklch(0.8 0.06 70)' }}>Start exploring</div>
          <h2 style={{ margin: '16px auto 14px' }}>Your next trip is hiding something.</h2>
          <p className="fc-sub">Join free and let Venture find the spots most travellers never will.</p>
          <Link href="/auth" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
            Get started free →
          </Link>
        </div>
      </section>

      {/* ══ Footer ══ */}
      <footer className="mk-footer">
        <div className="ft-mark">Venture</div>
        <div className="ft-links">
          <Link href="/explore">Explore</Link>
          <a href="#">About</a>
          <a href="#">Privacy</a>
          <a href="#">Contact</a>
        </div>
        <div className="ft-cr">© 2026 · DISCOVER WHAT MOST TOURISTS NEVER FIND</div>
      </footer>
    </div>
  );
}

/* ── Logged-in Dashboard ──────────────────────────────────────── */
function Dashboard({ user }) {
  const { trips, loading } = useTrips();
  const { savedIds }       = useSavedSpots(user?.uid);
  const tripModal          = useTripModal();
  const firstName          = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there';

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!user?.uid) return;
    getUser(user.uid).then((prefs) => {
      if (prefs && !prefs.onboardingComplete) setShowOnboarding(true);
    }).catch(() => {});
  }, [user?.uid]); // eslint-disable-line

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const upcoming = trips.filter((t) => {
    const d = t.destinations?.[0]?.startDate;
    return !d || new Date(d + 'T00:00:00') >= now;
  }).sort((a, b) => {
    const da = a.destinations?.[0]?.startDate ?? '9999';
    const db = b.destinations?.[0]?.startDate ?? '9999';
    return da < db ? -1 : 1;
  });
  const past = trips.filter((t) => {
    const d = t.destinations?.[0]?.startDate;
    return d && new Date(d + 'T00:00:00') < now;
  });

  const nextTrip     = upcoming[0] ?? null;
  const restUpcoming = upcoming.slice(1);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const userCities = [...new Set(trips.flatMap((t) => t.destinations?.map((d) => d.city) ?? []))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--paper)' }}>
      {showOnboarding && (
        <OnboardingModal userId={user.uid} onClose={() => setShowOnboarding(false)} />
      )}
      <TopNav />

      <main className="page">

        {/* ── Greeting ── */}
        <div className="greeting">
          <div>
            <h1>{greeting}, <em>{firstName}</em></h1>
            <div className="gsub">
              {loading ? '' : `${upcoming.length} UPCOMING · ${past.length} PAST`}
            </div>
          </div>
          <button
            onClick={() => tripModal?.openModal()}
            className="btn btn-primary"
            style={{ border: 'none', cursor: 'pointer', flexShrink: 0 }}
          >
            + Plan a new trip
          </button>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="skeleton" style={{ height: 392, borderRadius: 24 }} />
            <div className="skeleton" style={{ height: 100, borderRadius: 18 }} />
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && trips.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">✈️</div>
            <h3>No trips yet</h3>
            <p>Plan your next adventure — AI surfaces hidden gems that most tourists never find.</p>
            <button
              onClick={() => tripModal?.openModal()}
              className="btn btn-primary"
              style={{ border: 'none', cursor: 'pointer', marginTop: 8 }}
            >
              Plan my first trip →
            </button>
          </div>
        )}

        {/* ── Content ── */}
        {!loading && trips.length > 0 && (
          <>
            {/* Hero next trip */}
            {nextTrip && <TripHero key={nextTrip.id} trip={nextTrip} onDelete={() => deleteTrip(nextTrip.id)} />}

            {/* Stats */}
            <StatsStrip trips={trips} savedCount={savedIds.size} />

            {/* Upcoming */}
            {restUpcoming.length > 0 && (
              <section className="section">
                <div className="sec-head">
                  <h2>Upcoming <span className="cnt">{restUpcoming.length}</span></h2>
                  <button
                    onClick={() => tripModal?.openModal()}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--terracotta-deep)', padding: 0 }}
                  >
                    + New trip →
                  </button>
                </div>
                <div className="shelf">
                  {restUpcoming.map((t) => <TripCard key={t.id} trip={t} onDelete={() => deleteTrip(t.id)} />)}
                </div>
              </section>
            )}

            {/* Past trips */}
            {past.length > 0 && (
              <section className="section">
                <PastSection past={past} onDelete={(id) => deleteTrip(id)} />
              </section>
            )}

            {/* Trips like yours */}
            <TripsLikeYours userCities={userCities} currentUserId={user.uid} />
          </>
        )}
      </main>

      <InstallBanner />
    </div>
  );
}

/* ── Root ─────────────────────────────────────────────────────── */
export default function RootPage() {
  const { user, loading } = useAuth();
  if (loading) return <GuestHome />;
  if (!user)   return <GuestHome />;
  return <Dashboard user={user} />;
}
