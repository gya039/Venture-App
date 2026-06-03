'use client';

import { useMemo } from 'react';
import { getCityPass, getBestTier } from '@/constants/cityPasses';
import { formatPrice, getNumericPrice } from '@/lib/pricing';

/**
 * DayPassCalculator
 *
 * Props:
 *   city       {string}   — destination city name
 *   days       {object[]} — from useDayPlanner: [{ spots: [{ entryPrice, name, ... }], ... }]
 *   tripDays   {number}   — total days in this destination
 */
export default function DayPassCalculator({ city, days = [], tripDays = 1 }) {
  const pass = getCityPass(city);

  const calc = useMemo(() => {
    // Sum all entry prices across all day plan spots
    const allSpots = days.flatMap((d) => d.spots ?? []);
    const paidSpots = allSpots.filter((s) => formatPrice(s).priceType === 'paid');
    const totalEntries = paidSpots.reduce((sum, s) => sum + getNumericPrice(s), 0);

    if (!pass) return { pass: null, totalEntries, paidSpots };

    const tier = getBestTier(pass, tripDays);
    if (!tier) return { pass, totalEntries, paidSpots, tier: null };

    const transportBonus = pass.includesTransport
      ? pass.transportValue * tripDays
      : 0;

    const passValue    = totalEntries + transportBonus;
    const savings      = passValue - tier.price;
    const worthIt      = savings > 0;
    const breakEven    = tier.price - transportBonus; // need this much in entries to break even

    return {
      pass,
      tier,
      totalEntries,
      paidSpots,
      transportBonus,
      passValue,
      savings,
      worthIt,
      breakEven,
    };
  }, [pass, days, tripDays]);

  /* ── No pass data for this city ─────────────────────────────────────── */
  if (!pass) {
    return (
      <div style={{
        padding: '32px 20px',
        textAlign: 'center',
        background: 'var(--card)',
        borderRadius: 14,
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: 10 }}>🎟️</div>
        <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          No city pass data for {city}
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          We have pass data for Amsterdam, Paris, Rome, Barcelona, Vienna, Prague, Lisbon, Berlin, Budapest and Copenhagen.
        </p>
      </div>
    );
  }

  /* ── No spots planned yet ───────────────────────────────────────────── */
  if (calc.paidSpots.length === 0) {
    return (
      <div style={{
        padding: '32px 20px',
        textAlign: 'center',
        background: 'var(--card)',
        borderRadius: 14,
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: 10 }}>📅</div>
        <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Build your day plan first
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Add spots with entry fees to your Days and we'll calculate whether the {pass.name} is worth buying.
        </p>
      </div>
    );
  }

  const { tier, totalEntries, transportBonus, savings, worthIt, breakEven } = calc;

  /* ── Verdict colors ─────────────────────────────────────────────────── */
  const verdictColor  = worthIt ? '#22c55e' : '#f59e0b';
  const verdictBg     = worthIt ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)';
  const verdictBorder = worthIt ? 'rgba(34,197,94,0.2)'  : 'rgba(245,158,11,0.2)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Pass identity ──────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.5rem', flexShrink: 0,
        }}>
          🎟️
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            {pass.emoji} Analysing
          </p>
          <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{pass.name}</p>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
            {pass.coverageNote}
          </p>
        </div>
      </div>

      {/* ── Verdict banner ─────────────────────────────────────────────── */}
      <div style={{
        background: verdictBg,
        border: `1px solid ${verdictBorder}`,
        borderRadius: 14,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: '1.4rem' }}>{worthIt ? '✅' : '⚠️'}</span>
          <p style={{ fontWeight: 700, fontSize: '1.05rem', color: verdictColor }}>
            {worthIt
              ? `Worth it — saves you €${Math.abs(savings).toFixed(0)}`
              : `Probably skip it — only €${Math.abs(savings).toFixed(0)} over`
            }
          </p>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {worthIt
            ? `The ${tier.label} ${pass.name} (€${tier.price}) covers your planned entries and more.`
            : `Your planned entries (€${totalEntries.toFixed(0)}) don't quite justify the ${tier.label} pass (€${tier.price}). Add more attractions to tip the balance.`
          }
        </p>
      </div>

      {/* ── Cost breakdown ─────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Cost Breakdown
          </p>
        </div>

        {/* Individual spots */}
        {calc.paidSpots.map((spot, i) => (
          <div key={spot.id ?? i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 18px',
            borderBottom: '1px solid var(--border)',
            gap: 12,
          }}>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {spot.name}
            </span>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
              €{getNumericPrice(spot).toFixed(0)}
            </span>
          </div>
        ))}

        {/* Transport bonus row */}
        {pass.includesTransport && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(245,158,11,0.04)',
          }}>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              🚇 Public transit ({tripDays} day{tripDays !== 1 ? 's' : ''})
            </span>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>
              ~€{transportBonus.toFixed(0)}
            </span>
          </div>
        )}

        {/* Totals */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* A la carte total */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>Total à la carte</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>
              €{(totalEntries + transportBonus).toFixed(0)}
            </span>
          </div>

          {/* Pass price */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              {tier.label} {pass.name}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>
              €{tier.price}
            </span>
          </div>

          {/* Savings / difference */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: '0.83rem', fontWeight: 600, color: verdictColor }}>
              {worthIt ? 'You save' : 'Pass costs extra'}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: verdictColor }}>
              €{Math.abs(savings).toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Break-even hint ────────────────────────────────────────────── */}
      {!worthIt && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.15)',
          borderRadius: 10,
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}>
          💡 You need <strong style={{ color: 'var(--text-secondary)' }}>€{breakEven.toFixed(0)}</strong> in paid attractions to break even on this pass. Add more spots to your day plan to hit that threshold.
        </div>
      )}

      {/* ── Tier comparison ────────────────────────────────────────────── */}
      {pass.tiers.length > 1 && (
        <div style={{
          background: 'var(--card)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              All Pass Tiers
            </p>
          </div>
          {pass.tiers.map((t) => {
            const isSelected = t.days === tier.days;
            return (
              <div
                key={t.days}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '11px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'rgba(245,158,11,0.06)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSelected && <span style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>●</span>}
                  <span style={{ fontSize: '0.83rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {t.label}
                  </span>
                  {isSelected && (
                    <span style={{
                      fontSize: '0.65rem', background: 'rgba(245,158,11,0.15)',
                      color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 600,
                    }}>
                      Recommended
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? 700 : 400, color: isSelected ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  €{t.price}
                </span>
              </div>
            );
          })}
          {/* Buy link */}
          <div style={{ padding: '12px 18px' }}>
            <a
              href={pass.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '10px',
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: 8,
                color: 'var(--accent)',
                fontSize: '0.83rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Buy {pass.name} →
            </a>
          </div>
        </div>
      )}

    </div>
  );
}
