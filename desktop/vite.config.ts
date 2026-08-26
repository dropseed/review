import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "path";

/**
 * Fill in `public/sw.js`'s `BUILD_ID` and `PRECACHE` from what this build
 * actually emitted.
 *
 * The worker precaches the app *shell* — `index.html` and the hashed JS/CSS
 * needed to paint it — so a Home-Screen launch over a slow or absent tailnet
 * shows the app rather than a white screen. The list can't be written by hand:
 * every name in it carries a content hash that changes each build.
 *
 * Only what a first paint needs is precached: the entry chunks and their
 * *static* imports, plus their CSS. Lazily imported chunks (Shiki, Mermaid, the
 * settings modal) are deliberately left out — they would multiply the install's
 * download for screens most launches never reach — and the worker's runtime
 * cache-first rule for `/assets/` picks each of them up the first time it is
 * actually used.
 *
 * `BUILD_ID` derives from the file list, which makes the cache name change
 * exactly when its contents would: a rebuild that emits identical assets keeps
 * the warm cache, and any real change retires it in `activate`.
 */
function precacheManifest(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  let files: string[] = [];

  return {
    name: "review-precache-manifest",
    apply: "build",

    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },

    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((item) => item.type === "chunk")
          .map((chunk) => [chunk.fileName, chunk]),
      );

      const shell = new Set<string>();
      const walk = (fileName: string): void => {
        if (shell.has(fileName)) return;
        const chunk = chunks.get(fileName);
        if (!chunk) return;
        shell.add(fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) shell.add(css);
        for (const imported of chunk.imports) walk(imported);
      };

      for (const chunk of chunks.values())
        if (chunk.isEntry) walk(chunk.fileName);

      files = ["/index.html", ...[...shell].sort().map((name) => `/${name}`)];
    },

    // `closeBundle`, not `writeBundle`: `public/` is copied into `outDir` as
    // part of the write, and this rewrites the copy that lands there.
    closeBundle() {
      const sw = path.resolve(root, outDir, "sw.js");
      if (!fs.existsSync(sw)) return;

      const buildId = createHash("sha256")
        .update(files.join("\n"))
        .digest("hex")
        .slice(0, 12);

      const source = fs.readFileSync(sw, "utf8");
      const filled = source
        .replace(/^const BUILD_ID = ".*";$/m, `const BUILD_ID = "${buildId}";`)
        .replace(
          /^const PRECACHE = \[\];$/m,
          `const PRECACHE = ${JSON.stringify(files)};`,
        );

      if (filled === source) {
        this.warn(
          "sw.js: neither BUILD_ID nor PRECACHE was substituted — the service " +
            "worker will ship with no precache. Check the declarations it looks for.",
        );
        return;
      }
      fs.writeFileSync(sw, filled);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), precacheManifest()],
  // Use absolute paths for BrowserRouter compatibility
  base: "/",
  // @pierre/diffs workers use code-splitting, which requires ES module format
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./ui"),
    },
  },
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        // $REVIEW_PORT is the one override for the backend port (see
        // server::DEFAULT_PORT) — honored here too so an isolated dev
        // backend doesn't get silently proxied into whatever holds 7787
        // (an installed app with remote access on is exactly that).
        target: `http://127.0.0.1:${process.env.REVIEW_PORT ?? "7787"}`,
        // Allow WebSocket upgrades (terminal PTY sockets in web mode).
        ws: true,
      },
    },
    watch: {
      // Tell vite to ignore watching the Tauri crate
      ignored: ["**/tauri/**"],
    },
  },
});
