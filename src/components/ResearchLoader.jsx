'use client';

import { useState, useEffect } from 'react';

/**
 * ResearchLoader — shown while AI research streams in.
 *
 * Props:
 *   city   {string}  City name
 *   status {string}  Live status message from the SSE stream
 *   count  {number}  How many spots have arrived so far
 */
export default function ResearchLoader({ city, status, count = 0 }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fallback message when no SSE status yet
  const displayMsg = status || (
    elapsed < 8  ? `Scanning travel blogs and local forums for ${city ?? 'your city'}…` :
    elapsed < 20 ? 'Curating hidden gems and local secrets…' :
    elapsed < 35 ? 'Scoring each spot by how well-hidden it is…' :
                   'Geocoding locations — almost done…'
  );

  // Shrink skeleton count as real spots arrive (keep at least 1 until done)
  const skeletonCount = Math.max(1, 4 - Math.floor(count / 4));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>

      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--accent)', flexShrink: 0, marginTop: 5,
          animation: 'pulse 1.2s ease-in-out infinite',
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', flex: 1, lineHeight: 1.5 }}>
          {displayMsg}
        </p>
        <span style={{
          fontSize: '0.72rem', color: 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginTop: 2,
        }}>
          {elapsed}s
        </span>
      </div>

      {/* Live spot counter — appears once first spot arrives */}
      {count > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: 'rgba(245,158,11,0.07)',
          border: '1px solid rgba(245,158,11,0.18)',
          borderRadius: 8,
        }}>
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>📍</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
            {count} spot{count !== 1 ? 's' : ''} found so far…
          </span>
          <div style={{
            marginLeft: 'auto',
            display: 'flex', gap: 3,
          }}>
            {[...Array(3)].map((_, i) => (
              <span
                key={i}
                style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--accent)',
                  opacity: 0.3 + (i * 0.25),
                  animation: `pulse 1s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shrinking skeleton placeholders */}
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? 84 : 76,
            background: 'var(--card)',
            borderRadius: 12,
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--border)',
            animation: 'pulse 1.5s ease-in-out infinite',
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}
