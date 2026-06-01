// Hiddenness score system — 1 (tourist staple) → 10 (off the map)
// Five tiers mapped to Field Guide tier colors (approximated as hex for inline usage).
// The CSS variables --t1 through --t5 hold the precise oklch values.
export const HIDDENNESS_LEVELS = [
  { min: 1,  max: 2,  label: 'Tourist Trail',   cssVar: '--t1', color: '#879ab5', tierIdx: 0 },
  { min: 3,  max: 4,  label: 'Well-Trodden',    cssVar: '--t2', color: '#b5a47a', tierIdx: 1 },
  { min: 5,  max: 6,  label: 'Worth a Detour',  cssVar: '--t3', color: '#c8913a', tierIdx: 2 },
  { min: 7,  max: 8,  label: 'Local Secret',    cssVar: '--t4', color: '#b85a33', tierIdx: 3 },
  { min: 9,  max: 10, label: 'Off the Radar',   cssVar: '--t5', color: '#d4a020', tierIdx: 4 },
];

/**
 * Returns the hiddenness level object for a given score (1–10).
 * Falls back to Tourist Trail if score is out of range.
 */
export function getHiddennessLevel(score) {
  return (
    HIDDENNESS_LEVELS.find((l) => score >= l.min && score <= l.max) ??
    HIDDENNESS_LEVELS[0]
  );
}

/** Returns the CSS variable string for a score, e.g. "var(--t4)" */
export function getTierVar(score) {
  return `var(${getHiddennessLevel(score).cssVar})`;
}
