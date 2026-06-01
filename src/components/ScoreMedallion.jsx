'use client';

import { useState, useEffect, useRef } from 'react';
import { getHiddennessLevel } from '@/constants/hiddenness';

/**
 * ScoreMedallion — the recurring rarity indicator.
 *
 * A circular SVG progress ring filled score/10, colored by tier.
 * Scores 9–10 get a gold glow via drop-shadow filter.
 * When `animate` is true the ring sweeps and the number counts up
 * from 0 → score over 620ms (cubic ease-out). Use this on first
 * reveal (streaming cards, drawer open).
 *
 * Props:
 *   score    {number}  1–10
 *   size     {number}  px diameter (default 50)
 *   animate  {boolean} trigger count-up animation (default false)
 *   showDen  {boolean} show "/10" denominator (default true)
 */
export default function ScoreMedallion({ score = 5, size = 50, animate = false, showDen = true }) {
  const level = getHiddennessLevel(score);
  const [prog, setProg] = useState(animate ? 0 : 1);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!animate) {
      setProg(1);
      return;
    }
    const DUR = 620;
    const t0 = performance.now();

    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      // cubic ease-out
      setProg(1 - Math.pow(1 - p, 3));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate, score]);

  const r          = 42;                     // SVG ring radius (viewBox 100×100)
  const C          = 2 * Math.PI * r;        // circumference ≈ 263.9
  const strokeWidth = size <= 40 ? 7 : 6;
  const num        = Math.round(prog * score);
  const fill       = prog * (score / 10) * C;
  const isGold     = score >= 9;

  return (
    <div
      className={'medallion' + (isGold ? ' glow' : '')}
      style={{ width: size, height: size, '--sc': `var(${level.cssVar})` }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100">
        {/* Track ring */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth={strokeWidth}
          opacity="0.6"
        />
        {/* Progress arc */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke="var(--sc)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${fill} ${C}`}
        />
      </svg>

      <div className="mv">
        <span className="mnum" style={{ fontSize: size * 0.42 }}>{num}</span>
        {showDen && (
          <span className="mden" style={{ fontSize: size * 0.16, marginTop: size * 0.02 }}>
            /10
          </span>
        )}
      </div>
    </div>
  );
}
