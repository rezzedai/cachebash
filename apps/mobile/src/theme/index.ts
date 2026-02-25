/**
 * CacheBash v2 Mobile Theme
 * Dark-mode-first design system
 */

export const theme = {
  colors: {
    // Background layers
    background: '#0a0a0f',
    surface: '#14141f',
    surfaceElevated: '#1e1e2e',

    // Brand colors
    primary: '#00d4ff',
    primaryDim: '#0099bb',
    secondary: '#7c3aed',

    // Status colors
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',

    // Text hierarchy
    text: '#f0f0f5',
    textSecondary: '#9ca3af',
    textMuted: '#8b95a3',

    // Borders
    border: '#2a2a3a',
  },

  spacing: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  borderRadius: {
    sm: 6,
    md: 10,
    lg: 16,
    xl: 24,
  },

  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 28,
  },
} as const;

export type Theme = typeof theme;
