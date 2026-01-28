/**
 * Compare Mobile Theme
 * Matches the desktop app's dark aesthetic with stone colors
 */

export const colors = {
  // Stone palette (matching desktop)
  stone: {
    50: "#fafaf9",
    100: "#f5f5f4",
    200: "#e7e5e4",
    300: "#d6d3d1",
    400: "#a8a29e",
    500: "#78716c",
    600: "#57534e",
    700: "#44403c",
    800: "#292524",
    900: "#1c1917",
    950: "#0c0a09",
  },

  // Background hierarchy
  bg: {
    primary: "#0c0a09", // Deepest black
    secondary: "#1c1917", // Card backgrounds
    tertiary: "#292524", // Elevated surfaces
    elevated: "#44403c", // Highest elevation
  },

  // Text hierarchy (high contrast for accessibility)
  text: {
    primary: "#fafaf9",
    secondary: "#c7c4c0",
    muted: "#a19d99",
    faint: "#918d89",
  },

  // Borders
  border: {
    subtle: "rgba(168, 162, 158, 0.1)",
    default: "rgba(168, 162, 158, 0.2)",
    strong: "rgba(168, 162, 158, 0.3)",
  },

  // Accent colors (matching desktop)
  accent: {
    amber: "#f59e0b",
    lime: "#84cc16",
    rose: "#f43f5e",
    sky: "#0ea5e9",
    cyan: "#06b6d4",
    emerald: "#10b981",
    violet: "#8b5cf6",
  },

  // Brand colors
  brand: {
    terracotta: {
      400: "#c75d4a",
      500: "#a63d2f",
      600: "#8b3426",
    },
    sage: {
      400: "#6b9b7a",
      500: "#4a7c59",
      600: "#3d6549",
    },
  },

  // Semantic colors
  success: "#84cc16", // Lime for approved
  error: "#f43f5e", // Rose for rejected
  warning: "#f59e0b", // Amber for warnings
  info: "#06b6d4", // Cyan for info/trusted

  // Status-specific backgrounds
  status: {
    approved: {
      bg: "rgba(132, 204, 22, 0.1)",
      border: "rgba(132, 204, 22, 0.2)",
    },
    rejected: {
      bg: "rgba(244, 63, 94, 0.1)",
      border: "rgba(244, 63, 94, 0.2)",
    },
    trusted: {
      bg: "rgba(6, 182, 212, 0.1)",
      border: "rgba(6, 182, 212, 0.2)",
    },
  },

  // Code diff colors (matching desktop)
  diff: {
    added: {
      bg: "rgba(132, 204, 22, 0.12)",
      text: "#bef264",
      indicator: "#84cc16",
    },
    removed: {
      bg: "rgba(244, 63, 94, 0.12)",
      text: "#fda4af",
      indicator: "#f43f5e",
    },
    context: {
      bg: "transparent",
      text: "#c7c4c0",
    },
    lineNumber: "#57534e",
  },
} as const;

// Spacing scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
} as const;

// Border radius
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

// Typography
export const typography = {
  // Font families
  fontFamily: {
    sans: "System", // Will use SF Pro on iOS
    mono: "Menlo",
  },

  // Font sizes
  fontSize: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    "2xl": 24,
    "3xl": 28,
    "4xl": 34,
  },

  // Font weights
  fontWeight: {
    normal: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
} as const;

// Shadow presets
export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
} as const;
