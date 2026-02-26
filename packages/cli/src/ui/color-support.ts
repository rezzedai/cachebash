/**
 * Terminal color capability detection.
 *
 * Detects what level of color the terminal supports and provides
 * helpers that gracefully degrade:
 *   - Level 3: true-color (24-bit) — COLORTERM=truecolor/24bit
 *   - Level 2: 256-color — TERM contains "256color"
 *   - Level 1: basic 16-color ANSI
 *   - Level 0: no color (NO_COLOR set, not a TTY, dumb terminal)
 */

export const enum ColorLevel {
  None = 0,
  Basic = 1,
  Color256 = 2,
  TrueColor = 3,
}

export function detectColorLevel(): ColorLevel {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return ColorLevel.None;

  const term = process.env.TERM ?? "";
  if (term === "dumb") return ColorLevel.None;

  const colorterm = process.env.COLORTERM ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit") return ColorLevel.TrueColor;

  if (term.includes("256color")) return ColorLevel.Color256;

  // Most modern terminals support at least basic color
  return ColorLevel.Basic;
}

const level = detectColorLevel();

/** Current terminal color level (cached at import time). */
export const colorLevel = level;

/** Wrap text in a standard 4-bit ANSI foreground code. */
export function fg(code: number, text: string): string {
  if (level === ColorLevel.None) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

/** Wrap text in a standard 4-bit ANSI background code. */
export function bg(code: number, text: string): string {
  if (level === ColorLevel.None) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

/**
 * Apply a 24-bit RGB foreground color, degrading gracefully:
 *   TrueColor → \x1b[38;2;r;g;b
 *   256-color → nearest 256-color index
 *   Basic     → nearest 4-bit ANSI code
 *   None      → plain text
 */
export function fgRgb(r: number, g: number, b: number, text: string): string {
  switch (level) {
    case ColorLevel.TrueColor:
      return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
    case ColorLevel.Color256:
      return `\x1b[38;5;${rgbTo256(r, g, b)}m${text}\x1b[0m`;
    case ColorLevel.Basic:
      return `\x1b[${rgbToBasic(r, g, b)}m${text}\x1b[0m`;
    default:
      return text;
  }
}

/**
 * Apply a 24-bit RGB background color, degrading gracefully.
 */
export function bgRgb(r: number, g: number, b: number, text: string): string {
  switch (level) {
    case ColorLevel.TrueColor:
      return `\x1b[48;2;${r};${g};${b}m${text}\x1b[0m`;
    case ColorLevel.Color256:
      return `\x1b[48;5;${rgbTo256(r, g, b)}m${text}\x1b[0m`;
    case ColorLevel.Basic:
      return `\x1b[${rgbToBasic(r, g, b) + 10}m${text}\x1b[0m`;
    default:
      return text;
  }
}

/** Map RGB to the nearest xterm-256 color index (16-231 cube + 232-255 grays). */
function rgbTo256(r: number, g: number, b: number): number {
  // Check if it's close to a grayscale value
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round((r - 8) / 247 * 24) + 232;
  }
  // Map to 6x6x6 color cube (indices 16-231)
  const ri = Math.round(r / 255 * 5);
  const gi = Math.round(g / 255 * 5);
  const bi = Math.round(b / 255 * 5);
  return 16 + 36 * ri + 6 * gi + bi;
}

/** Map RGB to the nearest basic 4-bit ANSI foreground code (30-37). */
function rgbToBasic(r: number, g: number, b: number): number {
  const brightness = (r + g + b) / 3;
  if (brightness < 64) return 30;  // black
  // Determine dominant channel
  if (r > g && r > b) return brightness > 170 ? 91 : 31; // red / bright red
  if (g > r && g > b) return brightness > 170 ? 92 : 32; // green / bright green
  if (b > r && b > g) return brightness > 170 ? 94 : 34; // blue / bright blue
  if (r > b) return brightness > 170 ? 93 : 33;          // yellow
  if (g > r) return brightness > 170 ? 96 : 36;          // cyan
  return brightness > 170 ? 97 : 37;                     // white / bright white
}
