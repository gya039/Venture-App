'use client';

import { useState, useEffect } from 'react';

/**
 * ResearchLoader — animated skeleton shown while AI research runs.
 * Props:
 *   city {string}  City name to display in the status line
 */
export default function ResearchLoader({ city }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const msg =
    elapsed < 10  ? 'Scanning Reddit, travel blogs, and local forums…' :
    elapsed < 25  ? 'Curating hidden gems and local secrets…' :
    elapsed < 45  ? 'Almost there — scoring each spot…' :
                    'Nearly done — finalising results…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0' }}>

      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
        <span style={{
          width:        '8px',
          height:       '8px',
          borderRadius: '50%',
          background:   'var(--accent)',
          flexShrink:   0,
          animation:    'pulse 1.2s ease-in-out infinite',
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Researching hidden gems{city ? ` in ${city}` : ''}…
        </p>
        <span style={{
          marginLeft:   'auto',
          fontSize:     '0.72rem',
          color:        'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {elapsed}s
        </span>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', lineHeight: 1.5 }}>
        {msg}
      </p>

      {/* Skeleton cards */}
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            height:         i === 1 ? '90px' : i === 3 ? '76px' : '84px',
            background:     'var(--card)',
            borderRadius:   '12px',
            border:         '1px solid var(--border)',
            borderLeft:     '3px solid var(--border)',
            animation:      'pulse 1.5s ease-in-out infinite',
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}
