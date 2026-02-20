import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./ui"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./ui/test/setup.ts"],
    include: ["ui/**/*.test.ts", "ui/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "json", "html"],
      include: ["ui/**/*.ts", "ui/**/*.tsx"],
      exclude: ["ui/**/*.test.ts", "ui/**/*.test.tsx", "ui/test/**"],
    },
  },
});
