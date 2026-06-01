'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useTrips } from '@/hooks/useTrips';
import { useSavedSpots } from '@/hooks/useSavedSpots';
import { getUser, updateUserPrefs } from '@/lib/db';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import TopNav from '@/components/TopNav';
import { INTERESTS } from '@/constants/interests';

function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map((c) =>
    String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))
  ).join('');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/* ── Badge definitions ─────────────────────────────────────── */
const BADGES = [
  { id: 'first_explorer', icon: '🧭', name: 'First Explorer', desc: 'Created your first trip',        check: ({ trips }) => trips.length >= 1 },
  { id: 'gem_hunter',     icon: '💎', name: 'Gem Hunter',     desc: 'Saved 5 or more spots',         check: ({ savedCount }) => savedCount >= 5 },
  { id: 'wanderlust',     icon: '🌍', name: 'Wanderlust',     desc: 'Researched 3 or more cities',   check: ({ citiesResearched }) => citiesResearched >= 3 },
  { id: 'jet_setter',     icon: '✈️', name: 'Jet Setter',     desc: 'Planned 5 or more trips',       check: ({ trips }) => trips.length >= 5 },
  { id: 'local_expert',   icon: '⭐', name: 'Local Expert',   desc: 'Saved 20 or more spots',        check: ({ savedCount }) => savedCount >= 20 },
  { id: 'world_traveller',icon: '🗺️', name: 'World Traveller',desc: 'Explored cities on 3+ continents', check: ({ continents }) => continents >= 3 },
];

const COUNTRY_TO_CONTINENT = {
  PT: 'EU', ES: 'EU', FR: 'EU', DE: 'EU', IT: 'EU', GB: 'EU', NL: 'EU',
  BE: 'EU', AT: 'EU', CZ: 'EU', HU: 'EU', PL: 'EU', DK: 'EU', SE: 'EU',
  JP: 'AS', KR: 'AS', TH: 'AS', SG: 'AS', CN: 'AS', IN: 'AS', VN: 'AS',
  US: 'AM', CA: 'AM', MX: 'AM', BR: 'AM', AR: 'AM',
  AU: 'OC', NZ: 'OC',
  ZA: 'AF', NG: 'AF', EG: 'AF', MA: 'AF',
};

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { trips, loading: tripsLoading } = useTrips();
  const { savedIds } = useSavedSpots(user?.uid);
  const router = useRouter();

  const [userPrefs,  setUserPrefs]  = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    getUser(user.uid).then(setUserPrefs).catch(() => {});
  }, [user?.uid]); // eslint-disable-line

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const allDests      = trips.flatMap((t) => t.destinations ?? []);
  const researchedCities = [...new Set(allDests.filter((d) => d.researchDone).map((d) => d.city))];
  const pastTrips     = trips.filter((t) => { const d = t.destinations?.[0]?.startDate; return d && new Date(d + 'T00:00:00') < now; });
  const continentSet  = new Set(allDests.map((d) => COUNTRY_TO_CONTINENT[d.countryCode?.toUpperCase()]).filter(Boolean));
  const savedInterests = userPrefs?.interests ?? [];
  const interestObjs   = INTERESTS.filter((i) => savedInterests.includes(i.id));

  const badgeCtx = { trips, savedCount: savedIds.size, citiesResearched: researchedCities.length, continents: continentSet.size };

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(auth); router.push('/'); }
    catch { setSigningOut(false); }
  }

  if (authLoading) return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="skel" style={{ width: 60, height: 60, borderRadius: '50%' }} />
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
        <div>
          <p style={{ color: 'var(--muted)', marginBottom: 20, fontFamily: 'var(--serif)', fontStyle: 'italic' }}>Sign in to view your profile.</p>
          <Link href="/auth" className="btn btn-primary" style={{ textDecoration: 'none' }}>Sign in →</Link>
        </div>
      </div>
    </div>
  );

  // Format email prefix into a readable name: "yankapiankov" → "Yankapiankov",
  // "john.doe123" → "John Doe"
  function formatEmailName(email = '') {
    return email
      .split('@')[0]                          // take local part
      .replace(/[._\-]+/g, ' ')              // dots/dashes → spaces
      .replace(/\d+/g, '')                   // strip trailing numbers
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ') || 'Traveller';
  }

  const displayName  = user.displayName || formatEmailName(user.email);
  const initials     = displayName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'YA';
  const memberSince  = userPrefs?.createdAt
    ? (userPrefs.createdAt?.toDate?.() ?? new Date(userPrefs.createdAt))
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()
    : `${new Date().getFullYear()}`;

  // Explorer rank derived from earned badges count
  const earnedCount = BADGES.filter((b) => b.check(badgeCtx)).length;
  const rankName = earnedCount >= 5 ? 'Master Explorer'
    : earnedCount >= 3 ? 'Seasoned Explorer'
    : earnedCount >= 1 ? 'Explorer'
    : 'Newcomer';
  const rankLvl = Math.max(1, earnedCount);

  const recentTrips = [...trips].sort((a, b) => {
    const da = a.destinations?.[0]?.startDate ?? '';
    const db = b.destinations?.[0]?.startDate ?? '';
    return db > da ? 1 : -1;
  }).slice(0, 5);

  // Stamp year from member since
  const stampYear = userPrefs?.createdAt
    ? (userPrefs.createdAt?.toDate?.() ?? new Date(userPrefs.createdAt)).getFullYear()
    : new Date().getFullYear();

  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <TopNav />

      <div className="pf-wrap">

        {/* ══ Passport banner — cartographic cover ══ */}
        <div className="pf-banner">
          <div className="pf-cover">
            {/* Passport label — top left */}
            <span className="passport">
              <span className="dia" />
              Venture · Traveller
            </span>

            {/* Rotated stamp — top right */}
            <div className="pf-stamp">
              <span className="ps-top">VENTURE</span>
              <span className="ps-mid">{stampYear}</span>
              <span className="ps-star">✦</span>
              <span className="ps-bot">EXPLORER</span>
            </div>

            {/* Coordinates — bottom right */}
            <span className="coord">N48°51′ · E2°21′</span>
          </div>

          <div className="pf-id">
            {/* Gold-ringed avatar */}
            <div className="pf-avatar">{initials}</div>

            {/* Name block */}
            <div className="pf-name-block">
              <div className="pf-name">{displayName}</div>
              <div className="pf-meta">
                <span className="em">{user.email}</span>
                <span className="sep">·</span>
                Member since {memberSince}
              </div>
              {/* Explorer rank chip */}
              <span className="pf-rank">
                <span className="rk-dia" />
                {rankName}
                <span className="rk-lvl">LVL {rankLvl}</span>
              </span>
            </div>

            {/* Actions */}
            <div className="pf-actions">
              <button
                className="btn btn-secondary btn-sm pf-edit"
                style={{ border: '1px solid var(--line-strong)', cursor: 'pointer', textDecoration: 'none' }}
                onClick={() => window.location.href = '/settings'}
              >
                Edit profile
              </button>
              <button
                className="pf-signout"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>

        {/* ══ Stats strip ══ */}
        {!tripsLoading && (
          <div className="pf-stats">
            <div className="pf-stat"><div className="n">{researchedCities.length}</div><div className="l">Cities explored</div></div>
            <div className="pf-stat"><div className="n">{trips.length}</div><div className="l">Total trips</div></div>
            <div className="pf-stat"><div className="n">{savedIds.size}</div><div className="l">Spots saved</div></div>
            <div className="pf-stat"><div className="n">{pastTrips.length}</div><div className="l">Trips completed</div></div>
          </div>
        )}

        {/* ══ Two-col layout ══ */}
        <div className="pf-cols">

          {/* ── Left col: badges + style ── */}
          <div>
            {/* Badges */}
            <div className="pf-block">
              <h2>Achievements <span className="cnt">{BADGES.filter((b) => b.check(badgeCtx)).length}/{BADGES.length}</span></h2>
              <div className="badges">
                {BADGES.map((badge) => {
                  const earned = badge.check(badgeCtx);
                  return (
                    <div key={badge.id} className={`badge-fg${earned ? ' earned' : ' locked'}`}>
                      <div className="bg-medal">{badge.icon}</div>
                      <div className="bg-nm">{badge.name}</div>
                      <div className="bg-d">{badge.desc}</div>
                      <div className="bg-lock">{earned ? '✓ Earned' : 'Locked'}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Travel style */}
            {interestObjs.length > 0 && (
              <div className="pf-block">
                <h2>Travel style</h2>
                <div className="style-tags">
                  {interestObjs.map((i) => (
                    <span key={i.id} className="style-tag">
                      <span className="ico">{i.icon}</span>
                      {i.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Cities explored chips */}
            {researchedCities.length > 0 && (
              <div className="pf-block">
                <h2>Cities explored <span className="cnt">{researchedCities.length}</span></h2>
                <div className="city-chips">
                  {researchedCities.map((city) => {
                    const dest = allDests.find((d) => d.city === city);
                    return (
                      <div key={city} className="city-chip">
                        <span className="cc-flag">{flagEmoji(dest?.countryCode)}</span>
                        <span className="cc-nm">{city}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right col: recent trips ── */}
          <div>
            <div className="pf-block">
              <h2>Recent trips <span className="cnt">{trips.length}</span></h2>

              {tripsLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1,2,3].map((i) => <div key={i} className="skel" style={{ height: 70, borderRadius: 14 }} />)}
                </div>
              )}

              {!tripsLoading && trips.length === 0 && (
                <div className="empty-state" style={{ padding: 28 }}>
                  <div className="empty-state-icon">✈️</div>
                  <h3>No trips yet</h3>
                  <p>Plan your first adventure.</p>
                  <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none', marginTop: 8 }}>Start planning →</Link>
                </div>
              )}

              {recentTrips.map((t) => {
                const first = t.destinations?.[0];
                const label = t.name ?? (t.isMultiCity
                  ? t.destinations.map((d) => d.city).join(' · ')
                  : first?.city ?? 'Trip');
                const isPast = first?.startDate && new Date(first.startDate + 'T00:00:00') < now;
                return (
                  <Link key={t.id} href={`/trips/${t.id}`} className="pf-trip">
                    <div className="pf-trip-inner">
                      <span className="pt-flag">{flagEmoji(first?.countryCode)}</span>
                      <div className="pt-main">
                        <div className="pt-dest">{label}</div>
                        <div className="pt-meta">
                          {fmtDate(first?.startDate) || 'Dates TBD'}
                          {t.destinations?.length > 1 && ` · ${t.destinations.length} cities`}
                        </div>
                      </div>
                      <span className={`pt-stat${isPast ? '' : ' up'}`}>
                        {isPast ? '✓ Done' : 'Upcoming'}
                      </span>
                    </div>
                  </Link>
                );
              })}

              <div style={{ marginTop: 16 }}>
                <Link href="/" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--terracotta-deep)', textDecoration: 'none' }}>
                  View all trips →
                </Link>
              </div>
            </div>

            {/* Settings */}
            <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', background: 'var(--card)' }}>
              <p style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, marginBottom: 4 }}>Account settings</p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Currency, preferences, app settings</p>
              <Link href="/settings" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--terracotta-deep)', textDecoration: 'none' }}>
                Settings →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
