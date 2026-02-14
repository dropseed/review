// Dark palette matching the desktop app (stone/warm neutrals)
export const stone = {
  950: "#0c0a09",
  900: "#1c1917",
  800: "#292524",
  700: "#44403c",
  600: "#57534e",
  500: "#78716c",
  400: "#a8a29e",
  300: "#d6d3d1",
  200: "#e7e5e3",
  50: "#fafaf9",
} as const;

// Semantic colors matching the desktop palette
export const colors = {
  // Status colors
  approved: "#10b981", // Emerald-500
  rejected: "#f43f5e", // Rose-500
  trusted: "#14b8a6", // Teal-500
  classifying: "#a78bfa", // Violet-400
  accent: "#d9923a", // Amber-500

  // File status
  added: "#22c55e", // Green-500
  modified: "#3b82f6", // Blue-500
  deleted: "#ef4444", // Red-500
  renamed: "#a855f7", // Purple-500
} as const;

// Shared border color for dark surfaces
export const borderSubtle = "rgba(168, 162, 158, 0.15)";
