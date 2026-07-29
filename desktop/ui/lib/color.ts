/**
 * Small color helpers shared by the theme resolver and the terminal palette.
 *
 * These live here rather than in either caller because both need to reason
 * about colors that arrive from outside the app — VS Code theme JSON and the
 * live CSS custom properties — where the exact hex form is not guaranteed.
 */

/** Parse a hex color (#RGB, #RRGGBB, or #RRGGBBAA) into [r, g, b]. */
export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length >= 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Mix two hex colors by a ratio (0 = a, 1 = b). Returns #RRGGBB. */
export function mixColors(a: string, b: string, ratio: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * ratio);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * ratio);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Relative luminance per WCAG. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(rgb[0]) +
    0.7152 * channel(rgb[1]) +
    0.0722 * channel(rgb[2])
  );
}

/** WCAG contrast ratio between two colors, 1 (identical) to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
