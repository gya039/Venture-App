/** Convert a 2-letter ISO country code to its flag emoji. */
export function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map((c) =>
    String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))
  ).join('');
}
