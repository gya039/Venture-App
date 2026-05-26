/**
 * HiddennessDots — 5-dot signal-bar indicator for hiddenness score.
 *
 * score 1–2  → 1 dot lit  (tourist)
 * score 3–4  → 2 dots lit (worth knowing)
 * score 5–6  → 3 dots lit (hidden gem)
 * score 7–8  → 4 dots lit (local secret)
 * score 9–10 → 5 dots lit (off the map)
 */
export default function HiddennessDots({ score = 1, size = 7, gap = 3, showScore = false }) {
  const lit = score <= 2 ? 1 : score <= 4 ? 2 : score <= 6 ? 3 : score <= 8 ? 4 : 5;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width:        size,
            height:       size,
            borderRadius: '50%',
            background:   i <= lit
              ? `hsl(${38 + (i - 1) * 4}, 95%, ${48 + (i - 1) * 3}%)`   // amber ramp
              : 'rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
        />
      ))}
      {showScore && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 2 }}>
          {score}/10
        </span>
      )}
    </div>
  );
}
