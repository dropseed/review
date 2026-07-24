import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./ui"),
      // @xterm/addon-ligatures ships only an ESM build (its CJS `main` file is
      // missing), so vitest's Node resolution fails on the bare specifier.
      // Point it at the `.mjs` the browser build already uses via `module`.
      "@xterm/addon-ligatures": path.resolve(
        __dirname,
        "./node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs",
      ),
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
